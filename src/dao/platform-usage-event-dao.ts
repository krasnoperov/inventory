import { inject, injectable } from 'inversify';
import type { Kysely } from 'kysely';
import type { Database, PlatformUsageEvent } from '../db/types';
import { TYPES } from '../core/di-types';
import type {
  PlatformUsageMetadata,
  PlatformUsageType,
  PlatformUsageUnit,
} from '../backend/platform/platformUsage';

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
}
