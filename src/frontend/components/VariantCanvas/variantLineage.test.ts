import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Lineage } from '../../space/protocol';
import { buildAncestryTrail } from './variantLineage';

let nextId = 0;
function link(overrides: Partial<Lineage>): Lineage {
  nextId += 1;
  return {
    id: `lineage-${nextId}`,
    parent_variant_id: 'parent',
    child_variant_id: 'child',
    relation_type: 'derived',
    severed: false,
    ...overrides,
  } as Lineage;
}

describe('buildAncestryTrail', () => {
  test('returns an empty trail when the variant has no parent', () => {
    assert.deepEqual(buildAncestryTrail('a', []), []);
    assert.deepEqual(buildAncestryTrail('a', [link({ parent_variant_id: 'x', child_variant_id: 'y' })]), []);
  });

  test('returns the direct parent for a one-step chain', () => {
    const lineage = [link({ parent_variant_id: 'root', child_variant_id: 'a', relation_type: 'refined' })];
    assert.deepEqual(buildAncestryTrail('a', lineage), [
      { variantId: 'root', relationType: 'refined' },
    ]);
  });

  test('walks the full chain ordered oldest ancestor → direct parent', () => {
    const lineage = [
      link({ parent_variant_id: 'root', child_variant_id: 'mid', relation_type: 'derived' }),
      link({ parent_variant_id: 'mid', child_variant_id: 'leaf', relation_type: 'refined' }),
    ];
    assert.deepEqual(buildAncestryTrail('leaf', lineage), [
      { variantId: 'root', relationType: 'derived' },
      { variantId: 'mid', relationType: 'refined' },
    ]);
  });

  test('stops at a severed link', () => {
    const lineage = [
      link({ parent_variant_id: 'root', child_variant_id: 'mid', severed: true }),
      link({ parent_variant_id: 'mid', child_variant_id: 'leaf', relation_type: 'refined' }),
    ];
    assert.deepEqual(buildAncestryTrail('leaf', lineage), [
      { variantId: 'mid', relationType: 'refined' },
    ]);
  });

  test('terminates on a cycle without looping forever', () => {
    const lineage = [
      link({ parent_variant_id: 'b', child_variant_id: 'a' }),
      link({ parent_variant_id: 'a', child_variant_id: 'b' }),
    ];
    const trail = buildAncestryTrail('a', lineage);
    // a→b then b→a is blocked by the visited guard, so the trail is just [b].
    assert.deepEqual(trail, [{ variantId: 'b', relationType: 'derived' }]);
  });
});
