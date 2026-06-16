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

function createMockRepo(): SpaceRepository {
  return {
    getVariantById: mock.fn(async () => createMockVariant()),
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
});
