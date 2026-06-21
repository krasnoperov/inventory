import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Lineage, Variant } from '../../space/protocol';
import { buildLineageAssetEdges } from './canvasEdges';

function variant(id: string, assetId: string): Variant {
  return {
    id,
    asset_id: assetId,
    media_kind: 'image',
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: null,
    thumb_key: null,
    media_key: null,
    media_mime_type: null,
    media_size_bytes: null,
    media_width: null,
    media_height: null,
    media_duration_ms: null,
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: 1,
    updated_at: 1,
    description: null,
  } as Variant;
}

function lineage(overrides: Partial<Lineage> = {}): Lineage {
  return {
    id: 'l1',
    parent_variant_id: 'pv',
    child_variant_id: 'cv',
    relation_type: 'derived',
    severed: false,
    created_at: 1,
    ...overrides,
  } as Lineage;
}

const variants = [
  variant('a1-v1', 'a1'),
  variant('a1-v2', 'a1'),
  variant('a2-v1', 'a2'),
  variant('a3-v1', 'a3'),
];

describe('buildLineageAssetEdges', () => {
  test('maps variant lineage to a directed asset edge', () => {
    const edges = buildLineageAssetEdges(
      [lineage({ parent_variant_id: 'a1-v1', child_variant_id: 'a2-v1', relation_type: 'refined' })],
      variants,
    );
    assert.deepEqual(edges, [{ id: 'a1->a2', source: 'a1', target: 'a2', relationType: 'refined' }]);
  });

  test('skips severed links', () => {
    const edges = buildLineageAssetEdges(
      [lineage({ parent_variant_id: 'a1-v1', child_variant_id: 'a2-v1', severed: true })],
      variants,
    );
    assert.equal(edges.length, 0);
  });

  test('skips intra-asset refinements', () => {
    const edges = buildLineageAssetEdges(
      [lineage({ parent_variant_id: 'a1-v1', child_variant_id: 'a1-v2' })],
      variants,
    );
    assert.equal(edges.length, 0);
  });

  test('de-duplicates directed asset pairs, first relation wins', () => {
    const edges = buildLineageAssetEdges(
      [
        lineage({ id: 'l1', parent_variant_id: 'a1-v1', child_variant_id: 'a2-v1', relation_type: 'derived' }),
        lineage({ id: 'l2', parent_variant_id: 'a1-v2', child_variant_id: 'a2-v1', relation_type: 'forked' }),
      ],
      variants,
    );
    assert.deepEqual(edges, [{ id: 'a1->a2', source: 'a1', target: 'a2', relationType: 'derived' }]);
  });

  test('drops links whose variants are missing', () => {
    const edges = buildLineageAssetEdges(
      [lineage({ parent_variant_id: 'ghost', child_variant_id: 'a2-v1' })],
      variants,
    );
    assert.equal(edges.length, 0);
  });
});
