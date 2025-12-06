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
import type { GenerationWorkflowInput, OperationType } from '../../../workflows/types';
import type { SpaceRepository } from '../repository/SpaceRepository';
import type { BroadcastFn } from '../controllers/types';
import type { Env } from '../../../../core/types';
import { loggers } from '../../../../shared/logger';

const log = loggers.generationController;

// ============================================================================
// Types
// ============================================================================

/** Recipe stored with variant for retry capability */
export interface GenerationRecipe {
  prompt: string;
  assetType: string;
  aspectRatio?: string;
  sourceImageKeys?: string[];
  /** Parent variant IDs for retry support (in case lineage records are missing) */
  parentVariantIds?: string[];
  /** Operation type matching user-facing tool name */
  operation: OperationType;
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
}

/** Result of variant creation */
export interface VariantCreationResult {
  asset: Asset;
  variant: Variant;
  variantId: string;
  assetId: string;
  parentVariantIds: string[];
  sourceImageKeys: string[];
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

    // Determine operation: 'generate' if no refs, 'derive' if using refs
    const operation = determineOperation(resolved.parentVariantIds.length > 0);

    // Build recipe (includes parentVariantIds for retry support)
    const recipe: GenerationRecipe = {
      prompt: input.prompt || `Create a ${input.assetType} named "${input.name}"`,
      assetType: input.assetType,
      aspectRatio: input.aspectRatio,
      sourceImageKeys: resolved.sourceImageKeys.length > 0 ? resolved.sourceImageKeys : undefined,
      parentVariantIds: resolved.parentVariantIds.length > 0 ? resolved.parentVariantIds : undefined,
      operation,
    };

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
      sourceImageKeys: resolved.sourceImageKeys,
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
    const recipe: GenerationRecipe = {
      prompt: input.prompt,
      assetType: asset.type,
      aspectRatio: input.aspectRatio,
      sourceImageKeys: resolved.sourceImageKeys,
      parentVariantIds: resolved.parentVariantIds.length > 0 ? resolved.parentVariantIds : undefined,
      operation: 'refine',
    };

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
      sourceImageKeys: resolved.sourceImageKeys,
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
    operation: OperationType
  ): Promise<string | null> {
    if (!this.env.GENERATION_WORKFLOW) {
      log.warn('Generation workflow not configured', { spaceId: this.spaceId });
      return null;
    }

    // Parse recipe to get prompt
    const recipe = JSON.parse(result.variant.recipe) as GenerationRecipe;

    const workflowInput: GenerationWorkflowInput = {
      requestId,
      jobId: variantId,
      spaceId: this.spaceId,
      userId: meta.userId,
      prompt: recipe.prompt,
      assetId: result.assetId,
      assetName: result.asset.name,
      assetType: recipe.assetType,
      aspectRatio: recipe.aspectRatio,
      sourceImageKeys: result.sourceImageKeys.length > 0 ? result.sourceImageKeys : undefined,
      parentVariantIds: result.parentVariantIds.length > 0 ? result.parentVariantIds : undefined,
      operation,
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
  // Private Helpers
  // ==========================================================================

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
    for (const parentId of parentVariantIds) {
      const lineage = await this.repo.createLineage({
        id: crypto.randomUUID(),
        parentVariantId: parentId,
        childVariantId,
        relationType,
      });
      this.broadcast({ type: 'lineage:created', lineage });
    }
  }
}
