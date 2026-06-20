import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Asset, CollectionItem, SpaceCollection, Variant } from '../../space/protocol';
import {
  getDisplayVariant,
  getItemAsset,
  getPinnedVariantIdForAssetCollection,
  getUnfiledAssets,
  moveId,
  sortCollections,
} from './spaceBoardModel';

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    name: 'Anna',
    type: 'character',
    media_kind: 'image',
    tags: '[]',
    parent_asset_id: null,
    active_variant_id: 'variant-1',
    created_by: 'user-1',
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function variant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 'variant-1',
    asset_id: 'asset-1',
    media_kind: 'image',
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: 'images/variant-1.png',
    thumb_key: null,
    media_key: 'images/variant-1.png',
    media_mime_type: 'image/png',
    media_size_bytes: 1,
    media_width: 1,
    media_height: 1,
    media_duration_ms: null,
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: 1,
    updated_at: 1,
    description: null,
    ...overrides,
  };
}

function item(overrides: Partial<CollectionItem> = {}): CollectionItem {
  return {
    id: 'item-1',
    collection_id: 'collection-1',
    subject_type: 'asset',
    asset_id: 'asset-1',
    variant_id: null,
    role: 'lead',
    pinned_variant_id: null,
    sort_index: 0,
    created_by: 'user-1',
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

describe('space board model', () => {
  test('sorts collections and moves ids for reorder commands', () => {
    const collections: SpaceCollection[] = [
      { id: 'b', name: 'Scenes', kind: 'scenes', color: null, description: null, sort_index: 2, created_at: 2, updated_at: 2 },
      { id: 'a', name: 'Cast', kind: 'cast', color: null, description: null, sort_index: 1, created_at: 1, updated_at: 1 },
    ];

    assert.deepEqual(sortCollections(collections).map((collection) => collection.id), ['a', 'b']);
    assert.deepEqual(moveId(['item-1', 'item-2', 'item-3'], 'item-2', -1), ['item-2', 'item-1', 'item-3']);
    assert.deepEqual(moveId(['item-1', 'item-2'], 'item-1', -1), ['item-1', 'item-2']);
  });

  test('resolves pinned variants for asset items and exact variants for variant items', () => {
    const anna = asset();
    const active = variant();
    const pinned = variant({ id: 'variant-2', created_at: 2 });
    const variantItem = item({ subject_type: 'variant', asset_id: null, variant_id: 'variant-2' });

    assert.equal(getDisplayVariant(item({ pinned_variant_id: 'variant-2' }), anna, [active, pinned])?.id, 'variant-2');
    assert.equal(getDisplayVariant(variantItem, anna, [active, pinned])?.id, 'variant-2');
  });

  test('treats assets represented by variant items as filed', () => {
    const anna = asset();
    const roman = asset({ id: 'asset-2', name: 'Roman', active_variant_id: 'variant-2' });
    const annaVariant = variant();
    const romanVariant = variant({ id: 'variant-2', asset_id: 'asset-2' });

    const unfiled = getUnfiledAssets(
      [anna, roman],
      [item({ subject_type: 'variant', asset_id: null, variant_id: 'variant-2' })],
      [annaVariant, romanVariant],
    );

    assert.deepEqual(unfiled.map((candidate) => candidate.id), ['asset-1']);
    assert.equal(getItemAsset(item({ subject_type: 'variant', asset_id: null, variant_id: 'variant-2' }), [anna, roman], [annaVariant, romanVariant])?.id, 'asset-2');
  });

  test('keeps asset items filed when their pinned variant changes', () => {
    const anna = asset();
    const roman = asset({ id: 'asset-2', name: 'Roman', active_variant_id: 'variant-2' });
    const annaVariant = variant();
    const romanVariant = variant({ id: 'variant-2', asset_id: 'asset-2' });
    const filedItem = item({ asset_id: 'asset-2', pinned_variant_id: 'variant-2' });

    assert.equal(getDisplayVariant(filedItem, roman, [annaVariant, romanVariant])?.id, 'variant-2');
    assert.deepEqual(
      getUnfiledAssets([anna, roman], [filedItem], [annaVariant, romanVariant]).map((candidate) => candidate.id),
      ['asset-1'],
    );
  });

  test('pins active variants only for asset style reference collection items', () => {
    const anna = asset();
    const styleCollection: SpaceCollection = {
      id: 'style-refs',
      name: 'Style References',
      kind: 'style_refs',
      color: null,
      description: null,
      sort_index: 0,
      created_at: 1,
      updated_at: 1,
    };
    const castCollection: SpaceCollection = {
      ...styleCollection,
      id: 'cast',
      name: 'Cast',
      kind: 'cast',
    };

    assert.equal(getPinnedVariantIdForAssetCollection(styleCollection, anna), 'variant-1');
    assert.equal(getPinnedVariantIdForAssetCollection(castCollection, anna), null);
    assert.equal(getPinnedVariantIdForAssetCollection(styleCollection, asset({ active_variant_id: null })), null);
  });
});
