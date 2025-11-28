import { injectable, inject, optional } from 'inversify';
import { UsageEventDAO, type UsageEventMetadata } from '../../dao/usage-event-dao';
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

@injectable()
export class UsageService {
  constructor(
    @inject(UsageEventDAO) private usageEventDAO: UsageEventDAO,
    @inject(PolarService) @optional() private polarService: PolarService | null,
  ) {}

  /**
   * Track Claude API token usage
   * Creates separate events for input and output tokens (different pricing)
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

    // Track input tokens
    if (tokensIn > 0) {
      await this.usageEventDAO.create({
        userId,
        eventName: USAGE_EVENTS.CLAUDE_INPUT_TOKENS,
        quantity: tokensIn,
        metadata: { ...baseMetadata, token_type: 'input' },
      });

      if (this.polarService) {
        this.polarService
          .ingestEvent(userId, USAGE_EVENTS.CLAUDE_INPUT_TOKENS, {
            ...baseMetadata,
            token_type: 'input',
          })
          .catch((err) => console.warn('Failed to sync Claude input tokens to Polar:', err));
      }
    }

    // Track output tokens
    if (tokensOut > 0) {
      await this.usageEventDAO.create({
        userId,
        eventName: USAGE_EVENTS.CLAUDE_OUTPUT_TOKENS,
        quantity: tokensOut,
        metadata: { ...baseMetadata, token_type: 'output' },
      });

      if (this.polarService) {
        this.polarService
          .ingestEvent(userId, USAGE_EVENTS.CLAUDE_OUTPUT_TOKENS, {
            ...baseMetadata,
            token_type: 'output',
          })
          .catch((err) => console.warn('Failed to sync Claude output tokens to Polar:', err));
      }
    }
  }

  /**
   * Track Gemini/NanoBanana image generation
   * Tracks: image count + input/output tokens (if available)
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

    // Track image count
    await this.usageEventDAO.create({
      userId,
      eventName: USAGE_EVENTS.GEMINI_IMAGES,
      quantity: imageCount,
      metadata: baseMetadata,
    });

    if (this.polarService) {
      this.polarService
        .ingestEvent(userId, USAGE_EVENTS.GEMINI_IMAGES, baseMetadata)
        .catch((err) => console.warn('Failed to sync Gemini image count to Polar:', err));
    }

    // Track input tokens (if available)
    if (tokenUsage?.inputTokens && tokenUsage.inputTokens > 0) {
      await this.usageEventDAO.create({
        userId,
        eventName: USAGE_EVENTS.GEMINI_INPUT_TOKENS,
        quantity: tokenUsage.inputTokens,
        metadata: { ...baseMetadata, token_type: 'input' },
      });

      if (this.polarService) {
        this.polarService
          .ingestEvent(userId, USAGE_EVENTS.GEMINI_INPUT_TOKENS, {
            ...baseMetadata,
            token_type: 'input',
          })
          .catch((err) => console.warn('Failed to sync Gemini input tokens to Polar:', err));
      }
    }

    // Track output tokens (if available)
    if (tokenUsage?.outputTokens && tokenUsage.outputTokens > 0) {
      await this.usageEventDAO.create({
        userId,
        eventName: USAGE_EVENTS.GEMINI_OUTPUT_TOKENS,
        quantity: tokenUsage.outputTokens,
        metadata: { ...baseMetadata, token_type: 'output' },
      });

      if (this.polarService) {
        this.polarService
          .ingestEvent(userId, USAGE_EVENTS.GEMINI_OUTPUT_TOKENS, {
            ...baseMetadata,
            token_type: 'output',
          })
          .catch((err) => console.warn('Failed to sync Gemini output tokens to Polar:', err));
      }
    }
  }

  /**
   * Sync pending local events to Polar
   * Can be called by a scheduled job or queue consumer
   */
  async syncPendingEvents(batchSize = 100): Promise<number> {
    if (!this.polarService) {
      return 0;
    }

    const pendingEvents = await this.usageEventDAO.findUnsynced(batchSize);
    if (pendingEvents.length === 0) {
      return 0;
    }

    try {
      // Convert to Polar event format
      const polarEvents = pendingEvents.map((event) => {
        const metadata = event.metadata ? JSON.parse(event.metadata) : {};
        return {
          userId: event.user_id,
          eventName: event.event_name,
          timestamp: new Date(event.created_at),
          metadata: {
            ...metadata,
            quantity: event.quantity,
            local_event_id: event.id,
          },
        };
      });

      // Send batch to Polar
      await this.polarService.ingestEventsBatch(polarEvents);

      // Mark as synced
      await this.usageEventDAO.markSynced(pendingEvents.map((e) => e.id));

      return pendingEvents.length;
    } catch (error) {
      console.error('Failed to sync events to Polar:', error);
      throw error;
    }
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
}
