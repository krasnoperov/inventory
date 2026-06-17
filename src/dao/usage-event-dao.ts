import { injectable, inject } from 'inversify';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database, UsageEvent } from '../db/types';
import { TYPES } from '../core/di-types';

/**
 * Maximum sync attempts before marking event as failed
 * After this many failures, events are excluded from automatic sync and require
 * manual retry via /api/billing/retry-failed endpoint
 *
 * @see https://docs.polar.sh/api-reference/events/ingest - Polar batch ingest API
 */
export const MAX_SYNC_ATTEMPTS = 3;

export interface UsageEventMetadata {
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

export interface UsageSyncHealth {
  pending: number;
  failed: number;
  synced: number;
  oldestPendingCreatedAt: string | null;
  oldestFailedCreatedAt: string | null;
  lastSyncedAt: string | null;
  lastSyncAttemptAt: string | null;
}

export interface InternalBillingHealth {
  internalUsers: number;
  billableEvents: number;
  nonBillableEvents: number;
}

@injectable()
export class UsageEventDAO {
  constructor(@inject(TYPES.Database) private db: Kysely<Database>) {}

  async create(data: {
    userId: number;
    eventName: string;
    quantity: number;
    metadata?: UsageEventMetadata;
    polarBillable?: boolean;
  }): Promise<string> {
    const id = crypto.randomUUID();
    await this.db
      .insertInto('usage_events')
      .values({
        id,
        user_id: data.userId,
        event_name: data.eventName,
        quantity: data.quantity,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
        polar_billable: data.polarBillable === false ? 0 : 1,
        created_at: new Date().toISOString(),
        synced_at: null,
        sync_attempts: 0,
        last_sync_error: null,
        last_sync_attempt_at: null,
      })
      .execute();

    return id;
  }

  async findByUser(userId: number, limit = 100): Promise<UsageEvent[]> {
    return await this.db
      .selectFrom('usage_events')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
  }

  async findUnsynced(limit = 100): Promise<UsageEvent[]> {
    return await this.db
      .selectFrom('usage_events as e')
      .selectAll('e')
      .where('e.synced_at', 'is', null)
      .where('e.sync_attempts', '<', MAX_SYNC_ATTEMPTS) // Exclude failed events
      .where('e.polar_billable', '=', 1)
      .orderBy('e.created_at', 'asc')
      .limit(limit)
      .execute();
  }

  async markSynced(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    await this.db
      .updateTable('usage_events')
      .set({ synced_at: new Date().toISOString() })
      .where('id', 'in', ids)
      .execute();
  }

  async getUserUsageForPeriod(
    userId: number,
    startDate: Date,
    endDate: Date
  ): Promise<{ eventName: string; totalQuantity: number }[]> {
    const events = await this.db
      .selectFrom('usage_events')
      .select(['event_name'])
      .select((eb) => eb.fn.sum<number>('quantity').as('total_quantity'))
      .where('user_id', '=', userId)
      .where('created_at', '>=', startDate.toISOString())
      .where('created_at', '<=', endDate.toISOString())
      .groupBy('event_name')
      .execute();

    return events.map((e) => ({
      eventName: e.event_name,
      totalQuantity: Number(e.total_quantity) || 0,
    }));
  }

  async deleteOldSyncedEvents(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.db
      .deleteFrom('usage_events')
      .where('synced_at', 'is not', null)
      .where('created_at', '<', cutoffDate.toISOString())
      .executeTakeFirst();

    return Number(result.numDeletedRows) || 0;
  }

  /**
   * Increment sync attempts for a batch of events
   * Call this BEFORE attempting to sync to Polar
   */
  async incrementSyncAttempts(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    await this.db
      .updateTable('usage_events')
      .set({
        sync_attempts: sql`sync_attempts + 1`,
        last_sync_attempt_at: new Date().toISOString(),
      })
      .where('id', 'in', ids)
      .execute();
  }

  /**
   * Record sync error for a batch of events
   * Call this when sync fails to store the error message
   */
  async recordSyncError(ids: string[], error: string): Promise<void> {
    if (ids.length === 0) return;

    // Truncate error to prevent DB bloat
    const truncatedError = error.length > 500 ? error.slice(0, 500) + '...' : error;

    await this.db
      .updateTable('usage_events')
      .set({ last_sync_error: truncatedError })
      .where('id', 'in', ids)
      .execute();
  }

  /**
   * Find events that have failed to sync (exceeded max attempts)
   */
  async findFailed(limit = 100): Promise<UsageEvent[]> {
    return await this.db
      .selectFrom('usage_events')
      .selectAll()
      .where('synced_at', 'is', null)
      .where('sync_attempts', '>=', MAX_SYNC_ATTEMPTS)
      .orderBy('created_at', 'asc')
      .limit(limit)
      .execute();
  }

  /**
   * Reset sync attempts for events (for manual retry)
   */
  async resetSyncAttempts(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    await this.db
      .updateTable('usage_events')
      .set({
        sync_attempts: 0,
        last_sync_error: null,
      })
      .where('id', 'in', ids)
      .execute();
  }

  /**
   * Get counts for billing status (pending, failed, synced)
   */
  async getSyncStats(): Promise<{
    pending: number;
    failed: number;
    synced: number;
  }> {
    const health = await this.getSyncHealth();
    return {
      pending: health.pending,
      failed: health.failed,
      synced: health.synced,
    };
  }

  /**
   * Get sync counts plus timestamps used by operational billing checks.
   */
  async getSyncHealth(): Promise<UsageSyncHealth> {
    const result = await this.db
      .selectFrom('usage_events as e')
      .select([
        sql<number>`COUNT(CASE WHEN e.polar_billable = 1 AND e.synced_at IS NULL AND e.sync_attempts < ${MAX_SYNC_ATTEMPTS} THEN 1 END)`.as('pending'),
        sql<number>`COUNT(CASE WHEN e.polar_billable = 1 AND e.synced_at IS NULL AND e.sync_attempts >= ${MAX_SYNC_ATTEMPTS} THEN 1 END)`.as('failed'),
        sql<number>`COUNT(CASE WHEN e.polar_billable = 1 AND e.synced_at IS NOT NULL THEN 1 END)`.as('synced'),
        sql<string | null>`MIN(CASE WHEN e.polar_billable = 1 AND e.synced_at IS NULL AND e.sync_attempts < ${MAX_SYNC_ATTEMPTS} THEN e.created_at END)`.as('oldest_pending_created_at'),
        sql<string | null>`MIN(CASE WHEN e.polar_billable = 1 AND e.synced_at IS NULL AND e.sync_attempts >= ${MAX_SYNC_ATTEMPTS} THEN e.created_at END)`.as('oldest_failed_created_at'),
        sql<string | null>`MAX(CASE WHEN e.polar_billable = 1 AND e.synced_at IS NOT NULL THEN e.synced_at END)`.as('last_synced_at'),
        sql<string | null>`MAX(CASE WHEN e.polar_billable = 1 THEN e.last_sync_attempt_at END)`.as('last_sync_attempt_at'),
      ])
      .executeTakeFirst();

    return {
      pending: Number(result?.pending) || 0,
      failed: Number(result?.failed) || 0,
      synced: Number(result?.synced) || 0,
      oldestPendingCreatedAt: result?.oldest_pending_created_at ?? null,
      oldestFailedCreatedAt: result?.oldest_failed_created_at ?? null,
      lastSyncedAt: result?.last_synced_at ?? null,
      lastSyncAttemptAt: result?.last_sync_attempt_at ?? null,
    };
  }

  /**
   * Count whether internal users remain on the non-billable usage path.
   */
  async getInternalBillingHealth(): Promise<InternalBillingHealth> {
    const result = await this.db
      .selectFrom('users as u')
      .leftJoin('usage_events as e', 'e.user_id', 'u.id')
      .select([
        sql<number>`COUNT(DISTINCT u.id)`.as('internal_users'),
        sql<number>`COUNT(CASE WHEN e.polar_billable = 1 THEN 1 END)`.as('billable_events'),
        sql<number>`COUNT(CASE WHEN e.polar_billable = 0 THEN 1 END)`.as('non_billable_events'),
      ])
      .where('u.paid_generation_entitlement', '=', 'internal')
      .executeTakeFirst();

    return {
      internalUsers: Number(result?.internal_users) || 0,
      billableEvents: Number(result?.billable_events) || 0,
      nonBillableEvents: Number(result?.non_billable_events) || 0,
    };
  }
}
