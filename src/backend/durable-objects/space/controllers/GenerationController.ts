/**
 * Generation Controller
 *
 * Handles workflow triggers for chat, generation, and refinement.
 * Creates placeholder variants upfront and updates them when workflows complete.
 *
 * Billing:
 * - preCheck quota/rate limits BEFORE triggering workflows
 * - Track usage AFTER successful completion (not during workflow)
 */

import type { Variant, WebSocketMeta, ChatMessage, Asset } from '../types';
import type {
  ChatRequestMessage,
  GenerateRequestMessage,
  RefineRequestMessage,
  ChatWorkflowInput,
  ChatWorkflowOutput,
  GenerationWorkflowInput,
  BotContextAsset,
} from '../../../workflows/types';
import type { ChatMessage as ApiChatMessage } from '../../../../api/types';
import { BaseController, type ControllerContext, NotFoundError, ValidationError } from './types';
import {
  preCheck,
  incrementRateLimit,
  trackClaudeUsage,
  trackImageGeneration,
} from '../billing/usageCheck';

/** Recipe stored with variant for retry capability */
interface GenerationRecipe {
  prompt: string;
  assetType: string;
  aspectRatio?: string;
  sourceImageKeys?: string[];
  /** Operation type matching user-facing tool name */
  operation: 'create' | 'refine' | 'combine';
}

export class GenerationController extends BaseController {
  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  // ==========================================================================
  // WebSocket Handlers - Workflow Triggers
  // ==========================================================================

  /**
   * Handle chat:request WebSocket message
   * Triggers ChatWorkflow for bot conversation
   */
  async handleChatRequest(ws: WebSocket, meta: WebSocketMeta, msg: ChatRequestMessage): Promise<void> {
    if (!this.env.CHAT_WORKFLOW) {
      throw new ValidationError('Chat workflow not configured');
    }

    // Check quota and rate limits before triggering workflow
    if (this.env.DB) {
      const check = await preCheck(this.env.DB, parseInt(meta.userId), 'claude');
      if (!check.allowed) {
        this.send(ws, {
          type: 'chat:error',
          requestId: msg.requestId,
          error: check.denyMessage || 'Request denied',
          code: check.denyReason === 'rate_limited' ? 'RATE_LIMITED' : 'QUOTA_EXCEEDED',
        });
        return;
      }
      // Increment rate limit counter
      await incrementRateLimit(this.env.DB, parseInt(meta.userId));
    }

    // Get chat history from local storage
    const historyResult = await this.sql.exec(
      'SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT 20'
    );
    const historyRows = historyResult.toArray() as unknown as ChatMessage[];
    const history: ApiChatMessage[] = historyRows.reverse().map((row) => ({
      role: row.sender_type === 'user' ? ('user' as const) : ('assistant' as const),
      content: row.content,
    }));

    // Get assets for context
    const assets = await this.repo.getAssetsWithVariantCount();

    // Build workflow input
    const workflowInput: ChatWorkflowInput = {
      requestId: msg.requestId,
      spaceId: this.spaceId,
      userId: meta.userId,
      message: msg.message,
      mode: msg.mode,
      history,
      forgeContext: msg.forgeContext,
      viewingContext: msg.viewingContext,
      assets,
    };

    // Trigger the workflow
    const instance = await this.env.CHAT_WORKFLOW.create({
      id: msg.requestId,
      params: workflowInput,
    });

    console.log(`[GenerationController] Started ChatWorkflow instance: ${instance.id}`);
  }

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
      // Increment rate limit counter
      await incrementRateLimit(this.env.DB, parseInt(meta.userId));
    }

    const variantId = crypto.randomUUID();
    const assetId = crypto.randomUUID();

    // Create the asset first
    const asset = await this.repo.createAsset({
      id: assetId,
      name: msg.name,
      type: msg.assetType,
      tags: [],
      parentAssetId: msg.parentAssetId,
      createdBy: meta.userId,
    });

    // Broadcast asset creation
    this.broadcast({ type: 'asset:created', asset });

    // Resolve reference assets to image keys and variant IDs
    const { sourceImageKeys, parentVariantIds } = await this.resolveReferences(
      msg.referenceAssetIds || []
    );

    // Build recipe for storage (enables retry)
    const recipe: GenerationRecipe = {
      prompt: msg.prompt || `Create a ${msg.assetType} named "${msg.name}"`,
      assetType: msg.assetType,
      aspectRatio: msg.aspectRatio,
      sourceImageKeys: sourceImageKeys.length > 0 ? sourceImageKeys : undefined,
      operation: 'create',
    };

    // Create placeholder variant (status=pending, no images)
    const variant = await this.repo.createPlaceholderVariant({
      id: variantId,
      assetId,
      recipe: JSON.stringify(recipe),
      createdBy: meta.userId,
    });

    // Set as active variant immediately
    await this.repo.updateAsset(assetId, { active_variant_id: variantId });
    asset.active_variant_id = variantId;

    // Broadcast variant creation (placeholder)
    this.broadcast({ type: 'variant:created', variant });
    this.broadcast({ type: 'asset:updated', asset });

    // Send generate:started so requestId can be correlated with variantId
    this.broadcast({
      type: 'generate:started',
      requestId: msg.requestId,
      jobId: variantId,
      assetId,
      assetName: msg.name,
    });

    // Create lineage records for parent variants
    if (parentVariantIds.length > 0) {
      const relationType = parentVariantIds.length === 1 ? 'derived' : 'composed';
      for (const parentId of parentVariantIds) {
        const lineage = await this.repo.createLineage({
          id: crypto.randomUUID(),
          parentVariantId: parentId,
          childVariantId: variantId,
          relationType,
        });
        this.broadcast({ type: 'lineage:created', lineage });
      }
    }

    // Build workflow input
    const workflowInput: GenerationWorkflowInput = {
      requestId: msg.requestId,
      jobId: variantId, // Use variantId as jobId for correlation
      spaceId: this.spaceId,
      userId: meta.userId,
      prompt: recipe.prompt,
      assetId,
      assetName: msg.name,
      assetType: msg.assetType,
      aspectRatio: msg.aspectRatio,
      sourceImageKeys: sourceImageKeys.length > 0 ? sourceImageKeys : undefined,
      parentVariantIds: parentVariantIds.length > 0 ? parentVariantIds : undefined,
      operation: 'create',
    };

    // Trigger the workflow
    const instance = await this.env.GENERATION_WORKFLOW.create({
      id: variantId,
      params: workflowInput,
    });

    // Update variant with workflow ID and set status to processing
    const updatedVariant = await this.repo.updateVariantWorkflow(variantId, instance.id, 'processing');
    if (updatedVariant) {
      this.broadcast({ type: 'variant:updated', variant: updatedVariant });
    }

    console.log(`[GenerationController] [create] Started workflow for "${msg.name}" (${sourceImageKeys.length} refs)`);
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
      // Increment rate limit counter
      await incrementRateLimit(this.env.DB, parseInt(meta.userId));
    }

    const variantId = crypto.randomUUID();

    // Get the asset
    const asset = await this.repo.getAssetById(msg.assetId);
    if (!asset) {
      throw new NotFoundError('Asset not found');
    }

    // Resolve source variant (use provided or active variant)
    let sourceVariantId = await this.resolveSourceVariant(msg.sourceVariantId, asset);
    if (!sourceVariantId) {
      throw new NotFoundError('No source variant available');
    }

    const sourceVariant = await this.repo.getVariantById(sourceVariantId);
    if (!sourceVariant) {
      throw new NotFoundError('Source variant not found');
    }

    // Ensure source variant has an image (is completed)
    if (!sourceVariant.image_key) {
      throw new ValidationError('Source variant has no image');
    }

    // Resolve additional references (for style guidance)
    let sourceImageKeys = [sourceVariant.image_key];
    let parentVariantIds: string[] = [sourceVariantId];

    if (msg.referenceAssetIds && msg.referenceAssetIds.length > 0) {
      const additionalRefs = await this.resolveReferences(msg.referenceAssetIds);
      sourceImageKeys = [...sourceImageKeys, ...additionalRefs.sourceImageKeys];
      parentVariantIds = [...parentVariantIds, ...additionalRefs.parentVariantIds];
    }

    // Build recipe for storage (enables retry)
    const recipe: GenerationRecipe = {
      prompt: msg.prompt,
      assetType: asset.type,
      aspectRatio: msg.aspectRatio,
      sourceImageKeys,
      operation: 'refine',
    };

    // Create placeholder variant (status=pending, no images)
    const variant = await this.repo.createPlaceholderVariant({
      id: variantId,
      assetId: msg.assetId,
      recipe: JSON.stringify(recipe),
      createdBy: meta.userId,
    });

    // Broadcast variant creation (placeholder)
    this.broadcast({ type: 'variant:created', variant });

    // Send refine:started so requestId can be correlated with variantId
    this.broadcast({
      type: 'refine:started',
      requestId: msg.requestId,
      jobId: variantId,
      assetId: msg.assetId,
      assetName: asset.name,
    });

    // Create lineage records for parent variants
    const relationType = parentVariantIds.length === 1 ? 'derived' : 'composed';
    for (const parentId of parentVariantIds) {
      const lineage = await this.repo.createLineage({
        id: crypto.randomUUID(),
        parentVariantId: parentId,
        childVariantId: variantId,
        relationType,
      });
      this.broadcast({ type: 'lineage:created', lineage });
    }

    // Build workflow input
    const workflowInput: GenerationWorkflowInput = {
      requestId: msg.requestId,
      jobId: variantId, // Use variantId as jobId for correlation
      spaceId: this.spaceId,
      userId: meta.userId,
      prompt: msg.prompt,
      assetId: msg.assetId,
      assetName: asset.name,
      assetType: asset.type,
      aspectRatio: msg.aspectRatio,
      sourceVariantId,
      sourceImageKeys,
      parentVariantIds,
      operation: 'refine',
    };

    // Trigger the workflow
    const instance = await this.env.GENERATION_WORKFLOW.create({
      id: variantId,
      params: workflowInput,
    });

    // Update variant with workflow ID and set status to processing
    const updatedVariant = await this.repo.updateVariantWorkflow(variantId, instance.id, 'processing');
    if (updatedVariant) {
      this.broadcast({ type: 'variant:updated', variant: updatedVariant });
    }

    const extraRefs = sourceImageKeys.length - 1; // Subtract 1 for source variant
    console.log(`[GenerationController] [refine] Started workflow for "${asset.name}" (${extraRefs} extra refs)`);
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

    console.log(`[GenerationController] [${recipe.operation}] Retrying variant ${variantId}`);
  }

  // ==========================================================================
  // HTTP Handlers - Chat Workflow
  // ==========================================================================

  /**
   * Handle POST /internal/chat-result HTTP request
   * Broadcasts chat workflow result to all clients
   * Tracks usage for successful requests
   */
  async httpChatResult(result: ChatWorkflowOutput): Promise<void> {
    // Track usage only for successful requests
    if (result.success && result.usage && this.env.DB) {
      try {
        await trackClaudeUsage(
          this.env.DB,
          parseInt(result.userId),
          result.usage.inputTokens,
          result.usage.outputTokens,
          'claude-sonnet-4-20250514',
          result.requestId
        );
      } catch (err) {
        console.warn('[GenerationController] Failed to track Claude usage:', err);
      }
    }

    this.broadcast({
      type: 'chat:response',
      requestId: result.requestId,
      success: result.success,
      response: result.response,
      error: result.error,
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
        let operation = 'create';
        try {
          const recipe = JSON.parse(variant.recipe);
          operation = recipe.operation || 'create';
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
        console.warn('[GenerationController] Failed to track image usage:', err);
      }
    }

    // Broadcast the update
    this.broadcast({ type: 'variant:updated', variant });

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

    // Broadcast the update
    this.broadcast({ type: 'variant:updated', variant });

    return { success: true, variant };
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Resolve reference asset IDs to image keys and variant IDs
   */
  private async resolveReferences(
    referenceAssetIds: string[]
  ): Promise<{
    sourceImageKeys: string[];
    parentVariantIds: string[];
  }> {
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
   * Resolve source variant ID, falling back to active variant if specified doesn't exist
   */
  private async resolveSourceVariant(
    sourceVariantId: string | undefined,
    asset: Asset
  ): Promise<string | null> {
    let resolvedId = sourceVariantId || asset.active_variant_id;

    // If a specific variant was requested, check if it exists
    if (sourceVariantId && sourceVariantId !== asset.active_variant_id) {
      const exists = await this.repo.getVariantById(sourceVariantId);
      if (!exists) {
        // Variant deleted - silently fallback to active variant
        resolvedId = asset.active_variant_id;
      }
    }

    return resolvedId;
  }
}
