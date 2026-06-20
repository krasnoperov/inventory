import { describe, test, mock, type Mock } from 'node:test';
import assert from 'node:assert/strict';
import { VariantFactory, type GenerationRecipe } from './VariantFactory';
import type { SpaceRepository } from '../repository/SpaceRepository';
import type { BroadcastFn } from '../controllers/types';
import type { Env } from '../../../../core/types';
import type { WebSocketMeta, SpaceStyle } from '../types';

// Helper to get mock from a function
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

function setupDefaultStylePreset(
  repo: SpaceRepository,
  options: {
    prompt: string;
    variantIds?: string[];
    imageKeys?: string[];
    presetId?: string;
    collectionId?: string;
  }
): void {
  const presetId = options.presetId ?? 'preset-default';
  const collectionId = options.collectionId ?? 'collection-style';
  const variantIds = options.variantIds ?? [];
  const imageKeys = options.imageKeys ?? variantIds.map((variantId) => `images/${variantId}.png`);
  asMock(repo.getDefaultStylePreset).mock.mockImplementation(async () => ({
    id: presetId,
    name: 'House Style',
    style_prompt: options.prompt,
    collection_id: collectionId,
    enabled: 1,
    is_default: 1,
    created_by: 'user-1',
    created_at: Date.now(),
    updated_at: Date.now(),
  }));
  asMock(repo.resolveStylePresetReferences).mock.mockImplementation(async () => ({
    preset: {
      id: presetId,
      name: 'House Style',
      style_prompt: options.prompt,
      collection_id: collectionId,
      enabled: 1,
      is_default: 1,
      created_by: 'user-1',
      created_at: Date.now(),
      updated_at: Date.now(),
    },
    stylePresetId: presetId,
    styleCollectionId: collectionId,
    stylePrompt: options.prompt,
    styleReferenceVariantIds: variantIds,
    styleReferenceImageKeys: imageKeys,
  }));
  asMock(repo.getVariantById).mock.mockImplementation(async (variantId: string) => {
    const index = variantIds.indexOf(variantId);
    if (index === -1) return null;
    return { id: variantId, image_key: imageKeys[index] };
  });
}

function createMockRepo(): SpaceRepository {
  return {
    getAssetById: mock.fn(async () => null),
    getVariantById: mock.fn(async () => null),
    getVariantImageKey: mock.fn(async () => null),
    getActiveStyle: mock.fn(async () => null),
    getDefaultStylePreset: mock.fn(async () => null),
    resolveStylePresetReferences: mock.fn(async () => null),
    createRelation: mock.fn(async (input) => ({
      id: input.id,
      subject_type: input.subject.subjectType,
      subject_asset_id: input.subject.assetId ?? null,
      subject_variant_id: input.subject.variantId ?? null,
      object_type: input.object.subjectType,
      object_asset_id: input.object.assetId ?? null,
      object_variant_id: input.object.variantId ?? null,
      relation_type: input.relationType,
      context: input.context ?? null,
      sort_index: input.sortIndex ?? 0,
      created_by: input.createdBy,
      created_at: Date.now(),
      updated_at: Date.now(),
    })),
    createAsset: mock.fn(async (input) => ({
      id: input.id,
      name: input.name,
      type: input.type,
      media_kind: input.mediaKind ?? 'image',
      tags: '[]',
      parent_asset_id: null,
      active_variant_id: null,
      created_by: input.createdBy,
      created_at: Date.now(),
      updated_at: Date.now(),
    })),
    createPlaceholderVariant: mock.fn(async (input) => ({
      id: input.id,
      asset_id: input.assetId,
      media_kind: input.mediaKind ?? 'image',
      workflow_id: null,
      status: 'pending',
      error_message: null,
      image_key: null,
      thumb_key: null,
      media_key: null,
      media_mime_type: null,
      media_size_bytes: null,
      media_width: null,
      media_height: null,
      media_duration_ms: null,
      transcript_key: null,
      transcript_mime_type: null,
      transcript_size_bytes: null,
      word_timings_key: null,
      word_timings_mime_type: null,
      word_timings_size_bytes: null,
      render_metadata_key: null,
      render_metadata_mime_type: null,
      render_metadata_size_bytes: null,
      generation_provenance: input.recipe,
      provider_metadata: null,
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

    test('video generation caps user references to Veo limit without active style', async () => {
      const repo = createMockRepo();
      const variantIds = ['var-1', 'var-2', 'var-3', 'var-4'];
      asMock(repo.getVariantImageKey).mock.mockImplementation(
        async (variantId: string) => `images/${variantId}.png`
      );
      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const meta = createMockMeta();

      const result = await factory.createAssetWithVariant(
        {
          name: 'Video Test',
          assetType: 'animation',
          mediaKind: 'video',
          prompt: 'A slow camera orbit',
          referenceVariantIds: variantIds,
        },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.deepStrictEqual(recipe.sourceImageKeys, [
        'images/var-1.png',
        'images/var-2.png',
        'images/var-3.png',
      ]);
      assert.deepStrictEqual(result.sourceImageKeys, recipe.sourceImageKeys);
      assert.strictEqual(result.styleImageKeys, undefined);
    });

    test('video refine caps ForgeTray references to Veo limit without active style', async () => {
      const repo = createMockRepo();
      asMock(repo.getAssetById).mock.mockImplementation(async () => ({
        id: 'asset-video',
        name: 'Video Asset',
        type: 'animation',
        media_kind: 'video',
        tags: '[]',
        parent_asset_id: null,
        active_variant_id: 'var-1',
        created_by: 'user-123',
        created_at: Date.now(),
        updated_at: Date.now(),
      }));
      asMock(repo.getVariantImageKey).mock.mockImplementation(
        async (variantId: string) => `images/${variantId}.png`
      );
      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const meta = createMockMeta();

      const result = await factory.createRefineVariant(
        {
          assetId: 'asset-video',
          mediaKind: 'video',
          prompt: 'Animate this set',
          sourceVariantIds: ['var-1', 'var-2', 'var-3', 'var-4'],
        },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.deepStrictEqual(recipe.sourceImageKeys, [
        'images/var-1.png',
        'images/var-2.png',
        'images/var-3.png',
      ]);
      assert.deepStrictEqual(result.sourceImageKeys, recipe.sourceImageKeys);
      assert.strictEqual(result.styleImageKeys, undefined);
    });
  });

  describe('style with description only', () => {
    test('prompt prepended with style description', async () => {
      const repo = createMockRepo();
      setupDefaultStylePreset(repo, { prompt: 'Watercolor painting' });

      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const meta = createMockMeta();

      const result = await factory.createAssetWithVariant(
        { name: 'Test', assetType: 'character', prompt: 'A warrior' },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.ok(recipe.prompt.startsWith('[Style: Watercolor painting]'));
      assert.ok(recipe.prompt.includes('A warrior'));
      assert.strictEqual(recipe.stylePresetId, 'preset-default');
      assert.strictEqual(recipe.styleId, undefined);
      // No style images
      assert.strictEqual(result.styleImageKeys, undefined);
    });
  });

  describe('style with images', () => {
    test('default style preset resolves exact variants and records provenance', async () => {
      const repo = createMockRepo();
      asMock(repo.getDefaultStylePreset).mock.mockImplementation(async () => ({
        id: 'preset-default',
        name: 'House Style',
        style_prompt: 'Painterly adventure game',
        collection_id: 'collection-style',
        enabled: 1,
        is_default: 1,
        created_by: 'user-1',
        created_at: Date.now(),
        updated_at: Date.now(),
      }));
      asMock(repo.resolveStylePresetReferences).mock.mockImplementation(async () => ({
        preset: {
          id: 'preset-default',
          name: 'House Style',
          style_prompt: 'Painterly adventure game',
          collection_id: 'collection-style',
          enabled: 1,
          is_default: 1,
          created_by: 'user-1',
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        stylePresetId: 'preset-default',
        styleCollectionId: 'collection-style',
        stylePrompt: 'Painterly adventure game',
        styleReferenceVariantIds: ['style-v1', 'style-v2'],
        styleReferenceImageKeys: ['images/style-v1.png', 'images/style-v2.png'],
      }));
      asMock(repo.getVariantById).mock.mockImplementation(async (variantId: string) => ({
        id: variantId,
        image_key: `images/${variantId}.png`,
      }));

      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const meta = createMockMeta();

      const result = await factory.createAssetWithVariant(
        { name: 'Test', assetType: 'character', prompt: 'A warrior' },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.ok(recipe.prompt.startsWith('[Style: Painterly adventure game]'));
      assert.strictEqual(recipe.stylePresetId, 'preset-default');
      assert.strictEqual(recipe.styleCollectionId, 'collection-style');
      assert.strictEqual(recipe.stylePrompt, 'Painterly adventure game');
      assert.deepStrictEqual(recipe.styleReferenceVariantIds, ['style-v1', 'style-v2']);
      assert.deepStrictEqual(recipe.styleReferenceImageKeys, ['images/style-v1.png', 'images/style-v2.png']);
      assert.deepStrictEqual(recipe.styleImageKeys, ['images/style-v1.png', 'images/style-v2.png']);
      assert.deepStrictEqual(result.styleReferenceVariantIds, ['style-v1', 'style-v2']);
      assert.strictEqual(asMock(repo.createRelation).mock.calls.length, 2);
      assert.deepStrictEqual(
        asMock(repo.createRelation).mock.calls.map((call) => call.arguments[0].subject.variantId),
        ['style-v1', 'style-v2']
      );
    });

    test('explicit style preset wins over default preset', async () => {
      const repo = createMockRepo();
      asMock(repo.getDefaultStylePreset).mock.mockImplementation(async () => {
        throw new Error('default should not be read for explicit preset');
      });
      asMock(repo.resolveStylePresetReferences).mock.mockImplementation(async (presetId: string) => ({
        preset: {
          id: presetId,
          name: 'Explicit Style',
          style_prompt: 'Clean ink lines',
          collection_id: 'collection-explicit',
          enabled: 1,
          is_default: 0,
          created_by: 'user-1',
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        stylePresetId: presetId,
        styleCollectionId: 'collection-explicit',
        stylePrompt: 'Clean ink lines',
        styleReferenceVariantIds: ['explicit-v1'],
        styleReferenceImageKeys: ['images/explicit-v1.png'],
      }));
      asMock(repo.getVariantById).mock.mockImplementation(async () => ({ image_key: 'images/explicit-v1.png' }));

      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const result = await factory.createAssetWithVariant(
        {
          name: 'Test',
          assetType: 'character',
          prompt: 'A warrior',
          stylePresetId: 'preset-explicit',
        },
        createMockMeta()
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.strictEqual(recipe.stylePresetId, 'preset-explicit');
      assert.deepStrictEqual(recipe.styleReferenceVariantIds, ['explicit-v1']);
      assert.strictEqual(asMock(repo.resolveStylePresetReferences).mock.calls[0].arguments[0], 'preset-explicit');
    });

    test('ad hoc style variants are snapped without applying default preset prompt', async () => {
      const repo = createMockRepo();
      asMock(repo.getDefaultStylePreset).mock.mockImplementation(async () => {
        throw new Error('default should not be read for ad hoc style variants');
      });
      asMock(repo.getVariantById).mock.mockImplementation(async (variantId: string) => ({
        id: variantId,
        image_key: `images/${variantId}.png`,
      }));

      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const result = await factory.createAssetWithVariant(
        {
          name: 'Test',
          assetType: 'character',
          prompt: 'A warrior',
          styleVariantIds: ['style-a', 'style-b'],
        },
        createMockMeta()
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.strictEqual(recipe.prompt, 'A warrior');
      assert.deepStrictEqual(recipe.sourceImageKeys, ['images/style-a.png', 'images/style-b.png']);
      assert.deepStrictEqual(recipe.styleReferenceVariantIds, ['style-a', 'style-b']);
      assert.deepStrictEqual(recipe.styleReferenceImageKeys, ['images/style-a.png', 'images/style-b.png']);
      assert.strictEqual(asMock(repo.createRelation).mock.calls.length, 2);
    });

    test('snapshot does not change when collection resolution changes later', async () => {
      const repo = createMockRepo();
      asMock(repo.getDefaultStylePreset).mock.mockImplementation(async () => ({
        id: 'preset-default',
        name: 'House Style',
        style_prompt: 'Painterly',
        collection_id: 'collection-style',
        enabled: 1,
        is_default: 1,
        created_by: 'user-1',
        created_at: Date.now(),
        updated_at: Date.now(),
      }));
      let resolvedVariantIds = ['style-v1'];
      asMock(repo.resolveStylePresetReferences).mock.mockImplementation(async () => ({
        preset: {
          id: 'preset-default',
          name: 'House Style',
          style_prompt: 'Painterly',
          collection_id: 'collection-style',
          enabled: 1,
          is_default: 1,
          created_by: 'user-1',
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        stylePresetId: 'preset-default',
        styleCollectionId: 'collection-style',
        stylePrompt: 'Painterly',
        styleReferenceVariantIds: resolvedVariantIds,
        styleReferenceImageKeys: resolvedVariantIds.map((id) => `images/${id}.png`),
      }));
      asMock(repo.getVariantById).mock.mockImplementation(async (variantId: string) => ({
        id: variantId,
        image_key: `images/${variantId}.png`,
      }));

      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const result = await factory.createAssetWithVariant(
        { name: 'Test', assetType: 'character', prompt: 'A warrior' },
        createMockMeta()
      );
      resolvedVariantIds = ['style-v2'];

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.deepStrictEqual(recipe.styleReferenceVariantIds, ['style-v1']);
      assert.deepStrictEqual(recipe.styleReferenceImageKeys, ['images/style-v1.png']);
    });

    test('sourceImageKeys prepended with style images', async () => {
      const repo = createMockRepo();
      setupDefaultStylePreset(repo, {
        prompt: 'Pixel art',
        variantIds: ['style-v1', 'style-v2'],
        imageKeys: ['styles/space-1/ref1.png', 'styles/space-1/ref2.png'],
      });

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
      assert.deepStrictEqual(recipe.styleImageKeys, [
        'styles/space-1/ref1.png',
        'styles/space-1/ref2.png',
      ]);
      // Style image keys returned separately
      assert.deepStrictEqual(result.styleImageKeys, [
        'styles/space-1/ref1.png',
        'styles/space-1/ref2.png',
      ]);
    });

    test('audio recipes do not receive image style anchors', async () => {
      const repo = createMockRepo();
      asMock(repo.getActiveStyle).mock.mockImplementation(async () =>
        createMockStyle({
          description: 'Pixel art',
          image_keys: '["styles/space-1/ref1.png"]',
        })
      );

      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const meta = createMockMeta();

      const result = await factory.createAssetWithVariant(
        {
          name: 'Theme',
          assetType: 'music',
          mediaKind: 'audio',
          prompt: 'A short loop',
        },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.strictEqual(recipe.prompt, 'A short loop');
      assert.strictEqual(recipe.styleId, undefined);
      assert.strictEqual(recipe.sourceImageKeys, undefined);
      assert.strictEqual(result.styleImageKeys, undefined);
      assert.strictEqual(asMock(repo.getActiveStyle).mock.calls.length, 0);
    });

    test('style images come before source images in combined keys', async () => {
      const repo = createMockRepo();
      setupDefaultStylePreset(repo, {
        prompt: 'Pixel art, 16-bit, vibrant colors',
        variantIds: ['style-v1'],
        imageKeys: ['styles/space-1/ref1.png'],
      });
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

    test('video generation caps style-only references to Veo limit', async () => {
      const repo = createMockRepo();
      setupDefaultStylePreset(repo, {
        prompt: 'Pixel art, 16-bit, vibrant colors',
        variantIds: ['style-v1', 'style-v2', 'style-v3', 'style-v4'],
        imageKeys: ['styles/ref1.png', 'styles/ref2.png', 'styles/ref3.png', 'styles/ref4.png'],
      });

      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const meta = createMockMeta();

      const result = await factory.createAssetWithVariant(
        {
          name: 'Video Test',
          assetType: 'animation',
          mediaKind: 'video',
          prompt: 'A slow camera orbit',
        },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.deepStrictEqual(recipe.sourceImageKeys, [
        'styles/ref1.png',
        'styles/ref2.png',
        'styles/ref3.png',
      ]);
      assert.deepStrictEqual(recipe.styleImageKeys, recipe.sourceImageKeys);
      assert.deepStrictEqual(result.sourceImageKeys, recipe.sourceImageKeys);
      assert.deepStrictEqual(result.styleImageKeys, recipe.sourceImageKeys);
    });

    test('video refine preserves source reference before filling style budget', async () => {
      const repo = createMockRepo();
      setupDefaultStylePreset(repo, {
        prompt: 'Pixel art, 16-bit, vibrant colors',
        variantIds: ['style-v1', 'style-v2', 'style-v3', 'style-v4'],
        imageKeys: ['styles/ref1.png', 'styles/ref2.png', 'styles/ref3.png', 'styles/ref4.png'],
      });
      asMock(repo.getAssetById).mock.mockImplementation(async () => ({
        id: 'asset-video',
        name: 'Video Asset',
        type: 'animation',
        media_kind: 'video',
        tags: '[]',
        parent_asset_id: null,
        active_variant_id: 'variant-source',
        created_by: 'user-123',
        created_at: Date.now(),
        updated_at: Date.now(),
      }));
      asMock(repo.getVariantById).mock.mockImplementation(async (variantId: string) => ({
        id: 'variant-source',
        asset_id: 'asset-video',
        media_kind: 'video',
        workflow_id: null,
        status: 'completed',
        error_message: null,
        image_key: variantId.startsWith('style-v')
          ? `styles/ref${Number(variantId.slice('style-v'.length))}.png`
          : 'images/source.png',
        thumb_key: 'images/source_thumb.webp',
        media_key: 'images/source.png',
        media_mime_type: 'image/png',
        media_size_bytes: 1234,
        media_width: 512,
        media_height: 512,
        media_duration_ms: null,
        recipe: '{}',
        starred: false,
        created_by: 'user-123',
        created_at: Date.now(),
        updated_at: Date.now(),
        plan_step_id: null,
        description: null,
        batch_id: null,
        quality_rating: null,
        rated_at: null,
      }));

      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const meta = createMockMeta();

      const result = await factory.createRefineVariant(
        {
          assetId: 'asset-video',
          mediaKind: 'video',
          prompt: 'Animate this asset',
        },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.deepStrictEqual(recipe.sourceImageKeys, [
        'styles/ref1.png',
        'styles/ref2.png',
        'images/source.png',
      ]);
      assert.deepStrictEqual(recipe.styleImageKeys, ['styles/ref1.png', 'styles/ref2.png']);
      assert.deepStrictEqual(result.sourceImageKeys, recipe.sourceImageKeys);
      assert.deepStrictEqual(result.styleImageKeys, ['styles/ref1.png', 'styles/ref2.png']);
    });

    test('video caps asset-backed style references and keeps style variant provenance aligned', async () => {
      const repo = createMockRepo();
      asMock(repo.getDefaultStylePreset).mock.mockImplementation(async () => ({
        id: 'preset-video',
        name: 'Video Style',
        style_prompt: 'Graphic novel animation',
        collection_id: 'collection-video-style',
        enabled: 1,
        is_default: 1,
        created_by: 'user-1',
        created_at: Date.now(),
        updated_at: Date.now(),
      }));
      asMock(repo.resolveStylePresetReferences).mock.mockImplementation(async () => ({
        preset: {
          id: 'preset-video',
          name: 'Video Style',
          style_prompt: 'Graphic novel animation',
          collection_id: 'collection-video-style',
          enabled: 1,
          is_default: 1,
          created_by: 'user-1',
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        stylePresetId: 'preset-video',
        styleCollectionId: 'collection-video-style',
        stylePrompt: 'Graphic novel animation',
        styleReferenceVariantIds: ['style-v1', 'style-v2', 'style-v3', 'style-v4'],
        styleReferenceImageKeys: [
          'images/style-v1.png',
          'images/style-v2.png',
          'images/style-v3.png',
          'images/style-v4.png',
        ],
      }));
      asMock(repo.getVariantById).mock.mockImplementation(async (variantId: string) => ({
        id: variantId,
        image_key: `images/${variantId}.png`,
      }));
      asMock(repo.getVariantImageKey).mock.mockImplementation(async (variantId: string) => `images/${variantId}.png`);

      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const result = await factory.createAssetWithVariant(
        {
          name: 'Video Test',
          assetType: 'animation',
          mediaKind: 'video',
          prompt: 'A slow camera orbit',
          referenceVariantIds: ['user-ref'],
        },
        createMockMeta()
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.deepStrictEqual(recipe.styleImageKeys, ['images/style-v1.png', 'images/style-v2.png']);
      assert.deepStrictEqual(recipe.styleReferenceVariantIds, ['style-v1', 'style-v2']);
      assert.deepStrictEqual(recipe.styleReferenceImageKeys, ['images/style-v1.png', 'images/style-v2.png']);
      assert.deepStrictEqual(recipe.sourceImageKeys, [
        'images/style-v1.png',
        'images/style-v2.png',
        'images/user-ref.png',
      ]);
      assert.strictEqual(recipe.veoReferenceMode, 'reference-images');
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

    test('video generation caps user references when style is disabled', async () => {
      const repo = createMockRepo();
      asMock(repo.getActiveStyle).mock.mockImplementation(async () =>
        createMockStyle({ description: 'Should not appear' })
      );
      asMock(repo.getVariantImageKey).mock.mockImplementation(
        async (variantId: string) => `images/${variantId}.png`
      );
      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const meta = createMockMeta();

      const result = await factory.createAssetWithVariant(
        {
          name: 'Video Test',
          assetType: 'animation',
          mediaKind: 'video',
          prompt: 'A slow camera orbit',
          referenceVariantIds: ['var-1', 'var-2', 'var-3', 'var-4'],
          disableStyle: true,
        },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.deepStrictEqual(recipe.sourceImageKeys, [
        'images/var-1.png',
        'images/var-2.png',
        'images/var-3.png',
      ]);
      assert.strictEqual(recipe.styleOverride, true);
      assert.strictEqual(recipe.styleId, undefined);
      assert.deepStrictEqual(result.sourceImageKeys, recipe.sourceImageKeys);
      assert.strictEqual(result.styleImageKeys, undefined);
    });
  });

  describe('image count validation', () => {
    test('asset-backed style images are skipped with matching empty style provenance when model budget is full', async () => {
      const repo = createMockRepo();
      asMock(repo.getDefaultStylePreset).mock.mockImplementation(async () => ({
        id: 'preset-default',
        name: 'House Style',
        style_prompt: 'Ink wash',
        collection_id: 'collection-style',
        enabled: 1,
        is_default: 1,
        created_by: 'user-1',
        created_at: Date.now(),
        updated_at: Date.now(),
      }));
      asMock(repo.resolveStylePresetReferences).mock.mockImplementation(async () => ({
        preset: {
          id: 'preset-default',
          name: 'House Style',
          style_prompt: 'Ink wash',
          collection_id: 'collection-style',
          enabled: 1,
          is_default: 1,
          created_by: 'user-1',
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        stylePresetId: 'preset-default',
        styleCollectionId: 'collection-style',
        stylePrompt: 'Ink wash',
        styleReferenceVariantIds: ['style-v1'],
        styleReferenceImageKeys: ['images/style-v1.png'],
      }));
      asMock(repo.getVariantById).mock.mockImplementation(async (variantId: string) => ({
        id: variantId,
        image_key: variantId === 'style-v1' ? 'images/style-v1.png' : null,
      }));
      asMock(repo.getVariantImageKey).mock.mockImplementation(async () => 'images/user-ref.png');

      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const result = await factory.createAssetWithVariant(
        {
          name: 'Test',
          assetType: 'character',
          prompt: 'A warrior',
          model: 'flash',
          referenceVariantIds: ['user-ref'],
        },
        createMockMeta()
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.ok(recipe.prompt.startsWith('[Style: Ink wash]'));
      assert.strictEqual(recipe.stylePresetId, 'preset-default');
      assert.deepStrictEqual(recipe.styleReferenceVariantIds, []);
      assert.deepStrictEqual(recipe.styleReferenceImageKeys, []);
      assert.strictEqual(result.styleImageKeys, undefined);
      assert.deepStrictEqual(recipe.sourceImageKeys, ['images/user-ref.png']);
      assert.strictEqual(asMock(repo.createRelation).mock.calls.length, 0);
    });

    test('style images skipped when total exceeds 14', async () => {
      const repo = createMockRepo();
      setupDefaultStylePreset(repo, {
        prompt: 'Test style',
        variantIds: ['style-v1', 'style-v2', 'style-v3'],
        imageKeys: ['s1.png', 's2.png', 's3.png'],
      });
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

    test('style images skipped when Flash source references fill its model limit', async () => {
      const repo = createMockRepo();
      setupDefaultStylePreset(repo, {
        prompt: 'Test style',
        variantIds: ['style-v1'],
        imageKeys: ['styles/ref1.png'],
      });
      asMock(repo.getVariantImageKey).mock.mockImplementation(async () => 'images/user-ref.png');

      const factory = new VariantFactory('space-1', repo, createMockEnv(), createMockBroadcast());
      const meta = createMockMeta();

      const result = await factory.createAssetWithVariant(
        {
          name: 'Test',
          assetType: 'character',
          prompt: 'A warrior',
          model: 'flash',
          referenceVariantIds: ['var-1'],
        },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.ok(recipe.prompt.startsWith('[Style: Test style]'));
      assert.strictEqual(result.styleImageKeys, undefined);
      assert.deepStrictEqual(recipe.sourceImageKeys, ['images/user-ref.png']);
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
      setupDefaultStylePreset(repo, { prompt: 'Batch style' });

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
        assert.strictEqual(recipe.stylePresetId, 'preset-default');
        assert.strictEqual(recipe.styleId, undefined);
      }

      assert.strictEqual(asMock(repo.getDefaultStylePreset).mock.calls.length, 1);
    });
  });
});
