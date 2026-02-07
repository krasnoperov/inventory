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
import type { BroadcastFn } from '../controllers/types';
import type { Env } from '../../../../core/types';
import { resolveImageModel } from '../../../services/nanoBananaService';
import { PromptBuilder } from './PromptBuilder';
import { loggers } from '../../../../shared/logger';

const log = loggers.generationController;

// ============================================================================
// Types
// ============================================================================

/** Recipe stored with variant for retry capability */
export interface GenerationRecipe {
  prompt: string;
  assetType: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  sourceImageKeys?: string[];
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
  /** Generation prompt */
  prompt?: string;
  /** Aspect ratio */
  aspectRatio?: string;
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
}

/** Input for refining an existing asset */
export interface RefineVariantInput {
  /** Target asset ID */
  assetId: string;
  /** Refinement prompt */
  prompt: string;
  /** Aspect ratio */
  aspectRatio?: string;
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

    // Create the asset
    const asset = await this.repo.createAsset({
      id: assetId,
      name: input.name,
      type: input.assetType,
      tags: [],
      parentAssetId: effectiveParentAssetId,
      createdBy: meta.userId,
    });
    this.broadcast({ type: 'asset:created', asset });

    // Resolve references
    const resolved = await this.resolveAllReferences(
      input.referenceAssetIds,
      input.referenceVariantIds
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

    // Build recipe (includes parentVariantIds for retry support)
    let recipe: GenerationRecipe = {
      prompt: input.prompt || `Create a ${input.assetType} named "${input.name}"`,
      assetType: input.assetType,
      aspectRatio: input.aspectRatio,
      sourceImageKeys: resolved.sourceImageKeys.length > 0 ? resolved.sourceImageKeys : undefined,
      parentVariantIds: resolved.parentVariantIds.length > 0 ? resolved.parentVariantIds : undefined,
      operation,
    };

    // Inject style anchoring
    const styleResult = await this.injectStyle(recipe, resolved.sourceImageKeys, input.disableStyle);
    recipe = styleResult.recipe;
    const effectiveSourceImageKeys = styleResult.sourceImageKeys;

    // Create placeholder variant
    const variant = await this.repo.createPlaceholderVariant({
      id: variantId,
      assetId,
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

    // Resolve source variants
    const resolved = await this.resolveRefineReferences(
      asset,
      input.sourceVariantId,
      input.sourceVariantIds,
      input.referenceAssetIds
    );

    if (resolved.sourceImageKeys.length === 0) {
      throw new Error('No source images available');
    }

    // Build recipe (includes parentVariantIds for retry support)
    let recipe: GenerationRecipe = {
      prompt: input.prompt,
      assetType: asset.type,
      aspectRatio: input.aspectRatio,
      sourceImageKeys: resolved.sourceImageKeys,
      parentVariantIds: resolved.parentVariantIds.length > 0 ? resolved.parentVariantIds : undefined,
      operation: 'refine',
    };

    // Inject style anchoring
    const styleResult = await this.injectStyle(recipe, resolved.sourceImageKeys, input.disableStyle);
    recipe = styleResult.recipe;
    const effectiveSourceImageKeys = styleResult.sourceImageKeys;

    // Create placeholder variant
    const variant = await this.repo.createPlaceholderVariant({
      id: variantId,
      assetId: input.assetId,
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
      model: recipe.model,
      aspectRatio: recipe.aspectRatio,
      imageSize: recipe.imageSize,
      sourceImageKeys: result.sourceImageKeys.length > 0 ? result.sourceImageKeys : undefined,
      parentVariantIds: result.parentVariantIds.length > 0 ? result.parentVariantIds : undefined,
      operation,
      styleImageKeys: effectiveStyleImageKeys?.length ? effectiveStyleImageKeys : undefined,
      modelProvider: recipe.modelProvider,
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
  async resolveAssetReferences(referenceAssetIds: string[]): Promise<ResolvedReferences> {
    const sourceImageKeys: string[] = [];
    const parentVariantIds: string[] = [];

    for (const refAssetId of referenceAssetIds) {
      const asset = await this.repo.getAssetById(refAssetId);
      if (asset?.active_variant_id) {
        const imageKey = await this.repo.getVariantImageKey(asset.active_variant_id);
        if (imageKey) {
          sourceImageKeys.push(imageKey);
          parentVariantIds.push(asset.active_variant_id);
        }
      }
    }

    return { sourceImageKeys, parentVariantIds };
  }

  /**
   * Resolve explicit variant IDs to image keys (for ForgeTray UI).
   */
  async resolveVariantReferences(referenceVariantIds: string[]): Promise<ResolvedReferences> {
    const sourceImageKeys: string[] = [];
    const parentVariantIds: string[] = [];

    for (const variantId of referenceVariantIds) {
      const imageKey = await this.repo.getVariantImageKey(variantId);
      if (imageKey) {
        sourceImageKeys.push(imageKey);
        parentVariantIds.push(variantId);
      }
    }

    return { sourceImageKeys, parentVariantIds };
  }

  /**
   * Resolve source variant ID with fallback to active variant.
   */
  async resolveSourceVariant(
    sourceVariantId: string | undefined,
    asset: Asset
  ): Promise<string | null> {
    let resolvedId = sourceVariantId || asset.active_variant_id;

    if (sourceVariantId && sourceVariantId !== asset.active_variant_id) {
      const exists = await this.repo.getVariantById(sourceVariantId);
      if (!exists) {
        resolvedId = asset.active_variant_id;
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
      input.referenceVariantIds
    );

    const operation = determineOperation(resolved.parentVariantIds.length > 0);

    // Build recipe ONCE — batch/explore defaults to flash model
    let recipe: GenerationRecipe = {
      prompt: input.prompt || `Create a ${input.assetType} named "${input.name}"`,
      assetType: input.assetType,
      model: resolveImageModel('flash'),
      aspectRatio: input.aspectRatio,
      sourceImageKeys: resolved.sourceImageKeys.length > 0 ? resolved.sourceImageKeys : undefined,
      parentVariantIds: resolved.parentVariantIds.length > 0 ? resolved.parentVariantIds : undefined,
      operation,
    };

    // Inject style ONCE
    const styleResult = await this.injectStyle(recipe, resolved.sourceImageKeys, input.disableStyle);
    recipe = styleResult.recipe;
    const effectiveSourceImageKeys = styleResult.sourceImageKeys;

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
          tags: [],
          parentAssetId: effectiveParentAssetId,
          createdBy: meta.userId,
        });
        this.broadcast({ type: 'asset:created', asset });

        const variant = await this.repo.createPlaceholderVariant({
          id: variantId,
          assetId,
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
    // If explicitly disabled, mark and return unchanged
    if (disableStyle) {
      return {
        recipe: { ...recipe, styleOverride: true },
        sourceImageKeys,
      };
    }

    // Fetch active style
    const style = await this.repo.getActiveStyle();
    if (!style || !style.enabled) {
      return { recipe, sourceImageKeys };
    }

    // Parse style image keys
    let styleImageKeys: string[] = [];
    try {
      styleImageKeys = JSON.parse(style.image_keys);
    } catch {
      // Ignore parse errors
    }

    // Validate total image count (Gemini limit: ~14-16 images)
    if (styleImageKeys.length + sourceImageKeys.length > 14) {
      log.warn('Style + source images exceed limit, skipping style images', {
        styleImages: styleImageKeys.length,
        sourceImages: sourceImageKeys.length,
      });
      // Still prepend description but skip style images
      styleImageKeys = [];
    }

    // Prepend style description to prompt
    let styledPrompt = recipe.prompt;
    if (style.description) {
      const builder = new PromptBuilder();
      builder.withStyle(style.description);
      styledPrompt = builder.build() + '\n\n' + recipe.prompt;
    }

    // Prepend style image keys to source images (style refs come first)
    const combinedSourceImageKeys = [...styleImageKeys, ...sourceImageKeys];

    // Update recipe
    const updatedRecipe: GenerationRecipe = {
      ...recipe,
      prompt: styledPrompt,
      sourceImageKeys: combinedSourceImageKeys.length > 0 ? combinedSourceImageKeys : undefined,
      styleId: style.id,
    };

    return {
      recipe: updatedRecipe,
      sourceImageKeys: combinedSourceImageKeys,
      styleImageKeys: styleImageKeys.length > 0 ? styleImageKeys : undefined,
    };
  }

  /**
   * Resolve all references, preferring explicit variant IDs over asset IDs.
   */
  private async resolveAllReferences(
    referenceAssetIds?: string[],
    referenceVariantIds?: string[]
  ): Promise<ResolvedReferences> {
    if (referenceVariantIds?.length) {
      return this.resolveVariantReferences(referenceVariantIds);
    }
    if (referenceAssetIds?.length) {
      return this.resolveAssetReferences(referenceAssetIds);
    }
    return { sourceImageKeys: [], parentVariantIds: [] };
  }

  /**
   * Resolve references for a refine operation.
   */
  private async resolveRefineReferences(
    asset: Asset,
    sourceVariantId?: string,
    sourceVariantIds?: string[],
    referenceAssetIds?: string[]
  ): Promise<ResolvedReferences> {
    let sourceImageKeys: string[] = [];
    let parentVariantIds: string[] = [];

    if (sourceVariantIds?.length) {
      // ForgeTray path: use explicit variant IDs
      const resolved = await this.resolveVariantReferences(sourceVariantIds);
      sourceImageKeys = resolved.sourceImageKeys;
      parentVariantIds = resolved.parentVariantIds;
    } else {
      // Legacy path: single sourceVariantId or fall back to active variant
      const resolvedId = await this.resolveSourceVariant(sourceVariantId, asset);
      if (!resolvedId) {
        return { sourceImageKeys: [], parentVariantIds: [] };
      }

      const sourceVariant = await this.repo.getVariantById(resolvedId);
      if (!sourceVariant?.image_key) {
        return { sourceImageKeys: [], parentVariantIds: [] };
      }

      sourceImageKeys = [sourceVariant.image_key];
      parentVariantIds = [resolvedId];
    }

    // Add additional asset references
    if (referenceAssetIds?.length) {
      const additionalRefs = await this.resolveAssetReferences(referenceAssetIds);
      sourceImageKeys = [...sourceImageKeys, ...additionalRefs.sourceImageKeys];
      parentVariantIds = [...parentVariantIds, ...additionalRefs.parentVariantIds];
    }

    return { sourceImageKeys, parentVariantIds };
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
