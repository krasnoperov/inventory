import { injectable, inject } from 'inversify';
import { Polar } from '@polar-sh/sdk';
import { TYPES } from '../../core/di-types';
import type { Env } from '../../core/types';

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
   */
  async ingestEventsBatch(
    events: Array<{
      userId: number;
      eventName: string;
      timestamp?: Date;
      metadata?: PolarEventMetadata;
    }>
  ): Promise<void> {
    if (!this.client) return;

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
        metadata: cleanMetadata,
      };
    });

    await this.client.events.ingest({ events: polarEvents });
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
   * Get customer usage for the current billing period
   * Note: This queries Polar's customer meters API
   * TODO: Implement when Polar meters are configured
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getCustomerUsage(userId: number): Promise<UsageSummary | null> {
    if (!this.client) return null;

    // For now, return null - usage is tracked locally in usage_events table
    // When Polar meters are configured, this can query the Polar API:
    // const session = await this.client.customerSessions.create({ externalCustomerId: String(userId) });
    // Then redirect user to session.customerPortalUrl to view usage in Polar's portal
    return null;
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
