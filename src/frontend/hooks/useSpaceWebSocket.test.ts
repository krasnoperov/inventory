import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  clearSpaceStateSnapshotCacheForTests,
  getSpaceStateSnapshotForTests,
  getVariantMediaUrl,
  getVariantThumbnailUrl,
  isVariantAudioReady,
  isVariantForgeTrayReady,
  isVariantImageReady,
  isVariantReady,
  isVariantVideoReady,
  saveSpaceStateSnapshotForTests,
  type Asset,
  type Variant,
} from './useSpaceWebSocket';

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    name: 'Asset One',
    type: 'scene',
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
    image_key: 'images/space/variant.png',
    thumb_key: 'images/space/variant_thumb.webp',
    media_key: 'images/space/variant.png',
    media_mime_type: 'image/png',
    media_size_bytes: 123,
    media_width: 100,
    media_height: 100,
    media_duration_ms: null,
    transcript_key: null,
    transcript_mime_type: null,
    transcript_size_bytes: null,
    word_timings_key: null,
    word_timings_mime_type: null,
    word_timings_size_bytes: null,
    render_metadata_key: null,
    render_metadata_mime_type: null,
    render_metadata_size_bytes: null,
    generation_provenance: '{}',
    provider_metadata: null,
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: 1,
    updated_at: 1,
    description: null,
    quality_rating: null,
    rated_at: null,
    ...overrides,
  };
}

describe('space state snapshot cache', () => {
  test('preserves loaded assets for same-space remounts without exposing mutable cache state', () => {
    clearSpaceStateSnapshotCacheForTests();

    saveSpaceStateSnapshotForTests('space-1', {
      assets: [asset()],
      variants: [variant()],
      lineage: [],
      presence: [],
      rotationSets: [],
      rotationViews: [],
      tileSets: [],
      tilePositions: [],
      syncMode: 'overview',
      updatedAt: 1,
    });

    const firstRead = getSpaceStateSnapshotForTests('space-1');
    assert.equal(firstRead?.assets.length, 1);
    assert.equal(firstRead?.variants.length, 1);

    firstRead?.assets.push(asset({ id: 'asset-2' }));

    const secondRead = getSpaceStateSnapshotForTests('space-1');
    assert.equal(secondRead?.assets.length, 1);
    assert.equal(secondRead?.assets[0]?.id, 'asset-1');
  });

  test('returns no snapshot for spaces that have not synced yet', () => {
    clearSpaceStateSnapshotCacheForTests();

    assert.equal(getSpaceStateSnapshotForTests('new-space'), null);
  });
});

describe('variant media helpers', () => {
  test('keeps image variants thumbnail-backed and image-ready', () => {
    const imageVariant = variant();

    assert.equal(isVariantReady(imageVariant), true);
    assert.equal(isVariantImageReady(imageVariant), true);
    assert.equal(isVariantForgeTrayReady(imageVariant), true);
    assert.equal(isVariantAudioReady(imageVariant), false);
    assert.equal(isVariantVideoReady(imageVariant), false);
    assert.equal(getVariantThumbnailUrl(imageVariant), '/api/images/images/space/variant_thumb.webp');
    assert.equal(getVariantMediaUrl(imageVariant, 'space-1'), '/api/spaces/space-1/variants/variant-1/media');
  });

  test('treats completed media-only variants as ready without image-only readiness', () => {
    const audioVariant = variant({
      media_kind: 'audio',
      image_key: null,
      thumb_key: null,
      media_key: 'media/space/theme.mp3',
      media_mime_type: 'audio/mpeg',
      media_width: null,
      media_height: null,
    });

    assert.equal(isVariantReady(audioVariant), true);
    assert.equal(isVariantImageReady(audioVariant), false);
    assert.equal(isVariantForgeTrayReady(audioVariant), true);
    assert.equal(isVariantAudioReady(audioVariant), true);
    assert.equal(isVariantVideoReady(audioVariant), false);
    assert.equal(getVariantThumbnailUrl(audioVariant), undefined);
    assert.equal(getVariantMediaUrl(audioVariant, 'space-1'), '/api/spaces/space-1/variants/variant-1/media');
  });

  test('requires canonical media for audio readiness', () => {
    const audioWithoutMedia = variant({
      media_kind: 'audio',
      image_key: 'images/space/audio-poster.png',
      thumb_key: null,
      media_key: null,
      media_mime_type: null,
      media_width: null,
      media_height: null,
    });

    assert.equal(isVariantReady(audioWithoutMedia), true);
    assert.equal(isVariantAudioReady(audioWithoutMedia), false);
    assert.equal(isVariantForgeTrayReady(audioWithoutMedia), false);
  });

  test('treats completed video variants as ready for native playback', () => {
    const videoVariant = variant({
      media_kind: 'video',
      image_key: null,
      thumb_key: null,
      media_key: 'media/space/clip.mp4',
      media_mime_type: 'video/mp4',
      media_duration_ms: 1200,
    });

    assert.equal(isVariantReady(videoVariant), true);
    assert.equal(isVariantImageReady(videoVariant), false);
    assert.equal(isVariantForgeTrayReady(videoVariant), true);
    assert.equal(isVariantAudioReady(videoVariant), false);
    assert.equal(isVariantVideoReady(videoVariant), true);
    assert.equal(getVariantThumbnailUrl(videoVariant), undefined);
    assert.equal(getVariantMediaUrl(videoVariant, 'space-1'), '/api/spaces/space-1/variants/variant-1/media');
  });

  test('does not mark pending media as ready', () => {
    const pendingVariant = variant({
      status: 'uploading',
      image_key: null,
      thumb_key: null,
      media_key: null,
    });

    assert.equal(isVariantReady(pendingVariant), false);
    assert.equal(isVariantImageReady(pendingVariant), false);
    assert.equal(isVariantForgeTrayReady(pendingVariant), false);
    assert.equal(isVariantAudioReady(pendingVariant), false);
    assert.equal(isVariantVideoReady(pendingVariant), false);
    assert.equal(getVariantMediaUrl(pendingVariant, 'space-1'), undefined);
  });
});
