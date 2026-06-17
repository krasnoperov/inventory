import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SpaceRepository, type SqlStorage, type SqlStorageResult } from './SpaceRepository';

describe('SpaceRepository', () => {
  // Mock SQL storage that tracks queries
  class MockSqlStorage implements SqlStorage {
    queries: Array<{ query: string; bindings: unknown[] }> = [];
    mockResults: Map<string, unknown[]> = new Map();

    exec(query: string, ...bindings: unknown[]): SqlStorageResult {
      this.queries.push({ query, bindings });

      // Find matching mock result
      for (const [pattern, result] of this.mockResults) {
        if (query.includes(pattern)) {
          return { toArray: () => result };
        }
      }
      return { toArray: () => [] };
    }

    setMockResult(queryPattern: string, result: unknown[]): void {
      this.mockResults.set(queryPattern, result);
    }

    getLastQuery(): { query: string; bindings: unknown[] } | undefined {
      return this.queries[this.queries.length - 1];
    }

    clear(): void {
      this.queries = [];
      this.mockResults.clear();
    }
  }

  let mockSql: MockSqlStorage;
  let repo: SpaceRepository;

  beforeEach(() => {
    mockSql = new MockSqlStorage();
    repo = new SpaceRepository(mockSql);
  });

  describe('Asset Operations', () => {
    test('getAllAssets executes correct query', async () => {
      mockSql.setMockResult('SELECT * FROM assets ORDER BY updated_at', [
        { id: 'a1', name: 'Asset 1', type: 'character' },
      ]);

      const assets = await repo.getAllAssets();

      assert.strictEqual(assets.length, 1);
      assert.strictEqual(assets[0].name, 'Asset 1');
    });

    test('getAssetById returns null when not found', async () => {
      const asset = await repo.getAssetById('nonexistent');
      assert.strictEqual(asset, null);
    });

    test('getAssetById returns asset when found', async () => {
      mockSql.setMockResult('WHERE id = ?', [
        { id: 'a1', name: 'Test Asset', type: 'item' },
      ]);

      const asset = await repo.getAssetById('a1');

      assert(asset !== null);
      assert.strictEqual(asset.name, 'Test Asset');
    });

    test('createAsset inserts with correct values', async () => {
      mockSql.setMockResult('WHERE id = ?', [
        { id: 'new-id', name: 'New Asset', type: 'scene', tags: '[]', created_by: 'user1' },
      ]);

      await repo.createAsset({
        id: 'new-id',
        name: 'New Asset',
        type: 'scene',
        tags: ['tag1'],
        createdBy: 'user1',
      });

      const insertQuery = mockSql.queries.find((q) => q.query.includes('INSERT INTO assets'));
      assert(insertQuery !== undefined);
      assert(insertQuery.query.includes('media_kind'));
      assert(insertQuery.bindings.includes('new-id'));
      assert(insertQuery.bindings.includes('New Asset'));
      assert(insertQuery.bindings.includes('scene'));
      assert(insertQuery.bindings.includes('image'));
      assert(insertQuery.bindings.includes('["tag1"]'));
    });

    test('createAsset accepts explicit media kind', async () => {
      mockSql.setMockResult('WHERE id = ?', [
        { id: 'new-id', name: 'New Asset', type: 'scene', media_kind: 'video' },
      ]);

      await repo.createAsset({
        id: 'new-id',
        name: 'New Asset',
        type: 'scene',
        mediaKind: 'video',
        tags: [],
        createdBy: 'user1',
      });

      const insertQuery = mockSql.queries.find((q) => q.query.includes('INSERT INTO assets'));
      assert(insertQuery !== undefined);
      assert.strictEqual(insertQuery.bindings[3], 'video');
    });

    test('updateAsset returns null for non-existent asset', async () => {
      const result = await repo.updateAsset('nonexistent', { name: 'Updated' });
      assert.strictEqual(result, null);
    });

    test('getAssetsWithVariantCount maps variant_count to variantCount', async () => {
      mockSql.setMockResult('variant_count', [
        { id: 'a1', name: 'Asset', type: 'character', variant_count: 5 },
      ]);

      const assets = await repo.getAssetsWithVariantCount();

      assert.strictEqual(assets.length, 1);
      assert.strictEqual(assets[0].variantCount, 5);
    });
  });

  describe('Variant Operations', () => {
    test('getAllVariants executes correct query', async () => {
      mockSql.setMockResult('SELECT * FROM variants', [
        { id: 'v1', asset_id: 'a1', image_key: 'img1' },
      ]);

      const variants = await repo.getAllVariants();

      assert.strictEqual(variants.length, 1);
      assert.strictEqual(variants[0].id, 'v1');
    });

    test('getOverviewVariants selects display variants without leaking ranking column', async () => {
      mockSql.setMockResult('ROW_NUMBER() OVER', [
        { id: 'v-active', asset_id: 'a1', image_key: 'img-active', overview_rank: 1 },
        { id: 'v-newest', asset_id: 'a2', image_key: 'img-newest', overview_rank: 1 },
      ]);

      const variants = await repo.getOverviewVariants();

      assert.strictEqual(variants.length, 2);
      assert.deepStrictEqual(
        variants.map((variant) => variant.id),
        ['v-active', 'v-newest']
      );
      assert.ok(!('overview_rank' in variants[0]));

      const query = mockSql.getLastQuery();
      assert(query !== undefined);
      assert(query.query.includes('CASE WHEN v.id = a.active_variant_id'));
      assert(query.query.includes('v.created_at DESC'));
    });

    test('getVariantById returns null when not found', async () => {
      const variant = await repo.getVariantById('nonexistent');
      assert.strictEqual(variant, null);
    });

    test('getVariantByWorkflowId finds by workflow_id', async () => {
      mockSql.setMockResult('workflow_id = ?', [
        { id: 'v1', workflow_id: 'workflow-123', asset_id: 'a1' },
      ]);

      const variant = await repo.getVariantByWorkflowId('workflow-123');

      assert(variant !== null);
      assert.strictEqual(variant.id, 'v1');
    });

    test('getVariantsByAsset filters by asset_id', async () => {
      mockSql.setMockResult('asset_id = ?', [
        { id: 'v1', asset_id: 'a1' },
        { id: 'v2', asset_id: 'a1' },
      ]);

      const variants = await repo.getVariantsByAsset('a1');

      assert.strictEqual(variants.length, 2);
    });

    test('getVariantImageKey returns image_key', async () => {
      mockSql.setMockResult('image_key FROM variants', [{ image_key: 'images/test.png' }]);

      const key = await repo.getVariantImageKey('v1');

      assert.strictEqual(key, 'images/test.png');
    });

    test('getVariantImageKey returns null when not found', async () => {
      const key = await repo.getVariantImageKey('nonexistent');
      assert.strictEqual(key, null);
    });

    test('updateVariantStarred returns null for non-existent', async () => {
      const result = await repo.updateVariantStarred('nonexistent', true);
      assert.strictEqual(result, null);
    });

    test('deleteVariant returns false for non-existent', async () => {
      const result = await repo.deleteVariant('nonexistent');
      assert.strictEqual(result, false);
    });

    test('createVariant inserts default media kind', async () => {
      mockSql.setMockResult('WHERE id = ?', [
        { id: 'v1', asset_id: 'a1', media_kind: 'image' },
      ]);

      await repo.createVariant({
        id: 'v1',
        assetId: 'a1',
        imageKey: 'images/v1.png',
        thumbKey: 'images/v1_thumb.webp',
        recipe: '{}',
        createdBy: 'user1',
      });

      const insertQuery = mockSql.queries.find((q) => q.query.includes('INSERT INTO variants'));
      assert(insertQuery !== undefined);
      assert(insertQuery.query.includes('media_kind'));
      assert.strictEqual(insertQuery.bindings[2], 'image');
      assert(insertQuery.query.includes('media_key'));
      assert.strictEqual(insertQuery.bindings[8], 'images/v1.png');
    });

    test('createVariant increments refs for audio sidecars', async () => {
      mockSql.setMockResult('WHERE id = ?', [
        { id: 'v1', asset_id: 'a1', media_kind: 'audio' },
      ]);

      await repo.createVariant({
        id: 'v1',
        assetId: 'a1',
        mediaKind: 'audio',
        imageKey: 'images/v1.png',
        thumbKey: 'images/v1_thumb.webp',
        mediaMetadata: {
          mediaKey: 'media/v1.mp3',
          transcriptKey: 'sidecars/v1/transcript.txt',
          wordTimingsKey: 'sidecars/v1/word_timings.json',
          renderMetadataKey: 'sidecars/v1/render_metadata.json',
        },
        recipe: '{}',
        createdBy: 'user1',
      });

      const refKeys = mockSql.queries
        .filter((q) => q.query.includes('INSERT INTO image_refs'))
        .map((q) => q.bindings[0]);

      assert.deepStrictEqual(refKeys, [
        'media/v1.mp3',
        'images/v1.png',
        'images/v1_thumb.webp',
        'sidecars/v1/transcript.txt',
        'sidecars/v1/word_timings.json',
        'sidecars/v1/render_metadata.json',
      ]);
    });

    test('completeVariant writes canonical media metadata', async () => {
      mockSql.setMockResult('WHERE id = ?', [
        { id: 'v1', asset_id: 'a1', recipe: '{}', media_kind: 'image' },
      ]);

      await repo.completeVariant('v1', 'images/v1.png', 'images/v1_thumb.webp', {
        mimeType: 'image/png',
        sizeBytes: 2048,
        width: 1024,
        height: 768,
      });

      const updateQuery = mockSql.queries.find((q) => q.query.includes("UPDATE variants SET status = 'completed'"));
      assert(updateQuery !== undefined);
      assert(updateQuery.query.includes('media_key'));
      assert.deepStrictEqual(updateQuery.bindings.slice(0, 8), [
        'images/v1.png',
        'images/v1_thumb.webp',
        'images/v1.png',
        'image/png',
        2048,
        1024,
        768,
        null,
      ]);
    });

    test('completeVariant writes provider metadata JSON', async () => {
      mockSql.setMockResult('WHERE id = ?', [
        { id: 'v1', asset_id: 'a1', recipe: '{}', media_kind: 'image' },
      ]);

      await repo.completeVariant('v1', 'images/v1.png', 'images/v1_thumb.webp', {
        providerMetadata: {
          provider: 'gemini',
          model: 'gemini-3-pro-image-preview',
          api: 'generate',
        },
      });

      const updateQuery = mockSql.queries.find((q) => q.query.includes("UPDATE variants SET status = 'completed'"));
      assert(updateQuery !== undefined);
      const providerMetadata = JSON.parse(String(updateQuery.bindings[17]));
      assert.deepStrictEqual(providerMetadata, {
        provider: 'gemini',
        model: 'gemini-3-pro-image-preview',
        api: 'generate',
      });
    });

    test('completeVariant accepts generated audio without legacy image keys', async () => {
      mockSql.setMockResult('WHERE id = ?', [
        { id: 'v1', asset_id: 'a1', recipe: '{}', media_kind: 'audio' },
      ]);

      await repo.completeVariant('v1', null, null, {
        mediaKey: 'media/space/v1.wav',
        mimeType: 'audio/wav',
        sizeBytes: 4044,
        durationMs: 250,
      });

      const updateQuery = mockSql.queries.find((q) => q.query.includes("UPDATE variants SET status = 'completed'"));
      assert(updateQuery !== undefined);
      assert.deepStrictEqual(updateQuery.bindings.slice(0, 8), [
        null,
        null,
        'media/space/v1.wav',
        'audio/wav',
        4044,
        null,
        null,
        250,
      ]);

      const refQuery = mockSql.queries.find((q) => q.query.includes('INSERT INTO image_refs'));
      assert(refQuery !== undefined);
      assert.strictEqual(refQuery.bindings[0], 'media/space/v1.wav');
    });

    test('createPlaceholderVariant inserts default media kind', async () => {
      mockSql.setMockResult('WHERE id = ?', [
        { id: 'v1', asset_id: 'a1', media_kind: 'image' },
      ]);

      const recipe = JSON.stringify({
        operation: 'generate',
        prompt: 'Create a sprite',
        assetType: 'character',
      });
      await repo.createPlaceholderVariant({
        id: 'v1',
        assetId: 'a1',
        recipe,
        createdBy: 'user1',
      });

      const insertQuery = mockSql.queries.find((q) => q.query.includes('INSERT INTO variants'));
      assert(insertQuery !== undefined);
      assert(insertQuery.query.includes('media_kind'));
      assert.strictEqual(insertQuery.bindings[2], 'image');
      assert(insertQuery.query.includes('generation_provenance'));
      assert.deepStrictEqual(JSON.parse(String(insertQuery.bindings[4])), {
        operation: 'generate',
        assetType: 'character',
        prompt: 'Create a sprite',
      });
    });

    test('createPlaceholderVariant accepts explicit media kind', async () => {
      mockSql.setMockResult('WHERE id = ?', [
        { id: 'v1', asset_id: 'a1', media_kind: 'audio' },
      ]);

      await repo.createPlaceholderVariant({
        id: 'v1',
        assetId: 'a1',
        mediaKind: 'audio',
        recipe: '{}',
        createdBy: 'user1',
      });

      const insertQuery = mockSql.queries.find((q) => q.query.includes('INSERT INTO variants'));
      assert(insertQuery !== undefined);
      assert.strictEqual(insertQuery.bindings[2], 'audio');
    });
  });

  describe('Production Record Operations', () => {
    test('upsertProductionRecord stores timeline placement metadata', async () => {
      const createdRecord = {
        id: 'record-1',
        production_id: 'episode-01',
        variant_id: 'variant-1',
        asset_id: 'asset-1',
        media_kind: 'video',
        shot_id: 'shot-1',
        scene_label: 'Opening',
        timeline_start_ms: 0,
        duration_ms: 1200,
        motion_prompt: 'slow push',
        source_refs: '["ref-a"]',
        source_variant_ids: '["source-1"]',
        metadata: '{"take":1}',
        created_by: 'user1',
        created_at: 1,
        updated_at: 2,
      };
      mockSql.setMockResult('SELECT * FROM production_records WHERE id = ?', [createdRecord]);

      const record = await repo.upsertProductionRecord({
        id: 'record-1',
        productionId: 'episode-01',
        variantId: 'variant-1',
        assetId: 'asset-1',
        mediaKind: 'video',
        shotId: 'shot-1',
        sceneLabel: 'Opening',
        timelineStartMs: 0,
        durationMs: 1200,
        motionPrompt: 'slow push',
        sourceRefs: ['ref-a'],
        sourceVariantIds: ['source-1'],
        metadata: { take: 1 },
        createdBy: 'user1',
      });

      const upsertQuery = mockSql.queries.find((q) => q.query.includes('INSERT INTO production_records'));
      assert(upsertQuery !== undefined);
      assert(upsertQuery.query.includes('ON CONFLICT(id) DO UPDATE'));
      assert.equal(upsertQuery.bindings[1], 'episode-01');
      assert.equal(upsertQuery.bindings[2], 'variant-1');
      assert.equal(upsertQuery.bindings[4], 'video');
      assert.equal(upsertQuery.bindings[10], '["ref-a"]');
      assert.equal(upsertQuery.bindings[11], '["source-1"]');
      assert.equal(upsertQuery.bindings[12], '{"take":1}');
      assert.equal(record.id, 'record-1');
    });

    test('getProductionRecordsByProductionId sorts by timeline', async () => {
      mockSql.setMockResult('WHERE production_id = ?', [
        { id: 'record-1', production_id: 'episode-01' },
      ]);

      const records = await repo.getProductionRecordsByProductionId('episode-01');

      assert.equal(records.length, 1);
      const query = mockSql.getLastQuery();
      assert(query !== undefined);
      assert(query.query.includes('ORDER BY timeline_start_ms ASC'));
      assert.deepEqual(query.bindings, ['episode-01']);
    });

    test('deleteProductionRecord returns false when missing', async () => {
      const deleted = await repo.deleteProductionRecord('missing');
      assert.equal(deleted, false);
    });
  });

  describe('Lineage Operations', () => {
    test('getAllLineage executes correct query', async () => {
      mockSql.setMockResult('SELECT * FROM lineage', [
        { id: 'l1', parent_variant_id: 'v1', child_variant_id: 'v2' },
      ]);

      const lineage = await repo.getAllLineage();

      assert.strictEqual(lineage.length, 1);
    });

    test('getLineageForVariant queries both parent and child', async () => {
      await repo.getLineageForVariant('v1');

      const query = mockSql.getLastQuery();
      assert(query !== undefined);
      assert(query.query.includes('parent_variant_id = ?'));
      assert(query.query.includes('child_variant_id = ?'));
      assert.deepStrictEqual(query.bindings, ['v1', 'v1']);
    });

    test('getLineageForVariants handles empty array', async () => {
      const result = await repo.getLineageForVariants([]);
      assert.deepStrictEqual(result, []);
    });

    test('getParentLineageWithDetails converts severed boolean', async () => {
      mockSql.setMockResult('child_variant_id = ?', [
        { id: 'l1', severed: 1, parent_variant_id: 'v1', child_variant_id: 'v2', asset_id: 'a1', image_key: 'i1', thumb_key: 't1', asset_name: 'A1' },
        { id: 'l2', severed: 0, parent_variant_id: 'v3', child_variant_id: 'v2', asset_id: 'a2', image_key: 'i2', thumb_key: 't2', asset_name: 'A2' },
      ]);

      const lineage = await repo.getParentLineageWithDetails('v2');

      assert.strictEqual(lineage[0].severed, true);
      assert.strictEqual(lineage[1].severed, false);
    });

    test('severLineage returns false for non-existent', async () => {
      const result = await repo.severLineage('nonexistent');
      assert.strictEqual(result, false);
    });

    test('createLineage inserts with correct values', async () => {
      mockSql.setMockResult('WHERE id = ?', [
        { id: 'l1', parent_variant_id: 'v1', child_variant_id: 'v2', relation_type: 'refined' },
      ]);

      await repo.createLineage({
        id: 'l1',
        parentVariantId: 'v1',
        childVariantId: 'v2',
        relationType: 'refined',
      });

      const insertQuery = mockSql.queries.find((q) => q.query.includes('INSERT INTO lineage'));
      assert(insertQuery !== undefined);
      assert(insertQuery.bindings.includes('l1'));
      assert(insertQuery.bindings.includes('v1'));
      assert(insertQuery.bindings.includes('v2'));
      assert(insertQuery.bindings.includes('refined'));
    });
  });

  describe('Chat Operations', () => {
    test('getChatHistory uses limit parameter', async () => {
      await repo.getChatHistory(50);

      const query = mockSql.getLastQuery();
      assert(query !== undefined);
      assert(query.bindings.includes(50));
    });

    test('getChatHistory defaults to 20', async () => {
      await repo.getChatHistory();

      const query = mockSql.getLastQuery();
      assert(query !== undefined);
      assert(query.bindings.includes(20));
    });

    test('createChatMessage returns created message', async () => {
      const message = await repo.createChatMessage({
        id: 'msg1',
        senderType: 'user',
        senderId: 'user1',
        content: 'Hello',
      });

      assert.strictEqual(message.id, 'msg1');
      assert.strictEqual(message.sender_type, 'user');
      assert.strictEqual(message.content, 'Hello');
      assert(typeof message.created_at === 'number');
    });

    test('clearChatHistory executes DELETE', async () => {
      await repo.clearChatHistory();

      const query = mockSql.getLastQuery();
      assert(query !== undefined);
      assert(query.query.includes('DELETE FROM chat_messages'));
    });
  });

  describe('State Operations', () => {
    test('getFullState returns all entities', async () => {
      mockSql.setMockResult('SELECT * FROM assets ORDER by updated_at', [{ id: 'a1' }]);
      mockSql.setMockResult('SELECT * FROM variants', [{ id: 'v1' }]);
      mockSql.setMockResult('SELECT * FROM lineage', [{ id: 'l1' }]);

      const state = await repo.getFullState();

      assert(Array.isArray(state.assets));
      assert(Array.isArray(state.variants));
      assert(Array.isArray(state.lineage));
    });

    test('getOverviewState skips full variant and lineage queries', async () => {
      mockSql.setMockResult('ROW_NUMBER() OVER', [{ id: 'v1', asset_id: 'a1', overview_rank: 1 }]);

      const state = await repo.getOverviewState();

      assert(Array.isArray(state.assets));
      assert(Array.isArray(state.variants));
      assert.strictEqual(state.variants.length, 1);
      assert.ok(!('lineage' in state));
      assert.ok(mockSql.queries.some((q) => q.query.includes('ROW_NUMBER() OVER')));
      assert.ok(!mockSql.queries.some((q) => q.query === 'SELECT * FROM variants'));
      assert.ok(!mockSql.queries.some((q) => q.query === 'SELECT * FROM lineage'));
    });

    test('getOverviewState includes variants referenced by tile and rotation rows', async () => {
      mockSql.setMockResult('ROW_NUMBER() OVER', [{ id: 'active-v1', asset_id: 'a1', overview_rank: 1 }]);
      mockSql.setMockResult('SELECT * FROM rotation_sets', [
        { id: 'rs1', source_variant_id: 'rotation-source-v1' },
      ]);
      mockSql.setMockResult('SELECT * FROM rotation_views', [
        { id: 'rv1', variant_id: 'rotation-view-v1' },
      ]);
      mockSql.setMockResult('SELECT * FROM tile_sets', [
        { id: 'ts1', seed_variant_id: 'tile-seed-v1' },
      ]);
      mockSql.setMockResult('SELECT * FROM tile_positions', [
        { id: 'tp1', variant_id: 'tile-position-v1' },
      ]);
      mockSql.setMockResult('WHERE id IN', [
        { id: 'rotation-source-v1', asset_id: 'a1' },
        { id: 'rotation-view-v1', asset_id: 'a1' },
        { id: 'tile-seed-v1', asset_id: 'a1' },
        { id: 'tile-position-v1', asset_id: 'a1' },
      ]);

      const state = await repo.getOverviewState();

      assert.deepStrictEqual(
        state.variants.map((variant) => variant.id),
        ['active-v1', 'rotation-source-v1', 'rotation-view-v1', 'tile-seed-v1', 'tile-position-v1']
      );
      const referencedVariantQuery = mockSql.queries.find((q) => q.query.includes('WHERE id IN'));
      assert(referencedVariantQuery !== undefined);
      assert.deepStrictEqual(referencedVariantQuery.bindings, [
        'rotation-source-v1',
        'rotation-view-v1',
        'tile-seed-v1',
        'tile-position-v1',
      ]);
    });
  });
});
