// @ts-nocheck - D1 mock shape is intentionally minimal
import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { preCheck, trackImageGeneration, trackVideoGeneration } from './usageCheck';

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

  test('treats admin users as internal even when the stored entitlement is none', async () => {
    const result = await preCheck(
      createPreCheckDb({
        quotaLimit: 0,
        paidGenerationEntitlement: 'none',
      }) as any,
      42,
      'elevenlabs',
      undefined,
      1,
      1,
      '7, 42, 99' // ADMIN_USER_IDS includes 42
    );

    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.quotaLimit, null);
    assert.strictEqual(result.quotaRemaining, null);
  });

  test('does not grant access to non-admins via ADMIN_USER_IDS', async () => {
    const result = await preCheck(
      createPreCheckDb({
        quotaLimit: 0,
        paidGenerationEntitlement: 'none',
      }) as any,
      42,
      'elevenlabs',
      undefined,
      1,
      1,
      '7, 99' // 42 is not listed
    );

    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.denyReason, 'paid_generation_required');
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

  test('records internal usage locally as non-billable', async () => {
    const inserts: unknown[][] = [];
    const db = {
      prepare: mock.fn((sql: string) => ({
        bind: mock.fn((...args: unknown[]) => ({
          first: mock.fn(async () => ({ paid_generation_entitlement: 'internal' })),
          run: mock.fn(async () => {
            if (sql.includes('INSERT INTO usage_events')) {
              inserts.push(args);
            }
            return { success: true };
          }),
        })),
      })),
    };

    await trackImageGeneration(db as any, 42, 1, 'gemini-3-pro-image-preview', 'generate');

    assert.strictEqual(inserts.length, 1);
    assert.strictEqual(inserts[0][1], 42);
    assert.strictEqual(inserts[0][2], 'gemini_images');
    assert.strictEqual(inserts[0][5], 0);
  });

  test('records Veo billing dimensions in video usage metadata', async () => {
    const inserts: unknown[][] = [];
    const db = {
      prepare: mock.fn((sql: string) => ({
        bind: mock.fn((...args: unknown[]) => ({
          first: mock.fn(async () => ({ paid_generation_entitlement: 'paid' })),
          run: mock.fn(async () => {
            if (sql.includes('INSERT INTO usage_events')) {
              inserts.push(args);
            }
            return { success: true };
          }),
        })),
      })),
    };

    await trackVideoGeneration(db as any, 42, 1, 'veo-3.1-generate-preview', 'generate', '1080p', 8);

    assert.strictEqual(inserts.length, 1);
    assert.strictEqual(inserts[0][2], 'gemini_videos');
    assert.deepStrictEqual(JSON.parse(String(inserts[0][4])), {
      model: 'veo-3.1-generate-preview',
      operation: 'generate',
      resolution: '1080p',
      duration_seconds: 8,
    });
  });
});
