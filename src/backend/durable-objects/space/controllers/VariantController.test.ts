import { describe, test, mock, type Mock } from 'node:test';
import assert from 'node:assert/strict';
import { VariantController } from './VariantController';
import type { ControllerContext, BroadcastFn } from './types';
import type { SpaceRepository, SqlStorage } from '../repository/SpaceRepository';
import type { Env } from '../../../../core/types';
import type { Asset, Variant, WebSocketMeta, ServerMessage } from '../types';

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

function createMockRepo(): SpaceRepository {
  return {
    getAssetById: mock.fn(async () => null),
    getVariantById: mock.fn(async () => null),
    getVariantsByAsset: mock.fn(async () => []),
    updateAsset: mock.fn(async (id, changes) => createMockAsset({ id, ...changes })),
  } as unknown as SpaceRepository;
}

function createMockSql(): SqlStorage {
  return {
    exec: mock.fn(() => ({ toArray: () => [{ ref_count: 1 }] })),
  } as unknown as SqlStorage;
}

function createMockEnv(): Env {
  return {
    IMAGES: {
      delete: mock.fn(async () => {}),
    },
  } as unknown as Env;
}

function createMockContext(
  repoOverrides?: Partial<SpaceRepository>,
  sqlOverrides?: Partial<SqlStorage>
): {
  ctx: ControllerContext;
  broadcasts: ServerMessage[];
} {
  const broadcasts: ServerMessage[] = [];
  const repo = { ...createMockRepo(), ...repoOverrides };
  const sql = { ...createMockSql(), ...sqlOverrides };

  const ctx: ControllerContext = {
    spaceId: 'space-1',
    repo: repo as SpaceRepository,
    env: createMockEnv(),
    sql: sql as SqlStorage,
    broadcast: mock.fn((msg: ServerMessage) => broadcasts.push(msg)) as BroadcastFn,
    send: mock.fn(),
    sendError: mock.fn(),
  };

  return { ctx, broadcasts };
}

function createOwnerMeta(): WebSocketMeta {
  return { userId: 'user-1', role: 'owner' };
}

// ============================================================================
// Tests
// ============================================================================

describe('VariantController', () => {
  describe('handleDelete', () => {
    test('deletes variant and broadcasts deletion', async () => {
      const variant = createMockVariant({ id: 'var-1', asset_id: 'asset-1' });
      const asset = createMockAsset({ id: 'asset-1', active_variant_id: 'other-var' });

      const { ctx, broadcasts } = createMockContext({
        getVariantById: mock.fn(async () => variant),
        getAssetById: mock.fn(async () => asset),
      });

      const controller = new VariantController(ctx);

      await controller.handleDelete({} as WebSocket, createOwnerMeta(), 'var-1');

      // Verify variant:deleted broadcast
      assert.ok(broadcasts.some((b) => b.type === 'variant:deleted' && b.variantId === 'var-1'));
    });

    test('reassigns active variant when deleting active variant', async () => {
      const activeVariant = createMockVariant({ id: 'active-var', asset_id: 'asset-1' });
      const otherVariant = createMockVariant({
        id: 'other-var',
        asset_id: 'asset-1',
        status: 'completed',
      });
      const asset = createMockAsset({ id: 'asset-1', active_variant_id: 'active-var' });

      const { ctx, broadcasts } = createMockContext({
        getVariantById: mock.fn(async () => activeVariant),
        getAssetById: mock.fn(async () => asset),
        getVariantsByAsset: mock.fn(async () => [activeVariant, otherVariant]),
        updateAsset: mock.fn(async (id, changes) =>
          createMockAsset({ id, ...changes, active_variant_id: changes.active_variant_id })
        ),
      });

      const controller = new VariantController(ctx);

      await controller.handleDelete({} as WebSocket, createOwnerMeta(), 'active-var');

      // Verify updateAsset was called to reassign active variant
      assert.strictEqual(asMock(ctx.repo.updateAsset).mock.calls.length, 1);
      const updateCall = asMock(ctx.repo.updateAsset).mock.calls[0];
      assert.strictEqual(updateCall.arguments[0], 'asset-1');
      assert.strictEqual(updateCall.arguments[1].active_variant_id, 'other-var');

      // Verify asset:updated broadcast
      const assetUpdate = broadcasts.find((b) => b.type === 'asset:updated');
      assert.ok(assetUpdate);
      assert.strictEqual((assetUpdate as { asset: Asset }).asset.active_variant_id, 'other-var');
    });

    test('prefers completed variants when reassigning active variant', async () => {
      const activeVariant = createMockVariant({ id: 'active-var', asset_id: 'asset-1' });
      const pendingVariant = createMockVariant({
        id: 'pending-var',
        asset_id: 'asset-1',
        status: 'pending',
      });
      const completedVariant = createMockVariant({
        id: 'completed-var',
        asset_id: 'asset-1',
        status: 'completed',
      });
      const asset = createMockAsset({ id: 'asset-1', active_variant_id: 'active-var' });

      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => activeVariant),
        getAssetById: mock.fn(async () => asset),
        // Order: pending first, then completed - should still pick completed
        getVariantsByAsset: mock.fn(async () => [activeVariant, pendingVariant, completedVariant]),
        updateAsset: mock.fn(async (id, changes) => createMockAsset({ id, ...changes })),
      });

      const controller = new VariantController(ctx);

      await controller.handleDelete({} as WebSocket, createOwnerMeta(), 'active-var');

      // Should pick completed variant, not pending
      const updateCall = asMock(ctx.repo.updateAsset).mock.calls[0];
      assert.strictEqual(updateCall.arguments[1].active_variant_id, 'completed-var');
    });

    test('falls back to any variant if no completed variants', async () => {
      const activeVariant = createMockVariant({ id: 'active-var', asset_id: 'asset-1' });
      const pendingVariant = createMockVariant({
        id: 'pending-var',
        asset_id: 'asset-1',
        status: 'pending',
      });
      const asset = createMockAsset({ id: 'asset-1', active_variant_id: 'active-var' });

      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => activeVariant),
        getAssetById: mock.fn(async () => asset),
        getVariantsByAsset: mock.fn(async () => [activeVariant, pendingVariant]),
        updateAsset: mock.fn(async (id, changes) => createMockAsset({ id, ...changes })),
      });

      const controller = new VariantController(ctx);

      await controller.handleDelete({} as WebSocket, createOwnerMeta(), 'active-var');

      // Should fall back to pending variant
      const updateCall = asMock(ctx.repo.updateAsset).mock.calls[0];
      assert.strictEqual(updateCall.arguments[1].active_variant_id, 'pending-var');
    });

    test('sets active_variant_id to null when deleting only variant', async () => {
      const onlyVariant = createMockVariant({ id: 'only-var', asset_id: 'asset-1' });
      const asset = createMockAsset({ id: 'asset-1', active_variant_id: 'only-var' });

      const { ctx, broadcasts } = createMockContext({
        getVariantById: mock.fn(async () => onlyVariant),
        getAssetById: mock.fn(async () => asset),
        getVariantsByAsset: mock.fn(async () => [onlyVariant]), // Only the one being deleted
        updateAsset: mock.fn(async (id, changes) => createMockAsset({ id, ...changes })),
      });

      const controller = new VariantController(ctx);

      await controller.handleDelete({} as WebSocket, createOwnerMeta(), 'only-var');

      // Should set to null
      const updateCall = asMock(ctx.repo.updateAsset).mock.calls[0];
      assert.strictEqual(updateCall.arguments[1].active_variant_id, null);

      // Verify asset:updated broadcast with null active_variant_id
      const assetUpdate = broadcasts.find((b) => b.type === 'asset:updated');
      assert.ok(assetUpdate);
      assert.strictEqual((assetUpdate as { asset: Asset }).asset.active_variant_id, null);
    });

    test('does not update asset when deleting non-active variant', async () => {
      const nonActiveVariant = createMockVariant({ id: 'non-active', asset_id: 'asset-1' });
      const asset = createMockAsset({ id: 'asset-1', active_variant_id: 'other-var' });

      const { ctx, broadcasts } = createMockContext({
        getVariantById: mock.fn(async () => nonActiveVariant),
        getAssetById: mock.fn(async () => asset),
      });

      const controller = new VariantController(ctx);

      await controller.handleDelete({} as WebSocket, createOwnerMeta(), 'non-active');

      // updateAsset should NOT be called
      assert.strictEqual(asMock(ctx.repo.updateAsset).mock.calls.length, 0);

      // No asset:updated broadcast
      assert.ok(!broadcasts.some((b) => b.type === 'asset:updated'));
    });

    test('handles variant not found gracefully', async () => {
      const { ctx, broadcasts } = createMockContext({
        getVariantById: mock.fn(async () => null),
      });

      const controller = new VariantController(ctx);

      // Should not throw
      await controller.handleDelete({} as WebSocket, createOwnerMeta(), 'nonexistent');

      // Still broadcasts deletion (idempotent)
      assert.ok(broadcasts.some((b) => b.type === 'variant:deleted'));
    });

    test('requires owner permission', async () => {
      const { ctx } = createMockContext();
      const controller = new VariantController(ctx);

      const editorMeta: WebSocketMeta = { userId: 'user-1', role: 'editor' };

      await assert.rejects(
        controller.handleDelete({} as WebSocket, editorMeta, 'var-1'),
        /owner/i
      );
    });

    test('decrements image refs when deleting variant', async () => {
      const variant = createMockVariant({
        id: 'var-1',
        image_key: 'images/test.png',
        thumb_key: 'thumbs/test.png',
      });
      const asset = createMockAsset({ id: 'asset-1', active_variant_id: 'other-var' });

      const sqlExec = mock.fn(() => ({ toArray: () => [{ ref_count: 1 }] }));
      const { ctx } = createMockContext(
        {
          getVariantById: mock.fn(async () => variant),
          getAssetById: mock.fn(async () => asset),
        },
        { exec: sqlExec }
      );

      const controller = new VariantController(ctx);

      await controller.handleDelete({} as WebSocket, createOwnerMeta(), 'var-1');

      // Should call SQL exec for decrementing refs (at least once per image key)
      const decrementCalls = sqlExec.mock.calls.filter((c) =>
        String(c.arguments[0]).includes('UPDATE image_refs')
      );
      assert.ok(decrementCalls.length >= 1);
    });
  });
});
