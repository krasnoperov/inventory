import { describe, test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { VariantFactory, determineOperation, type GenerationRecipe } from './VariantFactory';
import type { SpaceRepository } from '../repository/SpaceRepository';
import type { BroadcastFn } from '../controllers/types';
import type { Env } from '../../../../core/types';
import type { WebSocketMeta, Asset, Variant } from '../types';

// ============================================================================
// Mock Factories
// ============================================================================

function createMockRepo(): SpaceRepository {
  return {
    getAssetById: mock.fn(async () => null),
    getVariantById: mock.fn(async () => null),
    getVariantImageKey: mock.fn(async () => null),
    createAsset: mock.fn(async (input) => ({
      id: input.id,
      name: input.name,
      type: input.type,
      tags: '[]',
      parent_asset_id: input.parentAssetId || null,
      active_variant_id: null,
      created_by: input.createdBy,
      created_at: Date.now(),
      updated_at: Date.now(),
    })),
    createPlaceholderVariant: mock.fn(async (input) => ({
      id: input.id,
      asset_id: input.assetId,
      workflow_id: null,
      status: 'pending',
      error_message: null,
      image_key: null,
      thumb_key: null,
      recipe: input.recipe,
      starred: false,
      created_by: input.createdBy,
      created_at: Date.now(),
      updated_at: null,
      plan_step_id: input.planStepId || null,
    })),
    createLineage: mock.fn(async (input) => ({
      id: input.id,
      parent_variant_id: input.parentVariantId,
      child_variant_id: input.childVariantId,
      relation_type: input.relationType,
      severed: false,
      created_at: Date.now(),
    })),
    updateAsset: mock.fn(async () => ({})),
    updateVariantWorkflow: mock.fn(async (id, workflowId, status) => ({
      id,
      workflow_id: workflowId,
      status,
    })),
  } as unknown as SpaceRepository;
}

function createMockEnv(withWorkflow = true): Env {
  return {
    GENERATION_WORKFLOW: withWorkflow
      ? {
          create: mock.fn(async ({ id }) => ({ id })),
        }
      : undefined,
  } as unknown as Env;
}

function createMockBroadcast(): BroadcastFn {
  return mock.fn(() => {});
}

function createMockMeta(): WebSocketMeta {
  return {
    userId: 'user-123',
    role: 'editor',
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('VariantFactory', () => {
  describe('determineOperation', () => {
    test('returns "generate" when no references', () => {
      assert.strictEqual(determineOperation(false), 'generate');
    });

    test('returns "derive" when has references', () => {
      assert.strictEqual(determineOperation(true), 'derive');
    });
  });

  describe('resolveAssetReferences', () => {
    test('resolves asset IDs to image keys and variant IDs', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);

      // Setup mocks
      (repo.getAssetById as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async (id: string) => ({
          id,
          active_variant_id: `variant-${id}`,
        })
      );
      (repo.getVariantImageKey as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async (variantId: string) => `images/${variantId}.png`
      );

      const result = await factory.resolveAssetReferences(['asset-1', 'asset-2']);

      assert.deepStrictEqual(result.sourceImageKeys, [
        'images/variant-asset-1.png',
        'images/variant-asset-2.png',
      ]);
      assert.deepStrictEqual(result.parentVariantIds, ['variant-asset-1', 'variant-asset-2']);
    });

    test('skips assets without active variant', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);

      (repo.getAssetById as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async (id: string) => ({
          id,
          active_variant_id: id === 'asset-1' ? 'variant-1' : null,
        })
      );
      (repo.getVariantImageKey as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => 'images/test.png'
      );

      const result = await factory.resolveAssetReferences(['asset-1', 'asset-2']);

      assert.strictEqual(result.sourceImageKeys.length, 1);
      assert.strictEqual(result.parentVariantIds.length, 1);
    });
  });

  describe('resolveVariantReferences', () => {
    test('resolves variant IDs to image keys', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);

      (repo.getVariantImageKey as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async (variantId: string) => `images/${variantId}.png`
      );

      const result = await factory.resolveVariantReferences(['var-1', 'var-2']);

      assert.deepStrictEqual(result.sourceImageKeys, ['images/var-1.png', 'images/var-2.png']);
      assert.deepStrictEqual(result.parentVariantIds, ['var-1', 'var-2']);
    });

    test('skips variants without image key', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);

      (repo.getVariantImageKey as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async (variantId: string) => (variantId === 'var-1' ? 'images/var-1.png' : null)
      );

      const result = await factory.resolveVariantReferences(['var-1', 'var-2']);

      assert.strictEqual(result.sourceImageKeys.length, 1);
      assert.strictEqual(result.parentVariantIds.length, 1);
    });
  });

  describe('createAssetWithVariant', () => {
    test('creates asset and placeholder variant', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      const result = await factory.createAssetWithVariant(
        {
          name: 'Test Asset',
          assetType: 'character',
          prompt: 'Create a test character',
        },
        meta
      );

      // Verify asset created
      assert.ok(result.assetId);
      assert.strictEqual(result.asset.name, 'Test Asset');
      assert.strictEqual(result.asset.type, 'character');

      // Verify variant created
      assert.ok(result.variantId);
      assert.strictEqual(result.variant.status, 'pending');

      // Verify broadcasts
      const broadcastCalls = (broadcast as ReturnType<typeof mock.fn>).mock.calls;
      assert.ok(broadcastCalls.some((c) => c.arguments[0].type === 'asset:created'));
      assert.ok(broadcastCalls.some((c) => c.arguments[0].type === 'variant:created'));
      assert.ok(broadcastCalls.some((c) => c.arguments[0].type === 'asset:updated'));
    });

    test('creates lineage when references provided', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      // Setup reference resolution
      (repo.getVariantImageKey as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => 'images/ref.png'
      );

      const result = await factory.createAssetWithVariant(
        {
          name: 'Derived Asset',
          assetType: 'character',
          referenceVariantIds: ['ref-var-1'],
        },
        meta
      );

      // Verify lineage created
      assert.ok((repo.createLineage as ReturnType<typeof mock.fn>).mock.calls.length > 0);

      // Verify broadcasts include lineage
      const broadcastCalls = (broadcast as ReturnType<typeof mock.fn>).mock.calls;
      assert.ok(broadcastCalls.some((c) => c.arguments[0].type === 'lineage:created'));
    });

    test('auto-sets parentAssetId from first reference', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      // Setup: variant reference resolves to an asset
      (repo.getVariantById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        id: 'ref-var-1',
        asset_id: 'parent-asset-1',
      }));
      (repo.getVariantImageKey as ReturnType<typeof mock.fn>).mock.mockImplementation(
        async () => 'images/ref.png'
      );

      await factory.createAssetWithVariant(
        {
          name: 'Child Asset',
          assetType: 'character',
          referenceVariantIds: ['ref-var-1'],
        },
        meta
      );

      // Verify createAsset was called with parentAssetId
      const createAssetCall = (repo.createAsset as ReturnType<typeof mock.fn>).mock.calls[0];
      assert.strictEqual(createAssetCall.arguments[0].parentAssetId, 'parent-asset-1');
    });
  });

  describe('createRefineVariant', () => {
    test('creates refine variant for existing asset', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      // Setup existing asset
      (repo.getAssetById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        id: 'asset-1',
        name: 'Existing Asset',
        type: 'character',
        active_variant_id: 'existing-var',
      }));
      (repo.getVariantById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        id: 'existing-var',
        image_key: 'images/existing.png',
      }));

      const result = await factory.createRefineVariant(
        {
          assetId: 'asset-1',
          prompt: 'Refine this character',
        },
        meta
      );

      // Verify variant created with refine operation
      assert.ok(result.variantId);
      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.strictEqual(recipe.operation, 'refine');
      assert.deepStrictEqual(recipe.sourceImageKeys, ['images/existing.png']);
    });

    test('throws when asset not found', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      await assert.rejects(
        factory.createRefineVariant(
          {
            assetId: 'nonexistent',
            prompt: 'Refine',
          },
          meta
        ),
        /not found/
      );
    });

    test('throws when no source images available', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      // Asset exists but has no active variant with image
      (repo.getAssetById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => ({
        id: 'asset-1',
        active_variant_id: null,
      }));

      await assert.rejects(
        factory.createRefineVariant(
          {
            assetId: 'asset-1',
            prompt: 'Refine',
          },
          meta
        ),
        /No source images/
      );
    });
  });

  describe('triggerWorkflow', () => {
    test('triggers workflow and updates variant', async () => {
      const repo = createMockRepo();
      const env = createMockEnv(true);
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      const result = {
        asset: { id: 'asset-1', name: 'Test', type: 'character' } as Asset,
        variant: {
          id: 'var-1',
          recipe: JSON.stringify({ prompt: 'Test', assetType: 'character', operation: 'generate' }),
        } as Variant,
        variantId: 'var-1',
        assetId: 'asset-1',
        parentVariantIds: [],
        sourceImageKeys: [],
      };

      const workflowId = await factory.triggerWorkflow('req-1', 'var-1', result, meta, 'generate');

      assert.ok(workflowId);
      assert.ok((env.GENERATION_WORKFLOW!.create as ReturnType<typeof mock.fn>).mock.calls.length > 0);
      assert.ok((repo.updateVariantWorkflow as ReturnType<typeof mock.fn>).mock.calls.length > 0);
    });

    test('returns null when workflow not configured', async () => {
      const repo = createMockRepo();
      const env = createMockEnv(false);
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      const result = {
        asset: { id: 'asset-1', name: 'Test', type: 'character' } as Asset,
        variant: {
          id: 'var-1',
          recipe: JSON.stringify({ prompt: 'Test', assetType: 'character', operation: 'generate' }),
        } as Variant,
        variantId: 'var-1',
        assetId: 'asset-1',
        parentVariantIds: [],
        sourceImageKeys: [],
      };

      const workflowId = await factory.triggerWorkflow('req-1', 'var-1', result, meta, 'generate');

      assert.strictEqual(workflowId, null);
    });
  });
});
