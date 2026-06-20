import { inject, injectable } from 'inversify';
import type { Kysely } from 'kysely';
import { sql, type SelectQueryBuilder } from 'kysely';
import type {
  Database,
  ProviderUsageLedgerEntry,
  ProviderUsageMediaKind,
} from '../db/types';
import { TYPES } from '../core/di-types';

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

export interface ProviderSpendSummaryOptions {
  from?: string | null;
  to?: string | null;
  userId?: number | null;
  spaceId?: string | null;
  provider?: string | null;
  mediaKind?: ProviderUsageMediaKind | null;
}

export interface ProviderSpendAggregate {
  amountMicroUsd: number;
  amountUsd: number;
  quantity: number;
  entries: number;
  unpricedEntries: number;
}

export interface ProviderSpendProviderSummary extends ProviderSpendAggregate {
  provider: string;
}

export interface ProviderSpendModelSummary extends ProviderSpendAggregate {
  provider: string;
  providerModel: string;
}

export interface ProviderSpendMediaKindSummary extends ProviderSpendAggregate {
  mediaKind: ProviderUsageMediaKind | null;
}

export interface ProviderSpendMeterSummary extends ProviderSpendAggregate {
  meterEventName: string | null;
}

export interface ProviderSpendSummary {
  period: {
    from: string | null;
    to: string | null;
  };
  filters: {
    userId: number | null;
    spaceId: string | null;
    provider: string | null;
    mediaKind: ProviderUsageMediaKind | null;
  };
  totals: ProviderSpendAggregate;
  byProvider: ProviderSpendProviderSummary[];
  byModel: ProviderSpendModelSummary[];
  byMediaKind: ProviderSpendMediaKindSummary[];
  byMeterEventName: ProviderSpendMeterSummary[];
}

interface SpendAggregateRow {
  amount_micro_usd: number | string | bigint | null;
  quantity: number | string | null;
  entries: number | string | bigint | null;
  unpriced_entries: number | string | bigint | null;
}

@injectable()
export class ProviderUsageLedgerDAO {
  constructor(@inject(TYPES.Database) private db: Kysely<Database>) {}

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

  async getSpendSummary(options: ProviderSpendSummaryOptions = {}): Promise<ProviderSpendSummary> {
    const bounds = normalizeSpendBounds(options);
    let totalsQuery = this.applySpendFilters(
      this.db
        .selectFrom('provider_usage_ledger')
        .select(() => this.spendAggregateSelections()),
      bounds
    );

    let byProviderQuery = this.applySpendFilters(
      this.db
        .selectFrom('provider_usage_ledger')
        .select('provider')
        .select(() => this.spendAggregateSelections()),
      bounds
    );

    let byModelQuery = this.applySpendFilters(
      this.db
        .selectFrom('provider_usage_ledger')
        .select(['provider', 'provider_model'])
        .select(() => this.spendAggregateSelections()),
      bounds
    );

    let byMediaKindQuery = this.applySpendFilters(
      this.db
        .selectFrom('provider_usage_ledger')
        .select('media_kind')
        .select(() => this.spendAggregateSelections()),
      bounds
    );

    let byMeterEventNameQuery = this.applySpendFilters(
      this.db
        .selectFrom('provider_usage_ledger')
        .select('meter_event_name')
        .select(() => this.spendAggregateSelections()),
      bounds
    );

    byProviderQuery = byProviderQuery.groupBy('provider').orderBy('provider', 'asc');
    byModelQuery = byModelQuery.groupBy(['provider', 'provider_model']).orderBy('provider', 'asc').orderBy('provider_model', 'asc');
    byMediaKindQuery = byMediaKindQuery.groupBy('media_kind').orderBy('media_kind', 'asc');
    byMeterEventNameQuery = byMeterEventNameQuery.groupBy('meter_event_name').orderBy('meter_event_name', 'asc');

    const [
      totalsRow,
      byProviderRows,
      byModelRows,
      byMediaKindRows,
      byMeterEventNameRows,
    ] = await Promise.all([
      totalsQuery.executeTakeFirst(),
      byProviderQuery.execute(),
      byModelQuery.execute(),
      byMediaKindQuery.execute(),
      byMeterEventNameQuery.execute(),
    ]);

    return {
      period: {
        from: bounds.from ?? null,
        to: bounds.to ?? null,
      },
      filters: {
        userId: options.userId ?? null,
        spaceId: options.spaceId ?? null,
        provider: options.provider ?? null,
        mediaKind: options.mediaKind ?? null,
      },
      totals: this.toSpendAggregate(totalsRow),
      byProvider: byProviderRows.map((row) => ({
        provider: row.provider,
        ...this.toSpendAggregate(row),
      })),
      byModel: byModelRows.map((row) => ({
        provider: row.provider,
        providerModel: row.provider_model,
        ...this.toSpendAggregate(row),
      })),
      byMediaKind: byMediaKindRows.map((row) => ({
        mediaKind: row.media_kind,
        ...this.toSpendAggregate(row),
      })),
      byMeterEventName: byMeterEventNameRows.map((row) => ({
        meterEventName: row.meter_event_name,
        ...this.toSpendAggregate(row),
      })),
    };
  }

  private spendAggregateSelections() {
    return [
      sql<number>`sum(coalesce(amount_micro_usd, 0))`.as('amount_micro_usd'),
      sql<number>`sum(quantity)`.as('quantity'),
      sql<number>`count(*)`.as('entries'),
      sql<number>`sum(case when amount_micro_usd is null or pricing_source is null then 1 else 0 end)`.as('unpriced_entries'),
    ];
  }

  private applySpendFilters<O>(
    query: SelectQueryBuilder<Database, 'provider_usage_ledger', O>,
    options: ProviderSpendSummaryOptions
  ): SelectQueryBuilder<Database, 'provider_usage_ledger', O> {
    let filtered = query;
    if (options.from) {
      filtered = filtered.where('created_at', '>=', options.from);
    }
    if (options.to) {
      filtered = filtered.where('created_at', '<=', options.to);
    }
    if (options.userId) {
      filtered = filtered.where('user_id', '=', options.userId);
    }
    if (options.spaceId) {
      filtered = filtered.where('space_id', '=', options.spaceId);
    }
    if (options.provider) {
      filtered = filtered.where('provider', '=', options.provider);
    }
    if (options.mediaKind) {
      filtered = filtered.where('media_kind', '=', options.mediaKind);
    }
    return filtered;
  }

  private toSpendAggregate(row: SpendAggregateRow | undefined): ProviderSpendAggregate {
    const amountMicroUsd = Number(row?.amount_micro_usd) || 0;
    return {
      amountMicroUsd,
      amountUsd: amountMicroUsd / 1_000_000,
      quantity: Number(row?.quantity) || 0,
      entries: Number(row?.entries) || 0,
      unpricedEntries: Number(row?.unpriced_entries) || 0,
    };
  }
}

function normalizeSpendBounds(options: ProviderSpendSummaryOptions): ProviderSpendSummaryOptions {
  return {
    ...options,
    from: normalizeDateOnlyBound(options.from, 'from'),
    to: normalizeDateOnlyBound(options.to, 'to'),
  };
}

function normalizeDateOnlyBound(value: string | null | undefined, name: 'from' | 'to'): string | null | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return `${value}T${name === 'from' ? '00:00:00.000' : '23:59:59.999'}Z`;
}
