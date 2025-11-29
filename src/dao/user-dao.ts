import { injectable, inject } from 'inversify';
import type { Kysely } from 'kysely';
import type { Database, User, SessionUser } from '../db/types';
import { TYPES } from '../core/di-types';

export interface CreateUserData {
  email: string;
  name: string;
  google_id?: string;
}

export interface UpdateUserData {
  name?: string;
  google_id?: string;
  polar_customer_id?: string;
  // Quota limits cached from Polar webhooks (JSON)
  quota_limits?: string;
  quota_limits_updated_at?: string;
  // Rate limiting fields
  rate_limit_count?: number;
  rate_limit_window_start?: string;
}

@injectable()
export class UserDAO {
  constructor(@inject(TYPES.Database) private db: Kysely<Database>) {}

  async findById(id: number) {
    return await this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async findByEmail(email: string) {
    return await this.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst();
  }

  async findByGoogleId(googleId: string) {
    return await this.db
      .selectFrom('users')
      .selectAll()
      .where('google_id', '=', googleId)
      .executeTakeFirst();
  }

  async create(data: CreateUserData) {
    const result = await this.db
      .insertInto('users')
      .values({
        email: data.email,
        name: data.name,
        google_id: data.google_id,
        rate_limit_count: 0, // Initialize rate limit counter
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .returning(['id'])
      .executeTakeFirst();

    if (!result) {
      throw new Error('Failed to create user');
    }

    return result.id;
  }

  async update(id: number, data: UpdateUserData) {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.google_id !== undefined) updateData.google_id = data.google_id;
    if (data.polar_customer_id !== undefined) updateData.polar_customer_id = data.polar_customer_id;
    if (data.quota_limits !== undefined) updateData.quota_limits = data.quota_limits;
    if (data.quota_limits_updated_at !== undefined) updateData.quota_limits_updated_at = data.quota_limits_updated_at;
    if (data.rate_limit_count !== undefined) updateData.rate_limit_count = data.rate_limit_count;
    if (data.rate_limit_window_start !== undefined) updateData.rate_limit_window_start = data.rate_limit_window_start;

    await this.db
      .updateTable('users')
      .set(updateData)
      .where('id', '=', id)
      .execute();
  }

  async updateSettings(id: number, settings: {
    name?: string;
  }) {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (settings.name !== undefined) updateData.name = settings.name;

    await this.db
      .updateTable('users')
      .set(updateData)
      .where('id', '=', id)
      .execute();
  }

  async getSessionUser(id: number): Promise<SessionUser | null> {
    const user = await this.findById(id);
    if (!user) return null;
    return this.toSessionUser(user);
  }

  toSessionUser(user: User): SessionUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      google_id: user.google_id,
    };
  }

  /**
   * Find users without a Polar customer ID
   * Used by cron job to retry customer creation
   */
  async findWithoutPolarCustomer(limit = 50): Promise<User[]> {
    return await this.db
      .selectFrom('users')
      .selectAll()
      .where('polar_customer_id', 'is', null)
      .orderBy('created_at', 'asc')
      .limit(limit)
      .execute();
  }

  /**
   * Count users without a Polar customer ID
   * Used for billing status CLI command
   */
  async countWithoutPolarCustomer(): Promise<number> {
    const result = await this.db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('polar_customer_id', 'is', null)
      .executeTakeFirst();

    return Number(result?.count) || 0;
  }
}