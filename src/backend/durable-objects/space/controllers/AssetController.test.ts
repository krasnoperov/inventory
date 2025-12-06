// @ts-nocheck - Test file with dynamic mocks
import { describe, test, mock, type Mock } from 'node:test';
import assert from 'node:assert/strict';
import { AssetController } from './AssetController';
import type { ControllerContext, BroadcastFn } from './types';
import type { SpaceRepository, SqlStorage } from '../repository/SpaceRepository';
import type { Env } from '../../../../core/types';
import type { Asset, Variant, Lineage, WebSocketMeta, ServerMessage } from '../types';

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

function createMockLineage(overrides: Partial<Lineage> = {}): Lineage {
  return {
    id: 'lineage-1',
    parent_variant_id: 'parent-var',
    child_variant_id: 'child-var',
    relation_type: 'refined',
    severed: false,
    created_at: Date.now(),
    ...overrides,
  };
}

function createMockRepo(): SpaceRepository {
  return {
    getAssetById: mock.fn(async () => null),
    getAssetsByParent: mock.fn(async () => []),
    getVariantsByAsset: mock.fn(async () => []),
    getVariantById: mock.fn(async () => null),
    getLineageForVariants: mock.fn(async () => []),
    createAsset: mock.fn(async (input) =>
      createMockAsset({ id: input.id, name: input.name, type: input.type })
    ),
    updateAsset: mock.fn(async (id, changes) => createMockAsset({ id, ...changes })),
    deleteAsset: mock.fn(async () => {}),
    createLineage: mock.fn(async (input) =>
      createMockLineage({
        id: input.id,
        parent_variant_id: input.parentVariantId,
        child_variant_id: input.childVariantId,
        relation_type: input.relationType,
      })
    ),
  } as unknown as SpaceRepository;
}

function createMockSql(): SqlStorage {
  return {
    exec: mock.fn(() => ({ toArray: () => [] })),
  } as unknown as SqlStorage;
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
    env: {} as Env,
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

function createEditorMeta(): WebSocketMeta {
  return { userId: 'user-1', role: 'editor' };
}

function createViewerMeta(): WebSocketMeta {
  return { userId: 'user-1', role: 'viewer' };
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
        getAssetsByParent: mock.fn(async (parentId) => {
          if (parentId === 'parent-1') return [childAsset1, childAsset2];
          return [];
        }),
        getAssetById: mock.fn(async (id) => {
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

  // ==========================================================================
  // handleCreate
  // ==========================================================================

  describe('handleCreate', () => {
    test('creates asset and broadcasts creation', async () => {
      const { ctx, broadcasts } = createMockContext();
      const controller = new AssetController(ctx);

      await controller.handleCreate(
        {} as WebSocket,
        createEditorMeta(),
        'New Character',
        'character'
      );

      // Verify createAsset was called
      assert.strictEqual(asMock(ctx.repo.createAsset).mock.calls.length, 1);
      const createCall = asMock(ctx.repo.createAsset).mock.calls[0].arguments[0];
      assert.strictEqual(createCall.name, 'New Character');
      assert.strictEqual(createCall.type, 'character');

      // Verify broadcast
      const createBroadcast = broadcasts.find((b) => b.type === 'asset:created');
      assert.ok(createBroadcast);
      assert.strictEqual((createBroadcast as { asset: Asset }).asset.name, 'New Character');
    });

    test('creates asset with parent', async () => {
      const { ctx, broadcasts } = createMockContext();
      const controller = new AssetController(ctx);

      await controller.handleCreate(
        {} as WebSocket,
        createEditorMeta(),
        'Child Asset',
        'prop',
        'parent-asset-id'
      );

      const createCall = asMock(ctx.repo.createAsset).mock.calls[0].arguments[0];
      assert.strictEqual(createCall.parentAssetId, 'parent-asset-id');
    });

    test('requires editor permission', async () => {
      const { ctx } = createMockContext();
      const controller = new AssetController(ctx);

      await assert.rejects(
        controller.handleCreate({} as WebSocket, createViewerMeta(), 'Test', 'character'),
        /viewer/i
      );
    });

    test('sets createdBy from user meta', async () => {
      const { ctx } = createMockContext();
      const controller = new AssetController(ctx);

      await controller.handleCreate(
        {} as WebSocket,
        { userId: 'specific-user', role: 'editor' },
        'Test',
        'character'
      );

      const createCall = asMock(ctx.repo.createAsset).mock.calls[0].arguments[0];
      assert.strictEqual(createCall.createdBy, 'specific-user');
    });
  });

  // ==========================================================================
  // handleUpdate
  // ==========================================================================

  describe('handleUpdate', () => {
    test('updates asset name and broadcasts', async () => {
      const existingAsset = createMockAsset({ id: 'asset-1', name: 'Old Name' });
      const { ctx, broadcasts } = createMockContext({
        updateAsset: mock.fn(async (id, changes) =>
          createMockAsset({ id, name: changes.name ?? 'Old Name' })
        ),
      });
      const controller = new AssetController(ctx);

      await controller.handleUpdate({} as WebSocket, createEditorMeta(), 'asset-1', {
        name: 'New Name',
      });

      // Verify updateAsset was called
      assert.strictEqual(asMock(ctx.repo.updateAsset).mock.calls.length, 1);
      assert.strictEqual(asMock(ctx.repo.updateAsset).mock.calls[0].arguments[0], 'asset-1');

      // Verify broadcast
      assert.ok(broadcasts.some((b) => b.type === 'asset:updated'));
    });

    test('updates asset tags', async () => {
      const { ctx, broadcasts } = createMockContext({
        updateAsset: mock.fn(async (id, changes) => createMockAsset({ id, ...changes })),
      });
      const controller = new AssetController(ctx);

      await controller.handleUpdate({} as WebSocket, createEditorMeta(), 'asset-1', {
        tags: ['hero', 'main'],
      });

      const updateCall = asMock(ctx.repo.updateAsset).mock.calls[0].arguments[1];
      assert.deepStrictEqual(updateCall.tags, ['hero', 'main']);
    });

    test('updates asset type', async () => {
      const { ctx } = createMockContext({
        updateAsset: mock.fn(async (id, changes) => createMockAsset({ id, ...changes })),
      });
      const controller = new AssetController(ctx);

      await controller.handleUpdate({} as WebSocket, createEditorMeta(), 'asset-1', {
        type: 'environment',
      });

      const updateCall = asMock(ctx.repo.updateAsset).mock.calls[0].arguments[1];
      assert.strictEqual(updateCall.type, 'environment');
    });

    test('updates parent asset id', async () => {
      const { ctx } = createMockContext({
        updateAsset: mock.fn(async (id, changes) => createMockAsset({ id, ...changes })),
      });
      const controller = new AssetController(ctx);

      await controller.handleUpdate({} as WebSocket, createEditorMeta(), 'asset-1', {
        parentAssetId: 'new-parent',
      });

      const updateCall = asMock(ctx.repo.updateAsset).mock.calls[0].arguments[1];
      assert.strictEqual(updateCall.parent_asset_id, 'new-parent');
    });

    test('allows setting parent to null (move to root)', async () => {
      const { ctx } = createMockContext({
        updateAsset: mock.fn(async (id, changes) => createMockAsset({ id, ...changes })),
      });
      const controller = new AssetController(ctx);

      await controller.handleUpdate({} as WebSocket, createEditorMeta(), 'asset-1', {
        parentAssetId: null,
      });

      const updateCall = asMock(ctx.repo.updateAsset).mock.calls[0].arguments[1];
      assert.strictEqual(updateCall.parent_asset_id, null);
    });

    test('throws when asset not found', async () => {
      const { ctx } = createMockContext({
        updateAsset: mock.fn(async () => null),
      });
      const controller = new AssetController(ctx);

      await assert.rejects(
        controller.handleUpdate({} as WebSocket, createEditorMeta(), 'nonexistent', {
          name: 'Test',
        }),
        /not found/i
      );
    });

    test('rejects circular parent reference', async () => {
      // Asset trying to set itself as parent
      const { ctx } = createMockContext(
        {},
        {
          exec: mock.fn((query: string, id: string) => {
            // Simulate: asset-1 -> asset-2 -> asset-1 would be a cycle
            if (id === 'asset-2') return { toArray: () => [{ parent_asset_id: 'asset-1' }] };
            return { toArray: () => [] };
          }),
        }
      );
      const controller = new AssetController(ctx);

      await assert.rejects(
        controller.handleUpdate({} as WebSocket, createEditorMeta(), 'asset-1', {
          parentAssetId: 'asset-2',
        }),
        /circular/i
      );
    });

    test('requires editor permission', async () => {
      const { ctx } = createMockContext();
      const controller = new AssetController(ctx);

      await assert.rejects(
        controller.handleUpdate({} as WebSocket, createViewerMeta(), 'asset-1', { name: 'Test' }),
        /viewer/i
      );
    });
  });

  // ==========================================================================
  // handleSetActive
  // ==========================================================================

  describe('handleSetActive', () => {
    test('sets active variant and broadcasts', async () => {
      const { ctx, broadcasts } = createMockContext({
        updateAsset: mock.fn(async (id, changes) =>
          createMockAsset({ id, active_variant_id: changes.active_variant_id })
        ),
      });
      const controller = new AssetController(ctx);

      await controller.handleSetActive(
        {} as WebSocket,
        createEditorMeta(),
        'asset-1',
        'variant-123'
      );

      // Verify updateAsset was called with correct variant
      const updateCall = asMock(ctx.repo.updateAsset).mock.calls[0];
      assert.strictEqual(updateCall.arguments[0], 'asset-1');
      assert.strictEqual(updateCall.arguments[1].active_variant_id, 'variant-123');

      // Verify broadcast
      const updateBroadcast = broadcasts.find((b) => b.type === 'asset:updated');
      assert.ok(updateBroadcast);
      assert.strictEqual(
        (updateBroadcast as { asset: Asset }).asset.active_variant_id,
        'variant-123'
      );
    });

    test('throws when asset not found', async () => {
      const { ctx } = createMockContext({
        updateAsset: mock.fn(async () => null),
      });
      const controller = new AssetController(ctx);

      await assert.rejects(
        controller.handleSetActive({} as WebSocket, createEditorMeta(), 'nonexistent', 'var-1'),
        /not found/i
      );
    });

    test('requires editor permission', async () => {
      const { ctx } = createMockContext();
      const controller = new AssetController(ctx);

      await assert.rejects(
        controller.handleSetActive({} as WebSocket, createViewerMeta(), 'asset-1', 'var-1'),
        /viewer/i
      );
    });
  });

  // ==========================================================================
  // handleFork
  // ==========================================================================

  describe('handleFork', () => {
    test('forks from variant ID and broadcasts', async () => {
      const sourceVariant = createMockVariant({
        id: 'source-var',
        asset_id: 'source-asset',
        image_key: 'images/source.png',
        thumb_key: 'thumbs/source.png',
      });

      const { ctx, broadcasts } = createMockContext({
        getVariantById: mock.fn(async () => sourceVariant),
        updateAsset: mock.fn(async (id, changes) => createMockAsset({ id, ...changes })),
      });
      const controller = new AssetController(ctx);

      await controller.handleFork(
        {} as WebSocket,
        createEditorMeta(),
        undefined, // no sourceAssetId
        'source-var', // sourceVariantId
        'Forked Asset',
        'character'
      );

      // Verify fork broadcast
      const forkBroadcast = broadcasts.find((b) => b.type === 'asset:forked');
      assert.ok(forkBroadcast);
      assert.strictEqual((forkBroadcast as { asset: Asset }).asset.name, 'Forked Asset');
    });

    test('forks from asset ID using active variant', async () => {
      const sourceAsset = createMockAsset({
        id: 'source-asset',
        active_variant_id: 'active-var',
      });
      const activeVariant = createMockVariant({
        id: 'active-var',
        asset_id: 'source-asset',
      });

      const { ctx, broadcasts } = createMockContext({
        getAssetById: mock.fn(async (id) => (id === 'source-asset' ? sourceAsset : null)),
        getVariantById: mock.fn(async () => activeVariant),
        updateAsset: mock.fn(async (id, changes) => createMockAsset({ id, ...changes })),
      });
      const controller = new AssetController(ctx);

      await controller.handleFork(
        {} as WebSocket,
        createEditorMeta(),
        'source-asset', // sourceAssetId
        undefined, // no sourceVariantId
        'Forked Asset',
        'character'
      );

      // Verify fork broadcast
      assert.ok(broadcasts.some((b) => b.type === 'asset:forked'));
    });

    test('throws when source asset not found', async () => {
      const { ctx } = createMockContext({
        getAssetById: mock.fn(async () => null),
      });
      const controller = new AssetController(ctx);

      await assert.rejects(
        controller.handleFork(
          {} as WebSocket,
          createEditorMeta(),
          'nonexistent',
          undefined,
          'Fork',
          'character'
        ),
        /not found/i
      );
    });

    test('throws when source asset has no active variant', async () => {
      const sourceAsset = createMockAsset({
        id: 'source-asset',
        active_variant_id: null,
      });

      const { ctx } = createMockContext({
        getAssetById: mock.fn(async () => sourceAsset),
      });
      const controller = new AssetController(ctx);

      await assert.rejects(
        controller.handleFork(
          {} as WebSocket,
          createEditorMeta(),
          'source-asset',
          undefined,
          'Fork',
          'character'
        ),
        /no active variant/i
      );
    });

    test('throws when neither sourceAssetId nor sourceVariantId provided', async () => {
      const { ctx } = createMockContext();
      const controller = new AssetController(ctx);

      await assert.rejects(
        controller.handleFork(
          {} as WebSocket,
          createEditorMeta(),
          undefined,
          undefined,
          'Fork',
          'character'
        ),
        /sourceAssetId or sourceVariantId/i
      );
    });

    test('throws when source variant not found', async () => {
      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => null),
      });
      const controller = new AssetController(ctx);

      await assert.rejects(
        controller.handleFork(
          {} as WebSocket,
          createEditorMeta(),
          undefined,
          'nonexistent-var',
          'Fork',
          'character'
        ),
        /not found/i
      );
    });

    test('requires editor permission', async () => {
      const { ctx } = createMockContext();
      const controller = new AssetController(ctx);

      await assert.rejects(
        controller.handleFork(
          {} as WebSocket,
          createViewerMeta(),
          undefined,
          'var-1',
          'Fork',
          'character'
        ),
        /viewer/i
      );
    });

    test('creates lineage record with forked relation', async () => {
      const sourceVariant = createMockVariant({
        id: 'source-var',
        asset_id: 'source-asset',
      });

      const { ctx, broadcasts } = createMockContext({
        getVariantById: mock.fn(async () => sourceVariant),
        updateAsset: mock.fn(async (id, changes) => createMockAsset({ id, ...changes })),
      });
      const controller = new AssetController(ctx);

      await controller.handleFork(
        {} as WebSocket,
        createEditorMeta(),
        undefined,
        'source-var',
        'Forked',
        'character'
      );

      // Verify lineage was created
      assert.strictEqual(asMock(ctx.repo.createLineage).mock.calls.length, 1);
      const lineageCall = asMock(ctx.repo.createLineage).mock.calls[0].arguments[0];
      assert.strictEqual(lineageCall.parentVariantId, 'source-var');
      assert.strictEqual(lineageCall.relationType, 'forked');
    });
  });

  // ==========================================================================
  // HTTP Handlers
  // ==========================================================================

  describe('httpCreate', () => {
    test('creates asset and returns it', async () => {
      const { ctx, broadcasts } = createMockContext();
      const controller = new AssetController(ctx);

      const result = await controller.httpCreate({
        name: 'HTTP Asset',
        type: 'environment',
        createdBy: 'user-1',
      });

      assert.strictEqual(result.name, 'HTTP Asset');
      assert.strictEqual(result.type, 'environment');
      assert.ok(broadcasts.some((b) => b.type === 'asset:created'));
    });

    test('creates asset with custom ID', async () => {
      const { ctx } = createMockContext();
      const controller = new AssetController(ctx);

      const result = await controller.httpCreate({
        id: 'custom-id',
        name: 'Custom ID Asset',
        type: 'character',
        createdBy: 'user-1',
      });

      const createCall = asMock(ctx.repo.createAsset).mock.calls[0].arguments[0];
      assert.strictEqual(createCall.id, 'custom-id');
    });

    test('creates asset with parent', async () => {
      const { ctx } = createMockContext();
      const controller = new AssetController(ctx);

      await controller.httpCreate({
        name: 'Child',
        type: 'prop',
        parentAssetId: 'parent-id',
        createdBy: 'user-1',
      });

      const createCall = asMock(ctx.repo.createAsset).mock.calls[0].arguments[0];
      assert.strictEqual(createCall.parentAssetId, 'parent-id');
    });
  });

  describe('httpGetDetails', () => {
    test('returns asset with variants and lineage', async () => {
      const asset = createMockAsset({ id: 'asset-1' });
      const variants = [
        createMockVariant({ id: 'var-1', asset_id: 'asset-1' }),
        createMockVariant({ id: 'var-2', asset_id: 'asset-1' }),
      ];
      const lineage = [createMockLineage({ parent_variant_id: 'var-1', child_variant_id: 'var-2' })];

      const { ctx } = createMockContext({
        getAssetById: mock.fn(async () => asset),
        getVariantsByAsset: mock.fn(async () => variants),
        getLineageForVariants: mock.fn(async () => lineage),
      });
      const controller = new AssetController(ctx);

      const result = await controller.httpGetDetails('asset-1');

      assert.strictEqual(result.asset.id, 'asset-1');
      assert.strictEqual(result.variants.length, 2);
      assert.strictEqual(result.lineage.length, 1);
    });

    test('throws when asset not found', async () => {
      const { ctx } = createMockContext({
        getAssetById: mock.fn(async () => null),
      });
      const controller = new AssetController(ctx);

      await assert.rejects(controller.httpGetDetails('nonexistent'), /not found/i);
    });
  });

  describe('httpGetChildren', () => {
    test('returns child assets', async () => {
      const children = [
        createMockAsset({ id: 'child-1', parent_asset_id: 'parent' }),
        createMockAsset({ id: 'child-2', parent_asset_id: 'parent' }),
      ];

      const { ctx } = createMockContext({
        getAssetsByParent: mock.fn(async () => children),
      });
      const controller = new AssetController(ctx);

      const result = await controller.httpGetChildren('parent');

      assert.strictEqual(result.length, 2);
      assert.ok(result.some((a) => a.id === 'child-1'));
      assert.ok(result.some((a) => a.id === 'child-2'));
    });

    test('returns empty array when no children', async () => {
      const { ctx } = createMockContext({
        getAssetsByParent: mock.fn(async () => []),
      });
      const controller = new AssetController(ctx);

      const result = await controller.httpGetChildren('leaf-asset');

      assert.strictEqual(result.length, 0);
    });
  });

  describe('httpGetAncestors', () => {
    test('returns ancestors in root-first order', async () => {
      // Hierarchy: root -> middle -> asset
      const rootAsset = createMockAsset({ id: 'root', parent_asset_id: null });
      const middleAsset = createMockAsset({ id: 'middle', parent_asset_id: 'root' });
      const leafAsset = createMockAsset({ id: 'leaf', parent_asset_id: 'middle' });

      const { ctx } = createMockContext({
        getAssetById: mock.fn(async (id: string) => {
          if (id === 'root') return rootAsset;
          if (id === 'middle') return middleAsset;
          if (id === 'leaf') return leafAsset;
          return null;
        }),
      });
      const controller = new AssetController(ctx);

      const result = await controller.httpGetAncestors('leaf');

      // Should return [root, middle] (not including leaf itself)
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].id, 'root');
      assert.strictEqual(result[1].id, 'middle');
    });

    test('returns empty array for root asset', async () => {
      const rootAsset = createMockAsset({ id: 'root', parent_asset_id: null });

      const { ctx } = createMockContext({
        getAssetById: mock.fn(async () => rootAsset),
      });
      const controller = new AssetController(ctx);

      const result = await controller.httpGetAncestors('root');

      assert.strictEqual(result.length, 0);
    });
  });

  describe('httpReparent', () => {
    test('reparents asset and broadcasts', async () => {
      const { ctx, broadcasts } = createMockContext({
        updateAsset: mock.fn(async (id, changes) =>
          createMockAsset({ id, parent_asset_id: changes.parent_asset_id })
        ),
      });
      const controller = new AssetController(ctx);

      const result = await controller.httpReparent('child', 'new-parent');

      assert.strictEqual(result.parent_asset_id, 'new-parent');
      assert.ok(broadcasts.some((b) => b.type === 'asset:updated'));
    });

    test('moves asset to root with null parent', async () => {
      const { ctx } = createMockContext({
        updateAsset: mock.fn(async (id, changes) =>
          createMockAsset({ id, parent_asset_id: changes.parent_asset_id })
        ),
      });
      const controller = new AssetController(ctx);

      const result = await controller.httpReparent('child', null);

      assert.strictEqual(result.parent_asset_id, null);
    });

    test('throws on circular reference', async () => {
      const { ctx } = createMockContext(
        {},
        {
          exec: mock.fn((query: string, id: string) => {
            // new-parent's parent is child, creating a cycle
            if (id === 'new-parent') return { toArray: () => [{ parent_asset_id: 'child' }] };
            return { toArray: () => [] };
          }),
        }
      );
      const controller = new AssetController(ctx);

      await assert.rejects(controller.httpReparent('child', 'new-parent'), /circular/i);
    });

    test('throws when asset not found', async () => {
      const { ctx } = createMockContext({
        updateAsset: mock.fn(async () => null),
      });
      const controller = new AssetController(ctx);

      await assert.rejects(controller.httpReparent('nonexistent', 'parent'), /not found/i);
    });
  });

  describe('httpFork', () => {
    test('forks asset via HTTP and returns result', async () => {
      const sourceVariant = createMockVariant({
        id: 'source-var',
        asset_id: 'source-asset',
      });

      const { ctx, broadcasts } = createMockContext({
        getVariantById: mock.fn(async () => sourceVariant),
        updateAsset: mock.fn(async (id, changes) => createMockAsset({ id, ...changes })),
      });
      const controller = new AssetController(ctx);

      const result = await controller.httpFork({
        sourceVariantId: 'source-var',
        name: 'HTTP Fork',
        type: 'character',
        createdBy: 'user-1',
      });

      assert.ok(result.asset);
      assert.ok(result.variant);
      assert.ok(result.lineage);
      assert.strictEqual(result.asset.name, 'HTTP Fork');
      assert.ok(broadcasts.some((b) => b.type === 'asset:forked'));
    });

    test('throws when source variant not found', async () => {
      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => null),
      });
      const controller = new AssetController(ctx);

      await assert.rejects(
        controller.httpFork({
          sourceVariantId: 'nonexistent',
          name: 'Fork',
          type: 'character',
          createdBy: 'user-1',
        }),
        /not found/i
      );
    });
  });

  describe('httpSetActive', () => {
    test('sets active variant via HTTP and returns asset', async () => {
      const { ctx, broadcasts } = createMockContext({
        updateAsset: mock.fn(async (id, changes) =>
          createMockAsset({ id, active_variant_id: changes.active_variant_id })
        ),
      });
      const controller = new AssetController(ctx);

      const result = await controller.httpSetActive('asset-1', 'variant-1');

      assert.strictEqual(result.active_variant_id, 'variant-1');
      assert.ok(broadcasts.some((b) => b.type === 'asset:updated'));
    });

    test('throws when asset not found', async () => {
      const { ctx } = createMockContext({
        updateAsset: mock.fn(async () => null),
      });
      const controller = new AssetController(ctx);

      await assert.rejects(controller.httpSetActive('nonexistent', 'var-1'), /not found/i);
    });
  });
});
