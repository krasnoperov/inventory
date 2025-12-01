import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { wouldCreateCycle, getAncestorChain, getDescendantIds } from './hierarchy';

describe('Asset Hierarchy', () => {
  describe('wouldCreateCycle', () => {
    test('returns false when newParentId is null', async () => {
      const result = await wouldCreateCycle('a', null, async () => null);
      assert.strictEqual(result, false);
    });

    test('returns true for self-reference', async () => {
      const result = await wouldCreateCycle('a', 'a', async () => null);
      assert.strictEqual(result, true);
    });

    test('returns false for valid parent assignment', async () => {
      // Tree: root -> b, we're setting a's parent to b
      const parents: Record<string, string | null> = {
        root: null,
        b: 'root',
      };

      const result = await wouldCreateCycle('a', 'b', async (id) => parents[id] ?? null);
      assert.strictEqual(result, false);
    });

    test('detects direct cycle (child becoming parent of parent)', async () => {
      // Current: a -> b (a is parent of b)
      // Trying to set a's parent to b would create: b -> a -> b (cycle)
      const parents: Record<string, string | null> = {
        a: null,
        b: 'a',
      };

      const result = await wouldCreateCycle('a', 'b', async (id) => parents[id] ?? null);
      assert.strictEqual(result, true);
    });

    test('detects indirect cycle through chain', async () => {
      // Current: a -> b -> c (a is root, b is child of a, c is child of b)
      // Trying to set a's parent to c would create cycle
      const parents: Record<string, string | null> = {
        a: null,
        b: 'a',
        c: 'b',
      };

      const result = await wouldCreateCycle('a', 'c', async (id) => parents[id] ?? null);
      assert.strictEqual(result, true);
    });

    test('handles deep hierarchy without cycle', async () => {
      // Tree: root -> a -> b -> c -> d
      // Adding 'x' under 'd' is fine
      const parents: Record<string, string | null> = {
        root: null,
        a: 'root',
        b: 'a',
        c: 'b',
        d: 'c',
      };

      const result = await wouldCreateCycle('x', 'd', async (id) => parents[id] ?? null);
      assert.strictEqual(result, false);
    });

    test('handles existing corrupted cycle gracefully', async () => {
      // Corrupted: a -> b -> c -> a (cycle already exists)
      // Should not hang, should detect visited
      const parents: Record<string, string | null> = {
        a: 'c',
        b: 'a',
        c: 'b',
      };

      // This shouldn't hang due to visited set
      const result = await wouldCreateCycle('x', 'a', async (id) => parents[id] ?? null);
      // It might return true (if it detects x somehow) or false
      // The important thing is it doesn't hang
      assert(typeof result === 'boolean');
    });
  });

  describe('getAncestorChain', () => {
    interface TestAsset {
      id: string;
      name: string;
      parent_asset_id: string | null;
    }

    const createAssets = (): Record<string, TestAsset> => ({
      root: { id: 'root', name: 'Root', parent_asset_id: null },
      child: { id: 'child', name: 'Child', parent_asset_id: 'root' },
      grandchild: { id: 'grandchild', name: 'Grandchild', parent_asset_id: 'child' },
      greatgrandchild: { id: 'greatgrandchild', name: 'Great Grandchild', parent_asset_id: 'grandchild' },
    });

    test('returns empty array for root asset', async () => {
      const assets = createAssets();
      const ancestors = await getAncestorChain(
        'root',
        async (id) => assets[id] ?? null,
        (asset) => asset.parent_asset_id
      );
      assert.deepStrictEqual(ancestors, []);
    });

    test('returns single ancestor for direct child', async () => {
      const assets = createAssets();
      const ancestors = await getAncestorChain(
        'child',
        async (id) => assets[id] ?? null,
        (asset) => asset.parent_asset_id
      );
      assert.strictEqual(ancestors.length, 1);
      assert.strictEqual(ancestors[0].id, 'root');
    });

    test('returns ancestors in root-first order', async () => {
      const assets = createAssets();
      const ancestors = await getAncestorChain(
        'grandchild',
        async (id) => assets[id] ?? null,
        (asset) => asset.parent_asset_id
      );
      assert.strictEqual(ancestors.length, 2);
      assert.strictEqual(ancestors[0].id, 'root');
      assert.strictEqual(ancestors[1].id, 'child');
    });

    test('handles deep hierarchy', async () => {
      const assets = createAssets();
      const ancestors = await getAncestorChain(
        'greatgrandchild',
        async (id) => assets[id] ?? null,
        (asset) => asset.parent_asset_id
      );
      assert.strictEqual(ancestors.length, 3);
      assert.strictEqual(ancestors[0].id, 'root');
      assert.strictEqual(ancestors[1].id, 'child');
      assert.strictEqual(ancestors[2].id, 'grandchild');
    });

    test('returns empty array for non-existent asset', async () => {
      const assets = createAssets();
      const ancestors = await getAncestorChain(
        'nonexistent',
        async (id) => assets[id] ?? null,
        (asset) => asset.parent_asset_id
      );
      assert.deepStrictEqual(ancestors, []);
    });

    test('handles broken chain gracefully', async () => {
      const assets: Record<string, TestAsset> = {
        orphan: { id: 'orphan', name: 'Orphan', parent_asset_id: 'missing' },
      };
      const ancestors = await getAncestorChain(
        'orphan',
        async (id) => assets[id] ?? null,
        (asset) => asset.parent_asset_id
      );
      // Should return empty since parent is missing
      assert.deepStrictEqual(ancestors, []);
    });
  });

  describe('getDescendantIds', () => {
    test('returns empty array for leaf node', async () => {
      const children: Record<string, string[]> = {
        leaf: [],
      };
      const descendants = await getDescendantIds('leaf', async (id) => children[id] ?? []);
      assert.deepStrictEqual(descendants, []);
    });

    test('returns direct children', async () => {
      const children: Record<string, string[]> = {
        root: ['a', 'b'],
        a: [],
        b: [],
      };
      const descendants = await getDescendantIds('root', async (id) => children[id] ?? []);
      assert.deepStrictEqual(descendants.sort(), ['a', 'b']);
    });

    test('returns all descendants in tree', async () => {
      const children: Record<string, string[]> = {
        root: ['a', 'b'],
        a: ['c'],
        b: ['d', 'e'],
        c: [],
        d: [],
        e: [],
      };
      const descendants = await getDescendantIds('root', async (id) => children[id] ?? []);
      assert.deepStrictEqual(descendants.sort(), ['a', 'b', 'c', 'd', 'e']);
    });

    test('respects maxDepth', async () => {
      const children: Record<string, string[]> = {
        root: ['a'],
        a: ['b'],
        b: ['c'],
        c: ['d'],
        d: [],
      };
      const descendants = await getDescendantIds('root', async (id) => children[id] ?? [], 2);
      assert.deepStrictEqual(descendants.sort(), ['a', 'b']);
    });

    test('handles circular reference gracefully', async () => {
      // a -> b -> c -> a (cycle)
      const children: Record<string, string[]> = {
        a: ['b'],
        b: ['c'],
        c: ['a'],
      };
      // Should not hang due to visited set
      const descendants = await getDescendantIds('a', async (id) => children[id] ?? []);
      // Should include b and c, but not loop forever
      assert(descendants.includes('b'));
      assert(descendants.includes('c'));
    });
  });
});
