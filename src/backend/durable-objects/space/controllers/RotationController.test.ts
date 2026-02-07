// @ts-nocheck - Test file with dynamic mocks
import { describe, test, mock, type Mock } from 'node:test';
import assert from 'node:assert/strict';
import { RotationController } from './RotationController';
import type { ControllerContext, BroadcastFn } from './types';
import type { SpaceRepository, SqlStorage } from '../repository/SpaceRepository';
import type { Env } from '../../../../core/types';
import type {
  Asset,
  Variant,
  RotationSet,
  RotationView,
  WebSocketMeta,
  ServerMessage,
} from '../types';

// Helper to extract mock from function
type MockFn<T extends (...args: unknown[]) => unknown> = Mock<T>;
const asMock = <T extends (...args: unknown[]) => unknown>(fn: T): MockFn<T> =>
  fn as MockFn<T>;

// ============================================================================
// Mock Factories
// ============================================================================

function createMockAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    name: 'Test Asset',
    type: 'character',
    tags: '[]',
    parent_asset_id: null,
    active_variant_id: null,
    created_by: 'user-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

function createMockVariant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 'variant-1',
    asset_id: 'asset-1',
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: 'images/test.png',
    thumb_key: 'thumbs/test.png',
    recipe: '{}',
    starred: false,
    created_by: 'user-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    plan_step_id: null,
    ...overrides,
  };
}

function createMockRotationSet(overrides: Partial<RotationSet> = {}): RotationSet {
  return {
    id: 'rotset-1',
    asset_id: 'asset-1',
    source_variant_id: 'variant-1',
    config: JSON.stringify({ type: '4-directional' }),
    status: 'generating',
    current_step: 0,
    total_steps: 4,
    error_message: null,
    created_by: 'user-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

function createMockRotationView(overrides: Partial<RotationView> = {}): RotationView {
  return {
    id: 'rotview-1',
    rotation_set_id: 'rotset-1',
    variant_id: 'variant-1',
    direction: 'S',
    step_index: 0,
    created_at: Date.now(),
    ...overrides,
  };
}

function createMockRepo(): SpaceRepository {
  return {
    getAssetById: mock.fn(async () => createMockAsset()),
    getAssetsByParent: mock.fn(async () => []),
    getVariantById: mock.fn(async () => createMockVariant()),
    getVariantsByAsset: mock.fn(async () => []),
    getLineageForVariants: mock.fn(async () => []),
    createAsset: mock.fn(async (input) =>
      createMockAsset({ id: input.id, name: input.name, type: input.type })
    ),
    updateAsset: mock.fn(async (id, changes) => createMockAsset({ id, ...changes })),
    deleteAsset: mock.fn(async () => {}),
    createLineage: mock.fn(async (input) => ({
      id: input.id,
      parent_variant_id: input.parentVariantId,
      child_variant_id: input.childVariantId,
      relation_type: input.relationType,
      severed: false,
      created_at: Date.now(),
    })),
    createPlaceholderVariant: mock.fn(async (input) =>
      createMockVariant({ id: input.id, asset_id: input.assetId, status: 'pending' })
    ),
    updateVariantWorkflow: mock.fn(async (id, wfId, status) =>
      createMockVariant({ id, workflow_id: wfId, status })
    ),
    // Rotation-specific
    createRotationSet: mock.fn(async () => createMockRotationSet()),
    getRotationSetById: mock.fn(async () => null),
    createRotationView: mock.fn(async () => createMockRotationView()),
    getCompletedRotationViews: mock.fn(async () => []),
    getRotationViewsBySet: mock.fn(async () => []),
    updateRotationSetStatus: mock.fn(async () => createMockRotationSet()),
    updateRotationSetStep: mock.fn(async () => createMockRotationSet()),
    failRotationSet: mock.fn(async () => createMockRotationSet()),
    cancelRotationSet: mock.fn(async () => createMockRotationSet()),
  } as unknown as SpaceRepository;
}

function createMockSql(): SqlStorage {
  return {
    exec: mock.fn(() => ({ toArray: () => [] })),
  } as unknown as SqlStorage;
}

function createMockContext(
  repoOverrides?: Partial<SpaceRepository>,
  envOverrides?: Partial<Env>
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
    env: {
      GENERATION_WORKFLOW: { create: mock.fn(async () => ({ id: 'wf-1' })) },
      ...envOverrides,
    } as Env,
    sql: sql as SqlStorage,
    broadcast: mock.fn((msg: ServerMessage) => broadcasts.push(msg)) as BroadcastFn,
    send: mock.fn(),
    sendError: mock.fn(),
  };

  return { ctx, broadcasts };
}

function createEditorMeta(): WebSocketMeta {
  return { userId: 'user-1', role: 'editor' };
}

function createViewerMeta(): WebSocketMeta {
  return { userId: 'user-1', role: 'viewer' };
}

// ============================================================================
// Tests
// ============================================================================

describe('RotationController', () => {
  // ==========================================================================
  // handleRotationRequest
  // ==========================================================================

  describe('handleRotationRequest', () => {
    test('rejects viewer', async () => {
      // Return cancelled set so advanceRotation returns immediately
      const { ctx } = createMockContext({
        getRotationSetById: mock.fn(async () => createMockRotationSet({ status: 'cancelled' })),
      });
      const controller = new RotationController(ctx);

      await assert.rejects(
        controller.handleRotationRequest({} as WebSocket, createViewerMeta(), {
          type: 'rotation:request',
          requestId: 'req-1',
          sourceVariantId: 'variant-1',
          config: '4-directional',
        }),
        /viewer/i
      );
    });

    test('rejects non-completed variant', async () => {
      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => createMockVariant({ status: 'pending', image_key: null })),
      });
      const controller = new RotationController(ctx);

      await assert.rejects(
        controller.handleRotationRequest({} as WebSocket, createEditorMeta(), {
          type: 'rotation:request',
          requestId: 'req-1',
          sourceVariantId: 'variant-1',
          config: '4-directional',
        }),
        /completed/i
      );
    });

    test('rejects missing image', async () => {
      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => createMockVariant({ status: 'completed', image_key: null })),
      });
      const controller = new RotationController(ctx);

      await assert.rejects(
        controller.handleRotationRequest({} as WebSocket, createEditorMeta(), {
          type: 'rotation:request',
          requestId: 'req-1',
          sourceVariantId: 'variant-1',
          config: '4-directional',
        }),
        /image/i
      );
    });

    test('rejects missing source variant', async () => {
      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => null),
      });
      const controller = new RotationController(ctx);

      await assert.rejects(
        controller.handleRotationRequest({} as WebSocket, createEditorMeta(), {
          type: 'rotation:request',
          requestId: 'req-1',
          sourceVariantId: 'nonexistent',
          config: '4-directional',
        }),
        /not found/i
      );
    });

    test('creates child asset with correct name and parent', async () => {
      const sourceAsset = createMockAsset({ id: 'src-asset', name: 'Hero' });
      const { ctx, broadcasts } = createMockContext({
        getVariantById: mock.fn(async () => createMockVariant({ asset_id: 'src-asset' })),
        getAssetById: mock.fn(async () => sourceAsset),
        getRotationSetById: mock.fn(async () => createMockRotationSet({ status: 'cancelled' })),
      });
      const controller = new RotationController(ctx);

      await controller.handleRotationRequest({} as WebSocket, createEditorMeta(), {
        type: 'rotation:request',
        requestId: 'req-1',
        sourceVariantId: 'variant-1',
        config: '4-directional',
      });

      const createCall = asMock(ctx.repo.createAsset).mock.calls[0].arguments[0];
      assert.strictEqual(createCall.name, 'Hero — Rotation');
      assert.strictEqual(createCall.parentAssetId, 'src-asset');
    });

    test('forks variant via SQL', async () => {
      const { ctx } = createMockContext({
        getRotationSetById: mock.fn(async () => createMockRotationSet({ status: 'cancelled' })),
      });
      const controller = new RotationController(ctx);

      await controller.handleRotationRequest({} as WebSocket, createEditorMeta(), {
        type: 'rotation:request',
        requestId: 'req-1',
        sourceVariantId: 'variant-1',
        config: '4-directional',
      });

      // SQL exec called at least once for INSERT INTO variants
      assert.ok(asMock(ctx.sql.exec).mock.calls.length >= 1);
      const insertCall = asMock(ctx.sql.exec).mock.calls[0].arguments[0];
      assert.ok(insertCall.includes('INSERT INTO variants'));
    });

    test('creates rotation_set with correct totalSteps for 4-directional', async () => {
      const { ctx } = createMockContext({
        getRotationSetById: mock.fn(async () => createMockRotationSet({ status: 'cancelled' })),
      });
      const controller = new RotationController(ctx);

      await controller.handleRotationRequest({} as WebSocket, createEditorMeta(), {
        type: 'rotation:request',
        requestId: 'req-1',
        sourceVariantId: 'variant-1',
        config: '4-directional',
      });

      const setCall = asMock(ctx.repo.createRotationSet).mock.calls[0].arguments[0];
      assert.strictEqual(setCall.totalSteps, 4);
    });

    test('creates rotation_set with correct totalSteps for 8-directional', async () => {
      const { ctx } = createMockContext({
        getRotationSetById: mock.fn(async () => createMockRotationSet({ status: 'cancelled' })),
      });
      const controller = new RotationController(ctx);

      await controller.handleRotationRequest({} as WebSocket, createEditorMeta(), {
        type: 'rotation:request',
        requestId: 'req-1',
        sourceVariantId: 'variant-1',
        config: '8-directional',
      });

      const setCall = asMock(ctx.repo.createRotationSet).mock.calls[0].arguments[0];
      assert.strictEqual(setCall.totalSteps, 8);
    });

    test('creates rotation_set with correct totalSteps for turnaround', async () => {
      const { ctx } = createMockContext({
        getRotationSetById: mock.fn(async () => createMockRotationSet({ status: 'cancelled' })),
      });
      const controller = new RotationController(ctx);

      await controller.handleRotationRequest({} as WebSocket, createEditorMeta(), {
        type: 'rotation:request',
        requestId: 'req-1',
        sourceVariantId: 'variant-1',
        config: 'turnaround',
      });

      const setCall = asMock(ctx.repo.createRotationSet).mock.calls[0].arguments[0];
      assert.strictEqual(setCall.totalSteps, 5);
    });

    test('registers seed view at directions[0]', async () => {
      const { ctx } = createMockContext({
        getRotationSetById: mock.fn(async () => createMockRotationSet({ status: 'cancelled' })),
      });
      const controller = new RotationController(ctx);

      await controller.handleRotationRequest({} as WebSocket, createEditorMeta(), {
        type: 'rotation:request',
        requestId: 'req-1',
        sourceVariantId: 'variant-1',
        config: '4-directional',
      });

      const viewCall = asMock(ctx.repo.createRotationView).mock.calls[0].arguments[0];
      assert.strictEqual(viewCall.direction, 'S');
      assert.strictEqual(viewCall.stepIndex, 0);
    });

    test('broadcasts rotation:started', async () => {
      const { ctx, broadcasts } = createMockContext({
        getRotationSetById: mock.fn(async () => createMockRotationSet({ status: 'cancelled' })),
      });
      const controller = new RotationController(ctx);

      await controller.handleRotationRequest({} as WebSocket, createEditorMeta(), {
        type: 'rotation:request',
        requestId: 'req-1',
        sourceVariantId: 'variant-1',
        config: '4-directional',
      });

      const started = broadcasts.find((b) => b.type === 'rotation:started');
      assert.ok(started);
      assert.strictEqual(started.requestId, 'req-1');
      assert.strictEqual(started.totalSteps, 4);
      assert.deepStrictEqual(started.directions, ['S', 'E', 'N', 'W']);
    });
  });

  // ==========================================================================
  // advanceRotation
  // ==========================================================================

  describe('advanceRotation', () => {
    test('skips if set is cancelled', async () => {
      const { ctx, broadcasts } = createMockContext({
        getRotationSetById: mock.fn(async () => createMockRotationSet({ status: 'cancelled' })),
      });
      const controller = new RotationController(ctx);

      await controller.advanceRotation('rotset-1');

      // Should not try to get completed views
      assert.strictEqual(asMock(ctx.repo.getCompletedRotationViews).mock.calls.length, 0);
    });

    test('skips if set is failed', async () => {
      const { ctx } = createMockContext({
        getRotationSetById: mock.fn(async () => createMockRotationSet({ status: 'failed' })),
      });
      const controller = new RotationController(ctx);

      await controller.advanceRotation('rotset-1');

      assert.strictEqual(asMock(ctx.repo.getCompletedRotationViews).mock.calls.length, 0);
    });

    test('marks completed when all steps done', async () => {
      const completedViews = [
        { ...createMockRotationView({ direction: 'S', step_index: 0, variant_id: 'v1' }), image_key: 'img1', thumb_key: 'th1' },
        { ...createMockRotationView({ direction: 'E', step_index: 1, variant_id: 'v2' }), image_key: 'img2', thumb_key: 'th2' },
        { ...createMockRotationView({ direction: 'N', step_index: 2, variant_id: 'v3' }), image_key: 'img3', thumb_key: 'th3' },
        { ...createMockRotationView({ direction: 'W', step_index: 3, variant_id: 'v4' }), image_key: 'img4', thumb_key: 'th4' },
      ];

      const { ctx, broadcasts } = createMockContext({
        getRotationSetById: mock.fn(async () => createMockRotationSet({ total_steps: 4 })),
        getCompletedRotationViews: mock.fn(async () => completedViews),
        getRotationViewsBySet: mock.fn(async () => completedViews),
      });
      const controller = new RotationController(ctx);

      await controller.advanceRotation('rotset-1');

      assert.strictEqual(asMock(ctx.repo.updateRotationSetStatus).mock.calls.length, 1);
      assert.strictEqual(
        asMock(ctx.repo.updateRotationSetStatus).mock.calls[0].arguments[1],
        'completed'
      );
      assert.ok(broadcasts.some((b) => b.type === 'rotation:completed'));
    });

    test('gets correct next direction', async () => {
      const completedViews = [
        { ...createMockRotationView({ direction: 'S', step_index: 0, variant_id: 'v1' }), image_key: 'img1', thumb_key: 'th1' },
      ];

      const { ctx, broadcasts } = createMockContext({
        getRotationSetById: mock.fn(async () => createMockRotationSet({ total_steps: 4 })),
        getCompletedRotationViews: mock.fn(async () => completedViews),
        getAssetById: mock.fn(async () => createMockAsset()),
      });
      const controller = new RotationController(ctx);

      await controller.advanceRotation('rotset-1');

      // Should create a rotation view with direction 'E' (index 1 for 4-directional)
      const viewCall = asMock(ctx.repo.createRotationView).mock.calls[0].arguments[0];
      assert.strictEqual(viewCall.direction, 'E');
      assert.strictEqual(viewCall.stepIndex, 1);
    });

    test('creates placeholder variant', async () => {
      const completedViews = [
        { ...createMockRotationView({ direction: 'S', step_index: 0, variant_id: 'v1' }), image_key: 'img1', thumb_key: 'th1' },
      ];

      const { ctx } = createMockContext({
        getRotationSetById: mock.fn(async () => createMockRotationSet({ total_steps: 4 })),
        getCompletedRotationViews: mock.fn(async () => completedViews),
        getAssetById: mock.fn(async () => createMockAsset()),
      });
      const controller = new RotationController(ctx);

      await controller.advanceRotation('rotset-1');

      assert.strictEqual(asMock(ctx.repo.createPlaceholderVariant).mock.calls.length, 1);
    });

    test('triggers workflow', async () => {
      const completedViews = [
        { ...createMockRotationView({ direction: 'S', step_index: 0, variant_id: 'v1' }), image_key: 'img1', thumb_key: 'th1' },
      ];

      const { ctx } = createMockContext({
        getRotationSetById: mock.fn(async () => createMockRotationSet({ total_steps: 4 })),
        getCompletedRotationViews: mock.fn(async () => completedViews),
        getAssetById: mock.fn(async () => createMockAsset()),
      });
      const controller = new RotationController(ctx);

      await controller.advanceRotation('rotset-1');

      assert.strictEqual(asMock(ctx.env.GENERATION_WORKFLOW.create).mock.calls.length, 1);
    });

    test('broadcasts rotation:step_completed', async () => {
      const completedViews = [
        { ...createMockRotationView({ direction: 'S', step_index: 0, variant_id: 'v1' }), image_key: 'img1', thumb_key: 'th1' },
      ];

      const { ctx, broadcasts } = createMockContext({
        getRotationSetById: mock.fn(async () => createMockRotationSet({ total_steps: 4 })),
        getCompletedRotationViews: mock.fn(async () => completedViews),
        getAssetById: mock.fn(async () => createMockAsset()),
      });
      const controller = new RotationController(ctx);

      await controller.advanceRotation('rotset-1');

      const stepMsg = broadcasts.find((b) => b.type === 'rotation:step_completed');
      assert.ok(stepMsg);
      assert.strictEqual(stepMsg.direction, 'E');
      assert.strictEqual(stepMsg.step, 1);
      assert.strictEqual(stepMsg.total, 4);
    });

    test('returns silently when set not found', async () => {
      const { ctx, broadcasts } = createMockContext({
        getRotationSetById: mock.fn(async () => null),
      });
      const controller = new RotationController(ctx);

      // Should not throw
      await controller.advanceRotation('nonexistent');
      assert.strictEqual(broadcasts.length, 0);
    });
  });

  // ==========================================================================
  // handleRotationCancel
  // ==========================================================================

  describe('handleRotationCancel', () => {
    test('rejects viewer', async () => {
      const { ctx } = createMockContext();
      const controller = new RotationController(ctx);

      await assert.rejects(
        controller.handleRotationCancel({} as WebSocket, createViewerMeta(), 'rotset-1'),
        /viewer/i
      );
    });

    test('cancels and broadcasts rotation:cancelled', async () => {
      const { ctx, broadcasts } = createMockContext({
        getRotationSetById: mock.fn(async () => createMockRotationSet()),
      });
      const controller = new RotationController(ctx);

      await controller.handleRotationCancel({} as WebSocket, createEditorMeta(), 'rotset-1');

      assert.strictEqual(asMock(ctx.repo.cancelRotationSet).mock.calls.length, 1);
      assert.ok(broadcasts.some((b) => b.type === 'rotation:cancelled' && b.rotationSetId === 'rotset-1'));
    });

    test('throws when rotation set not found', async () => {
      const { ctx } = createMockContext({
        getRotationSetById: mock.fn(async () => null),
      });
      const controller = new RotationController(ctx);

      await assert.rejects(
        controller.handleRotationCancel({} as WebSocket, createEditorMeta(), 'nonexistent'),
        /not found/i
      );
    });
  });
});
