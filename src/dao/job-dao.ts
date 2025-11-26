import { injectable, inject } from 'inversify';
import type { Kysely } from 'kysely';
import type { Database, Job, NewJob } from '../db/types';
import { TYPES } from '../core/di-types';

@injectable()
export class JobDAO {
  constructor(@inject(TYPES.Database) private db: Kysely<Database>) {}

  async createJob(data: NewJob): Promise<Job> {
    const now = Date.now();
    const result = await this.db
      .insertInto('jobs')
      .values({
        ...data,
        created_at: data.created_at ?? now,
        updated_at: data.updated_at ?? now,
      })
      .returningAll()
      .executeTakeFirst();

    if (!result) {
      throw new Error('Failed to create job');
    }

    return result;
  }

  async getJobById(id: string): Promise<Job | null> {
    const result = await this.db
      .selectFrom('jobs')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return result ?? null;
  }

  async getJobsBySpaceId(spaceId: string, status?: string): Promise<Job[]> {
    let query = this.db
      .selectFrom('jobs')
      .selectAll()
      .where('space_id', '=', spaceId);

    if (status) {
      query = query.where('status', '=', status as Job['status']);
    }

    return await query.orderBy('created_at', 'desc').execute();
  }

  async getJobsByUserId(userId: string, limit?: number): Promise<Job[]> {
    let query = this.db
      .selectFrom('jobs')
      .selectAll()
      .where('created_by', '=', userId)
      .orderBy('created_at', 'desc');

    if (limit) {
      query = query.limit(limit);
    }

    return await query.execute();
  }

  async updateJobStatus(
    id: string,
    status: Job['status'],
    error?: string
  ): Promise<Job | null> {
    const updateData: Record<string, unknown> = {
      status,
      updated_at: Date.now(),
    };

    if (error !== undefined) {
      updateData.error = error;
    }

    const result = await this.db
      .updateTable('jobs')
      .set(updateData)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    return result ?? null;
  }

  async incrementAttempts(id: string): Promise<Job | null> {
    const result = await this.db
      .updateTable('jobs')
      .set((eb) => ({
        attempts: eb('attempts', '+', 1),
        updated_at: Date.now(),
      }))
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    return result ?? null;
  }

  async setJobResult(id: string, variantId: string): Promise<Job | null> {
    const result = await this.db
      .updateTable('jobs')
      .set({
        result_variant_id: variantId,
        status: 'completed',
        updated_at: Date.now(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    return result ?? null;
  }

  async getPendingJobs(limit?: number): Promise<Job[]> {
    let query = this.db
      .selectFrom('jobs')
      .selectAll()
      .where('status', '=', 'pending')
      .orderBy('created_at', 'asc');

    if (limit) {
      query = query.limit(limit);
    }

    return await query.execute();
  }

  async getStuckJobs(): Promise<Job[]> {
    return await this.db
      .selectFrom('jobs')
      .selectAll()
      .where('status', '=', 'stuck')
      .orderBy('created_at', 'asc')
      .execute();
  }

  async retryJob(id: string): Promise<Job | null> {
    const result = await this.db
      .updateTable('jobs')
      .set({
        status: 'pending',
        error: null,
        updated_at: Date.now(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    return result ?? null;
  }
}
