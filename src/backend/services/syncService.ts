import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import type { Database } from '../../db/types';
import type { Env } from '../../core/types';

// =============================================================================
// Types
// =============================================================================

interface Asset {
  id: string;
  name: string;
  type: string;
  tags: string;
  active_variant_id: string | null;
}

interface Variant {
  id: string;
  asset_id: string;
  thumb_key: string;
}

interface SpaceState {
  assets: Asset[];
  variants: Variant[];
}

// =============================================================================
// Sync Service - DO to D1 Synchronization
// =============================================================================

/**
 * Syncs asset data from Durable Objects to D1 for cross-space search.
 * This is a best-effort shadow index that may lag behind the source of truth.
 */
export class SyncService {
  private db: Kysely<Database>;

  constructor(private env: Env) {
    this.db = new Kysely<Database>({
      dialect: new D1Dialect({ database: env.DB }),
    });
  }

  /**
   * Sync all spaces - run periodically via cron
   */
  async syncAllSpaces(): Promise<{ synced: number; errors: number }> {
    let synced = 0;
    let errors = 0;

    // Get all spaces from D1
    const spaces = await this.db
      .selectFrom('spaces')
      .select(['id'])
      .execute();

    for (const space of spaces) {
      try {
        await this.syncSpace(space.id);
        synced++;
      } catch (error) {
        console.error(`Error syncing space ${space.id}:`, error);
        errors++;
      }
    }

    return { synced, errors };
  }

  /**
   * Sync a single space from DO to D1
   */
  async syncSpace(spaceId: string): Promise<void> {
    if (!this.env.SPACES_DO) {
      throw new Error('SPACES_DO not configured');
    }

    // Get state from DO
    const doId = this.env.SPACES_DO.idFromName(spaceId);
    const doStub = this.env.SPACES_DO.get(doId);

    const doResponse = await doStub.fetch(new Request('http://do/internal/state', {
      method: 'GET',
    }));

    if (!doResponse.ok) {
      throw new Error(`Failed to get state from DO: ${doResponse.status}`);
    }

    const state = await doResponse.json() as SpaceState;

    // Sync assets to asset_index
    await this.syncAssetIndex(spaceId, state);
  }

  /**
   * Sync asset_index table with current DO state
   */
  private async syncAssetIndex(spaceId: string, state: SpaceState): Promise<void> {
    const now = Date.now();

    // Delete assets that no longer exist in DO
    const assetIds = state.assets.map(a => a.id);

    if (assetIds.length === 0) {
      // Delete all assets for this space
      await this.db
        .deleteFrom('asset_index')
        .where('space_id', '=', spaceId)
        .execute();
    } else {
      // Delete assets not in current state
      await this.db
        .deleteFrom('asset_index')
        .where('space_id', '=', spaceId)
        .where('id', 'not in', assetIds)
        .execute();
    }

    // Upsert current assets
    for (const asset of state.assets) {
      // Get thumb_key from active variant
      const activeVariant = state.variants.find(
        v => v.id === asset.active_variant_id
      );

      await this.db
        .insertInto('asset_index')
        .values({
          id: asset.id,
          space_id: spaceId,
          name: asset.name,
          type: asset.type,
          tags: asset.tags,
          thumb_key: activeVariant?.thumb_key ?? null,
          updated_at: now,
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            name: asset.name,
            type: asset.type,
            tags: asset.tags,
            thumb_key: activeVariant?.thumb_key ?? null,
            updated_at: now,
          })
        )
        .execute();
    }
  }

  /**
   * Search assets across all spaces user has access to
   */
  async searchAssets(
    userId: string,
    query: string,
    options: {
      type?: string;
      tags?: string[];
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<Array<{
    id: string;
    space_id: string;
    name: string;
    type: string;
    tags: string | null;
    thumb_key: string | null;
  }>> {
    const { type, limit = 20, offset = 0 } = options;

    let queryBuilder = this.db
      .selectFrom('asset_index as ai')
      .innerJoin('space_members as sm', 'sm.space_id', 'ai.space_id')
      .where('sm.user_id', '=', userId)
      .select([
        'ai.id',
        'ai.space_id',
        'ai.name',
        'ai.type',
        'ai.tags',
        'ai.thumb_key',
      ]);

    // Add search filter
    if (query) {
      queryBuilder = queryBuilder.where('ai.name', 'like', `%${query}%`);
    }

    // Add type filter
    if (type) {
      queryBuilder = queryBuilder.where('ai.type', '=', type);
    }

    // Add pagination
    queryBuilder = queryBuilder
      .orderBy('ai.updated_at', 'desc')
      .limit(limit)
      .offset(offset);

    return queryBuilder.execute();
  }
}

// =============================================================================
// Cron Handler for Periodic Sync
// =============================================================================

/**
 * Handle scheduled sync event
 * Configure in wrangler.toml:
 * [triggers]
 * crons = ["0 * * * *"]  # Every hour
 */
export async function handleScheduledSync(env: Env): Promise<void> {
  console.log('Starting scheduled sync...');

  const syncService = new SyncService(env);
  const result = await syncService.syncAllSpaces();

  console.log(`Sync completed: ${result.synced} spaces synced, ${result.errors} errors`);
}
