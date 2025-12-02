import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLineageGraph,
  convertSqliteBoolean,
  type GraphDependencies,
  type LineageRow,
  type GraphVariant,
} from './graph';

describe('Lineage Graph', () => {
  describe('convertSqliteBoolean', () => {
    test('converts 0 to false', () => {
      assert.strictEqual(convertSqliteBoolean(0), false);
    });

    test('converts 1 to true', () => {
      assert.strictEqual(convertSqliteBoolean(1), true);
    });

    test('converts any non-zero to true', () => {
      assert.strictEqual(convertSqliteBoolean(2), true);
      assert.strictEqual(convertSqliteBoolean(-1), true);
    });
  });

  describe('buildLineageGraph', () => {
    const createMockDeps = (
      lineageData: Record<string, LineageRow[]>,
      variantData: GraphVariant[]
    ): GraphDependencies => ({
      getLineageForVariant: async (variantId) => lineageData[variantId] || [],
      getVariantsWithAssets: async (variantIds) =>
        variantData.filter((v) => variantIds.includes(v.id)),
    });

    test('returns single variant with no connections', async () => {
      const deps = createMockDeps({}, [
        {
          id: 'v1',
          asset_id: 'a1',
          thumb_key: 'thumb1',
          image_key: 'img1',
          created_at: 1000,
          asset_name: 'Asset 1',
          asset_type: 'character',
        },
      ]);

      const graph = await buildLineageGraph('v1', deps);

      assert.strictEqual(graph.startVariantId, 'v1');
      assert.strictEqual(graph.variants.length, 1);
      assert.strictEqual(graph.variants[0].id, 'v1');
      assert.strictEqual(graph.lineage.length, 0);
    });

    test('builds graph with parent-child relationship', async () => {
      const lineage: LineageRow[] = [
        {
          id: 'l1',
          parent_variant_id: 'v1',
          child_variant_id: 'v2',
          relation_type: 'refined',
          severed: 0,
          created_at: 1000,
        },
      ];

      const variants: GraphVariant[] = [
        { id: 'v1', asset_id: 'a1', thumb_key: 't1', image_key: 'i1', created_at: 1000, asset_name: 'Parent', asset_type: 'character' },
        { id: 'v2', asset_id: 'a2', thumb_key: 't2', image_key: 'i2', created_at: 2000, asset_name: 'Child', asset_type: 'character' },
      ];

      const deps = createMockDeps(
        {
          v1: lineage,
          v2: lineage,
        },
        variants
      );

      const graph = await buildLineageGraph('v1', deps);

      assert.strictEqual(graph.variants.length, 2);
      assert.strictEqual(graph.lineage.length, 1);
      assert.strictEqual(graph.lineage[0].severed, false);
    });

    test('traverses from child to find parent', async () => {
      const lineage: LineageRow[] = [
        {
          id: 'l1',
          parent_variant_id: 'v1',
          child_variant_id: 'v2',
          relation_type: 'refined',
          severed: 0,
          created_at: 1000,
        },
      ];

      const variants: GraphVariant[] = [
        { id: 'v1', asset_id: 'a1', thumb_key: 't1', image_key: 'i1', created_at: 1000, asset_name: 'Parent', asset_type: 'character' },
        { id: 'v2', asset_id: 'a2', thumb_key: 't2', image_key: 'i2', created_at: 2000, asset_name: 'Child', asset_type: 'character' },
      ];

      const deps = createMockDeps({ v1: lineage, v2: lineage }, variants);

      // Start from child - should find parent
      const graph = await buildLineageGraph('v2', deps);

      assert.strictEqual(graph.startVariantId, 'v2');
      assert.strictEqual(graph.variants.length, 2);
      assert(graph.variants.some((v) => v.id === 'v1'));
      assert(graph.variants.some((v) => v.id === 'v2'));
    });

    test('handles complex graph with multiple branches', async () => {
      // Graph: v1 -> v2, v1 -> v3, v2 -> v4
      const lineageData: Record<string, LineageRow[]> = {
        v1: [
          { id: 'l1', parent_variant_id: 'v1', child_variant_id: 'v2', relation_type: 'refined', severed: 0, created_at: 1000 },
          { id: 'l2', parent_variant_id: 'v1', child_variant_id: 'v3', relation_type: 'refined', severed: 0, created_at: 1001 },
        ],
        v2: [
          { id: 'l1', parent_variant_id: 'v1', child_variant_id: 'v2', relation_type: 'refined', severed: 0, created_at: 1000 },
          { id: 'l3', parent_variant_id: 'v2', child_variant_id: 'v4', relation_type: 'refined', severed: 0, created_at: 1002 },
        ],
        v3: [
          { id: 'l2', parent_variant_id: 'v1', child_variant_id: 'v3', relation_type: 'refined', severed: 0, created_at: 1001 },
        ],
        v4: [
          { id: 'l3', parent_variant_id: 'v2', child_variant_id: 'v4', relation_type: 'refined', severed: 0, created_at: 1002 },
        ],
      };

      const variants: GraphVariant[] = [
        { id: 'v1', asset_id: 'a1', thumb_key: 't1', image_key: 'i1', created_at: 1000, asset_name: 'V1', asset_type: 'character' },
        { id: 'v2', asset_id: 'a2', thumb_key: 't2', image_key: 'i2', created_at: 2000, asset_name: 'V2', asset_type: 'character' },
        { id: 'v3', asset_id: 'a3', thumb_key: 't3', image_key: 'i3', created_at: 3000, asset_name: 'V3', asset_type: 'character' },
        { id: 'v4', asset_id: 'a4', thumb_key: 't4', image_key: 'i4', created_at: 4000, asset_name: 'V4', asset_type: 'character' },
      ];

      const deps = createMockDeps(lineageData, variants);
      const graph = await buildLineageGraph('v1', deps);

      assert.strictEqual(graph.variants.length, 4);
      assert.strictEqual(graph.lineage.length, 3); // l1, l2, l3 - no duplicates
    });

    test('deduplicates lineage entries', async () => {
      // Same lineage returned from multiple queries
      const lineage: LineageRow[] = [
        { id: 'l1', parent_variant_id: 'v1', child_variant_id: 'v2', relation_type: 'refined', severed: 0, created_at: 1000 },
      ];

      const deps = createMockDeps(
        { v1: lineage, v2: lineage },
        [
          { id: 'v1', asset_id: 'a1', thumb_key: 't1', image_key: 'i1', created_at: 1000, asset_name: 'V1', asset_type: 'character' },
          { id: 'v2', asset_id: 'a2', thumb_key: 't2', image_key: 'i2', created_at: 2000, asset_name: 'V2', asset_type: 'character' },
        ]
      );

      const graph = await buildLineageGraph('v1', deps);

      // Should only have one lineage entry despite being returned twice
      assert.strictEqual(graph.lineage.length, 1);
    });

    test('converts severed boolean correctly', async () => {
      const lineage: LineageRow[] = [
        { id: 'l1', parent_variant_id: 'v1', child_variant_id: 'v2', relation_type: 'refined', severed: 1, created_at: 1000 },
      ];

      const deps = createMockDeps(
        { v1: lineage, v2: lineage },
        [
          { id: 'v1', asset_id: 'a1', thumb_key: 't1', image_key: 'i1', created_at: 1000, asset_name: 'V1', asset_type: 'character' },
          { id: 'v2', asset_id: 'a2', thumb_key: 't2', image_key: 'i2', created_at: 2000, asset_name: 'V2', asset_type: 'character' },
        ]
      );

      const graph = await buildLineageGraph('v1', deps);

      assert.strictEqual(graph.lineage[0].severed, true);
    });

    test('handles cycle without infinite loop', async () => {
      // Artificial cycle: v1 -> v2 -> v1
      const lineageData: Record<string, LineageRow[]> = {
        v1: [
          { id: 'l1', parent_variant_id: 'v1', child_variant_id: 'v2', relation_type: 'refined', severed: 0, created_at: 1000 },
          { id: 'l2', parent_variant_id: 'v2', child_variant_id: 'v1', relation_type: 'refined', severed: 0, created_at: 1001 },
        ],
        v2: [
          { id: 'l1', parent_variant_id: 'v1', child_variant_id: 'v2', relation_type: 'refined', severed: 0, created_at: 1000 },
          { id: 'l2', parent_variant_id: 'v2', child_variant_id: 'v1', relation_type: 'refined', severed: 0, created_at: 1001 },
        ],
      };

      const variants: GraphVariant[] = [
        { id: 'v1', asset_id: 'a1', thumb_key: 't1', image_key: 'i1', created_at: 1000, asset_name: 'V1', asset_type: 'character' },
        { id: 'v2', asset_id: 'a2', thumb_key: 't2', image_key: 'i2', created_at: 2000, asset_name: 'V2', asset_type: 'character' },
      ];

      const deps = createMockDeps(lineageData, variants);

      // Should not hang
      const graph = await buildLineageGraph('v1', deps);

      assert.strictEqual(graph.variants.length, 2);
      assert.strictEqual(graph.lineage.length, 2);
    });

    test('returns empty variants array when no variants found', async () => {
      const deps = createMockDeps({}, []);
      const graph = await buildLineageGraph('nonexistent', deps);

      assert.strictEqual(graph.variants.length, 0);
      assert.strictEqual(graph.lineage.length, 0);
    });
  });
});
