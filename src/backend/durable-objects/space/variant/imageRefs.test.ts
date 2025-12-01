import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getVariantImageKeys,
  parseRecipe,
  getRecipeInputKeys,
  INCREMENT_REF_SQL,
  DECREMENT_REF_SQL,
  DELETE_REF_SQL,
} from './imageRefs';

describe('Image Reference Utilities', () => {
  describe('SQL Constants', () => {
    test('INCREMENT_REF_SQL has upsert pattern', () => {
      assert(INCREMENT_REF_SQL.includes('INSERT INTO image_refs'));
      assert(INCREMENT_REF_SQL.includes('ON CONFLICT'));
      assert(INCREMENT_REF_SQL.includes('ref_count + 1'));
    });

    test('DECREMENT_REF_SQL returns new count', () => {
      assert(DECREMENT_REF_SQL.includes('UPDATE image_refs'));
      assert(DECREMENT_REF_SQL.includes('ref_count - 1'));
      assert(DECREMENT_REF_SQL.includes('RETURNING ref_count'));
    });

    test('DELETE_REF_SQL deletes by key', () => {
      assert(DELETE_REF_SQL.includes('DELETE FROM image_refs'));
      assert(DELETE_REF_SQL.includes('WHERE image_key = ?'));
    });
  });

  describe('getVariantImageKeys', () => {
    test('extracts image_key and thumb_key', () => {
      const keys = getVariantImageKeys({
        image_key: 'images/space1/var1.png',
        thumb_key: 'thumbs/space1/var1.png',
        recipe: '{}',
      });
      assert(keys.includes('images/space1/var1.png'));
      assert(keys.includes('thumbs/space1/var1.png'));
      assert.strictEqual(keys.length, 2);
    });

    test('extracts input keys from recipe', () => {
      const keys = getVariantImageKeys({
        image_key: 'images/space1/var1.png',
        thumb_key: 'thumbs/space1/var1.png',
        recipe: JSON.stringify({
          type: 'derive',
          inputs: [{ imageKey: 'images/space1/source.png' }],
        }),
      });
      assert(keys.includes('images/space1/var1.png'));
      assert(keys.includes('thumbs/space1/var1.png'));
      assert(keys.includes('images/space1/source.png'));
      assert.strictEqual(keys.length, 3);
    });

    test('handles multiple inputs', () => {
      const keys = getVariantImageKeys({
        image_key: 'img1',
        thumb_key: 'thumb1',
        recipe: JSON.stringify({
          type: 'compose',
          inputs: [
            { imageKey: 'ref1' },
            { imageKey: 'ref2' },
            { imageKey: 'ref3' },
          ],
        }),
      });
      assert.strictEqual(keys.length, 5);
      assert(keys.includes('img1'));
      assert(keys.includes('thumb1'));
      assert(keys.includes('ref1'));
      assert(keys.includes('ref2'));
      assert(keys.includes('ref3'));
    });

    test('deduplicates keys', () => {
      const keys = getVariantImageKeys({
        image_key: 'same-key',
        thumb_key: 'same-key', // Same as image_key
        recipe: JSON.stringify({
          inputs: [{ imageKey: 'same-key' }], // Also same
        }),
      });
      assert.strictEqual(keys.length, 1);
      assert.strictEqual(keys[0], 'same-key');
    });

    test('handles empty recipe', () => {
      const keys = getVariantImageKeys({
        image_key: 'img',
        thumb_key: 'thumb',
        recipe: '{}',
      });
      assert.deepStrictEqual(keys, ['img', 'thumb']);
    });

    test('handles recipe with no inputs', () => {
      const keys = getVariantImageKeys({
        image_key: 'img',
        thumb_key: 'thumb',
        recipe: JSON.stringify({ type: 'generate', prompt: 'test' }),
      });
      assert.deepStrictEqual(keys, ['img', 'thumb']);
    });

    test('handles invalid JSON gracefully', () => {
      const keys = getVariantImageKeys({
        image_key: 'img',
        thumb_key: 'thumb',
        recipe: 'not valid json',
      });
      assert.deepStrictEqual(keys, ['img', 'thumb']);
    });

    test('handles inputs with missing imageKey', () => {
      const keys = getVariantImageKeys({
        image_key: 'img',
        thumb_key: 'thumb',
        recipe: JSON.stringify({
          inputs: [
            { variantId: 'v1' }, // No imageKey
            { imageKey: 'ref1' },
          ],
        }),
      });
      assert.strictEqual(keys.length, 3);
      assert(keys.includes('ref1'));
    });
  });

  describe('parseRecipe', () => {
    test('parses valid JSON', () => {
      const recipe = parseRecipe(JSON.stringify({ type: 'generate', prompt: 'test' }));
      assert(recipe !== null);
      assert.strictEqual(recipe!.type, 'generate');
      assert.strictEqual(recipe!.prompt, 'test');
    });

    test('returns null for invalid JSON', () => {
      const recipe = parseRecipe('not json');
      assert.strictEqual(recipe, null);
    });

    test('returns null for empty string', () => {
      const recipe = parseRecipe('');
      assert.strictEqual(recipe, null);
    });

    test('parses recipe with inputs', () => {
      const recipe = parseRecipe(
        JSON.stringify({
          type: 'derive',
          inputs: [{ variantId: 'v1', imageKey: 'key1' }],
        })
      );
      assert(recipe !== null);
      assert.strictEqual(recipe!.type, 'derive');
      assert(Array.isArray(recipe!.inputs));
      assert.strictEqual(recipe!.inputs!.length, 1);
    });
  });

  describe('getRecipeInputKeys', () => {
    test('returns empty array for empty recipe', () => {
      const keys = getRecipeInputKeys('{}');
      assert.deepStrictEqual(keys, []);
    });

    test('returns empty array for invalid JSON', () => {
      const keys = getRecipeInputKeys('invalid');
      assert.deepStrictEqual(keys, []);
    });

    test('extracts input keys', () => {
      const keys = getRecipeInputKeys(
        JSON.stringify({
          inputs: [{ imageKey: 'key1' }, { imageKey: 'key2' }],
        })
      );
      assert.deepStrictEqual(keys, ['key1', 'key2']);
    });

    test('filters out inputs without imageKey', () => {
      const keys = getRecipeInputKeys(
        JSON.stringify({
          inputs: [
            { variantId: 'v1' }, // No imageKey
            { imageKey: 'key1' },
            { variantId: 'v2', imageKey: 'key2' },
          ],
        })
      );
      assert.deepStrictEqual(keys, ['key1', 'key2']);
    });
  });
});
