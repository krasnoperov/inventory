/**
 * Generation Controller
 *
 * Handles workflow triggers for chat, generation, and refinement.
 * Creates placeholder variants upfront and updates them when workflows complete.
 *
 * Uses VariantFactory for shared variant creation logic.
 *
 * Billing:
 * - preCheck quota/rate limits BEFORE triggering workflows
 * - Track usage AFTER successful completion (not during workflow)
 */

import type { Variant, WebSocketMeta, ChatMessage } from '../types';
import type { SimplePlan } from '../../../../shared/websocket-types';
import type {
  ChatRequestMessage,
  GenerateRequestMessage,
  RefineRequestMessage,
  ChatWorkflowInput,
  ChatWorkflowOutput,
  GenerationWorkflowInput,
} from '../../../workflows/types';
import type { ChatMessage as ApiChatMessage } from '../../../../api/types';
import { BaseController, type ControllerContext, NotFoundError, ValidationError } from './types';
import {
  preCheck,
  incrementRateLimit,
  trackClaudeUsage,
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

  constructor(ctx: ControllerContext) {
    super(ctx);
    this.variantFactory = new VariantFactory(ctx.spaceId, ctx.repo, ctx.env, ctx.broadcast);
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

    // Get active plan if one exists (SimplePlan - markdown-based)
    const activePlan = await this.repo.getActivePlan();

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
      activePlan: activePlan ?? undefined,
    };

    // Trigger the workflow
    const instance = await this.env.CHAT_WORKFLOW.create({
      id: msg.requestId,
      params: workflowInput,
    });

    log.info('Started ChatWorkflow', {
      requestId: msg.requestId,
      spaceId: this.spaceId,
      userId: meta.userId,
      mode: msg.mode,
      workflowId: instance.id,
    });
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
        log.warn('Failed to track Claude usage', {
          requestId: result.requestId,
          spaceId: this.spaceId,
          userId: result.userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.broadcast({
      type: 'chat:response',
      requestId: result.requestId,
      success: result.success,
      response: result.response,
      error: result.error,
      deferredActions: result.deferredActions,
    });
  }

  /**
   * Handle POST /internal/chat-progress HTTP request
   * Broadcasts tool execution progress during agentic loop
   */
  async httpChatProgress(progress: {
    requestId: string;
    toolName: string;
    toolParams: Record<string, unknown>;
    status: 'executing' | 'complete' | 'failed';
    result?: string;
    error?: string;
  }): Promise<void> {
    this.broadcast({
      type: 'chat:progress',
      requestId: progress.requestId,
      toolName: progress.toolName,
      toolParams: progress.toolParams,
      status: progress.status,
      result: progress.result,
      error: progress.error,
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

    return { success: true, variant };
  }

  // ==========================================================================
  // HTTP Handlers - Plan Operations (SimplePlan - markdown-based)
  // ==========================================================================

  /**
   * Handle POST /internal/plan HTTP request
   * Creates or updates a plan for a chat session and broadcasts to all clients.
   * Called by ChatWorkflow when executing update_plan tool.
   */
  async httpUpsertPlan(data: {
    sessionId: string;
    content: string;
    createdBy: string;
  }): Promise<SimplePlan> {
    const plan = await this.repo.upsertPlan({
      sessionId: data.sessionId,
      content: data.content,
      createdBy: data.createdBy,
    });

    // Broadcast to all clients
    this.broadcast({ type: 'simple_plan:updated', plan });

    log.info('Plan updated', {
      spaceId: this.spaceId,
      planId: plan.id,
      sessionId: data.sessionId,
      createdBy: data.createdBy,
    });

    return plan;
  }

  /**
   * Handle GET /internal/plan/:sessionId HTTP request
   * Gets the active plan for a chat session.
   */
  async httpGetActivePlan(sessionId: string): Promise<SimplePlan | null> {
    return this.repo.getActivePlan(sessionId);
  }

  /**
   * Handle DELETE /internal/plan/:planId HTTP request
   * Archives a plan (marks as done/dismissed).
   */
  async httpArchivePlan(planId: string): Promise<void> {
    await this.repo.archivePlan(planId);

    // Broadcast to all clients that the plan was archived
    this.broadcast({ type: 'simple_plan:archived', planId });

    log.info('Plan archived', {
      spaceId: this.spaceId,
      planId,
    });
  }
}
