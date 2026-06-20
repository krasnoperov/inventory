import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyCreatedOutputCollectionPlacements } from './collectionPlacements';
import type { CollectionItem } from './space/protocol';

const baseItem: CollectionItem = {
  id: 'item-1',
  collection_id: 'cast',
  subject_type: 'asset',
  asset_id: 'existing-asset',
  variant_id: null,
  role: 'character',
  pinned_variant_id: 'existing-v1',
  sort_index: 0,
  created_by: 'user-1',
  created_at: 1,
  updated_at: 1,
};

describe('collection placement helpers', () => {
  test('upload new asset placement pins the exact uploaded variant by default', () => {
    const calls: unknown[] = [];

    applyCreatedOutputCollectionPlacements(
      [{ collectionId: 'cast', role: 'lead', subjectType: 'asset', pinToCreatedVariant: true }],
      { assetId: 'asset-new', variantId: 'variant-uploaded' },
      [baseItem],
      (params) => calls.push(params),
      'asset'
    );

    assert.deepEqual(calls, [{
      collectionId: 'cast',
      subjectType: 'asset',
      assetId: 'asset-new',
      variantId: undefined,
      role: 'lead',
      pinnedVariantId: 'variant-uploaded',
      sortIndex: 1,
    }]);
  });

  test('upload variant placement creates variant-specific collection membership', () => {
    const calls: unknown[] = [];

    applyCreatedOutputCollectionPlacements(
      [{ collectionId: 'style', role: 'style_ref', subjectType: 'variant' }],
      { assetId: 'asset-1', variantId: 'variant-uploaded' },
      [],
      (params) => calls.push(params),
      'variant'
    );

    assert.deepEqual(calls, [{
      collectionId: 'style',
      subjectType: 'variant',
      assetId: undefined,
      variantId: 'variant-uploaded',
      role: 'style_ref',
      pinnedVariantId: null,
      sortIndex: 0,
    }]);
  });
});
