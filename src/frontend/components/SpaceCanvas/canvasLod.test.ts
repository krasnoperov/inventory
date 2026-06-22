import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { COMPACT_ZOOM, isCompactZoom } from './canvasLod';

describe('isCompactZoom', () => {
  test('greeks below the threshold', () => {
    assert.equal(isCompactZoom(COMPACT_ZOOM - 0.01), true);
    assert.equal(isCompactZoom(0.15), true);
  });

  test('shows full detail at and above the threshold', () => {
    assert.equal(isCompactZoom(COMPACT_ZOOM), false);
    assert.equal(isCompactZoom(1), false);
  });
});
