/**
 * Generation Controller
 *
 * Handles workflow triggers for generation and refinement.
 * Creates placeholder variants upfront and updates them when workflows complete.
 *
 * Uses VariantFactory for shared variant creation logic.
 *
 * Billing:
 * - preCheck quota/rate limits BEFORE triggering workflows
 * - Track usage AFTER successful completion (not during workflow)
 */

import type { Variant, WebSocketMeta } from '../types';
import type { RotationController } from './RotationController';
import type { TileController } from './TileController';
import type {
  GenerateRequestMessage,
  RefineRequestMessage,
  BatchRequestMessage,
  GenerationWorkflowInput,
} from '../../../workflows/types';
import { BaseController, type ControllerContext, NotFoundError, ValidationError } from './types';
import {
  preCheck,
  incrementRateLimit,
  trackImageGeneration,
} from '../billing/usageCheck';
import {
  VariantFactory,
  determineOperation,
  type GenerationRecipe,
} from '../generation/VariantFactory';
import { loggers } from '../../../../shared/logger';

const log = loggers.generationController;

export class GenerationController extends BaseController {
  private readonly variantFactory: VariantFactory;
  private rotationCtrl?: RotationController;
  private tileCtrl?: TileController;

  constructor(ctx: ControllerContext) {
    super(ctx);
    this.variantFactory = new VariantFactory(ctx.spaceId, ctx.repo, ctx.env, ctx.broadcast);
  }

  /** Set pipeline controllers (called after all controllers are initialized to avoid circular deps) */
  setPipelineControllers(rotation: RotationController, tile: TileController): void {
    this.rotationCtrl = rotation;
    this.tileCtrl = tile;
  }

  // ==========================================================================
  // WebSocket Handlers - Workflow Triggers
  // ==========================================================================

  /**
   * Handle generate:request WebSocket message
   * Creates asset, placeholder variant, lineage, then triggers workflow
   */
  async handleGenerateRequest(
    ws: WebSocket,
    meta: WebSocketMeta,
    msg: GenerateRequestMessage
  ): Promise<void> {
    this.requireEditor(meta);

    if (!this.env.GENERATION_WORKFLOW) {
      throw new ValidationError('Generation workflow not configured');
    }

    // Check quota and rate limits before triggering workflow
    if (this.env.DB) {
      const check = await preCheck(this.env.DB, parseInt(meta.userId), 'nanobanana');
      if (!check.allowed) {
        this.send(ws, {
          type: 'generate:error',
          requestId: msg.requestId,
          error: check.denyMessage || 'Request denied',
          code: check.denyReason === 'rate_limited' ? 'RATE_LIMITED' : 'QUOTA_EXCEEDED',
        });
        return;
      }
      await incrementRateLimit(this.env.DB, parseInt(meta.userId));
    }

    // Use factory to create asset + variant + lineage
    const result = await this.variantFactory.createAssetWithVariant(
      {
        name: msg.name,
        assetType: msg.assetType,
        prompt: msg.prompt,
        aspectRatio: msg.aspectRatio,
        parentAssetId: msg.parentAssetId,
        referenceAssetIds: msg.referenceAssetIds,
        referenceVariantIds: msg.referenceVariantIds,
        disableStyle: msg.disableStyle,
      },
      meta
    );

    // Send generate:started so requestId can be correlated with variantId
    this.broadcast({
      type: 'generate:started',
      requestId: msg.requestId,
      jobId: result.variantId,
      assetId: result.assetId,
      assetName: msg.name,
    });

    // Determine operation and trigger workflow
    const operation = determineOperation(result.parentVariantIds.length > 0);
    await this.variantFactory.triggerWorkflow(
      msg.requestId,
      result.variantId,
      result,
      meta,
      operation
    );
  }

  /**
   * Handle refine:request WebSocket message
   * Creates placeholder variant, lineage, then triggers workflow for refinement
   */
  async handleRefineRequest(
    ws: WebSocket,
    meta: WebSocketMeta,
    msg: RefineRequestMessage
  ): Promise<void> {
    this.requireEditor(meta);

    if (!this.env.GENERATION_WORKFLOW) {
      throw new ValidationError('Generation workflow not configured');
    }

    // Check quota and rate limits before triggering workflow
    if (this.env.DB) {
      const check = await preCheck(this.env.DB, parseInt(meta.userId), 'nanobanana');
      if (!check.allowed) {
        this.send(ws, {
          type: 'refine:error',
          requestId: msg.requestId,
          error: check.denyMessage || 'Request denied',
          code: check.denyReason === 'rate_limited' ? 'RATE_LIMITED' : 'QUOTA_EXCEEDED',
        });
        return;
      }
      await incrementRateLimit(this.env.DB, parseInt(meta.userId));
    }

    // Use factory to create refine variant + lineage
    const result = await this.variantFactory.createRefineVariant(
      {
        assetId: msg.assetId,
        prompt: msg.prompt,
        aspectRatio: msg.aspectRatio,
        sourceVariantId: msg.sourceVariantId,
        sourceVariantIds: msg.sourceVariantIds,
        referenceAssetIds: msg.referenceAssetIds,
        disableStyle: msg.disableStyle,
      },
      meta
    );

    // Send refine:started so requestId can be correlated with variantId
    this.broadcast({
      type: 'refine:started',
      requestId: msg.requestId,
      jobId: result.variantId,
      assetId: msg.assetId,
      assetName: result.asset.name,
    });

    // Trigger workflow
    await this.variantFactory.triggerWorkflow(
      msg.requestId,
      result.variantId,
      result,
      meta,
      'refine'
    );
  }

  /**
   * Handle batch:request WebSocket message
   * Creates multiple variants/assets and triggers workflows in parallel
   */
  async handleBatchRequest(
    ws: WebSocket,
    meta: WebSocketMeta,
    msg: BatchRequestMessage
  ): Promise<void> {
    this.requireEditor(meta);

    if (!this.env.GENERATION_WORKFLOW) {
      throw new ValidationError('Generation workflow not configured');
    }

    // Validate count
    if (msg.count < 2 || msg.count > 8) {
      throw new ValidationError('Batch count must be between 2 and 8');
    }

    // Check quota for the entire batch
    if (this.env.DB) {
      const check = await preCheck(this.env.DB, parseInt(meta.userId), 'nanobanana');
      if (!check.allowed) {
        this.send(ws, {
          type: 'batch:error',
          requestId: msg.requestId,
          error: check.denyMessage || 'Request denied',
          code: check.denyReason === 'rate_limited' ? 'RATE_LIMITED' : 'QUOTA_EXCEEDED',
        });
        return;
      }
      await incrementRateLimit(this.env.DB, parseInt(meta.userId));
    }

    // Use factory to create batch variants
    const { batchId, results } = await this.variantFactory.createBatchVariants(
      {
        name: msg.name,
        assetType: msg.assetType,
        prompt: msg.prompt,
        aspectRatio: msg.aspectRatio,
        parentAssetId: msg.parentAssetId,
        referenceAssetIds: msg.referenceAssetIds,
        referenceVariantIds: msg.referenceVariantIds,
        disableStyle: msg.disableStyle,
        count: msg.count,
        mode: msg.mode,
      },
      meta
    );

    // Broadcast batch:started
    this.broadcast({
      type: 'batch:started',
      requestId: msg.requestId,
      batchId,
      jobIds: results.map(r => r.variantId),
      assetIds: [...new Set(results.map(r => r.assetId))],
      count: msg.count,
      mode: msg.mode,
    });

    // Trigger all workflows in parallel
    await this.variantFactory.triggerBatchWorkflows(
      msg.requestId,
      results,
      meta,
      results[0]?.styleImageKeys
    );
  }

  /**
   * Handle variant:retry WebSocket message
   * Retries a failed variant generation
   */
  async handleRetryRequest(
    ws: WebSocket,
    meta: WebSocketMeta,
    variantId: string
  ): Promise<void> {
    this.requireEditor(meta);

    if (!this.env.GENERATION_WORKFLOW) {
      throw new ValidationError('Generation workflow not configured');
    }

    // Get the failed variant
    const variant = await this.repo.getVariantById(variantId);
    if (!variant) {
      throw new NotFoundError('Variant not found');
    }

    if (variant.status !== 'failed') {
      throw new ValidationError('Can only retry failed variants');
    }

    // Parse the recipe to get original generation params
    let recipe: GenerationRecipe;
    try {
      recipe = JSON.parse(variant.recipe) as GenerationRecipe;
    } catch {
      throw new ValidationError('Invalid recipe format');
    }

    // Get the asset
    const asset = await this.repo.getAssetById(variant.asset_id);
    if (!asset) {
      throw new NotFoundError('Asset not found');
    }

    // Reset variant for retry
    const resetVariant = await this.repo.resetVariantForRetry(variantId);
    if (!resetVariant) {
      throw new NotFoundError('Failed to reset variant');
    }

    // Broadcast the reset
    this.broadcast({ type: 'variant:updated', variant: resetVariant });

    // Build workflow input from stored recipe
    const workflowInput: GenerationWorkflowInput = {
      requestId: crypto.randomUUID(),
      jobId: variantId,
      spaceId: this.spaceId,
      userId: meta.userId,
      prompt: recipe.prompt,
      assetId: variant.asset_id,
      assetName: asset.name,
      assetType: recipe.assetType,
      aspectRatio: recipe.aspectRatio,
      sourceImageKeys: recipe.sourceImageKeys,
      operation: recipe.operation,
    };

    // Trigger the workflow
    const instance = await this.env.GENERATION_WORKFLOW.create({
      id: variantId,
      params: workflowInput,
    });

    // Update variant with new workflow ID
    const updatedVariant = await this.repo.updateVariantWorkflow(variantId, instance.id, 'processing');
    if (updatedVariant) {
      this.broadcast({ type: 'variant:updated', variant: updatedVariant });
    }

    log.info('Retrying variant', {
      spaceId: this.spaceId,
      userId: meta.userId,
      variantId,
      operation: recipe.operation,
      workflowId: instance.id,
    });
  }

  // ==========================================================================
  // HTTP Handlers - Variant Lifecycle (GenerationWorkflow)
  // ==========================================================================

  /**
   * Handle POST /internal/variant/status HTTP request
   * Updates a variant's status (e.g., pending → processing).
   * Called by GenerationWorkflow at workflow start.
   */
  async httpUpdateVariantStatus(data: {
    variantId: string;
    status: string;
  }): Promise<{ success: boolean }> {
    const variant = await this.repo.updateVariantStatus(data.variantId, data.status);
    if (!variant) {
      throw new NotFoundError('Variant not found');
    }

    // Broadcast the status update
    this.broadcast({ type: 'variant:updated', variant });

    return { success: true };
  }

  /**
   * Handle POST /internal/complete-variant HTTP request
   * Updates a placeholder variant with generated images.
   * Called by GenerationWorkflow when generation succeeds.
   * Tracks usage for successful generations.
   * If the variant was created by a plan step, completes the step.
   */
  async httpCompleteVariant(data: {
    variantId: string;
    imageKey: string;
    thumbKey: string;
  }): Promise<{ success: boolean; variant: Variant }> {
    // Idempotency: if already completed with same keys, return success
    const existing = await this.repo.getVariantById(data.variantId);
    if (!existing) {
      throw new NotFoundError('Variant not found');
    }

    if (existing.status === 'completed' && existing.image_key === data.imageKey) {
      return { success: true, variant: existing };
    }

    const variant = await this.repo.completeVariant(
      data.variantId,
      data.imageKey,
      data.thumbKey
    );

    if (!variant) {
      throw new NotFoundError('Variant not found');
    }

    // Track usage for successful generation
    if (this.env.DB && variant.created_by) {
      try {
        // Parse recipe to get operation type
        let operation = 'derive';
        try {
          const recipe = JSON.parse(variant.recipe);
          // Handle legacy 'create'/'combine' operations
          const recipeOp = recipe.operation || 'derive';
          operation = recipeOp === 'create' || recipeOp === 'combine' ? 'derive' : recipeOp;
        } catch {
          // Ignore parse errors
        }

        await trackImageGeneration(
          this.env.DB,
          parseInt(variant.created_by),
          1, // 1 image generated
          'gemini-3-pro-image-preview',
          operation
        );
      } catch (err) {
        log.warn('Failed to track image usage', {
          spaceId: this.spaceId,
          variantId: data.variantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Broadcast the variant update
    this.broadcast({ type: 'variant:updated', variant });

    // Batch progress tracking
    if (variant.batch_id) {
      const progress = await this.repo.getBatchProgress(variant.batch_id);
      this.broadcast({
        type: 'batch:progress',
        batchId: variant.batch_id,
        completedCount: progress.completedCount,
        failedCount: progress.failedCount,
        totalCount: progress.totalCount,
        variant,
      });
      if (progress.pendingCount === 0) {
        this.broadcast({
          type: 'batch:completed',
          batchId: variant.batch_id,
          completedCount: progress.completedCount,
          failedCount: progress.failedCount,
          totalCount: progress.totalCount,
        });
      }
    }

    // Pipeline advancement hooks (rotation/tile sets)
    try {
      const rotView = await this.repo.getRotationViewByVariant(data.variantId);
      if (rotView && this.rotationCtrl) {
        await this.rotationCtrl.advanceRotation(rotView.rotation_set_id);
      }

      const tilePos = await this.repo.getTilePositionByVariant(data.variantId);
      if (tilePos && this.tileCtrl) {
        await this.tileCtrl.advanceTileSet(tilePos.tile_set_id);
      }
    } catch (hookErr) {
      log.error('Pipeline advancement hook failed', {
        variantId: data.variantId,
        error: hookErr instanceof Error ? hookErr.message : String(hookErr),
      });
      // Don't fail the variant completion for hook errors
    }

    return { success: true, variant };
  }

  /**
   * Handle POST /internal/fail-variant HTTP request
   * Marks a variant as failed with an error message.
   * Called by GenerationWorkflow when generation fails.
   */
  async httpFailVariant(data: {
    variantId: string;
    error: string;
  }): Promise<{ success: boolean; variant: Variant }> {
    const variant = await this.repo.failVariant(data.variantId, data.error);

    if (!variant) {
      throw new NotFoundError('Variant not found');
    }

    // Broadcast the variant update
    this.broadcast({ type: 'variant:updated', variant });

    // Also broadcast job:failed for frontend job tracking
    // Note: jobId === variantId (placeholder variant created before workflow starts)
    this.broadcast({ type: 'job:failed', jobId: data.variantId, error: data.error });

    // Batch progress tracking
    if (variant.batch_id) {
      const progress = await this.repo.getBatchProgress(variant.batch_id);
      this.broadcast({
        type: 'batch:progress',
        batchId: variant.batch_id,
        completedCount: progress.completedCount,
        failedCount: progress.failedCount,
        totalCount: progress.totalCount,
        variant,
      });
      if (progress.pendingCount === 0) {
        this.broadcast({
          type: 'batch:completed',
          batchId: variant.batch_id,
          completedCount: progress.completedCount,
          failedCount: progress.failedCount,
          totalCount: progress.totalCount,
        });
      }
    }

    // Pipeline failure hooks (rotation/tile sets)
    try {
      const rotView = await this.repo.getRotationViewByVariant(data.variantId);
      if (rotView && this.rotationCtrl) {
        await this.repo.failRotationSet(rotView.rotation_set_id, data.error);
        this.broadcast({
          type: 'rotation:failed',
          rotationSetId: rotView.rotation_set_id,
          error: data.error,
          failedStep: rotView.step_index,
        });
      }

      const tilePos = await this.repo.getTilePositionByVariant(data.variantId);
      if (tilePos && this.tileCtrl) {
        await this.repo.failTileSet(tilePos.tile_set_id, data.error);
        this.broadcast({
          type: 'tileset:failed',
          tileSetId: tilePos.tile_set_id,
          error: data.error,
          failedStep: tilePos.grid_x * 100 + tilePos.grid_y,
        });
      }
    } catch (hookErr) {
      log.error('Pipeline failure hook failed', {
        variantId: data.variantId,
        error: hookErr instanceof Error ? hookErr.message : String(hookErr),
      });
    }

    return { success: true, variant };
  }
}
