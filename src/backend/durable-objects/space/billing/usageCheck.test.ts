// @ts-nocheck - D1 mock shape is intentionally minimal
import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkGenerationGuardrails,
  preCheck,
  trackGeminiAudioGeneration,
  trackImageGeneration,
  trackVideoGeneration,
} from './usageCheck';

function createPreCheckDb(options: {
  quotaLimit: number;
  quotaLimitsJson?: string;
  quotaUsed?: number;
  rateLimitCount?: number;
  rateLimitWindowStart?: string | null;
  paidGenerationEntitlement?: 'none' | 'paid' | 'internal';
  polarPaidAccessExpiresAt?: string | null;
}) {
  return {
    prepare: mock.fn((sql: string) => ({
      bind: mock.fn(() => ({
        first: mock.fn(async () => {
          if (sql.includes('FROM users')) {
            return {
              paid_generation_entitlement: options.paidGenerationEntitlement ?? 'paid',
              quota_limits: options.quotaLimitsJson ?? JSON.stringify({ elevenlabs_audio: options.quotaLimit }),
              polar_current_period_start: null,
              polar_current_period_end: null,
              polar_paid_access_expires_at: options.polarPaidAccessExpiresAt ?? null,
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

  test('blocks paid users after scheduled cancellation grace expires', async () => {
    const result = await preCheck(
      createPreCheckDb({
        quotaLimit: 100,
        paidGenerationEntitlement: 'paid',
        polarPaidAccessExpiresAt: '2000-01-01T00:00:00.000Z',
      }) as any,
      42,
      'elevenlabs'
    );

    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.denyReason, 'paid_generation_required');
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

  test('checks usage against the cached Polar billing period', async () => {
    const calls: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare: mock.fn((sql: string) => ({
        bind: mock.fn((...args: unknown[]) => {
          calls.push({ sql, args });
          return {
            first: mock.fn(async () => {
              if (sql.includes('FROM users')) {
                return {
                  paid_generation_entitlement: 'paid',
                  quota_limits: JSON.stringify({ gemini_images: 3 }),
                  polar_current_period_start: '2026-06-10T00:00:00.000Z',
                  polar_current_period_end: '2026-07-10T00:00:00.000Z',
                  polar_paid_access_expires_at: null,
                  rate_limit_count: 0,
                  rate_limit_window_start: new Date().toISOString(),
                };
              }
              return { total_used: 2 };
            }),
          };
        }),
      })),
    };

    const result = await preCheck(db as any, 42, 'nanobanana');
    const usageCall = calls.find((call) => call.sql.includes('FROM usage_events'));

    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.quotaUsed, 2);
    assert.strictEqual(result.quotaRemaining, 1);
    assert.ok(usageCall);
    assert.match(usageCall.sql, /created_at < \?/);
    assert.deepStrictEqual(usageCall.args, [
      42,
      'gemini_images',
      '2026-06-10T00:00:00.000Z',
      '2026-07-10T00:00:00.000Z',
    ]);
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

  test('records customer charge ledger rows with usage events', async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const db = {
      prepare: mock.fn((sql: string) => ({
        bind: mock.fn((...bindings: unknown[]) => {
          statements.push({ sql, bindings });
          return {
            first: mock.fn(async () => ({ paid_generation_entitlement: 'paid' })),
            run: mock.fn(async () => ({ success: true })),
          };
        }),
      })),
    };

    await trackVideoGeneration(db as any, 42, 1, 'veo-3.1-generate-preview', 'generate', '720p', 8);

    const usageInsert = statements.find((statement) => statement.sql.includes('INSERT INTO usage_events'))!;
    const chargeInsert = statements.find((statement) => statement.sql.includes('INSERT OR IGNORE INTO customer_charge_ledger'))!;

    assert.ok(usageInsert);
    assert.ok(chargeInsert);
    assert.strictEqual(chargeInsert.bindings[1], `usage_event:${usageInsert.bindings[0]}`);
    assert.strictEqual(chargeInsert.bindings[2], usageInsert.bindings[0]);
    assert.strictEqual(chargeInsert.bindings[3], 42);
    assert.strictEqual(chargeInsert.bindings[4], 'gemini_videos');
    assert.strictEqual(chargeInsert.bindings[5], 'video_unit');
    assert.strictEqual(chargeInsert.bindings[6], 2);
    assert.strictEqual(chargeInsert.bindings[7], 1);
    assert.strictEqual(chargeInsert.bindings[8], usageInsert.bindings[0]);
  });

  test('records ADMIN_USER_IDS usage locally as non-billable even when stored entitlement is none', async () => {
    const inserts: unknown[][] = [];
    const db = {
      prepare: mock.fn((sql: string) => ({
        bind: mock.fn((...args: unknown[]) => ({
          first: mock.fn(async () => ({ paid_generation_entitlement: 'none' })),
          run: mock.fn(async () => {
            if (sql.includes('INSERT INTO usage_events')) {
              inserts.push(args);
            }
            return { success: true };
          }),
        })),
      })),
    };

    await trackImageGeneration(db as any, 42, 1, 'gemini-3-pro-image-preview', 'generate', undefined, '42,99');

    assert.strictEqual(inserts.length, 1);
    assert.strictEqual(inserts[0][1], 42);
    assert.strictEqual(inserts[0][2], 'gemini_images');
    assert.strictEqual(inserts[0][5], 0);
  });

  test('links customer charge ledger rows to provider usage attribution', async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const db = {
      prepare: mock.fn((sql: string) => ({
        bind: mock.fn((...bindings: unknown[]) => {
          statements.push({ sql, bindings });
          return {
            first: mock.fn(async () => ({ paid_generation_entitlement: 'paid' })),
            run: mock.fn(async () => ({ success: true })),
          };
        }),
      })),
    };

    await trackImageGeneration(
      db as any,
      42,
      1,
      'gemini-3-pro-image-preview',
      'generate',
      '4K',
      undefined,
      {
        spaceId: 'space-1',
        variantId: 'variant-1',
        workflowId: 'workflow-1',
        requestId: 'request-1',
        mediaKind: 'image',
      }
    );

    const usageInsert = statements.find((statement) => statement.sql.includes('INSERT INTO usage_events'))!;
    const providerInsert = statements.find((statement) => statement.sql.includes('INSERT OR IGNORE INTO provider_usage_ledger'))!;
    const chargeUpdate = statements.find((statement) => statement.sql.includes('UPDATE customer_charge_ledger'))!;

    assert.ok(usageInsert);
    assert.ok(providerInsert);
    assert.ok(chargeUpdate);
    assert.strictEqual(providerInsert.bindings[1], 'workflow:workflow-1:meter:gemini_images');
    assert.strictEqual(providerInsert.bindings[2], usageInsert.bindings[0]);
    assert.deepStrictEqual(chargeUpdate.bindings, [
      'workflow:workflow-1:meter:gemini_images',
      usageInsert.bindings[0],
    ]);
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
    assert.strictEqual(inserts[0][3], 2);
    assert.deepStrictEqual(JSON.parse(String(inserts[0][4])), {
      model: 'veo-3.1-generate-preview',
      operation: 'generate',
      resolution: '1080p',
      duration_seconds: 8,
      generate_audio: true,
      video_count: 1,
    });
  });

  test('records native-audio Veo usage as weighted video units', async () => {
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

    await trackVideoGeneration(db as any, 42, 1, 'veo-3.1-generate-preview', 'generate', '720p', 8, true);

    assert.strictEqual(inserts.length, 1);
    assert.strictEqual(inserts[0][2], 'gemini_videos');
    assert.strictEqual(inserts[0][3], 2);
    assert.deepStrictEqual(JSON.parse(String(inserts[0][4])), {
      model: 'veo-3.1-generate-preview',
      operation: 'generate',
      resolution: '720p',
      duration_seconds: 8,
      generate_audio: true,
      video_count: 1,
    });
  });

  test('records Lyria audio usage as Gemini audio', async () => {
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

    await trackGeminiAudioGeneration(
      db as any,
      42,
      1,
      'lyria-3-clip-preview',
      'generate',
      'music',
      30_000,
      { inputTokens: 12, outputTokens: 0, totalTokens: 12 }
    );

    assert.strictEqual(inserts.length, 1);
    assert.strictEqual(inserts[0][2], 'gemini_audio');
    assert.strictEqual(inserts[0][3], 1);
    assert.deepStrictEqual(JSON.parse(String(inserts[0][4])), {
      provider: 'lyria',
      model: 'lyria-3-clip-preview',
      operation: 'generate',
      asset_type: 'music',
      duration_ms: 30000,
      input_tokens: 12,
      output_tokens: 0,
      total_tokens: 12,
    });
  });
});

describe('SpaceDO generation guardrails', () => {
  test('blocks managed generation when provider cost cap would be exceeded', async () => {
    const db = {
      prepare: mock.fn((sql: string) => ({
        bind: mock.fn(() => ({
          first: mock.fn(async () => {
            if (sql.includes('FROM users')) {
              return {
                paid_generation_entitlement: 'paid',
                quota_limits: JSON.stringify({ managed_provider_spend_micro_usd: 1_000_000 }),
                polar_current_period_start: '2026-06-01T00:00:00.000Z',
                polar_current_period_end: '2026-07-01T00:00:00.000Z',
                rate_limit_count: 0,
                rate_limit_window_start: null,
              };
            }
            return { total: 900_000 };
          }),
        })),
      })),
    };

    const result = await checkGenerationGuardrails(db as any, {
      userId: 42,
      spaceId: 'space-1',
      mode: 'managed',
      service: 'veo',
      requestedProviderCostMicroUsd: 200_000,
      mediaKind: 'video',
    });

    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.denyReason, 'quota_exceeded');
    assert.strictEqual(result.limitKey, 'managed_provider_spend_micro_usd');
  });

  test('blocks BYOK generation when platform workflow fair-use limit is exhausted', async () => {
    const db = {
      prepare: mock.fn((sql: string) => ({
        bind: mock.fn(() => ({
          first: mock.fn(async () => {
            if (sql.includes('FROM users')) {
              return {
                paid_generation_entitlement: 'none',
                quota_limits: JSON.stringify({ platform_workflow_runs: 1 }),
                polar_current_period_start: null,
                polar_current_period_end: null,
                rate_limit_count: 0,
                rate_limit_window_start: null,
              };
            }
            return { total: 1 };
          }),
        })),
      })),
    };

    const result = await checkGenerationGuardrails(db as any, {
      userId: 42,
      spaceId: 'space-1',
      mode: 'byok',
      service: 'nanobanana',
      requestedPlatformUsage: [{ usageType: 'workflow', quantity: 1 }],
      mediaKind: 'image',
    });

    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.denyReason, 'platform_limit_exceeded');
    assert.strictEqual(result.limitKey, 'platform_workflow_runs');
  });

  test('enforces explicit internal budgets while otherwise treating internal users as exempt', async () => {
    const db = {
      prepare: mock.fn((sql: string) => ({
        bind: mock.fn(() => ({
          first: mock.fn(async () => {
            if (sql.includes('FROM users')) {
              return {
                paid_generation_entitlement: 'internal',
                quota_limits: JSON.stringify({
                  platform_workflow_runs: 1,
                  internal_platform_workflow_runs: 2,
                }),
                polar_current_period_start: null,
                polar_current_period_end: null,
                rate_limit_count: 0,
                rate_limit_window_start: null,
              };
            }
            return { total: 2 };
          }),
        })),
      })),
    };

    const result = await checkGenerationGuardrails(db as any, {
      userId: 42,
      spaceId: 'space-1',
      mode: 'managed',
      service: 'nanobanana',
      requestedPlatformUsage: [{ usageType: 'workflow', quantity: 1 }],
      mediaKind: 'image',
    });

    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.denyReason, 'platform_limit_exceeded');
    assert.strictEqual(result.limitKey, 'internal_platform_workflow_runs');
  });

  test('blocks uploads when a per-space storage budget would be exceeded', async () => {
    const db = {
      prepare: mock.fn((sql: string) => ({
        bind: mock.fn(() => ({
          first: mock.fn(async () => {
            if (sql.includes('FROM users')) {
              return {
                paid_generation_entitlement: 'paid',
                quota_limits: JSON.stringify({ space_platform_storage_bytes: 100 }),
                polar_current_period_start: null,
                polar_current_period_end: null,
                rate_limit_count: 0,
                rate_limit_window_start: null,
              };
            }
            return { total: 90 };
          }),
        })),
      })),
    };

    const result = await checkGenerationGuardrails(db as any, {
      userId: 42,
      spaceId: 'space-1',
      mode: 'byok',
      service: 'nanobanana',
      requestedPlatformUsage: [{ usageType: 'storage', quantity: 20 }],
      mediaKind: 'image',
    });

    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.denyReason, 'platform_limit_exceeded');
    assert.strictEqual(result.limitKey, 'space_platform_storage_bytes');
  });

  test('blocks downloads when account delivery budget would be exceeded', async () => {
    const db = {
      prepare: mock.fn((sql: string) => ({
        bind: mock.fn(() => ({
          first: mock.fn(async () => {
            if (sql.includes('FROM users')) {
              return {
                paid_generation_entitlement: 'paid',
                quota_limits: JSON.stringify({ platform_delivery_bytes: 100 }),
                polar_current_period_start: null,
                polar_current_period_end: null,
                rate_limit_count: 0,
                rate_limit_window_start: null,
              };
            }
            return { total: 99 };
          }),
        })),
      })),
    };

    const result = await checkGenerationGuardrails(db as any, {
      userId: 42,
      spaceId: 'space-1',
      mode: 'byok',
      service: 'veo',
      requestedPlatformUsage: [{ usageType: 'delivery', quantity: 2 }],
      mediaKind: 'video',
    });

    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.denyReason, 'platform_limit_exceeded');
    assert.strictEqual(result.limitKey, 'platform_delivery_bytes');
  });

  test('blocks video-heavy usage with a daily video workflow cap', async () => {
    const db = {
      prepare: mock.fn((sql: string) => ({
        bind: mock.fn(() => ({
          first: mock.fn(async () => {
            if (sql.includes('FROM users')) {
              return {
                paid_generation_entitlement: 'paid',
                quota_limits: JSON.stringify({ video_workflow_runs_daily: 1 }),
                polar_current_period_start: null,
                polar_current_period_end: null,
                rate_limit_count: 0,
                rate_limit_window_start: null,
              };
            }
            return { total: sql.includes('media_kind = ?') ? 1 : 0 };
          }),
        })),
      })),
    };

    const result = await checkGenerationGuardrails(db as any, {
      userId: 42,
      spaceId: 'space-1',
      mode: 'managed',
      service: 'veo',
      requestedPlatformUsage: [{ usageType: 'workflow', quantity: 1 }],
      mediaKind: 'video',
      now: new Date('2026-06-20T12:00:00.000Z'),
    });

    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.denyReason, 'platform_limit_exceeded');
    assert.strictEqual(result.limitKey, 'video_workflow_runs_daily');
  });
});
