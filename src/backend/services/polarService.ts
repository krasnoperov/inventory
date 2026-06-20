import { injectable, inject } from 'inversify';
import { Polar } from '@polar-sh/sdk';
import { TYPES } from '../../core/di-types';
import type { Env } from '../../core/types';
import { PAID_GENERATION_PLAN } from '../billing/planCatalog';

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
  available: boolean;
  hasSubscription: boolean;
  meters: CustomerMeterInfo[];
  portalUrl: string | null;
  error?: string;
  subscription?: {
    status: string;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
  };
}

export interface PolarMeterInfo {
  id: string;
  name: string;
  aggregation: string;
  aggregationProperty: string | null;
  filter: unknown;
  archivedAt: Date | null;
}

export interface PolarProductInfo {
  configured: boolean;
  planKey: string;
  productIdEnvVar: string;
  productId: string | null;
  exists: boolean;
  name: string | null;
  isRecurring: boolean | null;
  isArchived: boolean | null;
  meteredPriceMeters: string[];
  meterCreditBenefitMeters: string[];
}

export interface CheckoutCustomer {
  userId: number;
  email: string;
  name: string;
}

function isActiveMeteredUnitPrice(price: unknown): price is {
  amountType: 'metered_unit';
  isArchived: boolean;
  meterId: string;
  meter: { name: string };
} {
  if (!price || typeof price !== 'object') return false;
  const record = price as {
    amountType?: unknown;
    isArchived?: unknown;
    meterId?: unknown;
    meter?: { name?: unknown };
  };
  return record.amountType === 'metered_unit' &&
    record.isArchived === false &&
    typeof record.meterId === 'string' &&
    typeof record.meter?.name === 'string';
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
   * List active organization meters configured in Polar.
   * Used by operational checks to catch missing production meters before usage
   * events pile up locally.
   */
  async listMeters(): Promise<PolarMeterInfo[]> {
    if (!this.client) return [];

    const response = await this.client.meters.list({
      organizationId: this.organizationId || undefined,
      isArchived: false,
      limit: 100,
    });

    const meters: PolarMeterInfo[] = [];
    for await (const meterPage of response) {
      const items = meterPage.result?.items || [];
      for (const meter of items) {
        meters.push({
          id: meter.id,
          name: meter.name,
          aggregation: meter.aggregation.func,
          aggregationProperty: 'property' in meter.aggregation ? meter.aggregation.property : null,
          filter: meter.filter,
          archivedAt: meter.archivedAt ?? null,
        });
      }
    }

    return meters;
  }

  /**
   * Inspect the configured paid-generation product wiring.
   * The product must be recurring and attach metered prices to every meter we
   * send billable events for; meter-credit benefits are reported for quota ops.
   */
  async getPaidGenerationProductInfo(): Promise<PolarProductInfo> {
    const productId = this.env[PAID_GENERATION_PLAN.polar.productIdEnvVar] || null;
    if (!this.client || !productId) {
      return {
        configured: this.client !== null && !!productId,
        planKey: PAID_GENERATION_PLAN.key,
        productIdEnvVar: PAID_GENERATION_PLAN.polar.productIdEnvVar,
        productId,
        exists: false,
        name: null,
        isRecurring: null,
        isArchived: null,
        meteredPriceMeters: [],
        meterCreditBenefitMeters: [],
      };
    }

    const product = await this.client.products.get({ id: productId });
    const activeMeteredPrices = product.prices.filter(isActiveMeteredUnitPrice) as Array<{
      meterId: string;
      meter: { name: string };
    }>;
    const priceMeterNameById = new Map(activeMeteredPrices.map((price) => [price.meterId, price.meter.name]));
    const meteredPriceMeters = activeMeteredPrices.map((price) => price.meter.name);
    const meterCreditBenefitMeters = product.benefits
      .filter((benefit) => benefit.type === 'meter_credit')
      .map((benefit) => priceMeterNameById.get(benefit.properties.meterId) ?? benefit.properties.meterId);

    return {
      configured: true,
      planKey: PAID_GENERATION_PLAN.key,
      productIdEnvVar: PAID_GENERATION_PLAN.polar.productIdEnvVar,
      productId,
      exists: true,
      name: product.name,
      isRecurring: product.isRecurring,
      isArchived: product.isArchived,
      meteredPriceMeters,
      meterCreditBenefitMeters,
    };
  }

  /**
   * Create a customer in Polar using our user ID as external_id
   * This allows us to reference customers by our internal user ID
   * Returns null if Polar is not configured
   *
   * @see https://docs.polar.sh/api-reference/customers/create
   * @see https://docs.polar.sh/features/customer-management
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
   * Ingest multiple events at once (batch)
   * Uses externalId for deduplication on retry
   *
   * @see https://docs.polar.sh/api-reference/events/ingest
   * @see https://docs.polar.sh/features/usage-based-billing/ingestion-strategies
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
   * Ingest multiple LLM events at once (batch)
   * Uses externalId for deduplication on retry - Polar ignores events with duplicate externalId
   *
   * @see https://docs.polar.sh/api-reference/events/ingest
   * @see https://docs.polar.sh/features/usage-based-billing/ingestion-strategies/llm
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
   *
   * @see https://docs.polar.sh/api-reference/customer-sessions/create
   * @see https://docs.polar.sh/features/customer-portal
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
   * Create a checkout session for paid generation access.
   * Returns null when Polar or the paid generation product is not configured.
   */
  async getPaidGenerationCheckoutUrl(
    customer: CheckoutCustomer,
    options: { returnUrl?: string; successUrl?: string } = {}
  ): Promise<string | null> {
    const productId = this.env[PAID_GENERATION_PLAN.polar.productIdEnvVar];
    if (!this.client || !productId) return null;

    const checkout = await this.client.checkouts.create({
      products: [productId],
      externalCustomerId: String(customer.userId),
      customerEmail: customer.email,
      customerName: customer.name,
      returnUrl: options.returnUrl || null,
      successUrl: options.successUrl || options.returnUrl || null,
      metadata: {
        source: 'inventory-app',
        purpose: PAID_GENERATION_PLAN.polar.checkoutPurpose,
        plan_key: PAID_GENERATION_PLAN.key,
        user_id: customer.userId,
      },
      customerMetadata: {
        inventory_user_id: customer.userId,
      },
    });

    return checkout.url;
  }

  /**
   * Get customer meter usage from Polar
   * Uses the Customer Meters API to get consumed/credited units per meter
   *
   * @see https://docs.polar.sh/api-reference/customer-meters/list
   * @see https://docs.polar.sh/features/usage-based-billing/meters
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
        available: false,
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
            currentPeriodStart: sub.currentPeriodStart || null,
            currentPeriodEnd: sub.currentPeriodEnd || null,
          };
        }
        break; // Just get the first page
      }

      return {
        configured: true,
        available: true,
        hasSubscription: !!subscription,
        meters,
        portalUrl,
        subscription,
      };
    } catch (error) {
      console.error('Failed to get billing status:', error);
      return {
        configured: true,
        available: false,
        hasSubscription: false,
        meters: [],
        portalUrl: null,
        error: error instanceof Error ? error.message : String(error),
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
