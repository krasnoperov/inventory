import { injectable, inject } from 'inversify';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database, UsageEvent, NewUsageEvent } from '../db/types';
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

@injectable()
export class UsageEventDAO {
  constructor(@inject(TYPES.Database) private db: Kysely<Database>) {}

  async create(data: {
    userId: number;
    eventName: string;
    quantity: number;
    metadata?: UsageEventMetadata;
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
      .selectFrom('usage_events')
      .selectAll()
      .where('synced_at', 'is', null)
      .where('sync_attempts', '<', MAX_SYNC_ATTEMPTS) // Exclude failed events
      .orderBy('created_at', 'asc')
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
    const result = await this.db
      .selectFrom('usage_events')
      .select([
        sql<number>`COUNT(CASE WHEN synced_at IS NULL AND sync_attempts < ${MAX_SYNC_ATTEMPTS} THEN 1 END)`.as('pending'),
        sql<number>`COUNT(CASE WHEN synced_at IS NULL AND sync_attempts >= ${MAX_SYNC_ATTEMPTS} THEN 1 END)`.as('failed'),
        sql<number>`COUNT(CASE WHEN synced_at IS NOT NULL THEN 1 END)`.as('synced'),
      ])
      .executeTakeFirst();

    return {
      pending: Number(result?.pending) || 0,
      failed: Number(result?.failed) || 0,
      synced: Number(result?.synced) || 0,
    };
  }
}
