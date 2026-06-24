import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatPlaybackTime } from './format';

describe('formatPlaybackTime', () => {
  test('formats seconds as m:ss with zero-padded seconds', () => {
    assert.equal(formatPlaybackTime(0), '0:00');
    assert.equal(formatPlaybackTime(5), '0:05');
    assert.equal(formatPlaybackTime(83), '1:23');
    assert.equal(formatPlaybackTime(725), '12:05');
  });

  test('floors fractional seconds', () => {
    assert.equal(formatPlaybackTime(83.9), '1:23');
  });

  test('clamps non-finite or negative input to 0:00', () => {
    assert.equal(formatPlaybackTime(null), '0:00');
    assert.equal(formatPlaybackTime(undefined), '0:00');
    assert.equal(formatPlaybackTime(-10), '0:00');
    assert.equal(formatPlaybackTime(NaN), '0:00');
    assert.equal(formatPlaybackTime(Infinity), '0:00');
  });
});
