import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { waveformBars } from './audioWaveform';

describe('waveformBars', () => {
  test('is deterministic for a given seed', () => {
    assert.deepEqual(waveformBars('clip-abc'), waveformBars('clip-abc'));
  });

  test('returns the requested number of bars', () => {
    assert.equal(waveformBars('seed', 24).length, 24);
    assert.equal(waveformBars('seed').length, 40);
  });

  test('keeps every bar within [0.12, 1]', () => {
    for (const v of waveformBars('any-seed-here', 64)) {
      assert.ok(v >= 0.12 && v <= 1, `bar out of range: ${v}`);
    }
  });

  test('uses a wide amplitude range (reads as a waveform, not a flat line)', () => {
    // Averaged across seeds so the assertion doesn't hinge on whether one
    // seed's zero-crossing happens to land on a sample.
    const seeds = ['clip-a', 'clip-b', 'clip-c', 'clip-d', 'clip-e'];
    const spreads = seeds.map((s) => {
      const bars = waveformBars(s, 40);
      return Math.max(...bars) - Math.min(...bars);
    });
    const avgSpread = spreads.reduce((a, b) => a + b, 0) / spreads.length;
    assert.ok(avgSpread > 0.45, `expected a wide silhouette, got avg spread ${avgSpread.toFixed(2)}`);
  });

  test('different seeds produce different silhouettes', () => {
    assert.notDeepEqual(waveformBars('clip-a'), waveformBars('clip-b'));
  });
});
