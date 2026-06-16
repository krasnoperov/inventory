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
      createMockVariant({ id: input.id, asset_id: input.assetId, media_kind: input.mediaKind ?? 'image' })
    ),
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
  // ==========================================================================
  // handleRefineRequest
  // ==========================================================================

  describe('handleRefineRequest', () => {
    test('uses target asset media kind for video quota checks when request omits mediaKind', async () => {
      const bindArgs: unknown[][] = [];
      const prepare = mock.fn((sql: string) => ({
        bind: mock.fn((...args: unknown[]) => {
          bindArgs.push(args);
          return {
            first: sql.includes('FROM users')
              ? mock.fn(async () => ({
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

    test('completes media-only video variants without image keys and tracks video usage', async () => {
      const run = mock.fn(async () => ({}));
      const bind = mock.fn(() => ({ run }));
      const prepare = mock.fn(() => ({ bind }));
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
        imageKey: null,
        thumbKey: null,
        mediaKey: 'media/space-1/variant-video.mp4',
        mediaMimeType: 'video/mp4',
        mediaSizeBytes: 4096,
        mediaDurationMs: 8000,
      });

      assert.strictEqual(result.variant.image_key, null);
      assert.strictEqual(result.variant.thumb_key, null);
      assert.strictEqual(result.variant.media_key, 'media/space-1/variant-video.mp4');
      assert.strictEqual(result.variant.media_mime_type, 'video/mp4');
      assert.strictEqual(result.variant.media_duration_ms, 8000);
      assert.strictEqual(prepare.mock.calls.length, 1);
      assert.strictEqual(bind.mock.calls[0].arguments[1], 123);
      assert.strictEqual(bind.mock.calls[0].arguments[2], 'gemini_videos');
      assert.strictEqual(bind.mock.calls[0].arguments[3], 1);
      assert.deepStrictEqual(JSON.parse(bind.mock.calls[0].arguments[4]), {
        model: 'veo-3.1-generate-preview',
        operation: 'generate',
      });
      assert.strictEqual(run.mock.calls.length, 1);

      const completeCall = asMock(ctx.repo.completeVariant).mock.calls[0];
      assert.deepStrictEqual(completeCall.arguments[3], {
        mediaKey: 'media/space-1/variant-video.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 4096,
        width: undefined,
        height: undefined,
        durationMs: 8000,
      });
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

      assert.strictEqual(statements.length, 1);
      assert.match(statements[0].sql, /INSERT INTO usage_events/);
      assert.strictEqual(statements[0].bindings[1], 42);
      assert.strictEqual(statements[0].bindings[2], 'elevenlabs_audio');
      assert.strictEqual(statements[0].bindings[3], 37);
      const metadata = JSON.parse(String(statements[0].bindings[4]));
      assert.strictEqual(metadata.provider, 'elevenlabs');
      assert.strictEqual(metadata.model, 'music_v1');
      assert.strictEqual(metadata.operation, 'generate');
      assert.strictEqual(metadata.asset_type, 'music');
      assert.strictEqual(metadata.total_tokens, 37);
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

      assert.strictEqual(statements.length, 0);
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
    test('blocks ElevenLabs audio batch when remaining quota is less than batch count', async () => {
      const db = {
        prepare: mock.fn((sql: string) => ({
          bind: mock.fn(() => ({
            first: mock.fn(async () => {
              if (sql.includes('FROM users')) {
                return {
                  quota_limits: JSON.stringify({ elevenlabs_audio: 1 }),
                  rate_limit_count: 0,
                  rate_limit_window_start: null,
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
          requestId: 'request-1',
          name: 'Batch Music',
          assetType: 'music',
          mediaKind: 'audio',
          prompt: 'eight loops',
          count: 8,
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

    test('blocks ElevenLabs audio batch when rate window has fewer slots than batch count', async () => {
      const db = {
        prepare: mock.fn((sql: string) => ({
          bind: mock.fn(() => ({
            first: mock.fn(async () => {
              if (sql.includes('FROM users')) {
                return {
                  quota_limits: JSON.stringify({ elevenlabs_audio: 100 }),
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
    test('blocks ElevenLabs audio retry when quota is exhausted', async () => {
      const db = {
        prepare: mock.fn((sql: string) => ({
          bind: mock.fn(() => ({
            first: mock.fn(async () => {
              if (sql.includes('FROM users')) {
                return {
                  quota_limits: JSON.stringify({ elevenlabs_audio: 0 }),
                  rate_limit_count: 0,
                  rate_limit_window_start: null,
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
      asMock(repo.getVariantById).mock.mockImplementation(async () => createMockVariant({
        status: 'failed',
        media_kind: 'audio',
        recipe: JSON.stringify({ prompt: 'Retry audio', operation: 'generate', assetType: 'music' }),
      }));
      const { ctx } = createMockContext(repo);
      ctx.env.DB = db as any;
      ctx.env.INVENTORY_AUDIO_PROVIDER = 'elevenlabs';
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
