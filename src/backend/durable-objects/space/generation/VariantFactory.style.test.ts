import { describe, test, mock, type Mock } from 'node:test';
import assert from 'node:assert/strict';
import { VariantFactory, type GenerationRecipe } from './VariantFactory';
import type { SpaceRepository } from '../repository/SpaceRepository';
import type { BroadcastFn } from '../controllers/types';
import type { Env } from '../../../../core/types';
import type { WebSocketMeta, SpaceStyle } from '../types';

// Helper to get mock from a function
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockFn = Mock<(...args: any[]) => any>;
const asMock = (fn: unknown): MockFn => fn as MockFn;

// ============================================================================
// Mock Factories
// ============================================================================

function createMockStyle(overrides: Partial<SpaceStyle> = {}): SpaceStyle {
  return {
    id: 'style-1',
    name: 'Default Style',
    description: 'Pixel art, 16-bit, vibrant colors',
    image_keys: '["styles/space-1/ref1.png","styles/space-1/ref2.png"]',
    enabled: 1,
    created_by: 'user-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

function createMockRepo(): SpaceRepository {
  return {
    getAssetById: mock.fn(async () => null),
    getVariantById: mock.fn(async () => null),
    getVariantImageKey: mock.fn(async () => null),
    getActiveStyle: mock.fn(async () => null),
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

function createMockEnv(): Env {
  return {
    GENERATION_WORKFLOW: {
      create: mock.fn(async ({ id }) => ({ id })),
    },
  } as unknown as Env;
}

function createMockBroadcast(): BroadcastFn {
  return mock.fn(() => {});
}

function createMockMeta(): WebSocketMeta {
  return { userId: 'user-123', role: 'editor' };
}

// ============================================================================
// Style Injection Tests
// ============================================================================

describe('VariantFactory - Style Injection', () => {
  describe('no style', () => {
    test('recipe unchanged when no style exists', async () => {
      const repo = createMockRepo();
      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const meta = createMockMeta();

      const result = await factory.createAssetWithVariant(
        { name: 'Test', assetType: 'character', prompt: 'A warrior' },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.strictEqual(recipe.prompt, 'A warrior');
      assert.strictEqual(recipe.styleId, undefined);
      assert.strictEqual(result.styleImageKeys, undefined);
    });
  });

  describe('style with description only', () => {
    test('prompt prepended with style description', async () => {
      const repo = createMockRepo();
      asMock(repo.getActiveStyle).mock.mockImplementation(async () =>
        createMockStyle({ image_keys: '[]', description: 'Watercolor painting' })
      );

      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const meta = createMockMeta();

      const result = await factory.createAssetWithVariant(
        { name: 'Test', assetType: 'character', prompt: 'A warrior' },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.ok(recipe.prompt.startsWith('[Style: Watercolor painting]'));
      assert.ok(recipe.prompt.includes('A warrior'));
      assert.strictEqual(recipe.styleId, 'style-1');
      // No style images
      assert.strictEqual(result.styleImageKeys, undefined);
    });
  });

  describe('style with images', () => {
    test('sourceImageKeys prepended with style images', async () => {
      const repo = createMockRepo();
      asMock(repo.getActiveStyle).mock.mockImplementation(async () =>
        createMockStyle({
          description: 'Pixel art',
          image_keys: '["styles/space-1/ref1.png","styles/space-1/ref2.png"]',
        })
      );

      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const meta = createMockMeta();

      const result = await factory.createAssetWithVariant(
        { name: 'Test', assetType: 'character', prompt: 'A warrior' },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      // Style images should be in sourceImageKeys
      assert.ok(recipe.sourceImageKeys);
      assert.ok(recipe.sourceImageKeys!.includes('styles/space-1/ref1.png'));
      assert.ok(recipe.sourceImageKeys!.includes('styles/space-1/ref2.png'));
      // Style image keys returned separately
      assert.deepStrictEqual(result.styleImageKeys, [
        'styles/space-1/ref1.png',
        'styles/space-1/ref2.png',
      ]);
    });

    test('style images come before source images in combined keys', async () => {
      const repo = createMockRepo();
      asMock(repo.getActiveStyle).mock.mockImplementation(async () =>
        createMockStyle({ image_keys: '["styles/space-1/ref1.png"]' })
      );
      asMock(repo.getVariantImageKey).mock.mockImplementation(async () => 'images/user-ref.png');

      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const meta = createMockMeta();

      const result = await factory.createAssetWithVariant(
        {
          name: 'Test',
          assetType: 'character',
          prompt: 'A warrior',
          referenceVariantIds: ['var-1'],
        },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      // Style image first, then user reference
      assert.strictEqual(recipe.sourceImageKeys![0], 'styles/space-1/ref1.png');
      assert.strictEqual(recipe.sourceImageKeys![1], 'images/user-ref.png');
    });
  });

  describe('disableStyle', () => {
    test('recipe has styleOverride: true when style is disabled', async () => {
      const repo = createMockRepo();
      asMock(repo.getActiveStyle).mock.mockImplementation(async () =>
        createMockStyle({ description: 'Should not appear' })
      );

      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const meta = createMockMeta();

      const result = await factory.createAssetWithVariant(
        { name: 'Test', assetType: 'character', prompt: 'A warrior', disableStyle: true },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.strictEqual(recipe.styleOverride, true);
      // Prompt should NOT have style prepended
      assert.strictEqual(recipe.prompt, 'A warrior');
      assert.strictEqual(recipe.styleId, undefined);
      assert.strictEqual(result.styleImageKeys, undefined);
    });
  });

  describe('image count validation', () => {
    test('style images skipped when total exceeds 14', async () => {
      const repo = createMockRepo();
      // Style has 3 images
      asMock(repo.getActiveStyle).mock.mockImplementation(async () =>
        createMockStyle({
          description: 'Test style',
          image_keys: '["s1.png","s2.png","s3.png"]',
        })
      );
      // User provides 12 source images
      const variantKeys = Array.from({ length: 12 }, (_, i) => `images/ref-${i}.png`);
      const variantIds = Array.from({ length: 12 }, (_, i) => `var-${i}`);

      let callIndex = 0;
      asMock(repo.getVariantImageKey).mock.mockImplementation(async () => {
        return variantKeys[callIndex++] || null;
      });

      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const meta = createMockMeta();

      const result = await factory.createAssetWithVariant(
        {
          name: 'Test',
          assetType: 'character',
          prompt: 'A warrior',
          referenceVariantIds: variantIds,
        },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      // Style description still prepended
      assert.ok(recipe.prompt.startsWith('[Style: Test style]'));
      // Style images should be skipped (3 + 12 = 15 > 14)
      assert.strictEqual(result.styleImageKeys, undefined);
      // Only user reference images remain
      assert.strictEqual(recipe.sourceImageKeys!.length, 12);
    });
  });

  describe('style with disabled flag', () => {
    test('disabled style does not modify recipe', async () => {
      const repo = createMockRepo();
      asMock(repo.getActiveStyle).mock.mockImplementation(async () =>
        createMockStyle({ enabled: 0, description: 'Should not appear' })
      );

      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const meta = createMockMeta();

      const result = await factory.createAssetWithVariant(
        { name: 'Test', assetType: 'character', prompt: 'A warrior' },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.strictEqual(recipe.prompt, 'A warrior');
      assert.strictEqual(recipe.styleId, undefined);
    });
  });
});

// ============================================================================
// Batch Creation Tests
// ============================================================================

describe('VariantFactory - Batch Creation', () => {
  describe('explore mode', () => {
    test('creates 1 asset with N variants, all share batchId', async () => {
      const repo = createMockRepo();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, createMockEnv(), broadcast);
      const meta = createMockMeta();

      const { batchId, results } = await factory.createBatchVariants(
        {
          name: 'Explore Asset',
          assetType: 'character',
          prompt: 'A warrior',
          count: 4,
          mode: 'explore',
        },
        meta
      );

      assert.ok(batchId);
      assert.strictEqual(results.length, 4);

      // All results should share the same assetId
      const assetIds = new Set(results.map((r) => r.assetId));
      assert.strictEqual(assetIds.size, 1);

      // All variants should be different
      const variantIds = new Set(results.map((r) => r.variantId));
      assert.strictEqual(variantIds.size, 4);

      // Verify asset:created broadcast (only 1)
      const assetCreated = asMock(broadcast).mock.calls.filter(
        (c) => c.arguments[0].type === 'asset:created'
      );
      assert.strictEqual(assetCreated.length, 1);
    });
  });

  describe('set mode', () => {
    test('creates N assets with 1 variant each, all share batchId', async () => {
      const repo = createMockRepo();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, createMockEnv(), broadcast);
      const meta = createMockMeta();

      const { batchId, results } = await factory.createBatchVariants(
        {
          name: 'Set Asset',
          assetType: 'character',
          prompt: 'A warrior',
          count: 3,
          mode: 'set',
        },
        meta
      );

      assert.ok(batchId);
      assert.strictEqual(results.length, 3);

      // All results should have different assetIds
      const assetIds = new Set(results.map((r) => r.assetId));
      assert.strictEqual(assetIds.size, 3);

      // Verify asset:created broadcasts (3 - one per asset)
      const assetCreated = asMock(broadcast).mock.calls.filter(
        (c) => c.arguments[0].type === 'asset:created'
      );
      assert.strictEqual(assetCreated.length, 3);
    });
  });

  describe('batch with lineage', () => {
    test('lineage created for each variant in batch', async () => {
      const repo = createMockRepo();
      asMock(repo.getVariantImageKey).mock.mockImplementation(async () => 'images/ref.png');

      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, createMockEnv(), broadcast);
      const meta = createMockMeta();

      const { results } = await factory.createBatchVariants(
        {
          name: 'Batch Asset',
          assetType: 'character',
          prompt: 'A warrior',
          count: 3,
          mode: 'explore',
          referenceVariantIds: ['ref-var-1'],
        },
        meta
      );

      assert.strictEqual(results.length, 3);

      // Verify lineage was created for each variant
      const lineageCalls = asMock(repo.createLineage).mock.calls;
      assert.strictEqual(lineageCalls.length, 3);
    });
  });

  describe('batch with style', () => {
    test('style injected once and shared across all batch variants', async () => {
      const repo = createMockRepo();
      asMock(repo.getActiveStyle).mock.mockImplementation(async () =>
        createMockStyle({ description: 'Batch style' })
      );

      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, createMockEnv(), broadcast);
      const meta = createMockMeta();

      const { results } = await factory.createBatchVariants(
        {
          name: 'Styled Batch',
          assetType: 'character',
          prompt: 'A warrior',
          count: 3,
          mode: 'explore',
        },
        meta
      );

      // All variants should have style applied
      for (const result of results) {
        const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
        assert.ok(recipe.prompt.startsWith('[Style: Batch style]'));
        assert.strictEqual(recipe.styleId, 'style-1');
      }

      // getActiveStyle should only be called once (not per variant)
      assert.strictEqual(asMock(repo.getActiveStyle).mock.calls.length, 1);
    });
  });
});
