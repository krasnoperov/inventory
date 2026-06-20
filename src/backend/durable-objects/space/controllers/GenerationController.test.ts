// @ts-nocheck - Test file with dynamic mocks
import { describe, test, mock, type Mock } from 'node:test';
import assert from 'node:assert/strict';
import { GenerationController } from './GenerationController';
import type { ControllerContext, BroadcastFn } from './types';
import type { SpaceRepository, SqlStorage } from '../repository/SpaceRepository';
import type { Env } from '../../../../core/types';
import type {
  Variant,
  RotationView,
  TilePosition,
  ServerMessage,
} from '../types';

// Helper to extract mock from function
type MockFn<T extends (...args: unknown[]) => unknown> = Mock<T>;
const asMock = <T extends (...args: unknown[]) => unknown>(fn: T): MockFn<T> =>
  fn as MockFn<T>;

// ============================================================================
// Mock Factories
// ============================================================================

function createMockVariant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 'variant-1',
    asset_id: 'asset-1',
    media_kind: 'image',
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: 'images/test.png',
    thumb_key: 'thumbs/test.png',
    media_key: 'images/test.png',
    media_mime_type: 'image/png',
    media_size_bytes: 1234,
    media_width: 512,
    media_height: 512,
    media_duration_ms: null,
    generation_provenance: '{}',
    provider_metadata: null,
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    plan_step_id: null,
    ...overrides,
  };
}

function createMockD1() {
  const statements: Array<{ sql: string; bindings: unknown[] }> = [];
  return {
    db: {
      prepare: mock.fn((sql: string) => ({
        bind: mock.fn((...bindings: unknown[]) => ({
          first: mock.fn(async () => ({ paid_generation_entitlement: 'paid' })),
          run: mock.fn(async () => {
            statements.push({ sql, bindings });
            return { success: true };
          }),
        })),
      })),
    },
    statements,
  };
}

function usageEventStatements(statements: Array<{ sql: string; bindings: unknown[] }>) {
  return statements.filter((statement) => /INSERT INTO usage_events\b/.test(statement.sql));
}

function platformUsageStatements(statements: Array<{ sql: string; bindings: unknown[] }>) {
  return statements.filter((statement) => /INSERT INTO platform_usage_events\b/.test(statement.sql));
}

function createQuotaCheckDb(options: {
  quotaLimit: number;
  quotaLimitsJson?: string;
  quotaUsed?: number;
  rateLimitCount?: number;
  paidGenerationEntitlement?: 'none' | 'paid' | 'internal';
  hasProviderKey?: boolean;
  platformUsed?: number;
  providerSpendMicroUsd?: number;
  bindings?: unknown[][];
}) {
  return {
    prepare: mock.fn((sql: string) => ({
      bind: mock.fn((...bindings: unknown[]) => {
        options.bindings?.push(bindings);
        return {
          first: mock.fn(async () => {
            if (sql.includes('SELECT 1 AS present')) {
              return options.hasProviderKey ? { present: 1 } : null;
            }
            if (sql.includes('FROM platform_usage_events')) {
              return { total: options.platformUsed ?? 0 };
            }
            if (sql.includes('FROM provider_usage_ledger')) {
              return { total: options.providerSpendMicroUsd ?? 0 };
            }
            if (sql.includes('FROM users')) {
              return {
                paid_generation_entitlement: options.paidGenerationEntitlement ?? 'paid',
                quota_limits: options.quotaLimitsJson ?? JSON.stringify({ elevenlabs_audio: options.quotaLimit }),
                polar_current_period_start: null,
                polar_current_period_end: null,
                polar_paid_access_expires_at: null,
                rate_limit_count: options.rateLimitCount ?? 0,
                rate_limit_window_start: null,
              };
            }
            return { total_used: options.quotaUsed ?? 0 };
          }),
          run: mock.fn(async () => ({ success: true })),
        };
      }),
    })),
  };
}

const EXHAUSTED_IMAGE_QUOTA_LIMITS = JSON.stringify({
  gemini_images: 0,
  elevenlabs_audio: 0,
});

function createMockRepo(): SpaceRepository {
  return {
    getVariantById: mock.fn(async () => createMockVariant()),
    getAssetById: mock.fn(async () => ({
      id: 'asset-1',
      name: 'Asset',
      type: 'music',
      media_kind: 'audio',
      active_variant_id: 'variant-1',
    })),
    completeVariant: mock.fn(async (id, imageKey, thumbKey, mediaMetadata = {}) =>
      createMockVariant({
        id,
        image_key: imageKey,
        thumb_key: thumbKey,
        media_key: mediaMetadata.mediaKey ?? imageKey,
        media_mime_type: mediaMetadata.mimeType ?? null,
        media_size_bytes: mediaMetadata.sizeBytes ?? null,
        media_width: mediaMetadata.width ?? null,
        media_height: mediaMetadata.height ?? null,
        media_duration_ms: mediaMetadata.durationMs ?? null,
        status: 'completed',
      })
    ),
    failVariant: mock.fn(async (id, error) =>
      createMockVariant({ id, status: 'failed', error_message: error })
    ),
    resetVariantForRetry: mock.fn(async (id) => createMockVariant({ id, status: 'pending' })),
    updateVariantWorkflow: mock.fn(async (id, workflowId, status) =>
      createMockVariant({ id, workflow_id: workflowId, status })
    ),
    createPlaceholderVariant: mock.fn(async (input) =>
      createMockVariant({ id: input.id, asset_id: input.assetId, media_kind: input.mediaKind ?? 'image', recipe: input.recipe })
    ),
    createAsset: mock.fn(async (input) => ({
      id: input.id,
      name: input.name,
      type: input.type,
      media_kind: input.mediaKind ?? 'image',
      active_variant_id: null,
      parent_asset_id: input.parentAssetId ?? null,
    })),
    updateAsset: mock.fn(async () => null),
    createLineage: mock.fn(async (input) => ({ id: input.id })),
    getRotationViewByVariant: mock.fn(async () => null),
    getTilePositionByVariant: mock.fn(async () => null),
    failRotationSet: mock.fn(async () => null),
    failTileSet: mock.fn(async () => null),
    getBatchProgress: mock.fn(async () => ({ completedCount: 0, failedCount: 0, totalCount: 1, pendingCount: 1 })),
    getActiveStyle: mock.fn(async () => null),
  } as unknown as SpaceRepository;
}

function createMockSql(): SqlStorage {
  return {
    exec: mock.fn(() => ({ toArray: () => [] })),
  } as unknown as SqlStorage;
}

function createMockContext(
  repoOverrides?: Partial<SpaceRepository>
): {
  ctx: ControllerContext;
  broadcasts: ServerMessage[];
} {
  const broadcasts: ServerMessage[] = [];
  const repo = { ...createMockRepo(), ...repoOverrides };
  const sql = createMockSql();

  const ctx: ControllerContext = {
    spaceId: 'space-1',
    repo: repo as SpaceRepository,
    env: {} as Env,
    sql: sql as SqlStorage,
    broadcast: mock.fn((msg: ServerMessage) => broadcasts.push(msg)) as BroadcastFn,
    send: mock.fn(),
    sendError: mock.fn(),
  };

  return { ctx, broadcasts };
}

// ============================================================================
// Tests — Pipeline Hooks Only
// ============================================================================

describe('GenerationController pipeline hooks', () => {
  describe('handleGenerateRequest', () => {
    test('returns preflight usage and selected video tier cost without creating a job', async () => {
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      const { ctx } = createMockContext(repo);
      ctx.env.DB = createQuotaCheckDb({
        quotaLimit: 10,
        quotaLimitsJson: JSON.stringify({ gemini_videos: 10 }),
      }) as any;
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleGenerationEstimateRequest(
        {} as WebSocket,
        { userId: '42', role: 'editor' } as any,
        {
          type: 'generation:estimate',
          requestId: 'estimate-video-fast',
          operation: 'generate',
          name: 'Video shot',
          assetType: 'animation',
          mediaKind: 'video',
          prompt: 'A fast camera move',
          videoTier: 'fast',
          videoResolution: '720p',
          videoDurationSeconds: 8,
          generateAudio: true,
        } as any
      );

      assert.strictEqual(asMock(ctx.send).mock.calls.length, 1);
      const response = asMock(ctx.send).mock.calls[0].arguments[1] as any;
      assert.strictEqual(response.type, 'generation:estimate');
      assert.strictEqual(response.requestId, 'estimate-video-fast');
      assert.strictEqual(response.success, true);
      assert.strictEqual(response.estimate.quotaQuantity, 2);
      assert.strictEqual(response.estimate.rateLimitQuantity, 1);
      assert.strictEqual(response.estimate.providerCostMicroUsd, 800000);
      assert.strictEqual(response.estimate.providerPricing.model, 'veo-3.1-fast-generate-preview');
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls.length, 0);
      assert.strictEqual(workflowCreate.mock.calls.length, 0);
    });

    test('uses paid generation error code when user has no paid-generation entitlement', async () => {
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      const { ctx } = createMockContext(repo);
      ctx.env.DB = createQuotaCheckDb({
        quotaLimit: 100,
        paidGenerationEntitlement: 'none',
      }) as any;
      ctx.env.INVENTORY_AUDIO_PROVIDER = 'elevenlabs';
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleGenerateRequest(
        {} as WebSocket,
        { userId: '42', role: 'editor' } as any,
        {
          type: 'generate:request',
          requestId: 'request-paid-required',
          name: 'Music cue',
          assetType: 'music',
          mediaKind: 'audio',
          prompt: 'short heroic orchestral loop',
        } as any
      );

      assert.strictEqual(asMock(ctx.send).mock.calls.length, 1);
      assert.deepStrictEqual(asMock(ctx.send).mock.calls[0].arguments[1], {
        type: 'generate:error',
        requestId: 'request-paid-required',
        error: 'Paid generation is not enabled for this account. Please upgrade your plan.',
        code: 'PAID_GENERATION_REQUIRED',
      });
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls.length, 0);
      assert.strictEqual(workflowCreate.mock.calls.length, 0);
    });

    test('allows BYOK provider keys without paid-generation entitlement', async () => {
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      const { ctx } = createMockContext(repo);
      ctx.env.DB = createQuotaCheckDb({
        quotaLimit: 0,
        paidGenerationEntitlement: 'none',
        hasProviderKey: true,
      }) as any;
      ctx.env.INVENTORY_AUDIO_PROVIDER = 'elevenlabs';
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleGenerateRequest(
        {} as WebSocket,
        { userId: '42', role: 'editor' } as any,
        {
          type: 'generate:request',
          requestId: 'request-byok',
          name: 'Music cue',
          assetType: 'music',
          mediaKind: 'audio',
          prompt: 'short heroic orchestral loop',
        } as any
      );

      assert.strictEqual(asMock(ctx.send).mock.calls.length, 0);
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls.length, 1);
      assert.strictEqual(workflowCreate.mock.calls.length, 1);
    });

    test('blocks BYOK generation when platform workflow fair-use limit is exhausted', async () => {
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      const { ctx } = createMockContext(repo);
      ctx.env.DB = createQuotaCheckDb({
        quotaLimit: 0,
        quotaLimitsJson: JSON.stringify({ platform_workflow_runs: 1 }),
        paidGenerationEntitlement: 'none',
        hasProviderKey: true,
        platformUsed: 1,
      }) as any;
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleGenerateRequest(
        {} as WebSocket,
        { userId: '42', role: 'editor' } as any,
        {
          type: 'generate:request',
          requestId: 'request-byok-platform-limit',
          name: 'BYOK image',
          assetType: 'item',
          mediaKind: 'image',
          prompt: 'pixel art potion',
        } as any
      );

      assert.strictEqual(asMock(ctx.send).mock.calls.length, 1);
      assert.deepStrictEqual(asMock(ctx.send).mock.calls[0].arguments[1], {
        type: 'generate:error',
        requestId: 'request-byok-platform-limit',
        error: 'Platform workflow limit exceeded.',
        code: 'PLATFORM_LIMIT_EXCEEDED',
      });
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls.length, 0);
      assert.strictEqual(workflowCreate.mock.calls.length, 0);
    });

    test('does not use Google BYOK to bypass custom image provider billing', async () => {
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      const { ctx } = createMockContext(repo);
      ctx.env.DB = createQuotaCheckDb({
        quotaLimit: 0,
        quotaLimitsJson: JSON.stringify({ gemini_images: 0 }),
        paidGenerationEntitlement: 'none',
        hasProviderKey: true,
      }) as any;
      ctx.env.CUSTOM_MODEL_ENDPOINT = 'https://custom.example.test/generate';
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleGenerateRequest(
        {} as WebSocket,
        { userId: '42', role: 'editor' } as any,
        {
          type: 'generate:request',
          requestId: 'request-custom-byok',
          name: 'Custom image',
          assetType: 'item',
          mediaKind: 'image',
          prompt: 'custom model image',
          modelProvider: 'custom',
        } as any
      );

      assert.strictEqual(asMock(ctx.send).mock.calls.length, 1);
      assert.deepStrictEqual(asMock(ctx.send).mock.calls[0].arguments[1], {
        type: 'generate:error',
        requestId: 'request-custom-byok',
        error: 'Paid generation is not enabled for this account. Please upgrade your plan.',
        code: 'PAID_GENERATION_REQUIRED',
      });
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls.length, 0);
      assert.strictEqual(workflowCreate.mock.calls.length, 0);
    });

    test('blocks ElevenLabs music generation when remaining quota can cover prompt but not provider cost', async () => {
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      const { ctx } = createMockContext(repo);
      ctx.env.DB = createQuotaCheckDb({ quotaLimit: 40 }) as any;
      ctx.env.INVENTORY_AUDIO_PROVIDER = 'elevenlabs';
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleGenerateRequest(
        {} as WebSocket,
        { userId: '42', role: 'editor' } as any,
        {
          type: 'generate:request',
          requestId: 'request-1',
          name: 'Music cue',
          assetType: 'music',
          mediaKind: 'audio',
          prompt: 'short heroic orchestral loop',
        } as any
      );

      assert.strictEqual(asMock(ctx.send).mock.calls.length, 1);
      assert.deepStrictEqual(asMock(ctx.send).mock.calls[0].arguments[1], {
        type: 'generate:error',
        requestId: 'request-1',
        error: 'Monthly quota exceeded for elevenlabs. Please upgrade your plan.',
        code: 'QUOTA_EXCEEDED',
      });
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls.length, 0);
      assert.strictEqual(workflowCreate.mock.calls.length, 0);
    });

    test('blocks native-audio video generation when weighted video quota is exhausted', async () => {
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      const { ctx } = createMockContext(repo);
      ctx.env.DB = createQuotaCheckDb({
        quotaLimit: 1,
        quotaLimitsJson: JSON.stringify({ gemini_videos: 1 }),
      }) as any;
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleGenerateRequest(
        {} as WebSocket,
        { userId: '42', role: 'editor' } as any,
        {
          type: 'generate:request',
          requestId: 'request-video-audio-quota',
          name: 'Audio shot',
          assetType: 'animation',
          mediaKind: 'video',
          prompt: 'A shot with synchronized footsteps',
          generateAudio: true,
        } as any
      );

      assert.strictEqual(asMock(ctx.send).mock.calls.length, 1);
      assert.deepStrictEqual(asMock(ctx.send).mock.calls[0].arguments[1], {
        type: 'generate:error',
        requestId: 'request-video-audio-quota',
        error: 'Monthly quota exceeded for veo. Please upgrade your plan.',
        code: 'QUOTA_EXCEEDED',
      });
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls.length, 0);
      assert.strictEqual(workflowCreate.mock.calls.length, 0);
    });

    test('does not apply ElevenLabs generated-audio quota estimate to Lyria music generation', async () => {
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      const { ctx } = createMockContext(repo);
      ctx.env.DB = createQuotaCheckDb({ quotaLimit: 40 }) as any;
      ctx.env.INVENTORY_AUDIO_PROVIDER = 'elevenlabs';
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleGenerateRequest(
        {} as WebSocket,
        { userId: '42', role: 'editor' } as any,
        {
          type: 'generate:request',
          requestId: 'request-lyria-quota',
          name: 'Music cue',
          assetType: 'music',
          mediaKind: 'audio',
          prompt: 'short heroic orchestral loop',
          musicProvider: 'lyria',
        } as any
      );

      assert.strictEqual(asMock(ctx.send).mock.calls.length, 0);
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls.length, 1);
      assert.strictEqual(workflowCreate.mock.calls.length, 1);
    });

    test('prechecks Lyria music generation against Gemini audio, not exhausted image quota', async () => {
      const bindings: unknown[][] = [];
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      const { ctx } = createMockContext(repo);
      ctx.env.DB = createQuotaCheckDb({
        quotaLimit: 0,
        quotaLimitsJson: EXHAUSTED_IMAGE_QUOTA_LIMITS,
        bindings,
      }) as any;
      ctx.env.INVENTORY_AUDIO_PROVIDER = 'elevenlabs';
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleGenerateRequest(
        {} as WebSocket,
        { userId: '42', role: 'editor' } as any,
        {
          type: 'generate:request',
          requestId: 'request-lyria-image-quota',
          name: 'Music cue',
          assetType: 'music',
          mediaKind: 'audio',
          prompt: 'short heroic orchestral loop',
          musicProvider: 'lyria',
        } as any
      );

      assert.strictEqual(asMock(ctx.send).mock.calls.length, 0);
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls.length, 1);
      assert.strictEqual(workflowCreate.mock.calls.length, 1);
      assert.ok(bindings.some((args) => args[1] === 'gemini_audio'));
      assert.ok(!bindings.some((args) => args[1] === 'gemini_images'));
    });

    test('blocks ElevenLabs sound effect generation when remaining quota can cover prompt but not provider cost', async () => {
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      const { ctx } = createMockContext(repo);
      ctx.env.DB = createQuotaCheckDb({ quotaLimit: 40 }) as any;
      ctx.env.INVENTORY_AUDIO_PROVIDER = 'elevenlabs';
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleGenerateRequest(
        {} as WebSocket,
        { userId: '42', role: 'editor' } as any,
        {
          type: 'generate:request',
          requestId: 'request-2',
          name: 'Footstep',
          assetType: 'sfx',
          mediaKind: 'audio',
          prompt: 'heavy boot step on wet stone',
        } as any
      );

      assert.strictEqual(asMock(ctx.send).mock.calls.length, 1);
      assert.deepStrictEqual(asMock(ctx.send).mock.calls[0].arguments[1], {
        type: 'generate:error',
        requestId: 'request-2',
        error: 'Monthly quota exceeded for elevenlabs. Please upgrade your plan.',
        code: 'QUOTA_EXCEEDED',
      });
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls.length, 0);
      assert.strictEqual(workflowCreate.mock.calls.length, 0);
    });

    test('persists UI-selected speech voice into the recipe and workflow input', async () => {
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      const { ctx } = createMockContext(repo);
      // No DB → quota check skipped, exercising the full create path.
      ctx.env.INVENTORY_AUDIO_PROVIDER = 'elevenlabs';
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleGenerateRequest(
        {} as WebSocket,
        { userId: '42', role: 'editor' } as any,
        {
          type: 'generate:request',
          requestId: 'request-voice',
          name: 'Narration',
          assetType: 'speech',
          mediaKind: 'audio',
          prompt: 'Hello there, traveler.',
          voiceId: 'voice-abc',
        } as any
      );

      const placeholderCalls = asMock(repo.createPlaceholderVariant).mock.calls;
      assert.strictEqual(placeholderCalls.length, 1);
      const recipe = JSON.parse(placeholderCalls[0].arguments[0].recipe);
      assert.strictEqual(recipe.voiceId, 'voice-abc');

      assert.strictEqual(workflowCreate.mock.calls.length, 1);
      assert.strictEqual(workflowCreate.mock.calls[0].arguments[0].params.voiceId, 'voice-abc');
    });

    test('persists UI-selected dialogue voices into the recipe and workflow input', async () => {
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      const { ctx } = createMockContext(repo);
      ctx.env.INVENTORY_AUDIO_PROVIDER = 'elevenlabs';
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleGenerateRequest(
        {} as WebSocket,
        { userId: '42', role: 'editor' } as any,
        {
          type: 'generate:request',
          requestId: 'request-dialogue',
          name: 'Scene',
          assetType: 'dialogue',
          mediaKind: 'audio',
          prompt: 'Ada: Ready?\nBen: Always.',
          dialogueVoiceIds: ['voice-ada', 'voice-ben'],
        } as any
      );

      const recipe = JSON.parse(asMock(repo.createPlaceholderVariant).mock.calls[0].arguments[0].recipe);
      assert.deepStrictEqual(recipe.dialogueVoiceIds, ['voice-ada', 'voice-ben']);
      assert.deepStrictEqual(
        workflowCreate.mock.calls[0].arguments[0].params.dialogueVoiceIds,
        ['voice-ada', 'voice-ben']
      );
    });

    test('persists selected Lyria music provider into the recipe and workflow input', async () => {
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      const { ctx } = createMockContext(repo);
      ctx.env.INVENTORY_AUDIO_PROVIDER = 'elevenlabs';
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleGenerateRequest(
        {} as WebSocket,
        { userId: '42', role: 'editor' } as any,
        {
          type: 'generate:request',
          requestId: 'request-lyria',
          name: 'Theme',
          assetType: 'music',
          mediaKind: 'audio',
          prompt: 'A bright orchestral loop.',
          musicProvider: 'lyria',
        } as any
      );

      const recipe = JSON.parse(asMock(repo.createPlaceholderVariant).mock.calls[0].arguments[0].recipe);
      assert.strictEqual(recipe.musicProvider, 'lyria');
      assert.strictEqual(workflowCreate.mock.calls[0].arguments[0].params.musicProvider, 'lyria');
    });
  });

  // ==========================================================================
  // handleRefineRequest
  // ==========================================================================

  describe('handleRefineRequest', () => {
    test('blocks ElevenLabs music refinement when remaining quota can cover prompt but not provider cost', async () => {
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      const { ctx } = createMockContext(repo);
      ctx.env.DB = createQuotaCheckDb({ quotaLimit: 40 }) as any;
      ctx.env.INVENTORY_AUDIO_PROVIDER = 'elevenlabs';
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleRefineRequest(
        {} as WebSocket,
        { userId: '42', role: 'editor' } as any,
        {
          type: 'refine:request',
          requestId: 'request-1',
          assetId: 'asset-1',
          mediaKind: 'audio',
          prompt: 'short heroic orchestral loop',
        } as any
      );

      assert.strictEqual(asMock(ctx.send).mock.calls.length, 1);
      assert.deepStrictEqual(asMock(ctx.send).mock.calls[0].arguments[1], {
        type: 'refine:error',
        requestId: 'request-1',
        error: 'Monthly quota exceeded for elevenlabs. Please upgrade your plan.',
        code: 'QUOTA_EXCEEDED',
      });
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls.length, 0);
      assert.strictEqual(workflowCreate.mock.calls.length, 0);
    });

    test('prechecks Lyria music refinement against Gemini audio, not exhausted image quota', async () => {
      const bindings: unknown[][] = [];
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      const { ctx } = createMockContext(repo);
      ctx.env.DB = createQuotaCheckDb({
        quotaLimit: 0,
        quotaLimitsJson: EXHAUSTED_IMAGE_QUOTA_LIMITS,
        bindings,
      }) as any;
      ctx.env.INVENTORY_AUDIO_PROVIDER = 'elevenlabs';
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleRefineRequest(
        {} as WebSocket,
        { userId: '42', role: 'editor' } as any,
        {
          type: 'refine:request',
          requestId: 'request-lyria-refine-quota',
          assetId: 'asset-1',
          mediaKind: 'audio',
          prompt: 'make the loop softer',
          musicProvider: 'lyria',
        } as any
      );

      assert.strictEqual(asMock(ctx.send).mock.calls.length, 0);
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls.length, 1);
      assert.strictEqual(workflowCreate.mock.calls.length, 1);
      assert.ok(bindings.some((args) => args[1] === 'gemini_audio'));
      assert.ok(!bindings.some((args) => args[1] === 'gemini_images'));
    });

    test('uses target asset media kind for video quota checks when request omits mediaKind', async () => {
      const bindArgs: unknown[][] = [];
      const prepare = mock.fn((sql: string) => ({
        bind: mock.fn((...args: unknown[]) => {
          bindArgs.push(args);
          return {
            first: sql.includes('FROM users')
              ? mock.fn(async () => ({
                  paid_generation_entitlement: 'paid',
                  quota_limits: JSON.stringify({
                    gemini_images: 100,
                    gemini_videos: 0,
                  }),
                  rate_limit_count: 0,
                  rate_limit_window_start: null,
                }))
              : mock.fn(async () => ({ total_used: 0 })),
          };
        }),
      }));
      const { ctx } = createMockContext({
        getAssetById: mock.fn(async () => ({
          id: 'asset-video',
          name: 'Video Asset',
          type: 'animation',
          media_kind: 'video',
          active_variant_id: 'variant-video',
        })),
      });
      ctx.env = {
        DB: { prepare },
        GENERATION_WORKFLOW: { create: mock.fn() },
      } as any;
      const controller = new GenerationController(ctx);

      await controller.handleRefineRequest(
        {} as WebSocket,
        { userId: '123', role: 'editor' },
        {
          type: 'refine:request',
          requestId: 'request-1',
          assetId: 'asset-video',
          prompt: 'Animate this',
        }
      );

      assert.strictEqual(ctx.send.mock.calls.length, 1);
      assert.deepStrictEqual(ctx.send.mock.calls[0].arguments[1], {
        type: 'refine:error',
        requestId: 'request-1',
        error: 'Monthly quota exceeded for veo. Please upgrade your plan.',
        code: 'QUOTA_EXCEEDED',
      });
      assert.ok(bindArgs.some((args) => args[1] === 'gemini_videos'));
    });
  });

  // ==========================================================================
  // handleRetryRequest
  // ==========================================================================

  describe('handleRetryRequest', () => {
    test('preserves styled video reference semantics when retrying', async () => {
      const createWorkflow = mock.fn(async () => ({ id: 'workflow-retry-1' }));
      const recipe = {
        prompt: '[Style: painterly]\n\nAnimate the hero',
        assetType: 'animation',
        mediaKind: 'video',
        model: 'veo-3.1-generate-preview',
        aspectRatio: '16:9',
        sourceImageKeys: ['styles/style-1.png', 'images/asset-1.png'],
        styleImageKeys: ['styles/style-1.png'],
        parentVariantIds: ['source-var-1'],
        operation: 'derive',
        modelProvider: 'custom',
        veoReferenceMode: 'reference-images',
        videoResolution: '1080p',
        videoDurationSeconds: 6,
        videoTier: 'fast',
      };
      const failedVariant = createMockVariant({
        id: 'variant-video',
        asset_id: 'asset-video',
        media_kind: 'video',
        status: 'failed',
        recipe: JSON.stringify(recipe),
      });
      const resetVariant = createMockVariant({
        ...failedVariant,
        status: 'pending',
        error_message: null,
      });
      const processingVariant = createMockVariant({
        ...failedVariant,
        workflow_id: 'workflow-retry-1',
        status: 'processing',
        error_message: null,
      });
      const { ctx, broadcasts } = createMockContext({
        getVariantById: mock.fn(async () => failedVariant),
        getAssetById: mock.fn(async () => ({
          id: 'asset-video',
          name: 'Video Asset',
          type: 'animation',
          media_kind: 'video',
          active_variant_id: 'variant-video',
        })),
        resetVariantForRetry: mock.fn(async () => resetVariant),
        updateVariantWorkflow: mock.fn(async () => processingVariant),
      });
      ctx.env = {
        GENERATION_WORKFLOW: { create: createWorkflow },
      } as any;
      const controller = new GenerationController(ctx);

      await controller.handleRetryRequest(
        {} as WebSocket,
        { userId: 'user-1', role: 'editor' },
        'variant-video'
      );

      assert.strictEqual(createWorkflow.mock.calls.length, 1);
      assert.strictEqual(createWorkflow.mock.calls[0].arguments[0].id, 'variant-video');
      const workflowInput = createWorkflow.mock.calls[0].arguments[0].params;
      assert.deepStrictEqual(workflowInput.sourceImageKeys, recipe.sourceImageKeys);
      assert.deepStrictEqual(workflowInput.styleImageKeys, recipe.styleImageKeys);
      assert.deepStrictEqual(workflowInput.parentVariantIds, recipe.parentVariantIds);
      assert.strictEqual(workflowInput.mediaKind, 'video');
      assert.strictEqual(workflowInput.veoReferenceMode, 'reference-images');
      assert.strictEqual(workflowInput.videoResolution, '1080p');
      assert.strictEqual(workflowInput.videoDurationSeconds, 6);
      assert.strictEqual(workflowInput.videoTier, 'fast');
      assert.strictEqual(workflowInput.modelProvider, 'custom');
      assert.strictEqual(workflowInput.operation, 'derive');
      assert.strictEqual(asMock(ctx.repo.resetVariantForRetry).mock.calls[0].arguments[0], 'variant-video');
      assert.strictEqual(asMock(ctx.repo.updateVariantWorkflow).mock.calls[0].arguments[1], 'workflow-retry-1');
      assert.ok(broadcasts.some((msg) => msg.type === 'variant:updated' && msg.variant.status === 'pending'));
      assert.ok(broadcasts.some((msg) => msg.type === 'variant:updated' && msg.variant.status === 'processing'));
    });
  });

  // ==========================================================================
  // httpCompleteVariant
  // ==========================================================================

  describe('httpCompleteVariant', () => {
    test('calls advanceRotation when variant belongs to rotation view', async () => {
      const rotView: RotationView = {
        id: 'rv-1',
        rotation_set_id: 'rotset-1',
        variant_id: 'variant-1',
        direction: 'E',
        step_index: 1,
        created_at: Date.now(),
      };

      const advanceRotation = mock.fn(async () => {});
      const { ctx } = createMockContext({
        getRotationViewByVariant: mock.fn(async () => rotView),
      });

      const controller = new GenerationController(ctx);
      controller.setPipelineControllers(
        { advanceRotation } as any,
        { advanceTileSet: mock.fn() } as any
      );

      await controller.httpCompleteVariant({
        variantId: 'variant-1',
        imageKey: 'img/done.png',
        thumbKey: 'thumb/done.png',
      });

      assert.strictEqual(advanceRotation.mock.calls.length, 1);
      assert.strictEqual(advanceRotation.mock.calls[0].arguments[0], 'rotset-1');
    });

    test('calls advanceTileSet for tile position', async () => {
      const tilePos: TilePosition = {
        id: 'tp-1',
        tile_set_id: 'tileset-1',
        variant_id: 'variant-1',
        grid_x: 2,
        grid_y: 1,
        created_at: Date.now(),
      };

      const advanceTileSet = mock.fn(async () => {});
      const { ctx } = createMockContext({
        getTilePositionByVariant: mock.fn(async () => tilePos),
      });

      const controller = new GenerationController(ctx);
      controller.setPipelineControllers(
        { advanceRotation: mock.fn() } as any,
        { advanceTileSet } as any
      );

      await controller.httpCompleteVariant({
        variantId: 'variant-1',
        imageKey: 'img/done.png',
        thumbKey: 'thumb/done.png',
      });

      assert.strictEqual(advanceTileSet.mock.calls.length, 1);
      assert.strictEqual(advanceTileSet.mock.calls[0].arguments[0], 'tileset-1');
    });

    test('calls neither for standalone variant', async () => {
      const advanceRotation = mock.fn(async () => {});
      const advanceTileSet = mock.fn(async () => {});
      const { ctx } = createMockContext();

      const controller = new GenerationController(ctx);
      controller.setPipelineControllers(
        { advanceRotation } as any,
        { advanceTileSet } as any
      );

      await controller.httpCompleteVariant({
        variantId: 'variant-1',
        imageKey: 'img/done.png',
        thumbKey: 'thumb/done.png',
      });

      assert.strictEqual(advanceRotation.mock.calls.length, 0);
      assert.strictEqual(advanceTileSet.mock.calls.length, 0);
    });

    test('passes media metadata to repository completion', async () => {
      const { ctx } = createMockContext();
      const controller = new GenerationController(ctx);

      const result = await controller.httpCompleteVariant({
        variantId: 'variant-1',
        imageKey: 'img/done.png',
        thumbKey: 'thumb/done.png',
        mediaMimeType: 'image/png',
        mediaSizeBytes: 2048,
        mediaWidth: 1024,
        mediaHeight: 768,
      });

      assert.strictEqual(result.variant.media_key, 'img/done.png');
      assert.strictEqual(result.variant.media_mime_type, 'image/png');
      assert.strictEqual(result.variant.media_size_bytes, 2048);
      assert.strictEqual(result.variant.media_width, 1024);
      assert.strictEqual(result.variant.media_height, 768);

      const completeCall = asMock(ctx.repo.completeVariant).mock.calls[0];
      assert.deepStrictEqual(completeCall.arguments[3], {
        mediaKey: 'img/done.png',
        mimeType: 'image/png',
        sizeBytes: 2048,
        width: 1024,
        height: 768,
        durationMs: undefined,
      });
    });

    test('completes audio variants with canonical media and no legacy image keys', async () => {
      const { ctx } = createMockContext();
      const controller = new GenerationController(ctx);

      const result = await controller.httpCompleteVariant({
        variantId: 'variant-1',
        imageKey: null,
        thumbKey: null,
        mediaKey: 'media/space-1/variant-1.wav',
        mediaMimeType: 'audio/wav',
        mediaSizeBytes: 4044,
        mediaDurationMs: 250,
      });

      assert.strictEqual(result.variant.image_key, null);
      assert.strictEqual(result.variant.thumb_key, null);
      assert.strictEqual(result.variant.media_key, 'media/space-1/variant-1.wav');
      assert.strictEqual(result.variant.media_mime_type, 'audio/wav');
      assert.strictEqual(result.variant.media_duration_ms, 250);

      const completeCall = asMock(ctx.repo.completeVariant).mock.calls[0];
      assert.strictEqual(completeCall.arguments[1], null);
      assert.strictEqual(completeCall.arguments[2], null);
      assert.deepStrictEqual(completeCall.arguments[3], {
        mediaKey: 'media/space-1/variant-1.wav',
        mimeType: 'audio/wav',
        sizeBytes: 4044,
        width: undefined,
        height: undefined,
        durationMs: 250,
      });
    });

    test('tracks image usage with recipe image size metadata', async () => {
      const { db, statements } = createMockD1();
      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => createMockVariant({
          id: 'variant-image',
          media_kind: 'image',
        })),
        completeVariant: mock.fn(async (id, imageKey, thumbKey, mediaMetadata = {}) =>
          createMockVariant({
            id,
            image_key: imageKey,
            thumb_key: thumbKey,
            media_key: mediaMetadata.mediaKey ?? imageKey,
            workflow_id: 'workflow-image',
            status: 'completed',
            created_by: '123',
            recipe: JSON.stringify({
              mediaKind: 'image',
              model: 'gemini-3-pro-image-preview',
              operation: 'generate',
              imageSize: '4K',
            }),
          })
        ),
      });
      ctx.env = { DB: db } as any;
      const controller = new GenerationController(ctx);

      await controller.httpCompleteVariant({
        variantId: 'variant-image',
        requestId: 'request-image',
        imageKey: 'images/space-1/variant-image.png',
        thumbKey: 'thumbs/space-1/variant-image.webp',
      });

      const usageStatements = usageEventStatements(statements);
      assert.strictEqual(usageStatements.length, 1);
      assert.strictEqual(platformUsageStatements(statements).length, 1);
      const usageInsert = usageStatements[0];
      const ledgerInsert = statements.find((statement) => statement.sql.includes('INSERT OR IGNORE INTO provider_usage_ledger'))!;
      assert.strictEqual(usageInsert.bindings[1], 123);
      assert.strictEqual(usageInsert.bindings[2], 'gemini_images');
      assert.strictEqual(usageInsert.bindings[3], 1);
      assert.deepStrictEqual(JSON.parse(usageInsert.bindings[4]), {
        model: 'gemini-3-pro-image-preview',
        operation: 'generate',
        imageSize: '4K',
      });
      assert.strictEqual(ledgerInsert.bindings[1], 'workflow:workflow-image:meter:gemini_images');
      assert.strictEqual(ledgerInsert.bindings[2], usageInsert.bindings[0]);
      assert.strictEqual(ledgerInsert.bindings[4], 'space-1');
      assert.strictEqual(ledgerInsert.bindings[5], 'asset-1');
      assert.strictEqual(ledgerInsert.bindings[6], 'variant-image');
      assert.strictEqual(ledgerInsert.bindings[7], 'workflow-image');
      assert.strictEqual(ledgerInsert.bindings[8], 'request-image');
      assert.strictEqual(ledgerInsert.bindings[9], 'gemini');
      assert.strictEqual(ledgerInsert.bindings[10], 'gemini-3-pro-image');
      assert.strictEqual(ledgerInsert.bindings[12], 'image');
      assert.strictEqual(ledgerInsert.bindings[13], 'gemini_images');
      assert.strictEqual(ledgerInsert.bindings[14], 'image');
      assert.strictEqual(ledgerInsert.bindings[17], 240000);
    });

    test('does not collect provider spend for fake image completions', async () => {
      const { db, statements } = createMockD1();
      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => createMockVariant({
          id: 'variant-fake-image',
          media_kind: 'image',
        })),
        completeVariant: mock.fn(async (id, imageKey, thumbKey, mediaMetadata = {}) =>
          createMockVariant({
            id,
            image_key: imageKey,
            thumb_key: thumbKey,
            media_key: mediaMetadata.mediaKey ?? imageKey,
            provider_metadata: mediaMetadata.providerMetadata === undefined
              ? null
              : JSON.stringify(mediaMetadata.providerMetadata),
            status: 'completed',
            created_by: '123',
            recipe: JSON.stringify({
              mediaKind: 'image',
              model: 'gemini-3-pro-image-preview',
              operation: 'generate',
            }),
          })
        ),
      });
      ctx.env = { DB: db } as any;
      const controller = new GenerationController(ctx);

      await controller.httpCompleteVariant({
        variantId: 'variant-fake-image',
        imageKey: 'images/space-1/variant-fake-image.png',
        thumbKey: 'thumbs/space-1/variant-fake-image.webp',
        providerMetadata: {
          provider: 'fake',
          model: 'fake-image-model',
        },
      });

      const usageStatements = usageEventStatements(statements);
      assert.strictEqual(usageStatements.length, 1);
      assert.strictEqual(platformUsageStatements(statements).length, 1);
      assert.strictEqual(
        statements.filter((statement) => statement.sql.includes('INSERT OR IGNORE INTO provider_usage_ledger')).length,
        0
      );
      assert.strictEqual(usageStatements[0].bindings[2], 'gemini_images');
    });

    test('records custom image completions as zero-cost custom provider spend', async () => {
      const { db, statements } = createMockD1();
      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => createMockVariant({
          id: 'variant-custom-image',
          media_kind: 'image',
        })),
        completeVariant: mock.fn(async (id, imageKey, thumbKey, mediaMetadata = {}) =>
          createMockVariant({
            id,
            image_key: imageKey,
            thumb_key: thumbKey,
            media_key: mediaMetadata.mediaKey ?? imageKey,
            workflow_id: 'workflow-custom-image',
            provider_metadata: mediaMetadata.providerMetadata === undefined
              ? null
              : JSON.stringify(mediaMetadata.providerMetadata),
            status: 'completed',
            created_by: '123',
            recipe: JSON.stringify({
              mediaKind: 'image',
              model: 'gemini-3-pro-image-preview',
              operation: 'generate',
            }),
          })
        ),
      });
      ctx.env = { DB: db } as any;
      const controller = new GenerationController(ctx);

      await controller.httpCompleteVariant({
        variantId: 'variant-custom-image',
        requestId: 'request-custom-image',
        imageKey: 'images/space-1/variant-custom-image.png',
        thumbKey: 'thumbs/space-1/variant-custom-image.webp',
        providerMetadata: {
          provider: 'custom',
          model: 'custom-image-v1',
          operation: 'generate',
        },
      });

      const usageStatements = usageEventStatements(statements);
      assert.strictEqual(usageStatements.length, 1);
      assert.strictEqual(platformUsageStatements(statements).length, 1);
      const usageInsert = usageStatements[0];
      const ledgerInsert = statements.find((statement) => statement.sql.includes('INSERT OR IGNORE INTO provider_usage_ledger'))!;
      assert.strictEqual(usageInsert.bindings[2], 'gemini_images');
      assert.strictEqual(ledgerInsert.bindings[1], 'workflow:workflow-custom-image:meter:gemini_images');
      assert.strictEqual(ledgerInsert.bindings[2], usageInsert.bindings[0]);
      assert.strictEqual(ledgerInsert.bindings[8], 'request-custom-image');
      assert.strictEqual(ledgerInsert.bindings[9], 'custom');
      assert.strictEqual(ledgerInsert.bindings[10], 'custom-image-v1');
      assert.strictEqual(ledgerInsert.bindings[12], 'image');
      assert.strictEqual(ledgerInsert.bindings[13], 'gemini_images');
      assert.strictEqual(ledgerInsert.bindings[14], 'image');
      assert.strictEqual(ledgerInsert.bindings[15], 1);
      assert.strictEqual(ledgerInsert.bindings[16], null);
      assert.strictEqual(ledgerInsert.bindings[17], 0);
      const ledgerMetadata = JSON.parse(String(ledgerInsert.bindings[22]));
      assert.strictEqual(ledgerMetadata.provider, 'custom');
      assert.strictEqual(ledgerMetadata.provider_model, 'custom-image-v1');
      assert.strictEqual(ledgerMetadata.pricing_status, 'miss');
      assert.strictEqual(ledgerMetadata.pricing_reason, 'unsupported_provider');
    });

    test('completes media-only video variants without image keys and tracks video usage', async () => {
      const statements: Array<{ sql: string; bindings: unknown[] }> = [];
      const run = mock.fn(async () => ({}));
      const bind = mock.fn(() => ({ run }));
      const prepare = mock.fn((sql: string) => ({
        bind: mock.fn((...args: unknown[]) => {
          if (sql.includes('SELECT paid_generation_entitlement')) {
            return {
              first: mock.fn(async () => ({ paid_generation_entitlement: 'paid' })),
            };
          }
          statements.push({ sql, bindings: args });
          return bind(...args);
        }),
      }));
      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => createMockVariant({
          id: 'variant-video',
          media_kind: 'video',
          image_key: null,
          thumb_key: null,
          media_key: null,
        })),
        completeVariant: mock.fn(async (id, imageKey, thumbKey, mediaMetadata = {}) =>
          createMockVariant({
            id,
            media_kind: 'video',
            image_key: imageKey,
            thumb_key: thumbKey,
            media_key: mediaMetadata.mediaKey,
            media_mime_type: mediaMetadata.mimeType,
            media_size_bytes: mediaMetadata.sizeBytes,
            media_duration_ms: mediaMetadata.durationMs,
            workflow_id: 'workflow-video',
            provider_metadata: mediaMetadata.providerMetadata === undefined
              ? null
              : JSON.stringify(mediaMetadata.providerMetadata),
            status: 'completed',
            created_by: '123',
            recipe: JSON.stringify({
              mediaKind: 'video',
              model: 'veo-3.1-generate-preview',
              operation: 'generate',
            }),
          })
        ),
      });
      ctx.env = { DB: { prepare } } as any;
      const controller = new GenerationController(ctx);

      const result = await controller.httpCompleteVariant({
        variantId: 'variant-video',
        requestId: 'request-video',
        imageKey: null,
        thumbKey: null,
        mediaKey: 'media/space-1/variant-video.mp4',
        mediaMimeType: 'video/mp4',
        mediaSizeBytes: 4096,
        mediaDurationMs: 8000,
        providerMetadata: {
          provider: 'google-veo',
          model: 'veo-3.1-generate-preview',
          operation: 'generate',
          resolution: '720p',
          durationSeconds: 8,
          sourceImageCount: 0,
        },
      });

      assert.strictEqual(result.variant.image_key, null);
      assert.strictEqual(result.variant.thumb_key, null);
      assert.strictEqual(result.variant.media_key, 'media/space-1/variant-video.mp4');
      assert.strictEqual(result.variant.media_mime_type, 'video/mp4');
      assert.strictEqual(result.variant.media_duration_ms, 8000);
      const preparedSql = prepare.mock.calls.map((call) => String(call.arguments[0]));
      assert.strictEqual(preparedSql.filter((sql) => /INSERT INTO usage_events\b/.test(sql)).length, 1);
      assert.strictEqual(preparedSql.filter((sql) => /INSERT OR IGNORE INTO customer_charge_ledger\b/.test(sql)).length, 1);
      assert.strictEqual(preparedSql.filter((sql) => /INSERT INTO platform_usage_events\b/.test(sql)).length, 1);
      assert.strictEqual(preparedSql.filter((sql) => /INSERT OR IGNORE INTO provider_usage_ledger\b/.test(sql)).length, 1);
      assert.strictEqual(preparedSql.filter((sql) => /UPDATE customer_charge_ledger\b/.test(sql)).length, 1);
      const usageInsert = statements.find((statement) => /INSERT INTO usage_events\b/.test(statement.sql))!;
      const chargeInsert = statements.find((statement) => /INSERT OR IGNORE INTO customer_charge_ledger\b/.test(statement.sql))!;
      const providerInsert = statements.find((statement) => /INSERT OR IGNORE INTO provider_usage_ledger\b/.test(statement.sql))!;
      assert.strictEqual(usageInsert.bindings[1], 123);
      assert.strictEqual(usageInsert.bindings[2], 'gemini_videos');
      assert.strictEqual(usageInsert.bindings[3], 2);
      assert.deepStrictEqual(JSON.parse(usageInsert.bindings[4]), {
        model: 'veo-3.1-generate-preview',
        operation: 'generate',
        resolution: '720p',
        duration_seconds: 8,
        generate_audio: true,
        video_count: 1,
      });
      assert.strictEqual(chargeInsert.bindings[2], usageInsert.bindings[0]);
      assert.strictEqual(chargeInsert.bindings[4], 'gemini_videos');
      assert.strictEqual(providerInsert.bindings[1], 'workflow:workflow-video:meter:gemini_videos');
      assert.strictEqual(providerInsert.bindings[4], 'space-1');
      assert.strictEqual(providerInsert.bindings[6], 'variant-video');
      assert.strictEqual(providerInsert.bindings[7], 'workflow-video');
      assert.strictEqual(providerInsert.bindings[8], 'request-video');
      assert.strictEqual(providerInsert.bindings[9], 'gemini');
      assert.strictEqual(providerInsert.bindings[10], 'veo-3.1-generate-preview');
      assert.strictEqual(providerInsert.bindings[12], 'video');
      assert.strictEqual(providerInsert.bindings[14], 'video_second');
      assert.strictEqual(providerInsert.bindings[15], 8);
      assert.strictEqual(providerInsert.bindings[17], 3200000);
      assert.strictEqual(run.mock.calls.length, 5);

      const completeCall = asMock(ctx.repo.completeVariant).mock.calls[0];
      assert.deepStrictEqual(completeCall.arguments[3], {
        mediaKey: 'media/space-1/variant-video.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 4096,
        width: undefined,
        height: undefined,
        durationMs: 8000,
        providerMetadata: {
          provider: 'google-veo',
          model: 'veo-3.1-generate-preview',
          operation: 'generate',
          resolution: '720p',
          durationSeconds: 8,
          sourceImageCount: 0,
        },
      });
    });

    test('prices muted video provider spend without generated-audio rates', async () => {
      const { db, statements } = createMockD1();
      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => createMockVariant({
          id: 'variant-muted-video',
          media_kind: 'video',
          image_key: null,
          thumb_key: null,
          media_key: null,
        })),
        completeVariant: mock.fn(async (id, imageKey, thumbKey, mediaMetadata = {}) =>
          createMockVariant({
            id,
            media_kind: 'video',
            image_key: imageKey,
            thumb_key: thumbKey,
            media_key: mediaMetadata.mediaKey,
            media_mime_type: mediaMetadata.mimeType,
            media_size_bytes: mediaMetadata.sizeBytes,
            media_duration_ms: mediaMetadata.durationMs,
            workflow_id: 'workflow-muted-video',
            provider_metadata: mediaMetadata.providerMetadata === undefined
              ? null
              : JSON.stringify(mediaMetadata.providerMetadata),
            status: 'completed',
            created_by: '123',
            recipe: JSON.stringify({
              mediaKind: 'video',
              model: 'veo-3.1-generate-preview',
              operation: 'generate',
              generateAudio: false,
            }),
          })
        ),
      });
      ctx.env = { DB: db } as any;
      const controller = new GenerationController(ctx);

      await controller.httpCompleteVariant({
        variantId: 'variant-muted-video',
        requestId: 'request-muted-video',
        imageKey: null,
        thumbKey: null,
        mediaKey: 'media/space-1/variant-muted-video.mp4',
        mediaMimeType: 'video/mp4',
        mediaSizeBytes: 4096,
        mediaDurationMs: 8000,
        providerMetadata: {
          provider: 'google-veo',
          model: 'veo-3.1-generate-preview',
          operation: 'generate',
          resolution: '720p',
          durationSeconds: 8,
          generateAudio: false,
        },
      });

      const usageStatements = usageEventStatements(statements);
      assert.strictEqual(usageStatements.length, 1);
      assert.strictEqual(platformUsageStatements(statements).length, 1);
      const usageInsert = usageStatements[0];
      const ledgerInsert = statements.find((statement) => statement.sql.includes('INSERT OR IGNORE INTO provider_usage_ledger'))!;
      assert.strictEqual(usageInsert.bindings[2], 'gemini_videos');
      assert.strictEqual(usageInsert.bindings[3], 1);
      assert.deepStrictEqual(JSON.parse(String(usageInsert.bindings[4])), {
        model: 'veo-3.1-generate-preview',
        operation: 'generate',
        resolution: '720p',
        duration_seconds: 8,
        generate_audio: false,
        video_count: 1,
      });
      assert.strictEqual(ledgerInsert.bindings[1], 'workflow:workflow-muted-video:meter:gemini_videos');
      assert.strictEqual(ledgerInsert.bindings[8], 'request-muted-video');
      assert.strictEqual(ledgerInsert.bindings[14], 'video_second');
      assert.strictEqual(ledgerInsert.bindings[15], 8);
      assert.strictEqual(ledgerInsert.bindings[16], 0.2);
      assert.strictEqual(ledgerInsert.bindings[17], 1600000);
    });

    test('passes generated audio sidecars to repository completion', async () => {
      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => createMockVariant({ media_kind: 'audio' })),
      });
      const controller = new GenerationController(ctx);

      await controller.httpCompleteVariant({
        variantId: 'variant-1',
        imageKey: null,
        thumbKey: null,
        mediaKey: 'media/space-1/variant-1.mp3',
        mediaMimeType: 'audio/mpeg',
        mediaSizeBytes: 4096,
        transcriptKey: 'sidecars/space-1/variant-1/transcript.txt',
        transcriptMimeType: 'text/plain',
        transcriptSizeBytes: 11,
        wordTimingsKey: 'sidecars/space-1/variant-1/word_timings.json',
        wordTimingsMimeType: 'application/json',
        wordTimingsSizeBytes: 128,
        renderMetadataKey: 'sidecars/space-1/variant-1/render_metadata.json',
        renderMetadataMimeType: 'application/json',
        renderMetadataSizeBytes: 96,
      });

      const completeCall = asMock(ctx.repo.completeVariant).mock.calls[0];
      assert.deepStrictEqual(completeCall.arguments[3], {
        mediaKey: 'media/space-1/variant-1.mp3',
        mimeType: 'audio/mpeg',
        sizeBytes: 4096,
        width: undefined,
        height: undefined,
        durationMs: undefined,
        transcriptKey: 'sidecars/space-1/variant-1/transcript.txt',
        transcriptMimeType: 'text/plain',
        transcriptSizeBytes: 11,
        wordTimingsKey: 'sidecars/space-1/variant-1/word_timings.json',
        wordTimingsMimeType: 'application/json',
        wordTimingsSizeBytes: 128,
        renderMetadataKey: 'sidecars/space-1/variant-1/render_metadata.json',
        renderMetadataMimeType: 'application/json',
        renderMetadataSizeBytes: 96,
      });
    });

    test('passes provider metadata to repository completion', async () => {
      const { ctx } = createMockContext();
      const controller = new GenerationController(ctx);

      await controller.httpCompleteVariant({
        variantId: 'variant-1',
        imageKey: 'img/done.png',
        thumbKey: 'thumb/done.png',
        providerMetadata: {
          provider: 'gemini',
          model: 'gemini-3-pro-image-preview',
          api: 'generate',
        },
      });

      const completeCall = asMock(ctx.repo.completeVariant).mock.calls[0];
      assert.deepStrictEqual(completeCall.arguments[3].providerMetadata, {
        provider: 'gemini',
        model: 'gemini-3-pro-image-preview',
        api: 'generate',
      });
    });

    test('tracks ElevenLabs audio usage on successful audio completion', async () => {
      const { db, statements } = createMockD1();
      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => createMockVariant({
          media_kind: 'audio',
          recipe: JSON.stringify({ operation: 'generate', assetType: 'music' }),
          created_by: '42',
        })),
        completeVariant: mock.fn(async () => createMockVariant({
          media_kind: 'audio',
          recipe: JSON.stringify({ operation: 'generate', assetType: 'music' }),
          created_by: '42',
          workflow_id: 'workflow-elevenlabs',
          media_key: 'media/space-1/variant-1.mp3',
          media_mime_type: 'audio/mpeg',
          media_size_bytes: 4096,
          status: 'completed',
        })),
      });
      ctx.env.DB = db as any;
      const controller = new GenerationController(ctx);

      await controller.httpCompleteVariant({
        variantId: 'variant-1',
        requestId: 'request-elevenlabs',
        imageKey: null,
        thumbKey: null,
        mediaKey: 'media/space-1/variant-1.mp3',
        mediaMimeType: 'audio/mpeg',
        mediaSizeBytes: 4096,
        audioProvider: 'elevenlabs',
        audioModel: 'music_v1',
        audioUsage: {
          inputTokens: 37,
          outputTokens: 0,
          totalTokens: 37,
        },
      });

      const usageStatements = usageEventStatements(statements);
      assert.strictEqual(usageStatements.length, 1);
      assert.strictEqual(platformUsageStatements(statements).length, 1);
      assert.match(usageStatements[0].sql, /INSERT INTO usage_events/);
      const usageInsert = usageStatements[0];
      const ledgerInsert = statements.find((statement) => statement.sql.includes('INSERT OR IGNORE INTO provider_usage_ledger'))!;
      assert.strictEqual(usageInsert.bindings[1], 42);
      assert.strictEqual(usageInsert.bindings[2], 'elevenlabs_audio');
      assert.strictEqual(usageInsert.bindings[3], 37);
      const metadata = JSON.parse(String(usageInsert.bindings[4]));
      assert.strictEqual(metadata.provider, 'elevenlabs');
      assert.strictEqual(metadata.model, 'music_v1');
      assert.strictEqual(metadata.operation, 'generate');
      assert.strictEqual(metadata.asset_type, 'music');
      assert.strictEqual(metadata.total_tokens, 37);
      assert.strictEqual(ledgerInsert.bindings[1], 'workflow:workflow-elevenlabs:meter:elevenlabs_audio');
      assert.strictEqual(ledgerInsert.bindings[2], usageInsert.bindings[0]);
      assert.strictEqual(ledgerInsert.bindings[8], 'request-elevenlabs');
      assert.strictEqual(ledgerInsert.bindings[9], 'elevenlabs');
      assert.strictEqual(ledgerInsert.bindings[10], 'music_v1');
      assert.strictEqual(ledgerInsert.bindings[12], 'audio');
      assert.strictEqual(ledgerInsert.bindings[14], 'character');
      assert.strictEqual(ledgerInsert.bindings[15], 37);
    });

    test('tracks ElevenLabs speech and dialogue audio by prompt characters when provider usage is missing', async () => {
      const prompt = 'Ada: Ready?\nBen: Always.';
      const expectedQuantity = Array.from(prompt).length;
      const { db, statements } = createMockD1();
      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => createMockVariant({
          media_kind: 'audio',
          recipe: JSON.stringify({ prompt, operation: 'generate', assetType: 'dialogue' }),
          created_by: '42',
        })),
        completeVariant: mock.fn(async () => createMockVariant({
          media_kind: 'audio',
          recipe: JSON.stringify({ prompt, operation: 'generate', assetType: 'dialogue' }),
          created_by: '42',
          workflow_id: 'workflow-dialogue',
          media_key: 'media/space-1/variant-1.mp3',
          media_mime_type: 'audio/mpeg',
          media_size_bytes: 4096,
          status: 'completed',
        })),
      });
      ctx.env.DB = db as any;
      const controller = new GenerationController(ctx);

      await controller.httpCompleteVariant({
        variantId: 'variant-1',
        requestId: 'request-dialogue',
        imageKey: null,
        thumbKey: null,
        mediaKey: 'media/space-1/variant-1.mp3',
        mediaMimeType: 'audio/mpeg',
        mediaSizeBytes: 4096,
        audioProvider: 'elevenlabs',
        audioModel: 'eleven_v3',
        audioUsage: null,
      });

      const usageStatements = usageEventStatements(statements);
      assert.strictEqual(usageStatements.length, 1);
      assert.strictEqual(platformUsageStatements(statements).length, 1);
      const usageInsert = usageStatements[0];
      const ledgerInsert = statements.find((statement) => statement.sql.includes('INSERT OR IGNORE INTO provider_usage_ledger'))!;
      assert.strictEqual(usageInsert.bindings[2], 'elevenlabs_audio');
      assert.strictEqual(usageInsert.bindings[3], expectedQuantity);
      const metadata = JSON.parse(String(usageInsert.bindings[4]));
      assert.strictEqual(metadata.model, 'eleven_v3');
      assert.strictEqual(metadata.asset_type, 'dialogue');
      assert.strictEqual(metadata.input_tokens, expectedQuantity);
      assert.strictEqual(metadata.output_tokens, 0);
      assert.strictEqual(metadata.total_tokens, expectedQuantity);
      assert.strictEqual(ledgerInsert.bindings[1], 'workflow:workflow-dialogue:meter:elevenlabs_audio');
      assert.strictEqual(ledgerInsert.bindings[2], usageInsert.bindings[0]);
    });

    test('tracks Lyria music completions as Gemini audio usage', async () => {
      const { db, statements } = createMockD1();
      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => createMockVariant({
          media_kind: 'audio',
          recipe: JSON.stringify({ operation: 'generate', assetType: 'music', musicProvider: 'lyria' }),
          created_by: '42',
        })),
        completeVariant: mock.fn(async () => createMockVariant({
          media_kind: 'audio',
          recipe: JSON.stringify({ operation: 'generate', assetType: 'music', musicProvider: 'lyria' }),
          created_by: '42',
          workflow_id: 'workflow-lyria',
          media_key: 'media/space-1/variant-1.mp3',
          media_mime_type: 'audio/mpeg',
          media_size_bytes: 4096,
          media_duration_ms: 30_000,
          status: 'completed',
        })),
      });
      ctx.env.DB = db as any;
      const controller = new GenerationController(ctx);

      await controller.httpCompleteVariant({
        variantId: 'variant-1',
        requestId: 'request-lyria',
        imageKey: null,
        thumbKey: null,
        mediaKey: 'media/space-1/variant-1.mp3',
        mediaMimeType: 'audio/mpeg',
        mediaSizeBytes: 4096,
        mediaDurationMs: 30_000,
        audioProvider: 'lyria',
        audioModel: 'lyria-3-clip-preview',
        audioUsage: {
          inputTokens: 12,
          outputTokens: 0,
          totalTokens: 12,
        },
      });

      const usageStatements = usageEventStatements(statements);
      assert.strictEqual(usageStatements.length, 1);
      assert.strictEqual(platformUsageStatements(statements).length, 1);
      assert.match(usageStatements[0].sql, /INSERT INTO usage_events/);
      const usageInsert = usageStatements[0];
      const ledgerInsert = statements.find((statement) => statement.sql.includes('INSERT OR IGNORE INTO provider_usage_ledger'))!;
      assert.strictEqual(usageInsert.bindings[1], 42);
      assert.strictEqual(usageInsert.bindings[2], 'gemini_audio');
      assert.strictEqual(usageInsert.bindings[3], 1);
      const metadata = JSON.parse(String(usageInsert.bindings[4]));
      assert.strictEqual(metadata.provider, 'lyria');
      assert.strictEqual(metadata.model, 'lyria-3-clip-preview');
      assert.strictEqual(metadata.operation, 'generate');
      assert.strictEqual(metadata.asset_type, 'music');
      assert.strictEqual(metadata.duration_ms, 30_000);
      assert.strictEqual(metadata.total_tokens, 12);
      assert.strictEqual(ledgerInsert.bindings[1], 'workflow:workflow-lyria:meter:gemini_audio');
      assert.strictEqual(ledgerInsert.bindings[2], usageInsert.bindings[0]);
      assert.strictEqual(ledgerInsert.bindings[8], 'request-lyria');
      assert.strictEqual(ledgerInsert.bindings[9], 'gemini');
      assert.strictEqual(ledgerInsert.bindings[10], 'lyria-3-clip-preview');
      assert.strictEqual(ledgerInsert.bindings[12], 'audio');
      assert.strictEqual(ledgerInsert.bindings[14], 'generation');
      assert.strictEqual(ledgerInsert.bindings[15], 1);
      assert.strictEqual(ledgerInsert.bindings[17], 40000);
    });

    test('does not track fake audio completions as ElevenLabs usage', async () => {
      const { db, statements } = createMockD1();
      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => createMockVariant({ media_kind: 'audio', created_by: '42' })),
        completeVariant: mock.fn(async () => createMockVariant({ media_kind: 'audio', created_by: '42' })),
      });
      ctx.env.DB = db as any;
      const controller = new GenerationController(ctx);

      await controller.httpCompleteVariant({
        variantId: 'variant-1',
        imageKey: null,
        thumbKey: null,
        mediaKey: 'media/space-1/variant-1.wav',
        mediaMimeType: 'audio/wav',
        mediaSizeBytes: 4096,
        audioProvider: 'fake',
      });

      assert.strictEqual(usageEventStatements(statements).length, 0);
      assert.strictEqual(platformUsageStatements(statements).length, 1);
    });

    test('hook errors do not fail completion', async () => {
      const rotView: RotationView = {
        id: 'rv-1',
        rotation_set_id: 'rotset-1',
        variant_id: 'variant-1',
        direction: 'E',
        step_index: 1,
        created_at: Date.now(),
      };

      const advanceRotation = mock.fn(async () => { throw new Error('hook boom'); });
      const { ctx } = createMockContext({
        getRotationViewByVariant: mock.fn(async () => rotView),
      });

      const controller = new GenerationController(ctx);
      controller.setPipelineControllers(
        { advanceRotation } as any,
        { advanceTileSet: mock.fn() } as any
      );

      // Should not throw
      const result = await controller.httpCompleteVariant({
        variantId: 'variant-1',
        imageKey: 'img/done.png',
        thumbKey: 'thumb/done.png',
      });

      assert.ok(result.success);
    });
  });

  // ==========================================================================
  // httpFailVariant
  // ==========================================================================

  describe('httpFailVariant', () => {
    test('marks rotation set failed and broadcasts', async () => {
      const rotView: RotationView = {
        id: 'rv-1',
        rotation_set_id: 'rotset-1',
        variant_id: 'variant-1',
        direction: 'E',
        step_index: 1,
        created_at: Date.now(),
      };

      const { ctx, broadcasts } = createMockContext({
        getRotationViewByVariant: mock.fn(async () => rotView),
      });

      const controller = new GenerationController(ctx);
      controller.setPipelineControllers(
        { advanceRotation: mock.fn() } as any,
        { advanceTileSet: mock.fn() } as any
      );

      await controller.httpFailVariant({
        variantId: 'variant-1',
        error: 'generation failed',
      });

      assert.strictEqual(asMock(ctx.repo.failRotationSet).mock.calls.length, 1);
      assert.strictEqual(asMock(ctx.repo.failRotationSet).mock.calls[0].arguments[0], 'rotset-1');

      const failBroadcast = broadcasts.find((b) => b.type === 'rotation:failed');
      assert.ok(failBroadcast);
      assert.strictEqual(failBroadcast.rotationSetId, 'rotset-1');
      assert.strictEqual(failBroadcast.error, 'generation failed');
    });

    test('marks tile position failed and advances tile set', async () => {
      const tilePos: TilePosition = {
        id: 'tp-1',
        tile_set_id: 'tileset-1',
        variant_id: 'variant-1',
        grid_x: 2,
        grid_y: 1,
        created_at: Date.now(),
      };

      const { ctx, broadcasts } = createMockContext({
        getTilePositionByVariant: mock.fn(async () => tilePos),
        updateTilePositionStatus: mock.fn(async () => tilePos),
      });

      const advanceTileSetMock = mock.fn();
      const controller = new GenerationController(ctx);
      controller.setPipelineControllers(
        { advanceRotation: mock.fn() } as any,
        { advanceTileSet: advanceTileSetMock } as any
      );

      await controller.httpFailVariant({
        variantId: 'variant-1',
        error: 'tile failed',
      });

      assert.strictEqual(asMock(ctx.repo.updateTilePositionStatus).mock.calls.length, 1);
      assert.deepStrictEqual(
        asMock(ctx.repo.updateTilePositionStatus).mock.calls[0].arguments,
        ['tp-1', 'failed']
      );
      assert.strictEqual(advanceTileSetMock.mock.calls.length, 1);
      assert.strictEqual(advanceTileSetMock.mock.calls[0].arguments[0], 'tileset-1');

      const failBroadcast = broadcasts.find((b) => b.type === 'tileset:tile_failed');
      assert.ok(failBroadcast);
      assert.strictEqual(failBroadcast.tileSetId, 'tileset-1');
      assert.strictEqual(failBroadcast.variantId, 'variant-1');
      assert.strictEqual(failBroadcast.gridX, 2);
      assert.strictEqual(failBroadcast.gridY, 1);
      assert.strictEqual(failBroadcast.error, 'tile failed');
    });

    test('hook errors do not fail the failure handler', async () => {
      const { ctx } = createMockContext({
        getRotationViewByVariant: mock.fn(async () => { throw new Error('lookup boom'); }),
      });

      const controller = new GenerationController(ctx);
      controller.setPipelineControllers(
        { advanceRotation: mock.fn() } as any,
        { advanceTileSet: mock.fn() } as any
      );

      // Should not throw
      const result = await controller.httpFailVariant({
        variantId: 'variant-1',
        error: 'generation failed',
      });

      assert.ok(result.success);
    });
  });

  describe('handleBatchRequest', () => {
    test('blocks ElevenLabs music batch when remaining quota can cover prompts but not provider costs', async () => {
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      const { ctx } = createMockContext(repo);
      ctx.env.DB = createQuotaCheckDb({ quotaLimit: 60 }) as any;
      ctx.env.INVENTORY_AUDIO_PROVIDER = 'elevenlabs';
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleBatchRequest(
        {} as WebSocket,
        { userId: '42', role: 'editor' } as any,
        {
          type: 'batch:request',
          requestId: 'request-1',
          name: 'Batch Music',
          assetType: 'music',
          mediaKind: 'audio',
          prompt: 'short heroic orchestral loop',
          count: 2,
          mode: 'set',
        } as any
      );

      assert.strictEqual(asMock(ctx.send).mock.calls.length, 1);
      assert.deepStrictEqual(asMock(ctx.send).mock.calls[0].arguments[1], {
        type: 'batch:error',
        requestId: 'request-1',
        error: 'Monthly quota exceeded for elevenlabs. Please upgrade your plan.',
        code: 'QUOTA_EXCEEDED',
      });
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls.length, 0);
      assert.strictEqual(workflowCreate.mock.calls.length, 0);
    });

    test('prechecks Lyria music batch against Gemini audio, not exhausted image quota', async () => {
      const bindings: unknown[][] = [];
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      const { ctx } = createMockContext(repo);
      ctx.env.DB = createQuotaCheckDb({
        quotaLimit: 0,
        quotaLimitsJson: EXHAUSTED_IMAGE_QUOTA_LIMITS,
        bindings,
      }) as any;
      ctx.env.INVENTORY_AUDIO_PROVIDER = 'elevenlabs';
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleBatchRequest(
        {} as WebSocket,
        { userId: '42', role: 'editor' } as any,
        {
          type: 'batch:request',
          requestId: 'request-lyria-batch-quota',
          name: 'Batch Music',
          assetType: 'music',
          mediaKind: 'audio',
          prompt: 'short heroic orchestral loop',
          musicProvider: 'lyria',
          count: 2,
          mode: 'set',
        } as any
      );

      assert.strictEqual(asMock(ctx.send).mock.calls.length, 0);
      assert.strictEqual(workflowCreate.mock.calls.length, 2);
      assert.ok(bindings.some((args) => args[1] === 'gemini_audio'));
      assert.ok(!bindings.some((args) => args[1] === 'gemini_images'));
    });

    test('blocks ElevenLabs audio batch when rate window has fewer slots than batch count', async () => {
      const db = {
        prepare: mock.fn((sql: string) => ({
          bind: mock.fn(() => ({
            first: mock.fn(async () => {
              if (sql.includes('FROM users')) {
                return {
                  paid_generation_entitlement: 'paid',
                  quota_limits: JSON.stringify({ elevenlabs_audio: 1000 }),
                  rate_limit_count: 9,
                  rate_limit_window_start: new Date().toISOString(),
                };
              }
              return { total_used: 0 };
            }),
            run: mock.fn(async () => ({ success: true })),
          })),
        })),
      };
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      const { ctx } = createMockContext(repo);
      ctx.env.DB = db as any;
      ctx.env.INVENTORY_AUDIO_PROVIDER = 'elevenlabs';
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleBatchRequest(
        {} as WebSocket,
        { userId: '42', role: 'editor' } as any,
        {
          type: 'batch:request',
          requestId: 'request-2',
          name: 'Batch SFX',
          assetType: 'sfx',
          mediaKind: 'audio',
          prompt: 'eight impacts',
          count: 8,
          mode: 'set',
        } as any
      );

      assert.strictEqual(asMock(ctx.send).mock.calls.length, 1);
      assert.deepStrictEqual(asMock(ctx.send).mock.calls[0].arguments[1], {
        type: 'batch:error',
        requestId: 'request-2',
        error: 'Too many requests. Please wait 60 seconds.',
        code: 'RATE_LIMITED',
      });
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls.length, 0);
      assert.strictEqual(workflowCreate.mock.calls.length, 0);
    });
  });

  describe('handleRetryRequest', () => {
    test('blocks image retry when managed Gemini quota is exhausted', async () => {
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      asMock(repo.getVariantById).mock.mockImplementation(async () => createMockVariant({
        status: 'failed',
        media_kind: 'image',
        recipe: JSON.stringify({
          prompt: 'retry the icon',
          operation: 'generate',
          assetType: 'item',
        }),
      }));
      asMock(repo.getAssetById).mock.mockImplementation(async () => ({
        id: 'asset-1',
        name: 'Item',
        type: 'item',
        media_kind: 'image',
        active_variant_id: 'variant-1',
      }));
      const { ctx } = createMockContext(repo);
      ctx.env.DB = createQuotaCheckDb({
        quotaLimit: 0,
        quotaLimitsJson: JSON.stringify({ gemini_images: 0 }),
      }) as any;
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleRetryRequest({} as WebSocket, { userId: '42', role: 'editor' } as any, 'variant-1');

      assert.strictEqual(asMock(ctx.sendError).mock.calls.length, 1);
      assert.strictEqual(asMock(ctx.sendError).mock.calls[0].arguments[1], 'QUOTA_EXCEEDED');
      assert.strictEqual(asMock(repo.resetVariantForRetry).mock.calls.length, 0);
      assert.strictEqual(workflowCreate.mock.calls.length, 0);
    });

    test('allows image retry with Google BYOK when paid generation is unavailable', async () => {
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      asMock(repo.getVariantById).mock.mockImplementation(async () => createMockVariant({
        status: 'failed',
        media_kind: 'image',
        recipe: JSON.stringify({
          prompt: 'retry the icon',
          operation: 'generate',
          assetType: 'item',
        }),
      }));
      asMock(repo.getAssetById).mock.mockImplementation(async () => ({
        id: 'asset-1',
        name: 'Item',
        type: 'item',
        media_kind: 'image',
        active_variant_id: 'variant-1',
      }));
      const { ctx } = createMockContext(repo);
      ctx.env.DB = createQuotaCheckDb({
        quotaLimit: 0,
        quotaLimitsJson: JSON.stringify({ gemini_images: 0 }),
        paidGenerationEntitlement: 'none',
        hasProviderKey: true,
      }) as any;
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleRetryRequest({} as WebSocket, { userId: '42', role: 'editor' } as any, 'variant-1');

      assert.strictEqual(asMock(ctx.sendError).mock.calls.length, 0);
      assert.strictEqual(asMock(repo.resetVariantForRetry).mock.calls.length, 1);
      assert.strictEqual(workflowCreate.mock.calls.length, 1);
    });

    test('blocks ElevenLabs music retry when remaining quota can cover prompt but not provider cost', async () => {
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      asMock(repo.getVariantById).mock.mockImplementation(async () => createMockVariant({
        status: 'failed',
        media_kind: 'audio',
        recipe: JSON.stringify({
          prompt: 'short heroic orchestral loop',
          operation: 'generate',
          assetType: 'music',
        }),
      }));
      const { ctx } = createMockContext(repo);
      ctx.env.DB = createQuotaCheckDb({ quotaLimit: 40 }) as any;
      ctx.env.INVENTORY_AUDIO_PROVIDER = 'elevenlabs';
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleRetryRequest({} as WebSocket, { userId: '42', role: 'editor' } as any, 'variant-1');

      assert.strictEqual(asMock(ctx.sendError).mock.calls.length, 1);
      assert.strictEqual(asMock(ctx.sendError).mock.calls[0].arguments[1], 'QUOTA_EXCEEDED');
      assert.strictEqual(asMock(repo.resetVariantForRetry).mock.calls.length, 0);
      assert.strictEqual(workflowCreate.mock.calls.length, 0);
    });

    test('does not reject Lyria music retry because image quota is exhausted', async () => {
      const bindings: unknown[][] = [];
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      asMock(repo.getVariantById).mock.mockImplementation(async () => createMockVariant({
        status: 'failed',
        media_kind: 'audio',
        recipe: JSON.stringify({
          prompt: 'short heroic orchestral loop',
          operation: 'generate',
          assetType: 'music',
          musicProvider: 'lyria',
        }),
      }));
      const { ctx } = createMockContext(repo);
      ctx.env.DB = createQuotaCheckDb({
        quotaLimit: 0,
        quotaLimitsJson: EXHAUSTED_IMAGE_QUOTA_LIMITS,
        bindings,
      }) as any;
      ctx.env.INVENTORY_AUDIO_PROVIDER = 'elevenlabs';
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleRetryRequest({} as WebSocket, { userId: '42', role: 'editor' } as any, 'variant-1');

      assert.strictEqual(asMock(ctx.sendError).mock.calls.length, 0);
      assert.strictEqual(asMock(repo.resetVariantForRetry).mock.calls.length, 1);
      assert.strictEqual(workflowCreate.mock.calls.length, 1);
      assert.ok(bindings.some((args) => args[1] === 'gemini_audio'));
      assert.ok(!bindings.some((args) => args[1] === 'gemini_images'));
    });

    test('blocks native-audio video retry against weighted video quota', async () => {
      const workflowCreate = mock.fn(async () => ({ id: 'workflow-1' }));
      const repo = createMockRepo();
      asMock(repo.getVariantById).mock.mockImplementation(async () => createMockVariant({
        status: 'failed',
        media_kind: 'video',
        recipe: JSON.stringify({
          prompt: 'Animate the hero with footsteps',
          operation: 'generate',
          assetType: 'animation',
          mediaKind: 'video',
          generateAudio: true,
        }),
      }));
      const { ctx } = createMockContext(repo);
      ctx.env.DB = createQuotaCheckDb({
        quotaLimit: 1,
        quotaLimitsJson: JSON.stringify({ gemini_videos: 1 }),
      }) as any;
      ctx.env.GENERATION_WORKFLOW = { create: workflowCreate } as any;
      const controller = new GenerationController(ctx);

      await controller.handleRetryRequest({} as WebSocket, { userId: '42', role: 'editor' } as any, 'variant-1');

      assert.strictEqual(asMock(ctx.sendError).mock.calls.length, 1);
      assert.strictEqual(asMock(ctx.sendError).mock.calls[0].arguments[1], 'QUOTA_EXCEEDED');
      assert.strictEqual(asMock(repo.resetVariantForRetry).mock.calls.length, 0);
      assert.strictEqual(workflowCreate.mock.calls.length, 0);
    });
  });
});
