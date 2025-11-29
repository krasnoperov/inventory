import { injectable, inject } from 'inversify';
import type { Kysely } from 'kysely';
import type { Database, UserPattern, UserFeedback, UserPreferences } from '../db/types';
import { TYPES } from '../core/di-types';

/**
 * Data access for assistant memory: patterns, feedback, and preferences
 */
@injectable()
export class MemoryDAO {
  constructor(@inject(TYPES.Database) private db: Kysely<Database>) {}

  // ==========================================================================
  // USER PATTERNS
  // ==========================================================================

  /**
   * Upsert a pattern - increments count if exists, creates if not
   */
  async upsertPattern(data: {
    userId: number;
    spaceId: string | null;
    assetType: string;
    promptText: string;
    promptHash: string;
    styleTags?: string[];
  }): Promise<string> {
    const existing = await this.findPatternByHash(data.userId, data.promptHash);

    if (existing) {
      // Increment counters
      await this.db
        .updateTable('user_patterns')
        .set({
          success_count: existing.success_count + 1,
          total_uses: existing.total_uses + 1,
          last_used_at: new Date().toISOString(),
        })
        .where('id', '=', existing.id)
        .execute();
      return existing.id;
    }

    // Create new pattern
    const id = crypto.randomUUID();
    await this.db
      .insertInto('user_patterns')
      .values({
        id,
        user_id: data.userId,
        space_id: data.spaceId,
        asset_type: data.assetType,
        prompt_text: data.promptText,
        prompt_hash: data.promptHash,
        success_count: 1,
        total_uses: 1,
        style_tags: data.styleTags ? JSON.stringify(data.styleTags) : null,
        last_used_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      })
      .execute();

    return id;
  }

  /**
   * Find pattern by prompt hash (for deduplication)
   */
  async findPatternByHash(userId: number, promptHash: string): Promise<UserPattern | undefined> {
    return await this.db
      .selectFrom('user_patterns')
      .selectAll()
      .where('user_id', '=', userId)
      .where('prompt_hash', '=', promptHash)
      .executeTakeFirst();
  }

  /**
   * Get user's patterns, optionally filtered by type
   */
  async getPatterns(userId: number, options?: {
    assetType?: string;
    spaceId?: string | null;
    limit?: number;
  }): Promise<UserPattern[]> {
    let query = this.db
      .selectFrom('user_patterns')
      .selectAll()
      .where('user_id', '=', userId);

    if (options?.assetType) {
      query = query.where('asset_type', '=', options.assetType);
    }

    if (options?.spaceId !== undefined) {
      if (options.spaceId === null) {
        query = query.where('space_id', 'is', null);
      } else {
        query = query.where((eb) =>
          eb.or([
            eb('space_id', '=', options.spaceId!),
            eb('space_id', 'is', null),  // Include global patterns
          ])
        );
      }
    }

    return await query
      .orderBy('success_count', 'desc')
      .orderBy('last_used_at', 'desc')
      .limit(options?.limit ?? 50)
      .execute();
  }

  /**
   * Get top patterns for context injection
   */
  async getTopPatterns(userId: number, limit = 5): Promise<UserPattern[]> {
    return await this.db
      .selectFrom('user_patterns')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('success_count', 'desc')
      .orderBy('last_used_at', 'desc')
      .limit(limit)
      .execute();
  }

  /**
   * Delete a pattern
   */
  async deletePattern(userId: number, patternId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('user_patterns')
      .where('id', '=', patternId)
      .where('user_id', '=', userId)  // Ensure ownership
      .executeTakeFirst();

    return Number(result.numDeletedRows) > 0;
  }

  // ==========================================================================
  // USER FEEDBACK
  // ==========================================================================

  /**
   * Record feedback on a variant
   */
  async recordFeedback(data: {
    userId: number;
    variantId: string;
    rating: 'positive' | 'negative';
    prompt?: string;
  }): Promise<string> {
    const id = crypto.randomUUID();
    await this.db
      .insertInto('user_feedback')
      .values({
        id,
        user_id: data.userId,
        variant_id: data.variantId,
        rating: data.rating,
        prompt: data.prompt ?? null,
        created_at: new Date().toISOString(),
      })
      .execute();

    return id;
  }

  /**
   * Get feedback for a variant
   */
  async getFeedbackForVariant(variantId: string): Promise<UserFeedback | undefined> {
    return await this.db
      .selectFrom('user_feedback')
      .selectAll()
      .where('variant_id', '=', variantId)
      .executeTakeFirst();
  }

  /**
   * Get user's recent feedback
   */
  async getUserFeedback(userId: number, limit = 50): Promise<UserFeedback[]> {
    return await this.db
      .selectFrom('user_feedback')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
  }

  /**
   * Get feedback stats for a user
   */
  async getFeedbackStats(userId: number): Promise<{ positive: number; negative: number }> {
    const results = await this.db
      .selectFrom('user_feedback')
      .select(['rating'])
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('user_id', '=', userId)
      .groupBy('rating')
      .execute();

    const stats = { positive: 0, negative: 0 };
    for (const row of results) {
      if (row.rating === 'positive') stats.positive = Number(row.count);
      if (row.rating === 'negative') stats.negative = Number(row.count);
    }
    return stats;
  }

  // ==========================================================================
  // USER PREFERENCES
  // ==========================================================================

  /**
   * Get user preferences (creates default if not exists)
   */
  async getPreferences(userId: number): Promise<UserPreferences> {
    const existing = await this.db
      .selectFrom('user_preferences')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (existing) return existing;

    // Create default preferences
    const now = new Date().toISOString();
    await this.db
      .insertInto('user_preferences')
      .values({
        user_id: userId,
        default_art_style: null,
        default_aspect_ratio: null,
        auto_execute_safe: true,
        auto_approve_low_cost: false,
        inject_patterns: true,
        max_patterns_context: 5,
        created_at: now,
        updated_at: now,
      })
      .execute();

    return await this.db
      .selectFrom('user_preferences')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
  }

  /**
   * Update user preferences
   */
  async updatePreferences(userId: number, updates: {
    default_art_style?: string | null;
    default_aspect_ratio?: string | null;
    auto_execute_safe?: boolean;
    auto_approve_low_cost?: boolean;
    inject_patterns?: boolean;
    max_patterns_context?: number;
  }): Promise<void> {
    // Ensure preferences exist
    await this.getPreferences(userId);

    await this.db
      .updateTable('user_preferences')
      .set({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .where('user_id', '=', userId)
      .execute();
  }
}
