import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatMediaKind } from './mediaKind';

describe('formatMediaKind', () => {
  test('formats known media kinds for display', () => {
    assert.equal(formatMediaKind('image'), 'Image');
    assert.equal(formatMediaKind('audio'), 'Audio');
    assert.equal(formatMediaKind('video'), 'Video');
  });

  test('formats future compound values defensively', () => {
    assert.equal(formatMediaKind('sprite_sheet'), 'Sprite Sheet');
    assert.equal(formatMediaKind('sprite-sheet'), 'Sprite Sheet');
  });

  test('falls back for missing values', () => {
    assert.equal(formatMediaKind(null), 'Unknown media');
    assert.equal(formatMediaKind(undefined), 'Unknown media');
  });
});
