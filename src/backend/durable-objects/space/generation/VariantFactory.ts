/**
 * Variant Factory
 *
 * Centralized logic for creating variants, lineage records, and triggering workflows.
 * Used by both GenerationController (WebSocket handlers) and PlanExecutor (plan steps).
 *
 * This eliminates duplication between handleGenerateRequest/executePlanGenerate
 * and handleRefineRequest/executePlanRefine.
 */

import type { Asset, Variant, WebSocketMeta } from '../types';
import type { GenerationWorkflowInput, OperationType, BatchMode } from '../../../workflows/types';
import type { SpaceRepository } from '../repository/SpaceRepository';
import { ValidationError, type BroadcastFn } from '../controllers/types';
import type { Env } from '../../../../core/types';
import { PromptBuilder } from './PromptBuilder';
import { loggers } from '../../../../shared/logger';
import { DEFAULT_MEDIA_KIND, type MediaKind, type MusicGenerationProvider } from '../../../../shared/websocket-types';
import {
  determineVeoReferenceMode,
  type VeoReferenceMode,
} from '../../../services/googleVeoService';
import {
  DEFAULT_IMAGE_MODEL_ID,
  getImageModelCapabilities,
  isImageModelId,
  isImageModelSelection,
  isImageSizeSupportedByModel,
  normalizeImageSize,
  resolveImageModelSelection,
  type ImageModelId,
} from '../../../../shared/imageGenerationOptions';
import {
  DEFAULT_VIDEO_GENERATION_DURATION_SECONDS,
  DEFAULT_VIDEO_GENERATION_RESOLUTION,
  DEFAULT_VIDEO_GENERATION_TIER,
  getVideoGenerationModelForTier,
  getVideoGenerationTierForModel,
  isVideoGenerationResolutionSupportedForTier,
  normalizeVideoGenerationDurationSeconds,
  normalizeVideoGenerationResolution,
  normalizeVideoGenerationTier,
  type VideoGenerationDurationSeconds,
  type VideoGenerationResolution,
  type VideoGenerationTier,
} from '../../../../shared/videoGenerationOptions';

const log = loggers.generationController;
const MAX_VEO_REFERENCE_IMAGES = 3;

// ============================================================================
// Types
// ============================================================================

/** Recipe stored with variant for retry capability */
export interface GenerationRecipe {
  prompt: string;
  assetType: string;
  mediaKind?: MediaKind;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  sourceImageKeys?: string[];
  /** Style reference keys prepended to sourceImageKeys, preserving retry semantics */
  styleImageKeys?: string[];
  /** Parent variant IDs for retry support (in case lineage records are missing) */
  parentVariantIds?: string[];
  /** Operation type matching user-facing tool name */
  operation: OperationType;
  /** Style ID if a space style was applied */
  styleId?: string;
  /** True if style was explicitly disabled for this generation */
  styleOverride?: boolean;
  /** Model provider ('gemini' or 'custom') */
  modelProvider?: 'gemini' | 'custom';
  /** Veo request mode selected from resolved image references */
  veoReferenceMode?: VeoReferenceMode;
  /** Veo output resolution (video assets only) */
  videoResolution?: VideoGenerationResolution;
  /** Veo output duration in seconds (video assets only) */
  videoDurationSeconds?: VideoGenerationDurationSeconds;
  /** Veo model tier (video assets only) */
  videoTier?: VideoGenerationTier;
  /** Whether Veo should generate native synchronized audio (video assets only) */
  generateAudio?: boolean;
  /** ElevenLabs speech voice ID (audio assets) — persisted for retries */
  voiceId?: string;
  /** ElevenLabs dialogue voice IDs, ordered by speaker (audio assets) — persisted for retries */
  dialogueVoiceIds?: string[];
  /** Music provider selection for music audio assets — persisted for retries */
  musicProvider?: MusicGenerationProvider;
}

/** Determine operation type based on references */
export function determineOperation(hasReferences: boolean): OperationType {
  return hasReferences ? 'derive' : 'generate';
}

/** Input for creating a new asset with variant */
export interface CreateAssetVariantInput {
  /** Asset name */
  name: string;
  /** Asset type (character, item, scene, etc.) */
  assetType: string;
  /** Media kind for the asset and generated variants */
  mediaKind?: MediaKind;
  /** Generation prompt */
  prompt?: string;
  /** Aspect ratio */
  aspectRatio?: string;
  /** Image model selection (`pro`/`flash`) or resolved model ID */
  model?: string;
  /** Image output size (`1K`, `2K`, `4K`) */
  imageSize?: string;
  /** Parent asset ID for hierarchy */
  parentAssetId?: string;
  /** Reference asset IDs (resolved to active variants) */
  referenceAssetIds?: string[];
  /** Explicit variant IDs from ForgeTray */
  referenceVariantIds?: string[];
  /** Plan step ID if created by a plan */
  planStepId?: string;
  /** Disable style anchoring for this generation */
  disableStyle?: boolean;
  /** ElevenLabs speech voice ID (audio modes only) */
  voiceId?: string;
  /** ElevenLabs dialogue voice IDs, ordered by speaker (audio modes only) */
  dialogueVoiceIds?: string[];
  /** Music provider selection for music audio assets */
  musicProvider?: MusicGenerationProvider;
  /** Whether Veo should generate native synchronized audio (video assets only) */
  generateAudio?: boolean;
  /** Veo output resolution (video modes only) */
  videoResolution?: VideoGenerationResolution;
  /** Veo output duration in seconds (video modes only) */
  videoDurationSeconds?: VideoGenerationDurationSeconds;
  /** Veo model tier (video modes only) */
  videoTier?: VideoGenerationTier;
}

/** Input for refining an existing asset */
export interface RefineVariantInput {
  /** Target asset ID */
  assetId: string;
  /** Media kind override for the new variant */
  mediaKind?: MediaKind;
  /** Refinement prompt */
  prompt: string;
  /** Aspect ratio */
  aspectRatio?: string;
  /** Image model selection (`pro`/`flash`) or resolved model ID */
  model?: string;
  /** Image output size (`1K`, `2K`, `4K`) */
  imageSize?: string;
  /** Single source variant (legacy) */
  sourceVariantId?: string;
  /** Multiple source variants from ForgeTray */
  sourceVariantIds?: string[];
  /** Additional reference asset IDs */
  referenceAssetIds?: string[];
  /** Plan step ID if created by a plan */
  planStepId?: string;
  /** Disable style anchoring for this generation */
  disableStyle?: boolean;
  /** ElevenLabs speech voice ID (audio modes only) */
  voiceId?: string;
  /** ElevenLabs dialogue voice IDs, ordered by speaker (audio modes only) */
  dialogueVoiceIds?: string[];
  /** Music provider selection for music audio assets */
  musicProvider?: MusicGenerationProvider;
  /** Whether Veo should generate native synchronized audio (video assets only) */
  generateAudio?: boolean;
  /** Veo output resolution (video modes only) */
  videoResolution?: VideoGenerationResolution;
  /** Veo output duration in seconds (video modes only) */
  videoDurationSeconds?: VideoGenerationDurationSeconds;
  /** Veo model tier (video modes only) */
  videoTier?: VideoGenerationTier;
}

/** Result of variant creation */
export interface VariantCreationResult {
  asset: Asset;
  variant: Variant;
  variantId: string;
  assetId: string;
  parentVariantIds: string[];
  sourceImageKeys: string[];
  /** Style image keys injected (if style anchoring was active) */
  styleImageKeys?: string[];
}

/** Resolved references (image keys and variant IDs) */
export interface ResolvedReferences {
  sourceImageKeys: string[];
  parentVariantIds: string[];
}

// ============================================================================
// Variant Factory
// ============================================================================

export class VariantFactory {
  constructor(
    private readonly spaceId: string,
    private readonly repo: SpaceRepository,
    private readonly env: Env,
    private readonly broadcast: BroadcastFn
  ) {}

  // ==========================================================================
  // Public Methods - Asset + Variant Creation
  // ==========================================================================

  /**
   * Create a new asset with a placeholder variant, resolve references, and create lineage.
   * Does NOT trigger workflow - caller handles that.
   */
  async createAssetWithVariant(
    input: CreateAssetVariantInput,
    meta: WebSocketMeta
  ): Promise<VariantCreationResult> {
    const variantId = crypto.randomUUID();
    const assetId = crypto.randomUUID();

    // Auto-set parentAssetId from first reference if not explicitly provided
    let effectiveParentAssetId = input.parentAssetId;
    if (!effectiveParentAssetId && input.referenceAssetIds?.length) {
      effectiveParentAssetId = input.referenceAssetIds[0];
    } else if (!effectiveParentAssetId && input.referenceVariantIds?.length) {
      const firstVariant = await this.repo.getVariantById(input.referenceVariantIds[0]);
      if (firstVariant) {
        effectiveParentAssetId = firstVariant.asset_id;
      }
    }

    // Resolve references
    const resolved = await this.resolveAllReferences(
      input.referenceAssetIds,
      input.referenceVariantIds,
      input.mediaKind
    );

    // Debug: Log resolved references to trace lineage creation
    log.info('Resolved references for new asset', {
      inputRefVariantIds: input.referenceVariantIds,
      inputRefAssetIds: input.referenceAssetIds,
      resolvedParentVariantIds: resolved.parentVariantIds,
      sourceImageKeysCount: resolved.sourceImageKeys.length,
    });

    // Determine operation: 'generate' if no refs, 'derive' if using refs
    const operation = determineOperation(resolved.parentVariantIds.length > 0);

    const videoOptions = this.resolveRecipeVideoOptions(
      input.mediaKind,
      input.videoResolution,
      input.videoDurationSeconds,
      input.videoTier,
      input.model
    );
    const recipeModel = videoOptions.model ?? this.resolveRecipeModel(input.mediaKind, input.model);
    const recipeImageSize = this.resolveRecipeImageSize(input.mediaKind, input.imageSize, recipeModel);

    // Build recipe (includes parentVariantIds for retry support)
    let recipe: GenerationRecipe = {
      prompt: input.prompt || `Create a ${input.assetType} named "${input.name}"`,
      assetType: input.assetType,
      mediaKind: input.mediaKind,
      model: recipeModel,
      aspectRatio: input.aspectRatio,
      imageSize: recipeImageSize,
      videoResolution: videoOptions.videoResolution,
      videoDurationSeconds: videoOptions.videoDurationSeconds,
      videoTier: videoOptions.videoTier,
      sourceImageKeys: resolved.sourceImageKeys.length > 0 ? resolved.sourceImageKeys : undefined,
      parentVariantIds: resolved.parentVariantIds.length > 0 ? resolved.parentVariantIds : undefined,
      operation,
      generateAudio: input.mediaKind === 'video' ? input.generateAudio === true : undefined,
      voiceId: input.voiceId,
      dialogueVoiceIds: input.dialogueVoiceIds?.length ? input.dialogueVoiceIds : undefined,
      musicProvider: input.assetType === 'music' ? input.musicProvider : undefined,
    };

    // Inject style anchoring
    const styleResult = await this.injectStyle(recipe, resolved.sourceImageKeys, input.disableStyle);
    recipe = styleResult.recipe;
    const effectiveSourceImageKeys = styleResult.sourceImageKeys;
    recipe = this.withVeoReferenceMode(recipe, effectiveSourceImageKeys, styleResult.styleImageKeys);
    this.validateImageModelReferenceLimit(recipe, effectiveSourceImageKeys);

    // Create the asset only after request-level validation succeeds.
    const asset = await this.repo.createAsset({
      id: assetId,
      name: input.name,
      type: input.assetType,
      mediaKind: input.mediaKind,
      tags: [],
      parentAssetId: effectiveParentAssetId,
      createdBy: meta.userId,
    });
    this.broadcast({ type: 'asset:created', asset });

    // Create placeholder variant
    const variant = await this.repo.createPlaceholderVariant({
      id: variantId,
      assetId,
      mediaKind: input.mediaKind,
      recipe: JSON.stringify(recipe),
      createdBy: meta.userId,
      planStepId: input.planStepId,
    });

    // Set as active variant
    await this.repo.updateAsset(assetId, { active_variant_id: variantId });
    asset.active_variant_id = variantId;

    // Broadcast
    this.broadcast({ type: 'variant:created', variant });
    this.broadcast({ type: 'asset:updated', asset });

    // Create lineage records
    await this.createLineageRecords(resolved.parentVariantIds, variantId, 'derived');

    return {
      asset,
      variant,
      variantId,
      assetId,
      parentVariantIds: resolved.parentVariantIds,
      sourceImageKeys: effectiveSourceImageKeys,
      styleImageKeys: styleResult.styleImageKeys,
    };
  }

  /**
   * Create a refinement variant for an existing asset.
   * Does NOT trigger workflow - caller handles that.
   */
  async createRefineVariant(
    input: RefineVariantInput,
    meta: WebSocketMeta
  ): Promise<VariantCreationResult> {
    const variantId = crypto.randomUUID();

    // Get the asset
    const asset = await this.repo.getAssetById(input.assetId);
    if (!asset) {
      throw new Error(`Asset ${input.assetId} not found`);
    }
    const assetMediaKind = asset.media_kind ?? DEFAULT_MEDIA_KIND;
    if (input.mediaKind && input.mediaKind !== assetMediaKind) {
      throw new ValidationError(
        `Cannot create ${input.mediaKind} variant for ${assetMediaKind} asset`
      );
    }
    const mediaKind = input.mediaKind ?? assetMediaKind;

    // Resolve source variants
    const resolved = await this.resolveRefineReferences(
      asset,
      mediaKind,
      input.sourceVariantId,
      input.sourceVariantIds,
      input.referenceAssetIds
    );

    if (resolved.sourceImageKeys.length === 0 && resolved.parentVariantIds.length === 0) {
      throw new Error('No source media available');
    }

    const videoOptions = this.resolveRecipeVideoOptions(
      mediaKind,
      input.videoResolution,
      input.videoDurationSeconds,
      input.videoTier,
      input.model
    );
    const recipeModel = videoOptions.model ?? this.resolveRecipeModel(mediaKind, input.model);
    const recipeImageSize = this.resolveRecipeImageSize(mediaKind, input.imageSize, recipeModel);

    // Build recipe (includes parentVariantIds for retry support)
    let recipe: GenerationRecipe = {
      prompt: input.prompt,
      assetType: asset.type,
      mediaKind,
      model: recipeModel,
      aspectRatio: input.aspectRatio,
      imageSize: recipeImageSize,
      videoResolution: videoOptions.videoResolution,
      videoDurationSeconds: videoOptions.videoDurationSeconds,
      videoTier: videoOptions.videoTier,
      sourceImageKeys: resolved.sourceImageKeys.length > 0 ? resolved.sourceImageKeys : undefined,
      parentVariantIds: resolved.parentVariantIds.length > 0 ? resolved.parentVariantIds : undefined,
      operation: 'refine',
      generateAudio: mediaKind === 'video' ? input.generateAudio === true : undefined,
      voiceId: input.voiceId,
      dialogueVoiceIds: input.dialogueVoiceIds?.length ? input.dialogueVoiceIds : undefined,
      musicProvider: asset.type === 'music' ? input.musicProvider : undefined,
    };

    // Inject style anchoring
    const styleResult = await this.injectStyle(recipe, resolved.sourceImageKeys, input.disableStyle);
    recipe = styleResult.recipe;
    const effectiveSourceImageKeys = styleResult.sourceImageKeys;
    recipe = this.withVeoReferenceMode(recipe, effectiveSourceImageKeys, styleResult.styleImageKeys);
    this.validateImageModelReferenceLimit(recipe, effectiveSourceImageKeys);

    // Create placeholder variant
    const variant = await this.repo.createPlaceholderVariant({
      id: variantId,
      assetId: input.assetId,
      mediaKind,
      recipe: JSON.stringify(recipe),
      createdBy: meta.userId,
      planStepId: input.planStepId,
    });

    // Broadcast
    this.broadcast({ type: 'variant:created', variant });

    // Create lineage records
    await this.createLineageRecords(resolved.parentVariantIds, variantId, 'refined');

    return {
      asset,
      variant,
      variantId,
      assetId: input.assetId,
      parentVariantIds: resolved.parentVariantIds,
      sourceImageKeys: effectiveSourceImageKeys,
      styleImageKeys: styleResult.styleImageKeys,
    };
  }

  // ==========================================================================
  // Public Methods - Workflow
  // ==========================================================================

  /**
   * Trigger a generation workflow for a variant.
   * Returns the workflow instance ID.
   */
  async triggerWorkflow(
    requestId: string,
    variantId: string,
    result: VariantCreationResult,
    meta: WebSocketMeta,
    operation: OperationType,
    styleImageKeys?: string[]
  ): Promise<string | null> {
    if (!this.env.GENERATION_WORKFLOW) {
      log.warn('Generation workflow not configured', { spaceId: this.spaceId });
      return null;
    }

    // Parse recipe to get prompt
    const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;

    // Use styleImageKeys from argument or from result
    const effectiveStyleImageKeys = styleImageKeys || result.styleImageKeys;

    const workflowInput: GenerationWorkflowInput = {
      requestId,
      jobId: variantId,
      spaceId: this.spaceId,
      userId: meta.userId,
      prompt: recipe.prompt,
      assetId: result.assetId,
      assetName: result.asset.name,
      assetType: recipe.assetType,
      mediaKind: result.variant.media_kind ?? result.asset.media_kind ?? DEFAULT_MEDIA_KIND,
      model: recipe.model,
      aspectRatio: recipe.aspectRatio,
      imageSize: recipe.imageSize,
      sourceImageKeys: result.sourceImageKeys.length > 0 ? result.sourceImageKeys : undefined,
      parentVariantIds: result.parentVariantIds.length > 0 ? result.parentVariantIds : undefined,
      operation,
      styleImageKeys: effectiveStyleImageKeys?.length ? effectiveStyleImageKeys : undefined,
      veoReferenceMode: recipe.veoReferenceMode,
      videoResolution: recipe.videoResolution,
      videoDurationSeconds: recipe.videoDurationSeconds,
      videoTier: recipe.videoTier,
      generateAudio: recipe.generateAudio,
      modelProvider: recipe.modelProvider,
      voiceId: recipe.voiceId,
      dialogueVoiceIds: recipe.dialogueVoiceIds?.length ? recipe.dialogueVoiceIds : undefined,
      musicProvider: recipe.musicProvider,
    };

    const instance = await this.env.GENERATION_WORKFLOW.create({
      id: variantId,
      params: workflowInput,
    });

    // Update variant with workflow ID
    const updatedVariant = await this.repo.updateVariantWorkflow(variantId, instance.id, 'processing');
    if (updatedVariant) {
      this.broadcast({ type: 'variant:updated', variant: updatedVariant });
    }

    log.info('Started GenerationWorkflow', {
      requestId,
      spaceId: this.spaceId,
      userId: meta.userId,
      assetName: result.asset.name,
      assetId: result.assetId,
      variantId,
      operation,
      refCount: result.sourceImageKeys.length,
      workflowId: instance.id,
    });

    return instance.id;
  }

  // ==========================================================================
  // Public Methods - Reference Resolution
  // ==========================================================================

  /**
   * Resolve reference asset IDs to image keys and variant IDs.
   * Uses active variant of each referenced asset.
   */
  async resolveAssetReferences(
    referenceAssetIds: string[],
    mediaKind: MediaKind = DEFAULT_MEDIA_KIND
  ): Promise<ResolvedReferences> {
    const sourceImageKeys: string[] = [];
    const parentVariantIds: string[] = [];
    const includeMediaOnlyParents = mediaKind !== 'image';
    const requireProviderImage = mediaKind === 'image';

    for (const refAssetId of referenceAssetIds) {
      const asset = await this.repo.getAssetById(refAssetId);
      if (!asset) {
        if (requireProviderImage) {
          throw new ValidationError(`Reference asset ${refAssetId} not found`);
        }
        continue;
      }
      if (!asset.active_variant_id) {
        if (requireProviderImage) {
          throw new ValidationError(`Reference asset ${refAssetId} has no active variant`);
        }
        continue;
      }

      const resolved = await this.resolveVariantReference(
        asset.active_variant_id,
        includeMediaOnlyParents,
        requireProviderImage
      );
      sourceImageKeys.push(...resolved.sourceImageKeys);
      parentVariantIds.push(...resolved.parentVariantIds);
    }

    return { sourceImageKeys, parentVariantIds };
  }

  /**
   * Resolve explicit variant IDs to image keys (for ForgeTray UI).
   * Media-only references are lineage-only until a provider consumes media keys.
   */
  async resolveVariantReferences(
    referenceVariantIds: string[],
    mediaKind: MediaKind = DEFAULT_MEDIA_KIND
  ): Promise<ResolvedReferences> {
    const sourceImageKeys: string[] = [];
    const parentVariantIds: string[] = [];
    const includeMediaOnlyParents = mediaKind !== 'image';
    const requireProviderImage = mediaKind === 'image';

    for (const variantId of referenceVariantIds) {
      const resolved = await this.resolveVariantReference(
        variantId,
        includeMediaOnlyParents,
        requireProviderImage
      );
      sourceImageKeys.push(...resolved.sourceImageKeys);
      parentVariantIds.push(...resolved.parentVariantIds);
    }

    return { sourceImageKeys, parentVariantIds };
  }

  /**
   * Resolve source variant ID, using the active variant only when no explicit
   * source was requested.
   */
  async resolveSourceVariant(
    sourceVariantId: string | undefined,
    asset: Asset
  ): Promise<string | null> {
    let resolvedId = sourceVariantId || asset.active_variant_id;

    if (sourceVariantId && sourceVariantId !== asset.active_variant_id) {
      const exists = await this.repo.getVariantById(sourceVariantId);
      if (!exists) {
        throw new ValidationError(`Source variant ${sourceVariantId} not found`);
      }
    }

    return resolvedId;
  }

  // ==========================================================================
  // Public Methods - Batch Generation
  // ==========================================================================

  /**
   * Create multiple variants/assets for batch generation.
   * Resolves refs once, builds recipe once, injects style once, then creates N placeholders.
   */
  async createBatchVariants(
    input: CreateAssetVariantInput & { count: number; mode: BatchMode },
    meta: WebSocketMeta
  ): Promise<{ batchId: string; results: VariantCreationResult[] }> {
    const batchId = crypto.randomUUID();
    const results: VariantCreationResult[] = [];

    // Resolve references ONCE
    const resolved = await this.resolveAllReferences(
      input.referenceAssetIds,
      input.referenceVariantIds,
      input.mediaKind
    );

    const operation = determineOperation(resolved.parentVariantIds.length > 0);
    const mediaKind = input.mediaKind ?? DEFAULT_MEDIA_KIND;

    const videoOptions = this.resolveRecipeVideoOptions(
      mediaKind,
      input.videoResolution,
      input.videoDurationSeconds,
      input.videoTier,
      input.model
    );
    const recipeModel = videoOptions.model ?? this.resolveRecipeModel(mediaKind, input.model);
    const recipeImageSize = this.resolveRecipeImageSize(mediaKind, input.imageSize, recipeModel);

    // Build recipe ONCE
    let recipe: GenerationRecipe = {
      prompt: input.prompt || `Create a ${input.assetType} named "${input.name}"`,
      assetType: input.assetType,
      mediaKind: input.mediaKind,
      model: recipeModel,
      aspectRatio: input.aspectRatio,
      imageSize: recipeImageSize,
      videoResolution: videoOptions.videoResolution,
      videoDurationSeconds: videoOptions.videoDurationSeconds,
      videoTier: videoOptions.videoTier,
      sourceImageKeys: resolved.sourceImageKeys.length > 0 ? resolved.sourceImageKeys : undefined,
      parentVariantIds: resolved.parentVariantIds.length > 0 ? resolved.parentVariantIds : undefined,
      operation,
      generateAudio: mediaKind === 'video' ? input.generateAudio === true : undefined,
      voiceId: input.voiceId,
      dialogueVoiceIds: input.dialogueVoiceIds?.length ? input.dialogueVoiceIds : undefined,
      musicProvider: input.assetType === 'music' ? input.musicProvider : undefined,
    };

    // Inject style ONCE
    const styleResult = await this.injectStyle(recipe, resolved.sourceImageKeys, input.disableStyle);
    recipe = styleResult.recipe;
    const effectiveSourceImageKeys = styleResult.sourceImageKeys;
    recipe = this.withVeoReferenceMode(recipe, effectiveSourceImageKeys, styleResult.styleImageKeys);
    this.validateImageModelReferenceLimit(recipe, effectiveSourceImageKeys);

    // Auto-set parentAssetId from first reference
    let effectiveParentAssetId = input.parentAssetId;
    if (!effectiveParentAssetId && input.referenceAssetIds?.length) {
      effectiveParentAssetId = input.referenceAssetIds[0];
    } else if (!effectiveParentAssetId && input.referenceVariantIds?.length) {
      const firstVariant = await this.repo.getVariantById(input.referenceVariantIds[0]);
      if (firstVariant) {
        effectiveParentAssetId = firstVariant.asset_id;
      }
    }

    const recipeJson = JSON.stringify(recipe);

    if (input.mode === 'explore') {
      // Explore: 1 asset, N variants
      const assetId = crypto.randomUUID();
      const asset = await this.repo.createAsset({
        id: assetId,
        name: input.name,
        type: input.assetType,
        mediaKind: input.mediaKind,
        tags: [],
        parentAssetId: effectiveParentAssetId,
        createdBy: meta.userId,
      });
      this.broadcast({ type: 'asset:created', asset });

      for (let i = 0; i < input.count; i++) {
        const variantId = crypto.randomUUID();
        const variant = await this.repo.createPlaceholderVariant({
          id: variantId,
          assetId,
          mediaKind: input.mediaKind,
          recipe: recipeJson,
          createdBy: meta.userId,
          planStepId: input.planStepId,
          batchId,
        });

        // First variant is active
        if (i === 0) {
          await this.repo.updateAsset(assetId, { active_variant_id: variantId });
          asset.active_variant_id = variantId;
          this.broadcast({ type: 'asset:updated', asset });
        }

        this.broadcast({ type: 'variant:created', variant });

        // Create lineage records
        await this.createLineageRecords(resolved.parentVariantIds, variantId, 'derived');

        results.push({
          asset,
          variant,
          variantId,
          assetId,
          parentVariantIds: resolved.parentVariantIds,
          sourceImageKeys: effectiveSourceImageKeys,
          styleImageKeys: styleResult.styleImageKeys,
        });
      }
    } else {
      // Set: N assets, 1 variant each
      for (let i = 0; i < input.count; i++) {
        const assetId = crypto.randomUUID();
        const variantId = crypto.randomUUID();
        const assetName = `${input.name} #${i + 1}`;

        const asset = await this.repo.createAsset({
          id: assetId,
          name: assetName,
          type: input.assetType,
          mediaKind: input.mediaKind,
          tags: [],
          parentAssetId: effectiveParentAssetId,
          createdBy: meta.userId,
        });
        this.broadcast({ type: 'asset:created', asset });

        const variant = await this.repo.createPlaceholderVariant({
          id: variantId,
          assetId,
          mediaKind: input.mediaKind,
          recipe: recipeJson,
          createdBy: meta.userId,
          planStepId: input.planStepId,
          batchId,
        });

        await this.repo.updateAsset(assetId, { active_variant_id: variantId });
        asset.active_variant_id = variantId;

        this.broadcast({ type: 'variant:created', variant });
        this.broadcast({ type: 'asset:updated', asset });

        // Create lineage records
        await this.createLineageRecords(resolved.parentVariantIds, variantId, 'derived');

        results.push({
          asset,
          variant,
          variantId,
          assetId,
          parentVariantIds: resolved.parentVariantIds,
          sourceImageKeys: effectiveSourceImageKeys,
          styleImageKeys: styleResult.styleImageKeys,
        });
      }
    }

    return { batchId, results };
  }

  /**
   * Trigger workflows for all variants in a batch (in parallel).
   */
  async triggerBatchWorkflows(
    requestId: string,
    results: VariantCreationResult[],
    meta: WebSocketMeta,
    styleImageKeys?: string[]
  ): Promise<void> {
    const operation = results.length > 0 && results[0].parentVariantIds.length > 0 ? 'derive' as OperationType : 'generate' as OperationType;

    await Promise.all(results.map(r =>
      this.triggerWorkflow(requestId, r.variantId, r, meta, operation, styleImageKeys)
    ));
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Inject style anchoring into a recipe.
   * Prepends style description to prompt and style image keys to source images.
   */
  private async injectStyle(
    recipe: GenerationRecipe,
    sourceImageKeys: string[],
    disableStyle?: boolean
  ): Promise<{
    recipe: GenerationRecipe;
    sourceImageKeys: string[];
    styleImageKeys?: string[];
  }> {
    const mediaKind = recipe.mediaKind ?? DEFAULT_MEDIA_KIND;
    if (mediaKind !== 'image' && mediaKind !== 'video') {
      return { recipe, sourceImageKeys };
    }

    let effectiveRecipe = recipe;
    let effectiveSourceImageKeys = sourceImageKeys;
    if (mediaKind === 'video') {
      const capped = this.capVeoSourceImageKeys(recipe, sourceImageKeys);
      effectiveRecipe = capped.recipe;
      effectiveSourceImageKeys = capped.sourceImageKeys;
    }

    // If explicitly disabled, mark and return unchanged except media limits
    if (disableStyle) {
      return {
        recipe: { ...effectiveRecipe, styleOverride: true },
        sourceImageKeys: effectiveSourceImageKeys,
      };
    }

    // Fetch active style
    const style = await this.repo.getActiveStyle();
    if (!style || !style.enabled) {
      return { recipe: effectiveRecipe, sourceImageKeys: effectiveSourceImageKeys };
    }

    // Parse style image keys
    let styleImageKeys: string[] = [];
    try {
      styleImageKeys = JSON.parse(style.image_keys);
    } catch {
      // Ignore parse errors
    }

    if (mediaKind === 'video') {
      const sourceBudget = effectiveSourceImageKeys.length;
      const styleBudget = MAX_VEO_REFERENCE_IMAGES - sourceBudget;

      if (styleImageKeys.length + effectiveSourceImageKeys.length > MAX_VEO_REFERENCE_IMAGES) {
        log.warn('Style + source images exceed Veo limit, capping reference images', {
          styleImages: styleImageKeys.length,
          sourceImages: effectiveSourceImageKeys.length,
          maxImages: MAX_VEO_REFERENCE_IMAGES,
        });
      }

      styleImageKeys = styleImageKeys.slice(0, styleBudget);
    } else if (styleImageKeys.length + sourceImageKeys.length > this.getImageModelReferenceLimit(recipe)) {
      log.warn('Style + source images exceed limit, skipping style images', {
        styleImages: styleImageKeys.length,
        sourceImages: sourceImageKeys.length,
      });
      // Still prepend description but skip style images
      styleImageKeys = [];
    }

    // Prepend style description to prompt
    let styledPrompt = effectiveRecipe.prompt;
    if (style.description) {
      const builder = new PromptBuilder();
      builder.withStyle(style.description);
      styledPrompt = builder.build() + '\n\n' + effectiveRecipe.prompt;
    }

    // Prepend style image keys to source images (style refs come first)
    const combinedSourceImageKeys = [...styleImageKeys, ...effectiveSourceImageKeys];

    // Update recipe
    const updatedRecipe: GenerationRecipe = {
      ...effectiveRecipe,
      prompt: styledPrompt,
      sourceImageKeys: combinedSourceImageKeys.length > 0 ? combinedSourceImageKeys : undefined,
      styleImageKeys: styleImageKeys.length > 0 ? styleImageKeys : undefined,
      styleId: style.id,
    };

    return {
      recipe: updatedRecipe,
      sourceImageKeys: combinedSourceImageKeys,
      styleImageKeys: styleImageKeys.length > 0 ? styleImageKeys : undefined,
    };
  }

  private withVeoReferenceMode(
    recipe: GenerationRecipe,
    sourceImageKeys: string[],
    styleImageKeys?: string[]
  ): GenerationRecipe {
    if (recipe.mediaKind !== 'video') {
      return recipe;
    }

    return {
      ...recipe,
      veoReferenceMode: determineVeoReferenceMode(sourceImageKeys.length, styleImageKeys?.length ?? 0),
    };
  }

  private resolveRecipeVideoOptions(
    mediaKind: MediaKind | undefined,
    resolution?: VideoGenerationResolution,
    durationSeconds?: VideoGenerationDurationSeconds,
    tier?: VideoGenerationTier,
    model?: string
  ): {
    model?: string;
    videoResolution?: VideoGenerationResolution;
    videoDurationSeconds?: VideoGenerationDurationSeconds;
    videoTier?: VideoGenerationTier;
  } {
    const effectiveMediaKind = mediaKind ?? DEFAULT_MEDIA_KIND;
    const hasVideoOption = resolution !== undefined || durationSeconds !== undefined || tier !== undefined;
    if (effectiveMediaKind !== 'video') {
      if (hasVideoOption) {
        throw new ValidationError('Video options are only supported for video generation');
      }
      return {};
    }

    const normalizedResolution = resolution === undefined
      ? DEFAULT_VIDEO_GENERATION_RESOLUTION
      : normalizeVideoGenerationResolution(resolution);
    if (!normalizedResolution) {
      throw new ValidationError('Video resolution must be 720p, 1080p, or 4k');
    }

    const normalizedDuration = durationSeconds === undefined
      ? DEFAULT_VIDEO_GENERATION_DURATION_SECONDS
      : normalizeVideoGenerationDurationSeconds(durationSeconds);
    if (!normalizedDuration) {
      throw new ValidationError('Video duration must be 4, 6, or 8 seconds');
    }

    const modelTier = getVideoGenerationTierForModel(model);
    const normalizedTier = tier === undefined
      ? modelTier ?? DEFAULT_VIDEO_GENERATION_TIER
      : normalizeVideoGenerationTier(tier);
    if (!normalizedTier) {
      throw new ValidationError('Video tier must be generate, fast, or lite');
    }
    if (!isVideoGenerationResolutionSupportedForTier(normalizedResolution, normalizedTier)) {
      throw new ValidationError('Video resolution 4k is not supported for the lite tier');
    }

    return {
      model: getVideoGenerationModelForTier(normalizedTier),
      videoResolution: normalizedResolution,
      videoDurationSeconds: normalizedDuration,
      videoTier: normalizedTier,
    };
  }

  private resolveRecipeModel(mediaKind: MediaKind | undefined, model?: string): string | undefined {
    const effectiveMediaKind = mediaKind ?? DEFAULT_MEDIA_KIND;
    if (effectiveMediaKind === 'video') return undefined;
    if (effectiveMediaKind !== 'image') return undefined;
    if (!model) return DEFAULT_IMAGE_MODEL_ID;

    if (isImageModelSelection(model)) return resolveImageModelSelection(model);
    if (isImageModelId(model)) return model;

    throw new ValidationError('--model must be pro, flash, or an exact image model ID');
  }

  private resolveRecipeImageSize(
    mediaKind: MediaKind | undefined,
    imageSize: string | undefined,
    model?: string
  ): string | undefined {
    const effectiveMediaKind = mediaKind ?? DEFAULT_MEDIA_KIND;
    if (effectiveMediaKind !== 'image') return undefined;
    if (!imageSize) return undefined;

    const normalized = normalizeImageSize(imageSize);
    if (!normalized) {
      throw new ValidationError('--size must be 1K, 2K, or 4K');
    }
    const imageModel = this.resolveImageModelIdForCapabilities(model);
    if (!isImageSizeSupportedByModel(imageModel, normalized)) {
      const supportedSizes = getImageModelCapabilities(imageModel).supportedImageSizes.join(', ');
      throw new ValidationError(`Image model ${imageModel} supports only ${supportedSizes} output`);
    }
    return normalized;
  }

  private validateImageModelReferenceLimit(
    recipe: GenerationRecipe,
    sourceImageKeys: string[]
  ): void {
    const mediaKind = recipe.mediaKind ?? DEFAULT_MEDIA_KIND;
    if (mediaKind !== 'image') {
      return;
    }

    const capabilities = getImageModelCapabilities(this.resolveImageModelIdForCapabilities(recipe.model));
    if (sourceImageKeys.length <= capabilities.maxReferenceImages) return;

    const noun = capabilities.maxReferenceImages === 1 ? 'image' : 'images';
    throw new ValidationError(
      `Image model ${capabilities.modelId} supports at most ${capabilities.maxReferenceImages} reference ${noun}`
    );
  }

  private getImageModelReferenceLimit(recipe: GenerationRecipe): number {
    return getImageModelCapabilities(this.resolveImageModelIdForCapabilities(recipe.model)).maxReferenceImages;
  }

  private resolveImageModelIdForCapabilities(model?: string): ImageModelId {
    if (!model) return resolveImageModelSelection();
    if (isImageModelId(model)) return model;
    if (isImageModelSelection(model)) return resolveImageModelSelection(model);
    throw new ValidationError('--model must be pro, flash, or an exact image model ID');
  }

  private capVeoSourceImageKeys(
    recipe: GenerationRecipe,
    sourceImageKeys: string[]
  ): {
    recipe: GenerationRecipe;
    sourceImageKeys: string[];
  } {
    if (sourceImageKeys.length <= MAX_VEO_REFERENCE_IMAGES) {
      return { recipe, sourceImageKeys };
    }

    const cappedSourceImageKeys = sourceImageKeys.slice(0, MAX_VEO_REFERENCE_IMAGES);
    log.warn('Source images exceed Veo limit, capping reference images', {
      sourceImages: sourceImageKeys.length,
      maxImages: MAX_VEO_REFERENCE_IMAGES,
    });

    return {
      recipe: {
        ...recipe,
        sourceImageKeys: cappedSourceImageKeys,
      },
      sourceImageKeys: cappedSourceImageKeys,
    };
  }

  /**
   * Resolve all references, preferring explicit variant IDs over asset IDs.
   */
  private async resolveAllReferences(
    referenceAssetIds?: string[],
    referenceVariantIds?: string[],
    mediaKind: MediaKind = DEFAULT_MEDIA_KIND
  ): Promise<ResolvedReferences> {
    if (referenceVariantIds?.length) {
      return this.resolveVariantReferences(referenceVariantIds, mediaKind);
    }
    if (referenceAssetIds?.length) {
      return this.resolveAssetReferences(referenceAssetIds, mediaKind);
    }
    return { sourceImageKeys: [], parentVariantIds: [] };
  }

  /**
   * Resolve references for a refine operation.
   */
  private async resolveRefineReferences(
    asset: Asset,
    mediaKind: MediaKind,
    sourceVariantId?: string,
    sourceVariantIds?: string[],
    referenceAssetIds?: string[]
  ): Promise<ResolvedReferences> {
    let sourceImageKeys: string[] = [];
    let parentVariantIds: string[] = [];

    if (sourceVariantIds?.length) {
      // ForgeTray path: use explicit variant IDs
      const resolved = await this.resolveVariantReferences(sourceVariantIds, mediaKind);
      sourceImageKeys = resolved.sourceImageKeys;
      parentVariantIds = resolved.parentVariantIds;
    } else {
      // Legacy path: single sourceVariantId, or active variant when omitted
      const resolvedId = await this.resolveSourceVariant(sourceVariantId, asset);
      if (!resolvedId) {
        return { sourceImageKeys: [], parentVariantIds: [] };
      }

      const resolved = await this.resolveVariantReference(
        resolvedId,
        mediaKind !== 'image',
        mediaKind === 'image'
      );
      sourceImageKeys = resolved.sourceImageKeys;
      parentVariantIds = resolved.parentVariantIds;
    }

    // Add additional asset references
    if (referenceAssetIds?.length) {
      const additionalRefs = await this.resolveAssetReferences(referenceAssetIds, mediaKind);
      sourceImageKeys = [...sourceImageKeys, ...additionalRefs.sourceImageKeys];
      parentVariantIds = [...parentVariantIds, ...additionalRefs.parentVariantIds];
    }

    return { sourceImageKeys, parentVariantIds };
  }

  /**
   * Resolve a variant as an image reference when possible. Media-only variants
   * can still be lineage parents for non-image generation, but they are not
   * passed to image-reference model inputs.
   */
  private async resolveVariantReference(
    variantId: string,
    includeMediaOnlyParent: boolean,
    requireProviderImage = false
  ): Promise<ResolvedReferences> {
    const variant = await this.repo.getVariantById(variantId);
    const imageKey = variant?.image_key ?? await this.repo.getVariantImageKey(variantId);

    if (imageKey) {
      return { sourceImageKeys: [imageKey], parentVariantIds: [variantId] };
    }

    if (requireProviderImage) {
      throw new ValidationError(`Reference variant ${variantId} is not a completed image variant`);
    }

    if (includeMediaOnlyParent && variant?.media_key) {
      return { sourceImageKeys: [], parentVariantIds: [variantId] };
    }

    return { sourceImageKeys: [], parentVariantIds: [] };
  }

  /**
   * Create lineage records for parent variants.
   */
  private async createLineageRecords(
    parentVariantIds: string[],
    childVariantId: string,
    relationType: 'derived' | 'refined' | 'forked'
  ): Promise<void> {
    // Debug: Log lineage creation attempt
    log.info('Creating lineage records', {
      parentVariantIds,
      childVariantId,
      relationType,
      count: parentVariantIds.length,
    });

    for (const parentId of parentVariantIds) {
      const lineage = await this.repo.createLineage({
        id: crypto.randomUUID(),
        parentVariantId: parentId,
        childVariantId,
        relationType,
      });
      log.info('Created lineage record', { lineageId: lineage.id, parentId, childVariantId });
      this.broadcast({ type: 'lineage:created', lineage });
    }
  }
}
