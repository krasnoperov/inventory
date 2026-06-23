import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { configureMediaCdnBaseUrl, getR2ImageUrl } from '../media-cdn';
import { getVariantDisplayImageUrl, type Variant } from './protocol';

function variant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 'variant-1',
    media_kind: 'image',
    status: 'completed',
    image_key: 'images/space/variant.png',
    thumb_key: 'images/space/variant_thumb.webp',
    media_key: 'images/space/variant.png',
    ...overrides,
  } as Variant;
}

describe('getVariantDisplayImageUrl', () => {
  afterEach(() => {
    configureMediaCdnBaseUrl(undefined);
  });

  test('returns the lightweight thumbnail by default', () => {
    assert.equal(
      getVariantDisplayImageUrl(variant()),
      getR2ImageUrl('images/space/variant_thumb.webp'),
    );
  });

  test('returns the authenticated full-size media route when full-res is requested with a space', () => {
    assert.equal(
      getVariantDisplayImageUrl(variant(), { fullResolution: true, spaceId: 'space-1' }),
      '/api/spaces/space-1/variants/variant-1/media',
    );
  });

  test('full-res without a space falls back to the CDN media key (not the thumb)', () => {
    assert.equal(
      getVariantDisplayImageUrl(variant(), { fullResolution: true }),
      getR2ImageUrl('images/space/variant.png'),
    );
  });

  test('full-res does not swap for non-image variants', () => {
    // An audio variant has no image_key, so it is not image-ready and keeps the
    // thumbnail resolution (here: undefined) rather than the media route.
    const audio = variant({ media_kind: 'audio', image_key: null });
    assert.equal(
      getVariantDisplayImageUrl(audio, { fullResolution: true, spaceId: 'space-1' }),
      undefined,
    );
  });
});
