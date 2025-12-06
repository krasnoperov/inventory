// @ts-nocheck - Test file with dynamic mocks
import { describe, test, mock, type Mock } from 'node:test';
import assert from 'node:assert/strict';
import { VariantController } from './VariantController';
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
    getVariantById: mock.fn(async () => null),
    getVariantByWorkflowId: mock.fn(async () => null),
    getVariantsByAsset: mock.fn(async () => []),
    updateAsset: mock.fn(async (id, changes) => createMockAsset({ id, ...changes })),
    updateVariantStarred: mock.fn(async (id, starred) =>
      createMockVariant({ id, starred })
    ),
    createAsset: mock.fn(async (input) =>
      createMockAsset({ id: input.id, name: input.name, type: input.type })
    ),
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

function createEditorMeta(): WebSocketMeta {
  return { userId: 'user-1', role: 'editor' };
}

function createViewerMeta(): WebSocketMeta {
  return { userId: 'user-1', role: 'viewer' };
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

  // ==========================================================================
  // handleStar
  // ==========================================================================

  describe('handleStar', () => {
    test('stars variant and broadcasts update', async () => {
      const variant = createMockVariant({ id: 'var-1', starred: false });

      const { ctx, broadcasts } = createMockContext({
        updateVariantStarred: mock.fn(async (id, starred) =>
          createMockVariant({ id, starred })
        ),
      });
      const controller = new VariantController(ctx);

      await controller.handleStar({} as WebSocket, createEditorMeta(), 'var-1', true);

      // Verify updateVariantStarred was called
      assert.strictEqual(asMock(ctx.repo.updateVariantStarred).mock.calls.length, 1);
      const starCall = asMock(ctx.repo.updateVariantStarred).mock.calls[0];
      assert.strictEqual(starCall.arguments[0], 'var-1');
      assert.strictEqual(starCall.arguments[1], true);

      // Verify broadcast
      const updateBroadcast = broadcasts.find((b) => b.type === 'variant:updated');
      assert.ok(updateBroadcast);
      assert.strictEqual((updateBroadcast as { variant: Variant }).variant.starred, true);
    });

    test('unstars variant', async () => {
      const { ctx, broadcasts } = createMockContext({
        updateVariantStarred: mock.fn(async (id, starred) =>
          createMockVariant({ id, starred })
        ),
      });
      const controller = new VariantController(ctx);

      await controller.handleStar({} as WebSocket, createEditorMeta(), 'var-1', false);

      const starCall = asMock(ctx.repo.updateVariantStarred).mock.calls[0];
      assert.strictEqual(starCall.arguments[1], false);
    });

    test('throws when variant not found', async () => {
      const { ctx } = createMockContext({
        updateVariantStarred: mock.fn(async () => null),
      });
      const controller = new VariantController(ctx);

      await assert.rejects(
        controller.handleStar({} as WebSocket, createEditorMeta(), 'nonexistent', true),
        /not found/i
      );
    });

    test('requires editor permission', async () => {
      const { ctx } = createMockContext();
      const controller = new VariantController(ctx);

      await assert.rejects(
        controller.handleStar({} as WebSocket, createViewerMeta(), 'var-1', true),
        /viewer/i
      );
    });

    test('allows owner to star', async () => {
      const { ctx, broadcasts } = createMockContext({
        updateVariantStarred: mock.fn(async (id, starred) =>
          createMockVariant({ id, starred })
        ),
      });
      const controller = new VariantController(ctx);

      await controller.handleStar({} as WebSocket, createOwnerMeta(), 'var-1', true);

      assert.ok(broadcasts.some((b) => b.type === 'variant:updated'));
    });
  });

  // ==========================================================================
  // HTTP Handlers
  // ==========================================================================

  describe('httpApplyVariant', () => {
    test('creates new variant from workflow job', async () => {
      const { ctx, broadcasts } = createMockContext({
        getVariantByWorkflowId: mock.fn(async () => null), // Not existing
      });
      const controller = new VariantController(ctx);

      const result = await controller.httpApplyVariant({
        jobId: 'job-123',
        variantId: 'var-new',
        assetId: 'asset-1',
        imageKey: 'images/new.png',
        thumbKey: 'thumbs/new.png',
        recipe: '{"prompt":"test"}',
        createdBy: 'user-1',
      });

      assert.strictEqual(result.created, true);
      assert.strictEqual(result.variant.id, 'var-new');
      assert.strictEqual(result.variant.status, 'completed');

      // Verify variant:created broadcast
      assert.ok(broadcasts.some((b) => b.type === 'variant:created'));
    });

    test('is idempotent - returns existing variant', async () => {
      const existingVariant = createMockVariant({ id: 'existing-var', workflow_id: 'job-123' });

      const { ctx, broadcasts } = createMockContext({
        getVariantByWorkflowId: mock.fn(async () => existingVariant),
      });
      const controller = new VariantController(ctx);

      const result = await controller.httpApplyVariant({
        jobId: 'job-123',
        variantId: 'var-new', // Different ID, same job
        assetId: 'asset-1',
        imageKey: 'images/new.png',
        thumbKey: 'thumbs/new.png',
        recipe: '{}',
        createdBy: 'user-1',
      });

      assert.strictEqual(result.created, false);
      assert.strictEqual(result.variant.id, 'existing-var');

      // Should NOT broadcast (idempotent return)
      assert.strictEqual(broadcasts.filter((b) => b.type === 'variant:created').length, 0);
    });

    test('creates lineage records when parent variants specified', async () => {
      const { ctx, broadcasts } = createMockContext({
        getVariantByWorkflowId: mock.fn(async () => null),
      });
      const controller = new VariantController(ctx);

      await controller.httpApplyVariant({
        jobId: 'job-123',
        variantId: 'var-new',
        assetId: 'asset-1',
        imageKey: 'images/new.png',
        thumbKey: 'thumbs/new.png',
        recipe: '{}',
        createdBy: 'user-1',
        parentVariantIds: ['parent-var-1', 'parent-var-2'],
        relationType: 'derived',
      });

      // Verify lineage created for each parent
      assert.strictEqual(asMock(ctx.repo.createLineage).mock.calls.length, 2);

      // Verify lineage:created broadcasts
      const lineageBroadcasts = broadcasts.filter((b) => b.type === 'lineage:created');
      assert.strictEqual(lineageBroadcasts.length, 2);
    });

    test('sets as active variant if asset has none', async () => {
      const sqlExec = mock.fn((query: string) => {
        if (query.includes('SELECT active_variant_id')) {
          return { toArray: () => [{ active_variant_id: null }] };
        }
        return { toArray: () => [{ ref_count: 1 }] };
      });

      const { ctx, broadcasts } = createMockContext(
        {
          getVariantByWorkflowId: mock.fn(async () => null),
          updateAsset: mock.fn(async (id, changes) => createMockAsset({ id, ...changes })),
        },
        { exec: sqlExec }
      );
      const controller = new VariantController(ctx);

      await controller.httpApplyVariant({
        jobId: 'job-123',
        variantId: 'var-new',
        assetId: 'asset-1',
        imageKey: 'images/new.png',
        thumbKey: 'thumbs/new.png',
        recipe: '{}',
        createdBy: 'user-1',
      });

      // Should update asset to set active variant
      assert.strictEqual(asMock(ctx.repo.updateAsset).mock.calls.length, 1);
      const updateCall = asMock(ctx.repo.updateAsset).mock.calls[0];
      assert.strictEqual(updateCall.arguments[1].active_variant_id, 'var-new');
    });

    test('increments image refs', async () => {
      const sqlExec = mock.fn((query: string) => {
        return { toArray: () => [{ ref_count: 1 }] };
      });

      const { ctx } = createMockContext(
        { getVariantByWorkflowId: mock.fn(async () => null) },
        { exec: sqlExec }
      );
      const controller = new VariantController(ctx);

      await controller.httpApplyVariant({
        jobId: 'job-123',
        variantId: 'var-new',
        assetId: 'asset-1',
        imageKey: 'images/new.png',
        thumbKey: 'thumbs/new.png',
        recipe: '{}',
        createdBy: 'user-1',
      });

      // Should have INSERT calls for image refs
      const insertCalls = sqlExec.mock.calls.filter((c) =>
        String(c.arguments[0]).includes('INSERT INTO image_refs')
      );
      assert.ok(insertCalls.length >= 2); // image_key and thumb_key
    });
  });

  describe('httpStar', () => {
    test('stars variant via HTTP and returns it', async () => {
      const { ctx, broadcasts } = createMockContext({
        updateVariantStarred: mock.fn(async (id, starred) =>
          createMockVariant({ id, starred })
        ),
      });
      const controller = new VariantController(ctx);

      const result = await controller.httpStar('var-1', true);

      assert.strictEqual(result.starred, true);
      assert.ok(broadcasts.some((b) => b.type === 'variant:updated'));
    });

    test('throws when variant not found', async () => {
      const { ctx } = createMockContext({
        updateVariantStarred: mock.fn(async () => null),
      });
      const controller = new VariantController(ctx);

      await assert.rejects(controller.httpStar('nonexistent', true), /not found/i);
    });
  });

  describe('httpCreateUploadPlaceholder', () => {
    test('creates placeholder for existing asset', async () => {
      const existingAsset = createMockAsset({ id: 'asset-1' });

      const { ctx, broadcasts } = createMockContext({
        getAssetById: mock.fn(async () => existingAsset),
      });
      const controller = new VariantController(ctx);

      const result = await controller.httpCreateUploadPlaceholder({
        variantId: 'upload-var',
        assetId: 'asset-1',
        recipe: '{"type":"upload"}',
        createdBy: 'user-1',
      });

      assert.strictEqual(result.variant.id, 'upload-var');
      assert.strictEqual(result.variant.status, 'uploading');
      assert.strictEqual(result.variant.asset_id, 'asset-1');
      assert.strictEqual(result.assetId, 'asset-1');
      assert.strictEqual(result.asset, undefined); // No new asset created

      // Verify variant:created broadcast
      assert.ok(broadcasts.some((b) => b.type === 'variant:created'));
    });

    test('creates new asset when assetName provided', async () => {
      const { ctx, broadcasts } = createMockContext();
      const controller = new VariantController(ctx);

      const result = await controller.httpCreateUploadPlaceholder({
        variantId: 'upload-var',
        assetName: 'New Upload Asset',
        assetType: 'character',
        recipe: '{"type":"upload"}',
        createdBy: 'user-1',
      });

      assert.ok(result.asset); // New asset should be returned
      assert.strictEqual(result.asset?.name, 'New Upload Asset');
      assert.strictEqual(result.variant.status, 'uploading');

      // Verify both asset:created and variant:created broadcasts
      assert.ok(broadcasts.some((b) => b.type === 'asset:created'));
      assert.ok(broadcasts.some((b) => b.type === 'variant:created'));
    });

    test('creates new asset with parent', async () => {
      const { ctx } = createMockContext();
      const controller = new VariantController(ctx);

      const result = await controller.httpCreateUploadPlaceholder({
        variantId: 'upload-var',
        assetName: 'Child Asset',
        assetType: 'prop',
        parentAssetId: 'parent-asset',
        recipe: '{}',
        createdBy: 'user-1',
      });

      // Verify createAsset was called with parentAssetId
      const createCall = asMock(ctx.repo.createAsset).mock.calls[0].arguments[0];
      assert.strictEqual(createCall.parentAssetId, 'parent-asset');
    });

    test('throws when asset not found', async () => {
      const { ctx } = createMockContext({
        getAssetById: mock.fn(async () => null),
      });
      const controller = new VariantController(ctx);

      await assert.rejects(
        controller.httpCreateUploadPlaceholder({
          variantId: 'upload-var',
          assetId: 'nonexistent',
          recipe: '{}',
          createdBy: 'user-1',
        }),
        /not found/i
      );
    });

    test('throws when neither assetId nor assetName provided', async () => {
      const { ctx } = createMockContext();
      const controller = new VariantController(ctx);

      await assert.rejects(
        controller.httpCreateUploadPlaceholder({
          variantId: 'upload-var',
          recipe: '{}',
          createdBy: 'user-1',
        }),
        /assetId or assetName/i
      );
    });

    test('defaults assetType to character', async () => {
      const { ctx } = createMockContext();
      const controller = new VariantController(ctx);

      await controller.httpCreateUploadPlaceholder({
        variantId: 'upload-var',
        assetName: 'New Asset',
        // No assetType specified
        recipe: '{}',
        createdBy: 'user-1',
      });

      const createCall = asMock(ctx.repo.createAsset).mock.calls[0].arguments[0];
      assert.strictEqual(createCall.type, 'character');
    });
  });

  describe('httpCompleteUpload', () => {
    test('completes uploading variant with image keys', async () => {
      const uploadingVariant = createMockVariant({
        id: 'upload-var',
        status: 'uploading',
        image_key: null,
        thumb_key: null,
      });
      const asset = createMockAsset({ id: 'asset-1', active_variant_id: 'other-var' });

      const { ctx, broadcasts } = createMockContext({
        getVariantById: mock.fn(async () => uploadingVariant),
        getAssetById: mock.fn(async () => asset),
      });
      const controller = new VariantController(ctx);

      const result = await controller.httpCompleteUpload({
        variantId: 'upload-var',
        imageKey: 'images/uploaded.png',
        thumbKey: 'thumbs/uploaded.png',
      });

      assert.strictEqual(result.variant.status, 'completed');
      assert.strictEqual(result.variant.image_key, 'images/uploaded.png');
      assert.strictEqual(result.variant.thumb_key, 'thumbs/uploaded.png');

      // Verify variant:updated broadcast
      assert.ok(broadcasts.some((b) => b.type === 'variant:updated'));
    });

    test('sets as active if asset has no active variant', async () => {
      const uploadingVariant = createMockVariant({
        id: 'upload-var',
        asset_id: 'asset-1',
        status: 'uploading',
      });
      const asset = createMockAsset({ id: 'asset-1', active_variant_id: null });

      const { ctx, broadcasts } = createMockContext({
        getVariantById: mock.fn(async () => uploadingVariant),
        getAssetById: mock.fn(async () => asset),
        updateAsset: mock.fn(async (id, changes) => createMockAsset({ id, ...changes })),
      });
      const controller = new VariantController(ctx);

      await controller.httpCompleteUpload({
        variantId: 'upload-var',
        imageKey: 'images/uploaded.png',
        thumbKey: 'thumbs/uploaded.png',
      });

      // Should set as active variant
      assert.strictEqual(asMock(ctx.repo.updateAsset).mock.calls.length, 1);
      const updateCall = asMock(ctx.repo.updateAsset).mock.calls[0];
      assert.strictEqual(updateCall.arguments[1].active_variant_id, 'upload-var');

      // Verify asset:updated broadcast
      assert.ok(broadcasts.some((b) => b.type === 'asset:updated'));
    });

    test('throws when variant not found', async () => {
      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => null),
      });
      const controller = new VariantController(ctx);

      await assert.rejects(
        controller.httpCompleteUpload({
          variantId: 'nonexistent',
          imageKey: 'images/test.png',
          thumbKey: 'thumbs/test.png',
        }),
        /not found/i
      );
    });

    test('throws when variant is not in uploading status', async () => {
      const completedVariant = createMockVariant({
        id: 'completed-var',
        status: 'completed',
      });

      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => completedVariant),
      });
      const controller = new VariantController(ctx);

      await assert.rejects(
        controller.httpCompleteUpload({
          variantId: 'completed-var',
          imageKey: 'images/test.png',
          thumbKey: 'thumbs/test.png',
        }),
        /not uploading/i
      );
    });

    test('increments image refs', async () => {
      const uploadingVariant = createMockVariant({
        id: 'upload-var',
        status: 'uploading',
      });
      const asset = createMockAsset({ id: 'asset-1' });

      const sqlExec = mock.fn(() => ({ toArray: () => [{ ref_count: 1 }] }));
      const { ctx } = createMockContext(
        {
          getVariantById: mock.fn(async () => uploadingVariant),
          getAssetById: mock.fn(async () => asset),
        },
        { exec: sqlExec }
      );
      const controller = new VariantController(ctx);

      await controller.httpCompleteUpload({
        variantId: 'upload-var',
        imageKey: 'images/uploaded.png',
        thumbKey: 'thumbs/uploaded.png',
      });

      // Should have INSERT calls for both image keys
      const insertCalls = sqlExec.mock.calls.filter((c) =>
        String(c.arguments[0]).includes('INSERT INTO image_refs')
      );
      assert.strictEqual(insertCalls.length, 2);
    });
  });

  describe('httpFailUpload', () => {
    test('marks uploading variant as failed', async () => {
      const uploadingVariant = createMockVariant({
        id: 'upload-var',
        status: 'uploading',
      });

      const { ctx, broadcasts } = createMockContext({
        getVariantById: mock.fn(async () => uploadingVariant),
      });
      const controller = new VariantController(ctx);

      const result = await controller.httpFailUpload({
        variantId: 'upload-var',
        error: 'Upload failed: network error',
      });

      assert.strictEqual(result.variant.status, 'failed');
      assert.strictEqual(result.variant.error_message, 'Upload failed: network error');

      // Verify variant:updated broadcast
      const updateBroadcast = broadcasts.find((b) => b.type === 'variant:updated');
      assert.ok(updateBroadcast);
      assert.strictEqual((updateBroadcast as { variant: Variant }).variant.status, 'failed');
    });

    test('throws when variant not found', async () => {
      const { ctx } = createMockContext({
        getVariantById: mock.fn(async () => null),
      });
      const controller = new VariantController(ctx);

      await assert.rejects(
        controller.httpFailUpload({
          variantId: 'nonexistent',
          error: 'Test error',
        }),
        /not found/i
      );
    });

    test('can fail any variant status (not just uploading)', async () => {
      // This tests current behavior - httpFailUpload doesn't check status
      const pendingVariant = createMockVariant({
        id: 'pending-var',
        status: 'pending',
      });

      const { ctx, broadcasts } = createMockContext({
        getVariantById: mock.fn(async () => pendingVariant),
      });
      const controller = new VariantController(ctx);

      const result = await controller.httpFailUpload({
        variantId: 'pending-var',
        error: 'Job cancelled',
      });

      assert.strictEqual(result.variant.status, 'failed');
    });
  });
});
