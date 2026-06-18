import { describe, test, mock, type Mock } from 'node:test';
import assert from 'node:assert/strict';
import { VariantFactory, determineOperation, type GenerationRecipe } from './VariantFactory';
import type { SpaceRepository } from '../repository/SpaceRepository';
import type { BroadcastFn } from '../controllers/types';
import type { Env } from '../../../../core/types';
import type { WebSocketMeta, Asset, Variant } from '../types';

// Helper to get mock from a function
type MockFn = Mock<(...args: any[]) => any>;
const asMock = (fn: unknown): MockFn => fn as MockFn;

// ============================================================================
// Mock Factories
// ============================================================================

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
      media_kind: input.mediaKind ?? 'image',
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
      asMock(repo.getAssetById).mock.mockImplementation(async (id: string) => ({
        id,
        active_variant_id: `variant-${id}`,
      }));
      asMock(repo.getVariantImageKey).mock.mockImplementation(
        async (variantId: string) => `images/${variantId}.png`
      );

      const result = await factory.resolveAssetReferences(['asset-1', 'asset-2']);

      assert.deepStrictEqual(result.sourceImageKeys, [
        'images/variant-asset-1.png',
        'images/variant-asset-2.png',
      ]);
      assert.deepStrictEqual(result.parentVariantIds, ['variant-asset-1', 'variant-asset-2']);
    });

    test('rejects image asset references without active variants', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);

      asMock(repo.getAssetById).mock.mockImplementation(async (id: string) => ({
        id,
        active_variant_id: id === 'asset-1' ? 'variant-1' : null,
      }));
      asMock(repo.getVariantImageKey).mock.mockImplementation(async () => 'images/test.png');

      await assert.rejects(
        factory.resolveAssetReferences(['asset-1', 'asset-2']),
        /Reference asset asset-2 has no active variant/
      );
    });

    test('preserves media-only video asset references as parents without image refs', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);

      asMock(repo.getAssetById).mock.mockImplementation(async (id: string) => ({
        id,
        active_variant_id: `variant-${id}`,
      }));
      asMock(repo.getVariantById).mock.mockImplementation(async (id: string) => ({
        id,
        image_key: null,
        media_key: 'media/space-1/video.mp4',
      }));

      const result = await factory.resolveAssetReferences(['asset-1'], 'video');

      assert.deepStrictEqual(result.sourceImageKeys, []);
      assert.deepStrictEqual(result.parentVariantIds, ['variant-asset-1']);
    });
  });

  describe('resolveVariantReferences', () => {
    test('resolves variant IDs to image keys', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);

      asMock(repo.getVariantImageKey).mock.mockImplementation(
        async (variantId: string) => `images/${variantId}.png`
      );

      const result = await factory.resolveVariantReferences(['var-1', 'var-2']);

      assert.deepStrictEqual(result.sourceImageKeys, ['images/var-1.png', 'images/var-2.png']);
      assert.deepStrictEqual(result.parentVariantIds, ['var-1', 'var-2']);
    });

    test('rejects image variant references without completed image keys', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);

      asMock(repo.getVariantImageKey).mock.mockImplementation(
        async (variantId: string) => (variantId === 'var-1' ? 'images/var-1.png' : null)
      );

      await assert.rejects(
        factory.resolveVariantReferences(['var-1', 'var-2']),
        /Reference variant var-2 is not a completed image variant/
      );
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
      assert.strictEqual(
        (JSON.parse(result.variant.recipe) as GenerationRecipe).model,
        'gemini-3-pro-image-preview'
      );

      // Verify broadcasts
      const broadcastCalls = asMock(broadcast).mock.calls;
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
      asMock(repo.getVariantImageKey).mock.mockImplementation(async () => 'images/ref.png');

      await factory.createAssetWithVariant(
        {
          name: 'Derived Asset',
          assetType: 'character',
          referenceVariantIds: ['ref-var-1'],
        },
        meta
      );

      // Verify lineage created
      assert.ok(asMock(repo.createLineage).mock.calls.length > 0);

      // Verify broadcasts include lineage
      const broadcastCalls = asMock(broadcast).mock.calls;
      assert.ok(broadcastCalls.some((c) => c.arguments[0].type === 'lineage:created'));
    });

    test('rejects unresolved image references before creating records', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      await assert.rejects(
        factory.createAssetWithVariant(
          {
            name: 'Broken Composite',
            assetType: 'scene',
            mediaKind: 'image',
            prompt: 'Use this missing reference',
            referenceVariantIds: ['missing-ref'],
          },
          meta
        ),
        /Reference variant missing-ref is not a completed image variant/
      );

      assert.strictEqual(asMock(repo.createAsset).mock.calls.length, 0);
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls.length, 0);
      assert.strictEqual(asMock(repo.createLineage).mock.calls.length, 0);
      assert.strictEqual(asMock(broadcast).mock.calls.length, 0);
    });

    test('rejects Flash image generation with multiple references before creating records', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      asMock(repo.getVariantImageKey).mock.mockImplementation(
        async (variantId: string) => `images/${variantId}.png`
      );

      await assert.rejects(
        factory.createAssetWithVariant(
          {
            name: 'Flash Composite',
            assetType: 'scene',
            mediaKind: 'image',
            prompt: 'Combine these references quickly',
            model: 'flash',
            referenceVariantIds: ['ref-var-1', 'ref-var-2'],
          },
          meta
        ),
        /gemini-2\.5-flash-image supports at most 1 reference image/
      );

      assert.strictEqual(asMock(repo.createAsset).mock.calls.length, 0);
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls.length, 0);
      assert.strictEqual(asMock(repo.createLineage).mock.calls.length, 0);
      assert.strictEqual(asMock(broadcast).mock.calls.length, 0);
    });

    test('rejects Pro image generation above its reference limit before creating records', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      asMock(repo.getVariantImageKey).mock.mockImplementation(
        async (variantId: string) => `images/${variantId}.png`
      );

      await assert.rejects(
        factory.createAssetWithVariant(
          {
            name: 'Large Composite',
            assetType: 'scene',
            mediaKind: 'image',
            prompt: 'Combine many references',
            model: 'pro',
            referenceVariantIds: Array.from({ length: 15 }, (_, index) => `ref-var-${index}`),
          },
          meta
        ),
        /gemini-3-pro-image-preview supports at most 14 reference images/
      );

      assert.strictEqual(asMock(repo.createAsset).mock.calls.length, 0);
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls.length, 0);
      assert.strictEqual(asMock(repo.createLineage).mock.calls.length, 0);
      assert.strictEqual(asMock(broadcast).mock.calls.length, 0);
    });

    test('auto-sets parentAssetId from first reference', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      // Setup: variant reference resolves to an asset
      asMock(repo.getVariantById).mock.mockImplementation(async () => ({
        id: 'ref-var-1',
        asset_id: 'parent-asset-1',
      }));
      asMock(repo.getVariantImageKey).mock.mockImplementation(async () => 'images/ref.png');

      await factory.createAssetWithVariant(
        {
          name: 'Child Asset',
          assetType: 'character',
          referenceVariantIds: ['ref-var-1'],
        },
        meta
      );

      // Verify createAsset was called with parentAssetId
      const createAssetCall = asMock(repo.createAsset).mock.calls[0];
      assert.strictEqual(createAssetCall.arguments[0].parentAssetId, 'parent-asset-1');
    });

    test('propagates explicit media kind to asset, placeholder variant, and recipe', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      const result = await factory.createAssetWithVariant(
        {
          name: 'Video Asset',
          assetType: 'scene',
          mediaKind: 'video',
          prompt: 'Create an animated scene',
          generateAudio: true,
          videoResolution: '1080p',
          videoDurationSeconds: 6,
          videoTier: 'fast',
        },
        meta
      );

      assert.strictEqual(result.asset.media_kind, 'video');
      assert.strictEqual(result.variant.media_kind, 'video');
      assert.strictEqual(asMock(repo.createAsset).mock.calls[0].arguments[0].mediaKind, 'video');
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls[0].arguments[0].mediaKind, 'video');

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.strictEqual(recipe.mediaKind, 'video');
      assert.strictEqual(recipe.model, 'veo-3.1-fast-generate-preview');
      assert.strictEqual(recipe.veoReferenceMode, 'text-to-video');
      assert.strictEqual(recipe.generateAudio, true);
      assert.strictEqual(recipe.videoResolution, '1080p');
      assert.strictEqual(recipe.videoDurationSeconds, 6);
      assert.strictEqual(recipe.videoTier, 'fast');
    });

    test('rejects video combinations without configured pricing', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      await assert.rejects(
        () => factory.createAssetWithVariant(
          {
            name: 'Draft Video',
            assetType: 'animation',
            mediaKind: 'video',
            prompt: 'Create an animated draft',
            videoResolution: '4k',
            videoTier: 'lite',
          },
          meta
        ),
        /Video resolution 4k is not supported for the lite tier/
      );

      assert.strictEqual(asMock(repo.createAsset).mock.calls.length, 0);
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls.length, 0);
      assert.strictEqual(asMock(broadcast).mock.calls.length, 0);
    });

    test('labels single-image video generations as image-to-video', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      asMock(repo.getVariantImageKey).mock.mockImplementation(async (variantId: string) => `images/${variantId}.png`);

      const result = await factory.createAssetWithVariant(
        {
          name: 'Animated Portrait',
          assetType: 'animation',
          mediaKind: 'video',
          prompt: 'subtle breathing animation',
          referenceVariantIds: ['portrait-var'],
          disableStyle: true,
        },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.strictEqual(recipe.veoReferenceMode, 'image-to-video');
      assert.deepStrictEqual(recipe.sourceImageKeys, ['images/portrait-var.png']);
    });

    test('labels two-image video generations as first-last-frame', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      asMock(repo.getVariantImageKey).mock.mockImplementation(async (variantId: string) => `images/${variantId}.png`);

      const result = await factory.createAssetWithVariant(
        {
          name: 'Camera Move',
          assetType: 'animation',
          mediaKind: 'video',
          prompt: 'dolly between the two keyframes',
          referenceVariantIds: ['start-var', 'end-var'],
          disableStyle: true,
        },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.strictEqual(recipe.veoReferenceMode, 'first-last-frame');
      assert.deepStrictEqual(recipe.sourceImageKeys, ['images/start-var.png', 'images/end-var.png']);
    });

    test('labels styled video generations as reference-images', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      asMock(repo.getActiveStyle).mock.mockImplementation(async () => ({
        id: 'style-1',
        name: 'House Style',
        description: '',
        image_keys: JSON.stringify(['images/style.png']),
        enabled: 1,
      }));
      asMock(repo.getVariantImageKey).mock.mockImplementation(async (variantId: string) => `images/${variantId}.png`);

      const result = await factory.createAssetWithVariant(
        {
          name: 'Styled Video',
          assetType: 'animation',
          mediaKind: 'video',
          prompt: 'animate the keyframe',
          referenceVariantIds: ['keyframe-var'],
        },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.strictEqual(recipe.veoReferenceMode, 'reference-images');
      assert.deepStrictEqual(recipe.styleImageKeys, ['images/style.png']);
      assert.deepStrictEqual(recipe.sourceImageKeys, ['images/style.png', 'images/keyframe-var.png']);
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
      asMock(repo.getAssetById).mock.mockImplementation(async () => ({
        id: 'asset-1',
        name: 'Existing Asset',
        type: 'character',
        active_variant_id: 'existing-var',
      }));
      asMock(repo.getVariantById).mock.mockImplementation(async () => ({
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

    test('inherits media kind from target asset when refining', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      asMock(repo.getAssetById).mock.mockImplementation(async () => ({
        id: 'asset-1',
        name: 'Existing Audio',
        type: 'reference',
        media_kind: 'audio',
        active_variant_id: 'existing-var',
      }));
      asMock(repo.getVariantById).mock.mockImplementation(async () => ({
        id: 'existing-var',
        image_key: 'images/existing.png',
      }));

      const result = await factory.createRefineVariant(
        {
          assetId: 'asset-1',
          prompt: 'Refine this audio reference',
        },
        meta
      );

      assert.strictEqual(result.variant.media_kind, 'audio');
      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls[0].arguments[0].mediaKind, 'audio');

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.strictEqual(recipe.mediaKind, 'audio');
    });

    test('creates video refine variant from media-only active variant without image refs', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      asMock(repo.getAssetById).mock.mockImplementation(async () => ({
        id: 'asset-video',
        name: 'Existing Video',
        type: 'animation',
        media_kind: 'video',
        tags: '[]',
        parent_asset_id: null,
        active_variant_id: 'existing-video-var',
        created_by: 'user-123',
        created_at: Date.now(),
        updated_at: Date.now(),
      }));
      asMock(repo.getVariantById).mock.mockImplementation(async () => ({
        id: 'existing-video-var',
        asset_id: 'asset-video',
        media_kind: 'video',
        workflow_id: null,
        status: 'completed',
        error_message: null,
        image_key: null,
        thumb_key: null,
        media_key: 'media/space-1/existing-video-var.mp4',
        media_mime_type: 'video/mp4',
        media_size_bytes: 4096,
        media_width: null,
        media_height: null,
        media_duration_ms: 8000,
        recipe: '{}',
        starred: false,
        created_by: 'user-123',
        created_at: Date.now(),
        updated_at: Date.now(),
        plan_step_id: null,
      }));

      const result = await factory.createRefineVariant(
        {
          assetId: 'asset-video',
          prompt: 'Create a new animated take',
        },
        meta
      );

      const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
      assert.strictEqual(recipe.mediaKind, 'video');
      assert.strictEqual(recipe.operation, 'refine');
      assert.strictEqual(recipe.sourceImageKeys, undefined);
      assert.deepStrictEqual(result.sourceImageKeys, []);
      assert.deepStrictEqual(result.parentVariantIds, ['existing-video-var']);
      assert.strictEqual(asMock(repo.createLineage).mock.calls.length, 1);
    });

    test('keeps audio source lineage when refining without an image key', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      asMock(repo.getAssetById).mock.mockImplementation(async () => ({
        id: 'asset-1',
        name: 'Existing Audio',
        type: 'music',
        media_kind: 'audio',
        active_variant_id: 'existing-audio-var',
      }));
      asMock(repo.getVariantById).mock.mockImplementation(async () => ({
        id: 'existing-audio-var',
        asset_id: 'asset-1',
        media_kind: 'audio',
        image_key: null,
        media_key: 'media/existing.mp3',
      }));

      const result = await factory.createRefineVariant(
        {
          assetId: 'asset-1',
          prompt: 'Make the loop more tense',
        },
        meta
      );

      assert.deepStrictEqual(result.parentVariantIds, ['existing-audio-var']);
      assert.deepStrictEqual(result.sourceImageKeys, []);
      assert.strictEqual(result.variant.media_kind, 'audio');
      assert.strictEqual(asMock(repo.createLineage).mock.calls[0].arguments[0].parentVariantId, 'existing-audio-var');
    });

    test('keeps explicit audio references as lineage-only references', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      asMock(repo.getVariantById).mock.mockImplementation(async (variantId: string) => ({
        id: variantId,
        asset_id: 'audio-source-asset',
        media_kind: 'audio',
        image_key: null,
        media_key: 'media/source.wav',
      }));

      const result = await factory.createAssetWithVariant(
        {
          name: 'Footstep Sweetener',
          assetType: 'sfx',
          mediaKind: 'audio',
          prompt: 'Layer heavier boot impact on this footstep',
          referenceVariantIds: ['audio-source-var'],
        },
        meta
      );

      assert.deepStrictEqual(result.parentVariantIds, ['audio-source-var']);
      assert.deepStrictEqual(result.sourceImageKeys, []);
      assert.strictEqual(result.asset.media_kind, 'audio');
      assert.strictEqual(result.asset.parent_asset_id, 'audio-source-asset');
      assert.strictEqual(asMock(repo.createLineage).mock.calls[0].arguments[0].parentVariantId, 'audio-source-var');
    });

    test('rejects explicit media kind that differs from target asset when refining', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      asMock(repo.getAssetById).mock.mockImplementation(async () => ({
        id: 'asset-1',
        name: 'Existing Image',
        type: 'reference',
        media_kind: 'image',
        active_variant_id: 'existing-var',
      }));

      await assert.rejects(
        factory.createRefineVariant(
          {
            assetId: 'asset-1',
            mediaKind: 'video',
            prompt: 'Refine this reference',
          },
          meta
        ),
        /Cannot create video variant for image asset/
      );

      assert.strictEqual(asMock(repo.createPlaceholderVariant).mock.calls.length, 0);
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

    test('throws when no source media available', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      // Asset exists but has no active variant with image
      asMock(repo.getAssetById).mock.mockImplementation(async () => ({
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
        /No source media/
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
      assert.ok(asMock(env.GENERATION_WORKFLOW!.create).mock.calls.length > 0);
      assert.ok(asMock(repo.updateVariantWorkflow).mock.calls.length > 0);
    });

    test('passes stored Veo reference mode to workflow input', async () => {
      const repo = createMockRepo();
      const env = createMockEnv(true);
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      const result = {
        asset: { id: 'asset-1', name: 'Test', type: 'animation', media_kind: 'video' } as Asset,
        variant: {
          id: 'var-1',
          media_kind: 'video',
          recipe: JSON.stringify({
            prompt: 'Test',
            assetType: 'animation',
            mediaKind: 'video',
            operation: 'derive',
            veoReferenceMode: 'first-last-frame',
            generateAudio: true,
            videoResolution: '4k',
            videoDurationSeconds: 4,
            videoTier: 'fast',
          }),
        } as Variant,
        variantId: 'var-1',
        assetId: 'asset-1',
        parentVariantIds: ['start-var', 'end-var'],
        sourceImageKeys: ['images/start.png', 'images/end.png'],
      };

      await factory.triggerWorkflow('req-1', 'var-1', result, meta, 'derive');

      const workflowInput = asMock(env.GENERATION_WORKFLOW!.create).mock.calls[0].arguments[0].params;
      assert.strictEqual(workflowInput.veoReferenceMode, 'first-last-frame');
      assert.strictEqual(workflowInput.generateAudio, true);
      assert.strictEqual(workflowInput.videoResolution, '4k');
      assert.strictEqual(workflowInput.videoDurationSeconds, 4);
      assert.strictEqual(workflowInput.videoTier, 'fast');
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

  describe('createBatchVariants', () => {
    test('stores exact default image model in batch recipes', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      const { results } = await factory.createBatchVariants(
        {
          name: 'Image Set',
          assetType: 'scene',
          mediaKind: 'image',
          prompt: 'Create images',
          count: 2,
          mode: 'set',
        },
        meta
      );

      assert.strictEqual(results.length, 2);
      for (const result of results) {
        const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
        assert.strictEqual(recipe.mediaKind, 'image');
        assert.strictEqual(recipe.model, 'gemini-3-pro-image-preview');
      }
    });

    test('stores explicit image model and size in batch recipes', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      const { results } = await factory.createBatchVariants(
        {
          name: 'Draft Set',
          assetType: 'scene',
          mediaKind: 'image',
          prompt: 'Create drafts',
          model: 'flash',
          imageSize: '1K',
          count: 2,
          mode: 'explore',
        },
        meta
      );

      assert.strictEqual(results.length, 2);
      for (const result of results) {
        const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
        assert.strictEqual(recipe.model, 'gemini-2.5-flash-image');
        assert.strictEqual(recipe.imageSize, '1K');
      }
    });

    test('propagates explicit media kind to batch assets and placeholders', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      const { results } = await factory.createBatchVariants(
        {
          name: 'Video Set',
          assetType: 'scene',
          mediaKind: 'video',
          prompt: 'Create a set',
          count: 2,
          mode: 'set',
        },
        meta
      );

      assert.strictEqual(results.length, 2);
      assert.ok(results.every((result) => result.asset.media_kind === 'video'));
      assert.ok(results.every((result) => result.variant.media_kind === 'video'));
      assert.ok(asMock(repo.createAsset).mock.calls.every((call) => call.arguments[0].mediaKind === 'video'));
      assert.ok(asMock(repo.createPlaceholderVariant).mock.calls.every((call) => call.arguments[0].mediaKind === 'video'));
    });

    test('does not stamp image model defaults into audio batch recipes', async () => {
      const repo = createMockRepo();
      const env = createMockEnv();
      const broadcast = createMockBroadcast();
      const factory = new VariantFactory('space-1', repo, env, broadcast);
      const meta = createMockMeta();

      const { results } = await factory.createBatchVariants(
        {
          name: 'Footstep Set',
          assetType: 'sfx',
          mediaKind: 'audio',
          prompt: 'Create footstep sound effects',
          count: 2,
          mode: 'set',
        },
        meta
      );

      assert.strictEqual(results.length, 2);
      for (const result of results) {
        const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;
        assert.strictEqual(recipe.mediaKind, 'audio');
        assert.strictEqual(recipe.model, undefined);
      }
    });
  });
});
