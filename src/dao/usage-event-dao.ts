import { injectable, inject } from 'inversify';
import type { Kysely } from 'kysely';
import type { Database, UsageEvent, NewUsageEvent } from '../db/types';
import { TYPES } from '../core/di-types';

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
}
