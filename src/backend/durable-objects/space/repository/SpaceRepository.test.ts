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

      const asset = await repo.createAsset({
        id: 'new-id',
        name: 'New Asset',
        type: 'scene',
        tags: ['tag1'],
        createdBy: 'user1',
      });

      const insertQuery = mockSql.queries.find((q) => q.query.includes('INSERT INTO assets'));
      assert(insertQuery !== undefined);
      assert(insertQuery.bindings.includes('new-id'));
      assert(insertQuery.bindings.includes('New Asset'));
      assert(insertQuery.bindings.includes('scene'));
      assert(insertQuery.bindings.includes('["tag1"]'));
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
  });
});
