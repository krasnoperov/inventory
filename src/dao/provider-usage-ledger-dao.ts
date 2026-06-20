import type { Kysely } from 'kysely';
import type {
  Database,
  ProviderUsageLedgerEntry,
  ProviderUsageMediaKind,
} from '../db/types';

export interface ProviderUsageLedgerMetadata {
  [key: string]: string | number | boolean | null | undefined;
}

export interface ProviderUsageLedgerCreateData {
  attributionKey: string;
  usageEventId?: string | null;
  userId: number;
  spaceId?: string | null;
  assetId?: string | null;
  variantId?: string | null;
  workflowId?: string | null;
  requestId?: string | null;
  provider: string;
  providerModel: string;
  operation?: string | null;
  mediaKind?: ProviderUsageMediaKind | null;
  meterEventName?: string | null;
  usageUnit: string;
  quantity: number;
  unitPriceUsd?: number | null;
  amountMicroUsd?: number | null;
  currency?: 'USD';
  pricingSource?: string | null;
  providerRequestId?: string | null;
  providerResponseId?: string | null;
  providerUsageId?: string | null;
  metadata?: ProviderUsageLedgerMetadata | null;
  createdAt?: string;
}

export class ProviderUsageLedgerDAO {
  constructor(private db: Kysely<Database>) {}

  async create(data: ProviderUsageLedgerCreateData): Promise<string> {
    const id = crypto.randomUUID();

    await this.db
      .insertInto('provider_usage_ledger')
      .values({
        id,
        attribution_key: data.attributionKey,
        usage_event_id: data.usageEventId ?? null,
        user_id: data.userId,
        space_id: data.spaceId ?? null,
        asset_id: data.assetId ?? null,
        variant_id: data.variantId ?? null,
        workflow_id: data.workflowId ?? null,
        request_id: data.requestId ?? null,
        provider: data.provider,
        provider_model: data.providerModel,
        operation: data.operation ?? null,
        media_kind: data.mediaKind ?? null,
        meter_event_name: data.meterEventName ?? null,
        usage_unit: data.usageUnit,
        quantity: data.quantity,
        unit_price_usd: data.unitPriceUsd ?? null,
        amount_micro_usd: data.amountMicroUsd ?? null,
        currency: data.currency ?? 'USD',
        pricing_source: data.pricingSource ?? null,
        provider_request_id: data.providerRequestId ?? null,
        provider_response_id: data.providerResponseId ?? null,
        provider_usage_id: data.providerUsageId ?? null,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
        created_at: data.createdAt ?? new Date().toISOString(),
      })
      .execute();

    if (data.usageEventId) {
      await this.db
        .updateTable('customer_charge_ledger')
        .set({ provider_usage_ledger_id: id })
        .where('usage_event_id', '=', data.usageEventId)
        .where('provider_usage_ledger_id', 'is', null)
        .execute();
    }

    return id;
  }

  async findByAttributionKey(attributionKey: string): Promise<ProviderUsageLedgerEntry | undefined> {
    return await this.db
      .selectFrom('provider_usage_ledger')
      .selectAll()
      .where('attribution_key', '=', attributionKey)
      .executeTakeFirst();
  }

  async findByVariant(variantId: string): Promise<ProviderUsageLedgerEntry[]> {
    return await this.db
      .selectFrom('provider_usage_ledger')
      .selectAll()
      .where('variant_id', '=', variantId)
      .orderBy('created_at', 'asc')
      .execute();
  }
}
