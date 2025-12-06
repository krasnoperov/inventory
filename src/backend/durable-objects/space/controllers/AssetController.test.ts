import { describe, test, mock, beforeEach, type Mock } from 'node:test';
import assert from 'node:assert/strict';
import { AssetController } from './AssetController';
import type { ControllerContext, BroadcastFn } from './types';
import type { SpaceRepository } from '../repository/SpaceRepository';
import type { Env } from '../../../../core/types';
import type { Asset, WebSocketMeta, ServerMessage } from '../types';

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

function createMockRepo(): SpaceRepository {
  return {
    getAssetById: mock.fn(async () => null),
    getAssetsByParent: mock.fn(async () => []),
    getVariantsByAsset: mock.fn(async () => []),
    createAsset: mock.fn(async (input) => createMockAsset({ id: input.id, name: input.name })),
    updateAsset: mock.fn(async (id, changes) => createMockAsset({ id, ...changes })),
    deleteAsset: mock.fn(async () => {}),
  } as unknown as SpaceRepository;
}

function createMockContext(repoOverrides?: Partial<SpaceRepository>): {
  ctx: ControllerContext;
  broadcasts: ServerMessage[];
} {
  const broadcasts: ServerMessage[] = [];
  const repo = { ...createMockRepo(), ...repoOverrides };

  const ctx: ControllerContext = {
    spaceId: 'space-1',
    repo: repo as SpaceRepository,
    env: {} as Env,
    sql: { exec: mock.fn() } as unknown as ControllerContext['sql'],
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

describe('AssetController', () => {
  describe('handleDelete', () => {
    test('deletes asset and broadcasts deletion', async () => {
      const { ctx, broadcasts } = createMockContext();
      const controller = new AssetController(ctx);

      await controller.handleDelete({} as WebSocket, createOwnerMeta(), 'asset-1');

      // Verify deleteAsset was called
      assert.strictEqual(asMock(ctx.repo.deleteAsset).mock.calls.length, 1);
      assert.strictEqual(asMock(ctx.repo.deleteAsset).mock.calls[0].arguments[0], 'asset-1');

      // Verify broadcast
      assert.ok(broadcasts.some((b) => b.type === 'asset:deleted' && b.assetId === 'asset-1'));
    });

    test('reparents child assets to root when parent deleted', async () => {
      const childAsset1 = createMockAsset({ id: 'child-1', parent_asset_id: 'parent-1' });
      const childAsset2 = createMockAsset({ id: 'child-2', parent_asset_id: 'parent-1' });

      const { ctx, broadcasts } = createMockContext({
        getAssetsByParent: mock.fn(async (parentId: string) => {
          if (parentId === 'parent-1') return [childAsset1, childAsset2];
          return [];
        }),
        getAssetById: mock.fn(async (id: string) => {
          // After deletion, children have parent_asset_id = null
          if (id === 'child-1') return createMockAsset({ id: 'child-1', parent_asset_id: null });
          if (id === 'child-2') return createMockAsset({ id: 'child-2', parent_asset_id: null });
          return null;
        }),
      });

      const controller = new AssetController(ctx);

      await controller.handleDelete({} as WebSocket, createOwnerMeta(), 'parent-1');

      // Verify getAssetsByParent was called to find children
      assert.strictEqual(asMock(ctx.repo.getAssetsByParent).mock.calls.length, 1);
      assert.strictEqual(
        asMock(ctx.repo.getAssetsByParent).mock.calls[0].arguments[0],
        'parent-1'
      );

      // Verify broadcasts: 1 delete + 2 updates for reparented children
      const deleteBroadcast = broadcasts.find((b) => b.type === 'asset:deleted');
      assert.ok(deleteBroadcast);
      assert.strictEqual(deleteBroadcast.assetId, 'parent-1');

      const updateBroadcasts = broadcasts.filter((b) => b.type === 'asset:updated');
      assert.strictEqual(updateBroadcasts.length, 2);

      // Children should now have null parent
      const childUpdates = updateBroadcasts.map((b) => (b as { asset: Asset }).asset);
      assert.ok(childUpdates.some((a) => a.id === 'child-1' && a.parent_asset_id === null));
      assert.ok(childUpdates.some((a) => a.id === 'child-2' && a.parent_asset_id === null));
    });

    test('handles deletion of asset with no children', async () => {
      const { ctx, broadcasts } = createMockContext({
        getAssetsByParent: mock.fn(async () => []),
      });

      const controller = new AssetController(ctx);

      await controller.handleDelete({} as WebSocket, createOwnerMeta(), 'leaf-asset');

      // Only delete broadcast, no update broadcasts
      assert.strictEqual(broadcasts.length, 1);
      assert.strictEqual(broadcasts[0].type, 'asset:deleted');
    });

    test('handles deeply nested children (only direct children reparented)', async () => {
      // Parent -> Child -> Grandchild
      // When Parent is deleted, only Child is reparented to root
      // Grandchild remains under Child
      const childAsset = createMockAsset({ id: 'child', parent_asset_id: 'parent' });

      const { ctx, broadcasts } = createMockContext({
        getAssetsByParent: mock.fn(async (parentId: string) => {
          if (parentId === 'parent') return [childAsset];
          return [];
        }),
        getAssetById: mock.fn(async (id: string) => {
          if (id === 'child') return createMockAsset({ id: 'child', parent_asset_id: null });
          return null;
        }),
      });

      const controller = new AssetController(ctx);

      await controller.handleDelete({} as WebSocket, createOwnerMeta(), 'parent');

      // Only 1 child reparented (direct child)
      const updateBroadcasts = broadcasts.filter((b) => b.type === 'asset:updated');
      assert.strictEqual(updateBroadcasts.length, 1);
    });

    test('requires owner permission', async () => {
      const { ctx } = createMockContext();
      const controller = new AssetController(ctx);

      const editorMeta: WebSocketMeta = { userId: 'user-1', role: 'editor' };

      await assert.rejects(
        controller.handleDelete({} as WebSocket, editorMeta, 'asset-1'),
        /owner/i
      );
    });

    test('continues even if child lookup returns null', async () => {
      const childAsset = createMockAsset({ id: 'child-1', parent_asset_id: 'parent-1' });

      const { ctx, broadcasts } = createMockContext({
        getAssetsByParent: mock.fn(async () => [childAsset]),
        getAssetById: mock.fn(async () => null), // Child not found after deletion (edge case)
      });

      const controller = new AssetController(ctx);

      // Should not throw
      await controller.handleDelete({} as WebSocket, createOwnerMeta(), 'parent-1');

      // Delete broadcast should still happen
      assert.ok(broadcasts.some((b) => b.type === 'asset:deleted'));
      // No update broadcast since child not found
      assert.strictEqual(broadcasts.filter((b) => b.type === 'asset:updated').length, 0);
    });
  });
});
