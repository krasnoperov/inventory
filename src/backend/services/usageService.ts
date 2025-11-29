import { injectable, inject, optional } from 'inversify';
import { UsageEventDAO, type UsageEventMetadata } from '../../dao/usage-event-dao';
import { UserDAO } from '../../dao/user-dao';
import { PolarService } from './polarService';

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

export interface SyncResult {
  synced: number;
  failed: number;
}

export interface CustomerSyncResult {
  created: number;
  failed: number;
}

@injectable()
export class UsageService {
  constructor(
    @inject(UsageEventDAO) private usageEventDAO: UsageEventDAO,
    @inject(UserDAO) private userDAO: UserDAO,
    @inject(PolarService) @optional() private polarService: PolarService | null,
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
   * Can be called by a scheduled job or queue consumer
   *
   * Groups events by type:
   * - Claude token events: Sent as LLM events with proper metadata
   * - Gemini image events: Sent with quantity in metadata
   * - Gemini token events: Sent as LLM events with proper metadata
   *
   * Uses idempotency keys to prevent duplicate charges on retry
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
   * Check if user has quota remaining for a specific service
   * Returns whether the action is allowed
   */
  async checkQuota(
    userId: number,
    service: 'claude' | 'nanobanana'
  ): Promise<QuotaCheck> {
    // Check the most relevant meter for the service
    // For Claude: check output tokens (most expensive)
    // For Gemini: check image count
    const eventName =
      service === 'claude' ? USAGE_EVENTS.CLAUDE_OUTPUT_TOKENS : USAGE_EVENTS.GEMINI_IMAGES;

    // If no Polar service, always allow (no limits enforced)
    if (!this.polarService) {
      return {
        allowed: true,
        remaining: null,
        limit: null,
      };
    }

    try {
      const usage = await this.polarService.getCustomerUsage(userId);
      if (!usage) {
        // No usage data, allow but warn
        return {
          allowed: true,
          remaining: null,
          limit: null,
          message: 'Unable to verify quota',
        };
      }

      const meterData = usage.meters[eventName];
      if (!meterData) {
        // No meter for this service, allow
        return {
          allowed: true,
          remaining: null,
          limit: null,
        };
      }

      const { used, limit } = meterData;
      if (limit === null) {
        // No limit set, allow
        return {
          allowed: true,
          remaining: null,
          limit: null,
        };
      }

      const remaining = limit - used;
      const allowed = remaining > 0;

      return {
        allowed,
        remaining,
        limit,
        message: allowed ? undefined : `Quota exceeded. Upgrade your plan for more ${service} usage.`,
      };
    } catch (error) {
      console.error('Failed to check quota:', error);
      // On error, allow but log
      return {
        allowed: true,
        remaining: null,
        limit: null,
        message: 'Quota check failed',
      };
    }
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
