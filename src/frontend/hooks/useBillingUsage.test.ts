import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { calculateGeminiSpend, formatBillingPeriod, formatUsd, type BillingUsage } from './useBillingUsage';

describe('calculateGeminiSpend', () => {
  test('sums cost across all Gemini meters only', () => {
    const usage: BillingUsage = {
      period: {
        start: '2026-06-01T00:00:00.000Z',
        end: '2026-06-30T23:59:59.000Z',
      },
      usage: {
        gemini_images: {
          used: 2,
          limit: 50,
          remaining: 48,
          costUsd: 0.48,
        },
        gemini_input_tokens: {
          used: 1200,
          limit: null,
          remaining: null,
          costUsd: 0.03,
        },
        gemini_audio: {
          used: 1,
          limit: null,
          remaining: null,
          costUsd: 0.04,
        },
        elevenlabs_audio: {
          used: 1,
          limit: null,
          remaining: null,
          costUsd: 0.12,
        },
      },
    };

    assert.equal(calculateGeminiSpend(usage), 0.55);
  });

  test('treats missing and invalid Gemini costs as zero', () => {
    const usage: BillingUsage = {
      period: {
        start: '2026-06-01T00:00:00.000Z',
        end: '2026-06-30T23:59:59.000Z',
      },
      usage: {
        gemini_images: {
          used: 1,
          limit: null,
          remaining: null,
        },
        gemini_videos: {
          used: 1,
          limit: null,
          remaining: null,
          costUsd: Number.NaN,
        },
      },
    };

    assert.equal(calculateGeminiSpend(usage), 0);
  });
});

describe('formatUsd', () => {
  test('formats normal and sub-cent spend for the profile display', () => {
    assert.equal(formatUsd(3.2), '$3.20');
    assert.equal(formatUsd(0.0042), '$0.0042');
  });
});

describe('formatBillingPeriod', () => {
  test('formats the customer billing period for the profile display', () => {
    const usage: BillingUsage = {
      period: {
        start: '2026-06-01T00:00:00.000Z',
        end: '2026-06-30T23:59:59.000Z',
      },
      usage: {},
    };

    assert.equal(formatBillingPeriod(usage), 'Jun 1, 2026 - Jun 30, 2026');
  });

  test('falls back for missing or invalid period data', () => {
    assert.equal(formatBillingPeriod(null), 'Current billing period');
    assert.equal(formatBillingPeriod({
      period: {
        start: 'invalid',
        end: '2026-06-30T23:59:59.000Z',
      },
      usage: {},
    }), 'Current billing period');
  });
});
