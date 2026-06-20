import { inject, injectable } from 'inversify';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database, PlatformUsageEvent } from '../db/types';
import { TYPES } from '../core/di-types';
import type {
  PlatformUsageMetadata,
  PlatformUsageType,
  PlatformUsageUnit,
} from '../backend/platform/platformUsage';
import type { MediaKind } from '../backend/durable-objects/space/types';

export interface PlatformUsageEventCreateData {
  idempotencyKey: string;
  spaceId: string;
  userId?: number | null;
  usageType: PlatformUsageType;
  quantity: number;
  unit: PlatformUsageUnit;
  assetId?: string | null;
  variantId?: string | null;
  workflowId?: string | null;
  requestId?: string | null;
  artifactKey?: string | null;
  operation?: string | null;
  mediaKind?: 'image' | 'audio' | 'video' | null;
  metadata?: PlatformUsageMetadata | null;
  createdAt?: string;
}

export interface PlatformUsageSummaryOptions {
  from?: string | null;
  to?: string | null;
}

export interface PlatformUsageTypeSummary {
  usageType: PlatformUsageType;
  unit: PlatformUsageUnit;
  quantity: number;
  events: number;
}

export interface PlatformUsageMediaKindSummary {
  mediaKind: MediaKind | null;
  storageBytes: number;
  workflowRuns: number;
  deliveryBytes: number;
  events: number;
}

export interface PlatformUsageSummary {
  spaceId: string;
  period: {
    from: string | null;
    to: string | null;
  };
  totals: {
    storageBytes: number;
    workflowRuns: number;
    deliveryBytes: number;
  };
  byType: PlatformUsageTypeSummary[];
  byMediaKind: PlatformUsageMediaKindSummary[];
}

@injectable()
export class PlatformUsageEventDAO {
  constructor(@inject(TYPES.Database) private db: Kysely<Database>) {}

  async create(data: PlatformUsageEventCreateData): Promise<string> {
    const id = crypto.randomUUID();

    await this.db
      .insertInto('platform_usage_events')
      .values({
        id,
        idempotency_key: data.idempotencyKey,
        space_id: data.spaceId,
        user_id: data.userId ?? null,
        usage_type: data.usageType,
        quantity: Math.trunc(data.quantity),
        unit: data.unit,
        asset_id: data.assetId ?? null,
        variant_id: data.variantId ?? null,
        workflow_id: data.workflowId ?? null,
        request_id: data.requestId ?? null,
        artifact_key: data.artifactKey ?? null,
        operation: data.operation ?? null,
        media_kind: data.mediaKind ?? null,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
        created_at: data.createdAt ?? new Date().toISOString(),
      })
      .onConflict((oc) => oc.column('idempotency_key').doNothing())
      .execute();

    return id;
  }

  async findBySpace(spaceId: string, limit = 100): Promise<PlatformUsageEvent[]> {
    return await this.db
      .selectFrom('platform_usage_events')
      .selectAll()
      .where('space_id', '=', spaceId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
  }

  async getSpaceTotals(spaceId: string): Promise<Record<string, number>> {
    const rows = await this.db
      .selectFrom('platform_usage_events')
      .select(['usage_type'])
      .select((eb) => eb.fn.sum<number>('quantity').as('total_quantity'))
      .where('space_id', '=', spaceId)
      .groupBy('usage_type')
      .execute();

    const totals: Record<string, number> = {};
    for (const row of rows) {
      totals[row.usage_type] = Number(row.total_quantity) || 0;
    }
    return totals;
  }

  async getSpaceSummary(
    spaceId: string,
    options: PlatformUsageSummaryOptions = {}
  ): Promise<PlatformUsageSummary> {
    let byTypeQuery = this.db
      .selectFrom('platform_usage_events')
      .select(['usage_type', 'unit'])
      .select((eb) => [
        eb.fn.sum<number>('quantity').as('quantity'),
        sql<number>`count(*)`.as('events'),
      ])
      .where('space_id', '=', spaceId);

    let byMediaKindQuery = this.db
      .selectFrom('platform_usage_events')
      .select('media_kind')
      .select((eb) => [
        eb.fn.sum<number>(
          eb.case().when('usage_type', '=', 'storage').then(eb.ref('quantity')).else(0).end()
        ).as('storage_bytes'),
        eb.fn.sum<number>(
          eb.case().when('usage_type', '=', 'workflow').then(eb.ref('quantity')).else(0).end()
        ).as('workflow_runs'),
        eb.fn.sum<number>(
          eb.case().when('usage_type', '=', 'delivery').then(eb.ref('quantity')).else(0).end()
        ).as('delivery_bytes'),
        sql<number>`count(*)`.as('events'),
      ])
      .where('space_id', '=', spaceId);

    if (options.from) {
      byTypeQuery = byTypeQuery.where('created_at', '>=', options.from);
      byMediaKindQuery = byMediaKindQuery.where('created_at', '>=', options.from);
    }
    if (options.to) {
      byTypeQuery = byTypeQuery.where('created_at', '<=', options.to);
      byMediaKindQuery = byMediaKindQuery.where('created_at', '<=', options.to);
    }

    const byTypeRows = await byTypeQuery
      .groupBy(['usage_type', 'unit'])
      .orderBy('usage_type', 'asc')
      .execute();

    const byType: PlatformUsageTypeSummary[] = byTypeRows.map((row) => ({
      usageType: row.usage_type,
      unit: row.unit,
      quantity: Number(row.quantity) || 0,
      events: Number(row.events) || 0,
    }));

    const byMediaKindRows = await byMediaKindQuery
      .groupBy('media_kind')
      .orderBy('media_kind', 'asc')
      .execute();

    const byMediaKind: PlatformUsageMediaKindSummary[] = byMediaKindRows.map((row) => ({
      mediaKind: row.media_kind,
      storageBytes: Number(row.storage_bytes) || 0,
      workflowRuns: Number(row.workflow_runs) || 0,
      deliveryBytes: Number(row.delivery_bytes) || 0,
      events: Number(row.events) || 0,
    }));

    return {
      spaceId,
      period: {
        from: options.from ?? null,
        to: options.to ?? null,
      },
      totals: {
        storageBytes: byType.find((row) => row.usageType === 'storage')?.quantity ?? 0,
        workflowRuns: byType.find((row) => row.usageType === 'workflow')?.quantity ?? 0,
        deliveryBytes: byType.find((row) => row.usageType === 'delivery')?.quantity ?? 0,
      },
      byType,
      byMediaKind,
    };
  }
}
