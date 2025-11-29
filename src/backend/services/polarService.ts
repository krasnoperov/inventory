import { injectable, inject } from 'inversify';
import { Polar } from '@polar-sh/sdk';
import { TYPES } from '../../core/di-types';
import type { Env } from '../../core/types';

export interface LLMUsageData {
  vendor: 'anthropic' | 'google';
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

// LLMMetadata structure expected by Polar's event ingestion API
// Defined here because the SDK doesn't export this type directly
interface LLMMetadata {
  vendor: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  prompt?: string | null;
  response?: string | null;
}

export interface PolarEventMetadata {
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
  token_type?: 'input' | 'output';
  operation?: string;
  aspect_ratio?: string;
  request_id?: string;
  job_id?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface UsageSummary {
  period: {
    start: Date;
    end: Date;
  };
  meters: {
    [meterName: string]: {
      used: number;
      limit: number | null;
    };
  };
}

export interface CustomerMeterInfo {
  meterId: string;
  meterSlug: string;
  consumed: number;
  credited: number;
  remaining: number;
  hasLimit: boolean;
  percentUsed: number;
}

export interface BillingStatus {
  configured: boolean;
  hasSubscription: boolean;
  meters: CustomerMeterInfo[];
  portalUrl: string | null;
  subscription?: {
    status: string;
    currentPeriodEnd: Date | null;
  };
}

@injectable()
export class PolarService {
  private client: Polar | null;
  private organizationId: string;

  constructor(@inject(TYPES.Env) private env: Env) {
    // Polar is optional - if not configured, service becomes a no-op
    if (!env.POLAR_ACCESS_TOKEN) {
      console.warn('PolarService: POLAR_ACCESS_TOKEN not configured, billing features disabled');
      this.client = null;
      this.organizationId = '';
      return;
    }
    this.client = new Polar({
      accessToken: env.POLAR_ACCESS_TOKEN,
      server: env.POLAR_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production',
    });
    this.organizationId = env.POLAR_ORGANIZATION_ID || '';
  }

  /**
   * Check if Polar is configured and available
   */
  isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Create a customer in Polar using our user ID as external_id
   * This allows us to reference customers by our internal user ID
   * Returns null if Polar is not configured
   */
  async createCustomer(userId: number, email: string, name: string): Promise<string | null> {
    if (!this.client) return null;

    const customer = await this.client.customers.create({
      email,
      name,
      externalId: String(userId),
      organizationId: this.organizationId || undefined,
      metadata: {
        source: 'inventory-app',
        created_at: new Date().toISOString(),
      },
    });

    return customer.id;
  }

  /**
   * Get a customer by our internal user ID (external_id in Polar)
   */
  async getCustomerByExternalId(userId: number): Promise<{ id: string; email: string } | null> {
    if (!this.client) return null;

    try {
      const customer = await this.client.customers.getExternal({
        externalId: String(userId),
      });
      return {
        id: customer.id,
        email: customer.email,
      };
    } catch {
      // Customer not found
      return null;
    }
  }

  /**
   * Ingest a usage event for a customer
   * Uses external_customer_id to reference our user ID
   */
  async ingestEvent(
    userId: number,
    eventName: string,
    metadata?: PolarEventMetadata
  ): Promise<void> {
    if (!this.client) return;

    // Filter out undefined values from metadata
    const cleanMetadata = metadata
      ? Object.fromEntries(
          Object.entries(metadata).filter(([, v]) => v !== undefined)
        ) as { [key: string]: string | number | boolean }
      : undefined;

    await this.client.events.ingest({
      events: [
        {
          name: eventName,
          externalCustomerId: String(userId),
          timestamp: new Date(),
          metadata: cleanMetadata,
        },
      ],
    });
  }

  /**
   * Ingest multiple events at once (batch)
   * Uses externalId for deduplication on retry
   */
  async ingestEventsBatch(
    events: Array<{
      userId: number;
      eventName: string;
      timestamp?: Date;
      externalId?: string;
      metadata?: PolarEventMetadata;
    }>
  ): Promise<{ inserted: number; duplicates: number }> {
    if (!this.client) return { inserted: 0, duplicates: 0 };

    const polarEvents = events.map((event) => {
      const cleanMetadata = event.metadata
        ? Object.fromEntries(
            Object.entries(event.metadata).filter(([, v]) => v !== undefined)
          ) as { [key: string]: string | number | boolean }
        : undefined;

      return {
        name: event.eventName,
        externalCustomerId: String(event.userId),
        timestamp: event.timestamp || new Date(),
        externalId: event.externalId,
        metadata: cleanMetadata,
      };
    });

    const result = await this.client.events.ingest({ events: polarEvents });
    return {
      inserted: result.inserted || 0,
      duplicates: result.duplicates || 0,
    };
  }

  /**
   * Ingest LLM usage event with proper LLMMetadata structure
   * This is the recommended format for AI token billing in Polar
   */
  async ingestLLMEvent(
    userId: number,
    eventName: string,
    llmData: LLMUsageData
  ): Promise<void> {
    if (!this.client) return;

    const llmMetadata: LLMMetadata = {
      vendor: llmData.vendor,
      model: llmData.model,
      inputTokens: llmData.inputTokens,
      outputTokens: llmData.outputTokens,
      totalTokens: llmData.inputTokens + llmData.outputTokens,
      cachedInputTokens: llmData.cachedInputTokens,
    };

    await this.client.events.ingest({
      events: [
        {
          name: eventName,
          externalCustomerId: String(userId),
          timestamp: new Date(),
          metadata: { llm: llmMetadata },
        },
      ],
    });
  }

  /**
   * Ingest multiple LLM events at once (batch)
   * Uses externalId for deduplication on retry
   */
  async ingestLLMEventsBatch(
    events: Array<{
      userId: number;
      eventName: string;
      timestamp?: Date;
      externalId?: string;
      llmData: LLMUsageData;
    }>
  ): Promise<{ inserted: number; duplicates: number }> {
    if (!this.client) return { inserted: 0, duplicates: 0 };

    const polarEvents = events.map((event) => {
      const llmMetadata: LLMMetadata = {
        vendor: event.llmData.vendor,
        model: event.llmData.model,
        inputTokens: event.llmData.inputTokens,
        outputTokens: event.llmData.outputTokens,
        totalTokens: event.llmData.inputTokens + event.llmData.outputTokens,
        cachedInputTokens: event.llmData.cachedInputTokens,
      };

      return {
        name: event.eventName,
        externalCustomerId: String(event.userId),
        timestamp: event.timestamp || new Date(),
        externalId: event.externalId,
        metadata: { llm: llmMetadata },
      };
    });

    const result = await this.client.events.ingest({ events: polarEvents });
    return {
      inserted: result.inserted || 0,
      duplicates: result.duplicates || 0,
    };
  }

  /**
   * Create a customer session and return the portal URL
   * This allows the customer to view their usage and manage billing
   * Returns null if Polar is not configured
   */
  async getCustomerPortalUrl(userId: number, returnUrl?: string): Promise<string | null> {
    if (!this.client) return null;

    const session = await this.client.customerSessions.create({
      externalCustomerId: String(userId),
      returnUrl: returnUrl || null,
    });

    return session.customerPortalUrl;
  }

  /**
   * Get customer meter usage from Polar
   * Uses the Customer Meters API to get consumed/credited units per meter
   */
  async getCustomerMeters(userId: number): Promise<CustomerMeterInfo[]> {
    if (!this.client) return [];

    try {
      // Use the organization-level customer meters API with external customer ID filter
      const response = await this.client.customerMeters.list({
        externalCustomerId: String(userId),
      });

      const meters: CustomerMeterInfo[] = [];

      for await (const meterPage of response) {
        // The response is paginated, each page has a result with items
        const items = meterPage.result?.items || [];
        for (const meter of items) {
          const consumed = meter.consumedUnits || 0;
          const credited = meter.creditedUnits || 0;
          const hasLimit = credited > 0;
          const remaining = hasLimit ? Math.max(0, credited - consumed) : Infinity;
          const percentUsed = hasLimit && credited > 0 ? (consumed / credited) * 100 : 0;

          meters.push({
            meterId: meter.meterId,
            meterSlug: meter.meter?.name || meter.meterId,
            consumed,
            credited,
            remaining: hasLimit ? remaining : -1, // -1 indicates unlimited
            hasLimit,
            percentUsed: Math.min(100, percentUsed),
          });
        }
      }

      return meters;
    } catch (error) {
      console.error('Failed to get customer meters:', error);
      return [];
    }
  }

  /**
   * Get full billing status for a customer (for healthbar UI)
   */
  async getBillingStatus(userId: number): Promise<BillingStatus> {
    if (!this.client) {
      return {
        configured: false,
        hasSubscription: false,
        meters: [],
        portalUrl: null,
      };
    }

    try {
      // Get meters data
      const meters = await this.getCustomerMeters(userId);

      // Get portal URL
      const portalUrl = await this.getCustomerPortalUrl(userId);

      // Try to get subscription info using organization-level API
      let subscription: BillingStatus['subscription'];
      try {
        const subscriptions = await this.client.subscriptions.list({
          externalCustomerId: String(userId),
          active: true,
        });

        for await (const subPage of subscriptions) {
          const items = subPage.result?.items || [];
          if (items.length > 0) {
            const sub = items[0];
            subscription = {
              status: sub.status,
              currentPeriodEnd: sub.currentPeriodEnd || null,
            };
          }
          break; // Just get the first page
        }
      } catch {
        // No active subscription
      }

      return {
        configured: true,
        hasSubscription: !!subscription,
        meters,
        portalUrl,
        subscription,
      };
    } catch (error) {
      console.error('Failed to get billing status:', error);
      return {
        configured: true,
        hasSubscription: false,
        meters: [],
        portalUrl: null,
      };
    }
  }

  /**
   * Get customer usage for the current billing period
   * Note: This queries Polar's customer meters API
   */
  async getCustomerUsage(userId: number): Promise<UsageSummary | null> {
    if (!this.client) return null;

    try {
      const meters = await this.getCustomerMeters(userId);
      if (meters.length === 0) return null;

      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

      const meterData: UsageSummary['meters'] = {};
      for (const meter of meters) {
        meterData[meter.meterSlug] = {
          used: meter.consumed,
          limit: meter.hasLimit ? meter.credited : null,
        };
      }

      return {
        period: {
          start: periodStart,
          end: periodEnd,
        },
        meters: meterData,
      };
    } catch (error) {
      console.error('Failed to get customer usage:', error);
      return null;
    }
  }

  /**
   * Check if a customer exists in Polar
   * Returns false if Polar is not configured
   */
  async customerExists(userId: number): Promise<boolean> {
    if (!this.client) return false;
    const customer = await this.getCustomerByExternalId(userId);
    return customer !== null;
  }
}
