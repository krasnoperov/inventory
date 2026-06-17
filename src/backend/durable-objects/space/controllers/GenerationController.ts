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
  trackElevenLabsAudioGeneration,
  trackVideoGeneration,
} from '../billing/usageCheck';
import {
  VariantFactory,
  determineOperation,
  type GenerationRecipe,
} from '../generation/VariantFactory';
import type { VariantMediaMetadata } from '../repository/SpaceRepository';
import { loggers } from '../../../../shared/logger';

const log = loggers.generationController;

type GenerationBillingService = 'nanobanana' | 'elevenlabs' | 'veo';
type GenerationLimitDenyReason = 'quota_exceeded' | 'rate_limited' | 'paid_generation_required';

type AudioUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

const ELEVENLABS_GENERATED_AUDIO_COST_BUFFER = 50;

function getGenerationBillingService(env: ControllerContext['env'], mediaKind?: string): GenerationBillingService {
  if (mediaKind === 'video') {
    return 'veo';
  }
  if (mediaKind === 'audio' && env.INVENTORY_AUDIO_PROVIDER === 'elevenlabs') {
    return 'elevenlabs';
  }
  return 'nanobanana';
}

function countPromptCharacters(prompt: string | undefined): number {
  if (!prompt) return 0;
  return Array.from(prompt).length;
}

function getElevenLabsAudioUsage(audioUsage: AudioUsage | null | undefined, prompt: string | undefined): AudioUsage {
  if (audioUsage?.totalTokens && audioUsage.totalTokens > 0) {
    return audioUsage;
  }

  const promptCharacters = countPromptCharacters(prompt);
  const totalTokens = promptCharacters > 0 ? promptCharacters : 1;
  return {
    inputTokens: totalTokens,
    outputTokens: 0,
    totalTokens,
  };
}

function getQuotaCheckQuantity(
  service: GenerationBillingService,
  prompt: string | undefined,
  count = 1,
  assetType?: string
): number {
  const requestedCount = Math.max(1, Math.floor(count));
  if (service !== 'elevenlabs') {
    return requestedCount;
  }
  const promptCharacters = getElevenLabsAudioUsage(undefined, prompt).totalTokens;
  const generatedAudioEstimate = promptCharacters + ELEVENLABS_GENERATED_AUDIO_COST_BUFFER;
  const perRequestQuantity = assetType === 'music' || assetType === 'sfx'
    ? generatedAudioEstimate
    : promptCharacters;
  return perRequestQuantity * requestedCount;
}

function getGenerationLimitErrorCode(denyReason: GenerationLimitDenyReason | undefined): 'RATE_LIMITED' | 'PAID_GENERATION_REQUIRED' | 'QUOTA_EXCEEDED' {
  if (denyReason === 'rate_limited') return 'RATE_LIMITED';
  if (denyReason === 'paid_generation_required') return 'PAID_GENERATION_REQUIRED';
  return 'QUOTA_EXCEEDED';
}

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
      const billingService = getGenerationBillingService(this.env, msg.mediaKind);
      const quotaQuantity = getQuotaCheckQuantity(billingService, msg.prompt, 1, msg.assetType);
      const check = await preCheck(this.env.DB, parseInt(meta.userId), billingService, undefined, quotaQuantity, 1, this.env.ADMIN_USER_IDS);
      if (!check.allowed) {
        this.send(ws, {
          type: 'generate:error',
          requestId: msg.requestId,
          error: check.denyMessage || 'Request denied',
          code: getGenerationLimitErrorCode(check.denyReason),
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
        mediaKind: msg.mediaKind,
        prompt: msg.prompt,
        aspectRatio: msg.aspectRatio,
        parentAssetId: msg.parentAssetId,
        referenceAssetIds: msg.referenceAssetIds,
        referenceVariantIds: msg.referenceVariantIds,
        disableStyle: msg.disableStyle,
        voiceId: msg.voiceId,
        dialogueVoiceIds: msg.dialogueVoiceIds,
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
      let billingMediaKind = msg.mediaKind;
      let billingAssetType: string | undefined;
      if (!billingMediaKind || billingMediaKind === 'audio') {
        const asset = await this.repo.getAssetById(msg.assetId);
        if (!asset) {
          throw new NotFoundError('Asset not found');
        }
        billingMediaKind = billingMediaKind ?? asset.media_kind;
        billingAssetType = asset.type;
      }
      const billingService = getGenerationBillingService(this.env, billingMediaKind);
      const quotaQuantity = getQuotaCheckQuantity(billingService, msg.prompt, 1, billingAssetType);
      const check = await preCheck(this.env.DB, parseInt(meta.userId), billingService, undefined, quotaQuantity, 1, this.env.ADMIN_USER_IDS);
      if (!check.allowed) {
        this.send(ws, {
          type: 'refine:error',
          requestId: msg.requestId,
          error: check.denyMessage || 'Request denied',
          code: getGenerationLimitErrorCode(check.denyReason),
        });
        return;
      }
      await incrementRateLimit(this.env.DB, parseInt(meta.userId));
    }

    // Use factory to create refine variant + lineage
    const result = await this.variantFactory.createRefineVariant(
      {
        assetId: msg.assetId,
        mediaKind: msg.mediaKind,
        prompt: msg.prompt,
        aspectRatio: msg.aspectRatio,
        sourceVariantId: msg.sourceVariantId,
        sourceVariantIds: msg.sourceVariantIds,
        referenceAssetIds: msg.referenceAssetIds,
        disableStyle: msg.disableStyle,
        voiceId: msg.voiceId,
        dialogueVoiceIds: msg.dialogueVoiceIds,
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

    if (msg.mediaKind === 'video') {
      this.send(ws, {
        type: 'batch:error',
        requestId: msg.requestId,
        error: 'Video batch generation is not supported',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    // Check quota for the entire batch
    if (this.env.DB) {
      const billingService = getGenerationBillingService(this.env, msg.mediaKind);
      const quotaQuantity = getQuotaCheckQuantity(billingService, msg.prompt, msg.count, msg.assetType);
      const check = await preCheck(
        this.env.DB,
        parseInt(meta.userId),
        billingService,
        undefined,
        quotaQuantity,
        msg.count,
        this.env.ADMIN_USER_IDS
      );
      if (!check.allowed) {
        this.send(ws, {
          type: 'batch:error',
          requestId: msg.requestId,
          error: check.denyMessage || 'Request denied',
          code: getGenerationLimitErrorCode(check.denyReason),
        });
        return;
      }
      await incrementRateLimit(this.env.DB, parseInt(meta.userId), msg.count);
    }

    // Use factory to create batch variants
    const { batchId, results } = await this.variantFactory.createBatchVariants(
      {
        name: msg.name,
        assetType: msg.assetType,
        mediaKind: msg.mediaKind,
        prompt: msg.prompt,
        aspectRatio: msg.aspectRatio,
        parentAssetId: msg.parentAssetId,
        referenceAssetIds: msg.referenceAssetIds,
        referenceVariantIds: msg.referenceVariantIds,
        disableStyle: msg.disableStyle,
        voiceId: msg.voiceId,
        dialogueVoiceIds: msg.dialogueVoiceIds,
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

    const retryMediaKind = variant.media_kind ?? asset.media_kind;
    const billingService = getGenerationBillingService(this.env, retryMediaKind);
    if (this.env.DB && billingService === 'elevenlabs') {
      const quotaQuantity = getQuotaCheckQuantity(billingService, recipe.prompt, 1, recipe.assetType);
      const check = await preCheck(this.env.DB, parseInt(meta.userId), billingService, undefined, quotaQuantity, 1, this.env.ADMIN_USER_IDS);
      if (!check.allowed) {
        this.sendError(
          ws,
          getGenerationLimitErrorCode(check.denyReason),
          check.denyMessage || 'Request denied'
        );
        return;
      }
      await incrementRateLimit(this.env.DB, parseInt(meta.userId));
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
      mediaKind: retryMediaKind,
      model: recipe.model,
      aspectRatio: recipe.aspectRatio,
      imageSize: recipe.imageSize,
      sourceImageKeys: recipe.sourceImageKeys,
      parentVariantIds: recipe.parentVariantIds,
      styleImageKeys: recipe.styleImageKeys,
      operation: recipe.operation,
      modelProvider: recipe.modelProvider,
      voiceId: recipe.voiceId,
      dialogueVoiceIds: recipe.dialogueVoiceIds?.length ? recipe.dialogueVoiceIds : undefined,
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
    imageKey?: string | null;
    thumbKey?: string | null;
    mediaKey?: string | null;
    mediaMimeType?: string | null;
    mediaSizeBytes?: number | null;
    mediaWidth?: number | null;
    mediaHeight?: number | null;
    mediaDurationMs?: number | null;
    transcriptKey?: string | null;
    transcriptMimeType?: string | null;
    transcriptSizeBytes?: number | null;
    wordTimingsKey?: string | null;
    wordTimingsMimeType?: string | null;
    wordTimingsSizeBytes?: number | null;
    renderMetadataKey?: string | null;
    renderMetadataMimeType?: string | null;
    renderMetadataSizeBytes?: number | null;
    providerMetadata?: Record<string, unknown> | string | null;
    audioProvider?: string | null;
    audioModel?: string | null;
    audioUsage?: AudioUsage | null;
  }): Promise<{ success: boolean; variant: Variant }> {
    // Idempotency: if already completed with same keys, return success
    const existing = await this.repo.getVariantById(data.variantId);
    if (!existing) {
      throw new NotFoundError('Variant not found');
    }

    const imageKey = data.imageKey ?? null;
    const thumbKey = data.thumbKey ?? null;
    const mediaKey = data.mediaKey ?? imageKey;
    const existingMediaKey = existing.media_key ?? existing.image_key;

    if (
      existing.status === 'completed' &&
      existing.image_key === imageKey &&
      existing.thumb_key === thumbKey &&
      existingMediaKey === mediaKey
    ) {
      return { success: true, variant: existing };
    }
    if (hasAudioSidecarKeys(data) && existing.media_kind !== 'audio') {
      throw new ValidationError('Audio sidecars can only be attached to audio variants');
    }

    const mediaMetadata: VariantMediaMetadata = {
      mediaKey,
      mimeType: data.mediaMimeType,
      sizeBytes: data.mediaSizeBytes,
      width: data.mediaWidth,
      height: data.mediaHeight,
      durationMs: data.mediaDurationMs,
    };
    if (data.transcriptKey !== undefined) mediaMetadata.transcriptKey = data.transcriptKey;
    if (data.transcriptMimeType !== undefined) mediaMetadata.transcriptMimeType = data.transcriptMimeType;
    if (data.transcriptSizeBytes !== undefined) mediaMetadata.transcriptSizeBytes = data.transcriptSizeBytes;
    if (data.wordTimingsKey !== undefined) mediaMetadata.wordTimingsKey = data.wordTimingsKey;
    if (data.wordTimingsMimeType !== undefined) mediaMetadata.wordTimingsMimeType = data.wordTimingsMimeType;
    if (data.wordTimingsSizeBytes !== undefined) mediaMetadata.wordTimingsSizeBytes = data.wordTimingsSizeBytes;
    if (data.renderMetadataKey !== undefined) mediaMetadata.renderMetadataKey = data.renderMetadataKey;
    if (data.renderMetadataMimeType !== undefined) mediaMetadata.renderMetadataMimeType = data.renderMetadataMimeType;
    if (data.renderMetadataSizeBytes !== undefined) mediaMetadata.renderMetadataSizeBytes = data.renderMetadataSizeBytes;
    if (data.providerMetadata !== undefined) mediaMetadata.providerMetadata = data.providerMetadata;

    const variant = await this.repo.completeVariant(
      data.variantId,
      imageKey,
      thumbKey,
      mediaMetadata
    );

    if (!variant) {
      throw new NotFoundError('Variant not found');
    }

    // Track usage for successful generation
    if (
      this.env.DB &&
      variant.created_by &&
      (variant.media_kind === 'image' || variant.media_kind === 'video')
    ) {
      try {
        // Parse recipe to get operation type
        let operation = 'derive';
        let usageModel = 'gemini-3-pro-image-preview';
        try {
          const recipe = JSON.parse(variant.recipe);
          // Handle legacy 'create'/'combine' operations
          const recipeOp = recipe.operation || 'derive';
          operation = recipeOp === 'create' || recipeOp === 'combine' ? 'derive' : recipeOp;
          if (typeof recipe.model === 'string' && recipe.model.length > 0) {
            usageModel = recipe.model;
          }
        } catch {
          // Ignore parse errors
        }

        if (variant.media_kind === 'video') {
          await trackVideoGeneration(
            this.env.DB,
            parseInt(variant.created_by),
            1,
            usageModel,
            operation
          );
        } else {
          await trackImageGeneration(
            this.env.DB,
            parseInt(variant.created_by),
            1,
            usageModel,
            operation
          );
        }
      } catch (err) {
        log.warn('Failed to track generation usage', {
          spaceId: this.spaceId,
          variantId: data.variantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (
      this.env.DB &&
      variant.created_by &&
      variant.media_kind === 'audio' &&
      data.audioProvider === 'elevenlabs'
    ) {
      try {
        let operation = 'generate';
        let assetType: string | undefined;
        let prompt: string | undefined;
        try {
          const recipe = JSON.parse(variant.recipe);
          operation = recipe.operation || operation;
          assetType = recipe.assetType;
          prompt = typeof recipe.prompt === 'string' ? recipe.prompt : undefined;
        } catch {
          // Ignore parse errors
        }

        const audioUsage = getElevenLabsAudioUsage(data.audioUsage, prompt);
        await trackElevenLabsAudioGeneration(
          this.env.DB,
          parseInt(variant.created_by),
          audioUsage.totalTokens,
          data.audioModel || 'unknown',
          operation,
          assetType,
          audioUsage
        );
      } catch (err) {
        log.warn('Failed to track ElevenLabs audio usage', {
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

      // Single-shot grid/sheet slicing: the grid/sheet variant has no
      // tile_position or rotation_view, so the above hooks won't match.
      // Detect via recipe.generationMode and slice into individual cells.
      if (!rotView && !tilePos) {
        try {
          const recipe = JSON.parse(variant.recipe);
          if (recipe.generationMode === 'single-shot') {
            if (recipe.gridWidth && recipe.gridHeight && this.tileCtrl) {
              // Single-shot tile grid — slice into individual tile variants
              await this.tileCtrl.sliceSingleShotGrid(variant);
            } else if (recipe.gridLayout && this.rotationCtrl) {
              // Single-shot rotation sheet — slice into individual view variants
              await this.rotationCtrl.sliceSingleShotSheet(variant);
            }
          }
        } catch {
          // Not a single-shot variant or parse error — ignore
        }
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
        // Mark individual tile position as failed (not the entire set)
        await this.repo.updateTilePositionStatus(tilePos.id, 'failed');
        this.broadcast({
          type: 'tileset:tile_failed',
          tileSetId: tilePos.tile_set_id,
          variantId: data.variantId,
          gridX: tilePos.grid_x,
          gridY: tilePos.grid_y,
          error: data.error,
        });
        // Continue pipeline — advance to next tile
        await this.tileCtrl.advanceTileSet(tilePos.tile_set_id);
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

function hasAudioSidecarKeys(data: {
  transcriptKey?: string | null;
  wordTimingsKey?: string | null;
  renderMetadataKey?: string | null;
}): boolean {
  return Boolean(data.transcriptKey || data.wordTimingsKey || data.renderMetadataKey);
}
