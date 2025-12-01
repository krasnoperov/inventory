import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAssetUpdateQuery, buildInClause, buildVariantLineageQuery } from './queries';

describe('Space Queries', () => {
  describe('buildAssetUpdateQuery', () => {
    test('returns empty update when no changes provided', () => {
      const { sql, values } = buildAssetUpdateQuery({});
      // Should still have updated_at
      assert(sql.includes('updated_at = ?'));
      assert.strictEqual(values.length, 1);
      assert(typeof values[0] === 'number'); // timestamp
    });

    test('handles name change', () => {
      const { sql, values } = buildAssetUpdateQuery({ name: 'New Name' });
      assert(sql.includes('name = ?'));
      assert(sql.includes('updated_at = ?'));
      assert.strictEqual(values[0], 'New Name');
      assert.strictEqual(values.length, 2); // name + timestamp
    });

    test('handles tags change with JSON stringification', () => {
      const tags = ['tag1', 'tag2'];
      const { sql, values } = buildAssetUpdateQuery({ tags });
      assert(sql.includes('tags = ?'));
      assert.strictEqual(values[0], JSON.stringify(tags));
    });

    test('handles type change', () => {
      const { sql, values } = buildAssetUpdateQuery({ type: 'scene' });
      assert(sql.includes('type = ?'));
      assert.strictEqual(values[0], 'scene');
    });

    test('handles parent_asset_id change to new value', () => {
      const { sql, values } = buildAssetUpdateQuery({ parent_asset_id: 'parent-123' });
      assert(sql.includes('parent_asset_id = ?'));
      assert.strictEqual(values[0], 'parent-123');
    });

    test('handles parent_asset_id change to null', () => {
      const { sql, values } = buildAssetUpdateQuery({ parent_asset_id: null });
      assert(sql.includes('parent_asset_id = ?'));
      assert.strictEqual(values[0], null);
    });

    test('handles active_variant_id change', () => {
      const { sql, values } = buildAssetUpdateQuery({ active_variant_id: 'variant-456' });
      assert(sql.includes('active_variant_id = ?'));
      assert.strictEqual(values[0], 'variant-456');
    });

    test('handles multiple changes', () => {
      const { sql, values } = buildAssetUpdateQuery({
        name: 'Updated Name',
        type: 'character',
        parent_asset_id: 'parent-789',
      });

      assert(sql.includes('name = ?'));
      assert(sql.includes('type = ?'));
      assert(sql.includes('parent_asset_id = ?'));
      assert(sql.includes('updated_at = ?'));
      assert.strictEqual(values[0], 'Updated Name');
      assert.strictEqual(values[1], 'character');
      assert.strictEqual(values[2], 'parent-789');
      assert.strictEqual(values.length, 4); // 3 changes + timestamp
    });

    test('generates valid SQL syntax', () => {
      const { sql } = buildAssetUpdateQuery({ name: 'Test' });
      assert(sql.startsWith('UPDATE assets SET '));
      assert(sql.endsWith(' WHERE id = ?'));
    });
  });

  describe('buildInClause', () => {
    test('builds single placeholder', () => {
      const { placeholders, values } = buildInClause(['id1']);
      assert.strictEqual(placeholders, '?');
      assert.deepStrictEqual(values, ['id1']);
    });

    test('builds multiple placeholders', () => {
      const { placeholders, values } = buildInClause(['id1', 'id2', 'id3']);
      assert.strictEqual(placeholders, '?,?,?');
      assert.deepStrictEqual(values, ['id1', 'id2', 'id3']);
    });

    test('handles empty array', () => {
      const { placeholders, values } = buildInClause([]);
      assert.strictEqual(placeholders, '');
      assert.deepStrictEqual(values, []);
    });
  });

  describe('buildVariantLineageQuery', () => {
    test('builds query with single variant', () => {
      const query = buildVariantLineageQuery(['var1']);
      assert(query.includes('WHERE v.id IN (?)'));
      assert(query.includes('SELECT v.id'));
      assert(query.includes('a.name as asset_name'));
    });

    test('builds query with multiple variants', () => {
      const query = buildVariantLineageQuery(['var1', 'var2', 'var3']);
      assert(query.includes('WHERE v.id IN (?,?,?)'));
    });

    test('includes required fields', () => {
      const query = buildVariantLineageQuery(['var1']);
      assert(query.includes('v.id'));
      assert(query.includes('v.asset_id'));
      assert(query.includes('v.thumb_key'));
      assert(query.includes('v.image_key'));
      assert(query.includes('v.created_at'));
      assert(query.includes('a.name as asset_name'));
      assert(query.includes('a.type as asset_type'));
    });
  });
});
