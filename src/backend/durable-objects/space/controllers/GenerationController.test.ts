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
