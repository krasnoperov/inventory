import { injectable, inject, optional } from 'inversify';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { UsageEventDAO, type UsageEventMetadata } from '../../dao/usage-event-dao';
import { UserDAO } from '../../dao/user-dao';
import { PolarService } from './polarService';
import type { Database } from '../../db/types';
import { TYPES } from '../../core/di-types';

export const USAGE_EVENTS = {
  // Claude (Anthropic) - split by token type for accurate pricing
  CLAUDE_INPUT_TOKENS: 'claude_input_tokens',
  CLAUDE_OUTPUT_TOKENS: 'claude_output_tokens',
  // Gemini (NanoBanana) - images + tokens
  GEMINI_IMAGES: 'gemini_images',
  GEMINI_INPUT_TOKENS: 'gemini_input_tokens',
  GEMINI_OUTPUT_TOKENS: 'gemini_output_tokens',
} as const;

export type UsageEventName = (typeof USAGE_EVENTS)[keyof typeof USAGE_EVENTS];

export interface UsageStats {
  period: {
    start: Date;
    end: Date;
  };
  usage: {
    [key: string]: {
      used: number;
      limit: number | null;
      remaining: number | null;
    };
  };
  estimatedCost?: {
    amount: number;
    currency: string;
  };
}

export interface QuotaCheck {
  allowed: boolean;
  remaining: number | null;
  limit: number | null;
  message?: string;
}

/**
 * Result of pre-check before performing a limited action
 * Combines quota check + rate limit check in one response
 */
export interface PreCheckResult {
  allowed: boolean;
  // Quota info
  quotaUsed: number;
  quotaLimit: number | null;
  quotaRemaining: number | null;
  // Rate limit info
  rateLimitUsed: number;
  rateLimitMax: number;
  rateLimitRemaining: number;
  rateLimitResetsAt: Date | null;
  // Denial reason (if not allowed)
  denyReason?: 'quota_exceeded' | 'rate_limited';
  denyMessage?: string;
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  windowSeconds: number;  // Time window in seconds
  maxRequests: number;    // Max requests per window
}

export interface SyncResult {
  synced: number;
  failed: number;
}

export interface CustomerSyncResult {
  created: number;
  failed: number;
}

// Default rate limits per service
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  claude: { windowSeconds: 60, maxRequests: 20 },
  nanobanana: { windowSeconds: 60, maxRequests: 10 },
};

@injectable()
export class UsageService {
  constructor(
    @inject(UsageEventDAO) private usageEventDAO: UsageEventDAO,
    @inject(UserDAO) private userDAO: UserDAO,
    @inject(PolarService) @optional() private polarService: PolarService | null,
    @inject(TYPES.Database) private db: Kysely<Database>,
  ) {}

  /**
   * Track Claude API token usage
   * Creates separate events for input and output tokens (different pricing) in local storage.
   * Events are synced to Polar via the cron job (syncPendingEvents) for reliability.
   */
  async trackClaudeUsage(
    userId: number,
    tokensIn: number,
    tokensOut: number,
    model: string,
    requestId?: string
  ): Promise<void> {
    const baseMetadata: UsageEventMetadata = {
      model,
      request_id: requestId,
    };

    // Track input tokens locally
    if (tokensIn > 0) {
      await this.usageEventDAO.create({
        userId,
        eventName: USAGE_EVENTS.CLAUDE_INPUT_TOKENS,
        quantity: tokensIn,
        metadata: { ...baseMetadata, token_type: 'input' },
      });
    }

    // Track output tokens locally
    if (tokensOut > 0) {
      await this.usageEventDAO.create({
        userId,
        eventName: USAGE_EVENTS.CLAUDE_OUTPUT_TOKENS,
        quantity: tokensOut,
        metadata: { ...baseMetadata, token_type: 'output' },
      });
    }
    // Note: Events are synced to Polar via cron job (every 5 min) with proper
    // deduplication (externalId) and retry logic. No fire-and-forget here.
  }

  /**
   * Track Gemini/NanoBanana image generation
   * Tracks: image count + input/output tokens (if available) in local storage.
   * Events are synced to Polar via the cron job (syncPendingEvents) for reliability.
   */
  async trackImageGeneration(
    userId: number,
    imageCount: number,
    model: string,
    operation?: string,
    aspectRatio?: string,
    tokenUsage?: { inputTokens: number; outputTokens: number }
  ): Promise<void> {
    const baseMetadata: UsageEventMetadata = {
      model,
      operation,
      aspect_ratio: aspectRatio,
    };

    // Track image count locally
    await this.usageEventDAO.create({
      userId,
      eventName: USAGE_EVENTS.GEMINI_IMAGES,
      quantity: imageCount,
      metadata: baseMetadata,
    });

    // Track tokens locally (if available)
    if (tokenUsage?.inputTokens && tokenUsage.inputTokens > 0) {
      await this.usageEventDAO.create({
        userId,
        eventName: USAGE_EVENTS.GEMINI_INPUT_TOKENS,
        quantity: tokenUsage.inputTokens,
        metadata: { ...baseMetadata, token_type: 'input' },
      });
    }

    if (tokenUsage?.outputTokens && tokenUsage.outputTokens > 0) {
      await this.usageEventDAO.create({
        userId,
        eventName: USAGE_EVENTS.GEMINI_OUTPUT_TOKENS,
        quantity: tokenUsage.outputTokens,
        metadata: { ...baseMetadata, token_type: 'output' },
      });
    }
    // Note: Events are synced to Polar via cron job (every 5 min) with proper
    // deduplication (externalId) and retry logic. No fire-and-forget here.
  }

  /**
   * Sync pending local events to Polar
   * Called by the Polar worker cron job every 5 minutes
   *
   * Groups events by type:
   * - Claude token events: Sent as LLM events with proper metadata
   * - Gemini image events: Sent with quantity in metadata
   * - Gemini token events: Sent as LLM events with proper metadata
   *
   * Uses externalId for deduplication - Polar ignores events with duplicate externalId,
   * making it safe to retry on transient failures.
   *
   * Reliability pattern:
   * 1. Increment sync_attempts BEFORE calling Polar (track attempt even if we crash)
   * 2. Call Polar's batch ingest API
   * 3. Mark synced_at on success / record error on failure
   * 4. Events with sync_attempts >= MAX_SYNC_ATTEMPTS (3) are excluded from future syncs
   *
   * @see https://docs.polar.sh/api-reference/events/ingest
   * @see https://docs.polar.sh/features/usage-based-billing/ingestion-strategies
   */
  async syncPendingEvents(batchSize = 100): Promise<SyncResult> {
    if (!this.polarService) {
      return { synced: 0, failed: 0 };
    }

    const pendingEvents = await this.usageEventDAO.findUnsynced(batchSize);
    if (pendingEvents.length === 0) {
      return { synced: 0, failed: 0 };
    }

    const eventIds = pendingEvents.map((e) => e.id);

    try {
      // Mark sync attempt BEFORE sending to Polar (for tracking)
      await this.usageEventDAO.incrementSyncAttempts(eventIds);

      // Group events by type for proper formatting
      const claudeEvents = pendingEvents.filter((e) =>
        e.event_name.startsWith('claude_')
      );
      const geminiTokenEvents = pendingEvents.filter((e) =>
        e.event_name === USAGE_EVENTS.GEMINI_INPUT_TOKENS ||
        e.event_name === USAGE_EVENTS.GEMINI_OUTPUT_TOKENS
      );
      const geminiImageEvents = pendingEvents.filter((e) =>
        e.event_name === USAGE_EVENTS.GEMINI_IMAGES
      );

      // Sync Claude LLM events - group by user and timestamp (within same second)
      if (claudeEvents.length > 0) {
        // Group input/output events that belong together
        const groupedClaude = this.groupTokenEvents(
          claudeEvents,
          'claude',
          USAGE_EVENTS.CLAUDE_INPUT_TOKENS,
          USAGE_EVENTS.CLAUDE_OUTPUT_TOKENS
        );
        await this.polarService.ingestLLMEventsBatch(
          groupedClaude.map((group) => ({
            userId: group.userId,
            eventName: 'claude_usage',
            timestamp: group.timestamp,
            externalId: group.externalId,
            llmData: {
              vendor: 'anthropic' as const,
              model: group.model,
              inputTokens: group.inputTokens,
              outputTokens: group.outputTokens,
            },
          }))
        );
      }

      // Sync Gemini LLM events (tokens)
      if (geminiTokenEvents.length > 0) {
        const groupedGemini = this.groupTokenEvents(
          geminiTokenEvents,
          'gemini',
          USAGE_EVENTS.GEMINI_INPUT_TOKENS,
          USAGE_EVENTS.GEMINI_OUTPUT_TOKENS
        );
        await this.polarService.ingestLLMEventsBatch(
          groupedGemini.map((group) => ({
            userId: group.userId,
            eventName: 'gemini_usage',
            timestamp: group.timestamp,
            externalId: group.externalId,
            llmData: {
              vendor: 'google' as const,
              model: group.model,
              inputTokens: group.inputTokens,
              outputTokens: group.outputTokens,
            },
          }))
        );
      }

      // Sync Gemini image events with quantity in metadata
      if (geminiImageEvents.length > 0) {
        await this.polarService.ingestEventsBatch(
          geminiImageEvents.map((event) => {
            const metadata = event.metadata ? JSON.parse(event.metadata) : {};
            return {
              userId: event.user_id,
              eventName: event.event_name,
              timestamp: new Date(event.created_at),
              externalId: event.id, // Use local event ID for deduplication
              metadata: {
                ...metadata,
                quantity: event.quantity,
              },
            };
          })
        );
      }

      // Mark all as synced AFTER success
      await this.usageEventDAO.markSynced(eventIds);

      return { synced: pendingEvents.length, failed: 0 };
    } catch (error) {
      // Record error for debugging
      await this.usageEventDAO.recordSyncError(eventIds, String(error));
      console.error('Failed to sync events to Polar:', error);
      return { synced: 0, failed: pendingEvents.length };
    }
  }

  /**
   * Group token events by user and approximate timestamp
   * Includes deterministic externalId for Polar deduplication
   */
  private groupTokenEvents(
    events: Array<{ id: string; user_id: number; event_name: string; quantity: number; metadata: string | null; created_at: string }>,
    prefix: 'claude' | 'gemini',
    inputEventName: string,
    outputEventName: string
  ): Array<{
    userId: number;
    timestamp: Date;
    model: string;
    inputTokens: number;
    outputTokens: number;
    externalId: string;
  }> {
    const groups: Map<string, { userId: number; timestamp: Date; model: string; inputTokens: number; outputTokens: number; externalId: string }> = new Map();

    for (const event of events) {
      const metadata = event.metadata ? JSON.parse(event.metadata) : {};
      // Group by user + timestamp (rounded to second)
      const timestampKey = new Date(event.created_at).toISOString().slice(0, 19);
      const key = `${event.user_id}:${timestampKey}`;

      if (!groups.has(key)) {
        groups.set(key, {
          userId: event.user_id,
          timestamp: new Date(event.created_at),
          model: metadata.model || 'unknown',
          inputTokens: 0,
          outputTokens: 0,
          // Deterministic externalId for Polar deduplication
          externalId: `${prefix}:${event.user_id}:${timestampKey}`,
        });
      }

      const group = groups.get(key)!;
      if (event.event_name === inputEventName) {
        group.inputTokens += event.quantity;
      } else if (event.event_name === outputEventName) {
        group.outputTokens += event.quantity;
      }
    }

    return Array.from(groups.values());
  }

  /**
   * Get usage statistics for a user
   * Combines local data with Polar data when available
   */
  async getUserUsageStats(userId: number): Promise<UsageStats> {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Get local usage for the period
    const localUsage = await this.usageEventDAO.getUserUsageForPeriod(
      userId,
      periodStart,
      periodEnd
    );

    // Try to get Polar usage (more accurate with limits)
    let polarUsage = null;
    if (this.polarService) {
      try {
        polarUsage = await this.polarService.getCustomerUsage(userId);
      } catch (err) {
        console.warn('Failed to get Polar usage:', err);
      }
    }

    // Build usage stats
    const usage: UsageStats['usage'] = {};

    // Initialize with local data
    for (const event of localUsage) {
      usage[event.eventName] = {
        used: event.totalQuantity,
        limit: null,
        remaining: null,
      };
    }

    // Override with Polar data if available (more accurate)
    if (polarUsage) {
      for (const [meterName, meterData] of Object.entries(polarUsage.meters)) {
        usage[meterName] = {
          used: meterData.used,
          limit: meterData.limit,
          remaining: meterData.limit !== null ? meterData.limit - meterData.used : null,
        };
      }
    }

    return {
      period: {
        start: periodStart,
        end: periodEnd,
      },
      usage,
    };
  }

  /**
   * Pre-check: Verify quota AND rate limit before performing a limited action
   * Uses local D1 data for fast checks (~20-40ms vs 100-500ms Polar API)
   *
   * This combines:
   * 1. Quota check: Current period usage vs cached limits (from Polar webhooks)
   * 2. Rate limit: Fixed-window request counter
   *
   * @param userId - User ID
   * @param service - Service to check ('claude' or 'nanobanana')
   * @param rateLimit - Optional rate limit config (defaults per service)
   * @returns PreCheckResult with allowed status and detailed info
   *
   * @see https://docs.polar.sh/features/usage-based-billing/meters
   */
  async preCheck(
    userId: number,
    service: 'claude' | 'nanobanana',
    rateLimit?: RateLimitConfig
  ): Promise<PreCheckResult> {
    const eventName = service === 'claude'
      ? USAGE_EVENTS.CLAUDE_OUTPUT_TOKENS
      : USAGE_EVENTS.GEMINI_IMAGES;

    const rateLimitConfig = rateLimit || DEFAULT_RATE_LIMITS[service];
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const windowStart = new Date(now.getTime() - rateLimitConfig.windowSeconds * 1000).toISOString();

    // Single query: get user + aggregate usage for current period
    const result = await this.db
      .selectFrom('users as u')
      .leftJoin('usage_events as e', (join) =>
        join
          .onRef('e.user_id', '=', 'u.id')
          .on('e.event_name', '=', eventName)
          .on('e.created_at', '>=', periodStart)
      )
      .select([
        'u.id',
        'u.quota_limits',
        'u.rate_limit_count',
        'u.rate_limit_window_start',
      ])
      .select((eb) =>
        eb.fn.coalesce(
          eb.fn.sum<number>('e.quantity'),
          sql<number>`0`
        ).as('total_used')
      )
      .where('u.id', '=', userId)
      .groupBy(['u.id', 'u.quota_limits', 'u.rate_limit_count', 'u.rate_limit_window_start'])
      .executeTakeFirst();

    if (!result) {
      return {
        allowed: false,
        quotaUsed: 0,
        quotaLimit: null,
        quotaRemaining: null,
        rateLimitUsed: 0,
        rateLimitMax: rateLimitConfig.maxRequests,
        rateLimitRemaining: 0,
        rateLimitResetsAt: null,
        denyReason: 'quota_exceeded',
        denyMessage: 'User not found',
      };
    }

    // Parse quota limits from cached JSON
    const limits: Record<string, number | null> = result.quota_limits
      ? JSON.parse(result.quota_limits)
      : {};
    const quotaLimit = limits[eventName] ?? null;
    const quotaUsed = Number(result.total_used) || 0;
    const quotaRemaining = quotaLimit !== null ? Math.max(0, quotaLimit - quotaUsed) : null;

    // Check rate limit (fixed window)
    const windowExpired = !result.rate_limit_window_start ||
      result.rate_limit_window_start < windowStart;
    const rateLimitUsed = windowExpired ? 0 : (result.rate_limit_count || 0);
    const rateLimitRemaining = Math.max(0, rateLimitConfig.maxRequests - rateLimitUsed);
    const rateLimitResetsAt = result.rate_limit_window_start && !windowExpired
      ? new Date(new Date(result.rate_limit_window_start).getTime() + rateLimitConfig.windowSeconds * 1000)
      : null;

    // Check quota exceeded
    if (quotaLimit !== null && quotaUsed >= quotaLimit) {
      return {
        allowed: false,
        quotaUsed,
        quotaLimit,
        quotaRemaining: 0,
        rateLimitUsed,
        rateLimitMax: rateLimitConfig.maxRequests,
        rateLimitRemaining,
        rateLimitResetsAt,
        denyReason: 'quota_exceeded',
        denyMessage: `Monthly quota exceeded for ${service}. Please upgrade your plan.`,
      };
    }

    // Check rate limit exceeded
    if (rateLimitUsed >= rateLimitConfig.maxRequests) {
      return {
        allowed: false,
        quotaUsed,
        quotaLimit,
        quotaRemaining,
        rateLimitUsed,
        rateLimitMax: rateLimitConfig.maxRequests,
        rateLimitRemaining: 0,
        rateLimitResetsAt,
        denyReason: 'rate_limited',
        denyMessage: `Too many requests. Please wait ${rateLimitConfig.windowSeconds} seconds.`,
      };
    }

    // Allowed
    return {
      allowed: true,
      quotaUsed,
      quotaLimit,
      quotaRemaining,
      rateLimitUsed,
      rateLimitMax: rateLimitConfig.maxRequests,
      rateLimitRemaining: rateLimitRemaining - 1, // Account for this request
      rateLimitResetsAt,
    };
  }

  /**
   * Increment rate limit counter after successful action
   * Called alongside usage event recording
   */
  async incrementRateLimit(userId: number): Promise<void> {
    const now = new Date().toISOString();

    await this.db
      .updateTable('users')
      .set({
        rate_limit_count: sql`CASE
          WHEN rate_limit_window_start IS NULL OR rate_limit_window_start < datetime('now', '-60 seconds')
          THEN 1
          ELSE rate_limit_count + 1
        END`,
        rate_limit_window_start: sql`CASE
          WHEN rate_limit_window_start IS NULL OR rate_limit_window_start < datetime('now', '-60 seconds')
          THEN ${now}
          ELSE rate_limit_window_start
        END`,
      })
      .where('id', '=', userId)
      .execute();
  }

  /**
   * Check if user has quota remaining for a specific service (legacy method)
   * Now uses local D1 instead of Polar API for faster checks
   *
   * @deprecated Use preCheck() for combined quota + rate limit checks
   */
  async checkQuota(
    userId: number,
    service: 'claude' | 'nanobanana'
  ): Promise<QuotaCheck> {
    const result = await this.preCheck(userId, service);

    return {
      allowed: result.allowed,
      remaining: result.quotaRemaining,
      limit: result.quotaLimit,
      message: result.denyMessage,
    };
  }

  /**
   * Get customer portal URL for billing management
   */
  async getCustomerPortalUrl(userId: number, returnUrl?: string): Promise<string | null> {
    if (!this.polarService) {
      return null;
    }

    try {
      return await this.polarService.getCustomerPortalUrl(userId, returnUrl);
    } catch (error) {
      console.error('Failed to get customer portal URL:', error);
      return null;
    }
  }

  /**
   * Clean up old synced events to save storage
   */
  async cleanupOldEvents(olderThanDays = 90): Promise<number> {
    return await this.usageEventDAO.deleteOldSyncedEvents(olderThanDays);
  }

  /**
   * Sync missing Polar customers
   * Retries creating Polar customers for users who failed during signup
   * Handles race conditions by re-checking DB state before Polar operations
   */
  async syncMissingCustomers(limit = 50): Promise<CustomerSyncResult> {
    if (!this.polarService) {
      return { created: 0, failed: 0 };
    }

    const usersWithoutPolar = await this.userDAO.findWithoutPolarCustomer(limit);
    if (usersWithoutPolar.length === 0) {
      return { created: 0, failed: 0 };
    }

    let created = 0;
    let failed = 0;

    for (const user of usersWithoutPolar) {
      try {
        // Re-check DB to avoid race condition with concurrent signup
        const freshUser = await this.userDAO.findById(user.id);
        if (!freshUser || freshUser.polar_customer_id) {
          // User was deleted or already has a Polar customer now
          continue;
        }

        // Try to create customer in Polar
        let customerId: string | null = null;
        try {
          customerId = await this.polarService.createCustomer(user.id, user.email, user.name);
        } catch (polarError) {
          // If creation failed, maybe customer already exists (created by another process)
          // Try to look up by external ID
          const existingCustomer = await this.polarService.getCustomerByExternalId(user.id);
          if (existingCustomer) {
            customerId = existingCustomer.id;
          } else {
            throw polarError; // Re-throw if not a duplicate
          }
        }

        if (customerId) {
          await this.userDAO.update(user.id, { polar_customer_id: customerId });
          created++;
        }
      } catch (error) {
        console.error(`Failed to create Polar customer for user ${user.id}:`, error);
        failed++;
      }
    }

    return { created, failed };
  }
}
