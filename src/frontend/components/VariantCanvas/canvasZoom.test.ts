import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Variant } from '../../space/protocol';
import {
  computeNativeMaxZoom,
  MAX_NATIVE_MAX_ZOOM,
  MIN_NATIVE_MAX_ZOOM,
  NATIVE_ZOOM_HEADROOM,
} from './canvasZoom';

function variant(overrides: Partial<Variant> = {}): Variant {
  return { media_height: null, media_width: null, ...overrides } as Variant;
}

const THUMB_HEIGHT = 180;

describe('computeNativeMaxZoom', () => {
  test('falls back to the floor when no variant has dimensions', () => {
    assert.equal(computeNativeMaxZoom([], THUMB_HEIGHT), MIN_NATIVE_MAX_ZOOM);
    assert.equal(
      computeNativeMaxZoom([variant({ media_height: null })], THUMB_HEIGHT),
      MIN_NATIVE_MAX_ZOOM,
    );
  });

  test('reaches native 1:1 plus headroom for a typical generation', () => {
    // 768px tall rendered at 180px → native at 4.27×, ×1.5 headroom ≈ 6.4×.
    const zoom = computeNativeMaxZoom([variant({ media_height: 768 })], THUMB_HEIGHT);
    assert.equal(zoom, (768 / THUMB_HEIGHT) * NATIVE_ZOOM_HEADROOM);
    assert.ok(zoom > 768 / THUMB_HEIGHT, 'must allow zooming past native 1:1');
  });

  test('uses the most demanding (tallest) variant', () => {
    const zoom = computeNativeMaxZoom(
      [variant({ media_height: 256 }), variant({ media_height: 768 }), variant({ media_height: 512 })],
      THUMB_HEIGHT,
    );
    assert.equal(zoom, (768 / THUMB_HEIGHT) * NATIVE_ZOOM_HEADROOM);
  });

  test('ignores variants without a stored height', () => {
    const zoom = computeNativeMaxZoom(
      [variant({ media_height: null }), variant({ media_height: 768 })],
      THUMB_HEIGHT,
    );
    assert.equal(zoom, (768 / THUMB_HEIGHT) * NATIVE_ZOOM_HEADROOM);
  });

  test('clamps very tall sources to the ceiling', () => {
    const zoom = computeNativeMaxZoom([variant({ media_height: 4000 })], THUMB_HEIGHT);
    assert.equal(zoom, MAX_NATIVE_MAX_ZOOM);
  });

  test('never drops below the floor for a tiny image', () => {
    const zoom = computeNativeMaxZoom([variant({ media_height: 32 })], THUMB_HEIGHT);
    assert.equal(zoom, MIN_NATIVE_MAX_ZOOM);
  });
});
