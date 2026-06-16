import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getVariantMediaUrl,
  getVariantThumbnailUrl,
  isVariantAudioReady,
  isVariantImageReady,
  isVariantReady,
  type Variant,
} from './useSpaceWebSocket';

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

describe('variant media helpers', () => {
  test('keeps image variants thumbnail-backed and image-ready', () => {
    const imageVariant = variant();

    assert.equal(isVariantReady(imageVariant), true);
    assert.equal(isVariantImageReady(imageVariant), true);
    assert.equal(isVariantAudioReady(imageVariant), false);
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
    assert.equal(isVariantAudioReady(audioVariant), true);
    assert.equal(getVariantThumbnailUrl(audioVariant), undefined);
    assert.equal(getVariantMediaUrl(audioVariant, 'space-1'), '/api/spaces/space-1/variants/variant-1/media');
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
    assert.equal(isVariantAudioReady(pendingVariant), false);
    assert.equal(getVariantMediaUrl(pendingVariant, 'space-1'), undefined);
  });
});
