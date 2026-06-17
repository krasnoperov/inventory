// @ts-nocheck - D1 mock shape is intentionally minimal
import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { preCheck } from './usageCheck';

function createPreCheckDb(options: {
  quotaLimit: number;
  quotaLimitsJson?: string;
  quotaUsed?: number;
  rateLimitCount?: number;
  rateLimitWindowStart?: string | null;
  paidGenerationEntitlement?: 'none' | 'paid' | 'internal';
}) {
  return {
    prepare: mock.fn((sql: string) => ({
      bind: mock.fn(() => ({
        first: mock.fn(async () => {
          if (sql.includes('FROM users')) {
            return {
              paid_generation_entitlement: options.paidGenerationEntitlement ?? 'paid',
              quota_limits: options.quotaLimitsJson ?? JSON.stringify({ elevenlabs_audio: options.quotaLimit }),
              rate_limit_count: options.rateLimitCount ?? 0,
              rate_limit_window_start: options.rateLimitWindowStart ?? new Date().toISOString(),
            };
          }
          return { total_used: options.quotaUsed ?? 0 };
        }),
      })),
    })),
  };
}

describe('SpaceDO usage preCheck', () => {
  test('blocks users without explicit paid-generation entitlement', async () => {
    const result = await preCheck(
      createPreCheckDb({
        quotaLimit: 100,
        paidGenerationEntitlement: 'none',
      }) as any,
      42,
      'elevenlabs'
    );

    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.denyReason, 'paid_generation_required');
  });

  test('blocks users without entitlement before parsing cached quota limits', async () => {
    const result = await preCheck(
      createPreCheckDb({
        quotaLimit: 100,
        quotaLimitsJson: '{not-json',
        paidGenerationEntitlement: 'none',
      }) as any,
      42,
      'elevenlabs'
    );

    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.denyReason, 'paid_generation_required');
  });

  test('allows internal users without consuming quota', async () => {
    const result = await preCheck(
      createPreCheckDb({
        quotaLimit: 0,
        paidGenerationEntitlement: 'internal',
      }) as any,
      42,
      'elevenlabs'
    );

    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.quotaLimit, null);
    assert.strictEqual(result.quotaRemaining, null);
  });

  test('defaults rate limiting to one request when quota quantity is higher', async () => {
    const result = await preCheck(
      createPreCheckDb({ quotaLimit: 100, rateLimitCount: 9 }) as any,
      42,
      'elevenlabs',
      undefined,
      11
    );

    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.quotaRemaining, 100);
    assert.strictEqual(result.rateLimitUsed, 9);
    assert.strictEqual(result.rateLimitRemaining, 0);
  });

  test('uses explicit rate-limit quantity for batch admission', async () => {
    const result = await preCheck(
      createPreCheckDb({ quotaLimit: 1000, rateLimitCount: 9 }) as any,
      42,
      'elevenlabs',
      undefined,
      156,
      2
    );

    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.denyReason, 'rate_limited');
  });
});
