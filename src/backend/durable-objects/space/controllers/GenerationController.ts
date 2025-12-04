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
  OperationType,
} from '../../../workflows/types';
import type { ChatMessage as ApiChatMessage } from '../../../../api/types';
import { BaseController, type ControllerContext, NotFoundError, ValidationError } from './types';
import {
  preCheck,
  incrementRateLimit,
  trackClaudeUsage,
  trackImageGeneration,
} from '../billing/usageCheck';
import { loggers } from '../../../../shared/logger';

const log = loggers.generationController;

/** Recipe stored with variant for retry capability */
interface GenerationRecipe {
  prompt: string;
  assetType: string;
  aspectRatio?: string;
  sourceImageKeys?: string[];
  /** Operation type matching user-facing tool name */
  operation: 'derive' | 'refine';
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

    // Get active plan if one exists
    const activePlanData = await this.repo.getActivePlan();
    let activePlan;
    if (activePlanData) {
      const steps = await this.repo.getPlanSteps(activePlanData.id);
      activePlan = {
        id: activePlanData.id,
        goal: activePlanData.goal,
        steps: steps.map(s => ({
          id: s.id,
          description: s.description,
          action: s.action,
          params: JSON.parse(s.params || '{}'),
          status: s.status,
          result: s.result || undefined,
          error: s.error || undefined,
          dependsOn: s.depends_on ? JSON.parse(s.depends_on) : undefined,
        })),
        currentStepIndex: activePlanData.current_step_index,
        status: activePlanData.status,
        createdAt: activePlanData.created_at,
        autoAdvance: Boolean(activePlanData.auto_advance),
      };
    }

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
      activePlan,
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
      // Increment rate limit counter
      await incrementRateLimit(this.env.DB, parseInt(meta.userId));
    }

    const variantId = crypto.randomUUID();
    const assetId = crypto.randomUUID();

    // Auto-set parentAssetId from first reference if not explicitly provided
    // This ensures derived assets show their relationship on the Space page
    let effectiveParentAssetId = msg.parentAssetId;
    if (!effectiveParentAssetId && msg.referenceAssetIds && msg.referenceAssetIds.length > 0) {
      effectiveParentAssetId = msg.referenceAssetIds[0];
    } else if (!effectiveParentAssetId && msg.referenceVariantIds && msg.referenceVariantIds.length > 0) {
      // For ForgeTray path, get asset ID from first variant
      const firstVariant = await this.repo.getVariantById(msg.referenceVariantIds[0]);
      if (firstVariant) {
        effectiveParentAssetId = firstVariant.asset_id;
      }
    }

    // Create the asset first
    const asset = await this.repo.createAsset({
      id: assetId,
      name: msg.name,
      type: msg.assetType,
      tags: [],
      parentAssetId: effectiveParentAssetId,
      createdBy: meta.userId,
    });

    // Broadcast asset creation
    this.broadcast({ type: 'asset:created', asset });

    // Resolve references to image keys and variant IDs
    // Prefer explicit variant IDs (from ForgeTray) over asset IDs
    let sourceImageKeys: string[];
    let parentVariantIds: string[];

    if (msg.referenceVariantIds && msg.referenceVariantIds.length > 0) {
      // Use explicit variant IDs from ForgeTray
      const resolved = await this.resolveVariantReferences(msg.referenceVariantIds);
      sourceImageKeys = resolved.sourceImageKeys;
      parentVariantIds = resolved.parentVariantIds;
    } else {
      // Fall back to resolving from asset IDs (for Chat/Claude)
      const resolved = await this.resolveReferences(msg.referenceAssetIds || []);
      sourceImageKeys = resolved.sourceImageKeys;
      parentVariantIds = resolved.parentVariantIds;
    }

    // Build recipe for storage (enables retry)
    const recipe: GenerationRecipe = {
      prompt: msg.prompt || `Create a ${msg.assetType} named "${msg.name}"`,
      assetType: msg.assetType,
      aspectRatio: msg.aspectRatio,
      sourceImageKeys: sourceImageKeys.length > 0 ? sourceImageKeys : undefined,
      operation: 'derive',
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
    // For new asset creation, lineage type is always 'derived'
    if (parentVariantIds.length > 0) {
      for (const parentId of parentVariantIds) {
        const lineage = await this.repo.createLineage({
          id: crypto.randomUUID(),
          parentVariantId: parentId,
          childVariantId: variantId,
          relationType: 'derived',
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
      operation: 'derive',
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

    log.info('Started GenerationWorkflow for create', {
      requestId: msg.requestId,
      spaceId: this.spaceId,
      userId: meta.userId,
      assetName: msg.name,
      assetId: asset.id,
      variantId,
      refCount: sourceImageKeys.length,
      workflowId: instance.id,
    });
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

    // Resolve source variants - prefer explicit array from ForgeTray
    let sourceImageKeys: string[] = [];
    let parentVariantIds: string[] = [];

    if (msg.sourceVariantIds && msg.sourceVariantIds.length > 0) {
      // ForgeTray path: use explicit variant IDs (for combine-into-existing)
      const resolved = await this.resolveVariantReferences(msg.sourceVariantIds);
      sourceImageKeys = resolved.sourceImageKeys;
      parentVariantIds = resolved.parentVariantIds;
    } else {
      // Legacy path: single sourceVariantId or fall back to active variant
      const sourceVariantId = await this.resolveSourceVariant(msg.sourceVariantId, asset);
      if (!sourceVariantId) {
        throw new NotFoundError('No source variant available');
      }

      const sourceVariant = await this.repo.getVariantById(sourceVariantId);
      if (!sourceVariant?.image_key) {
        throw new NotFoundError('Source variant not found or has no image');
      }

      sourceImageKeys = [sourceVariant.image_key];
      parentVariantIds = [sourceVariantId];
    }

    // Add any additional asset references (for style guidance)
    if (msg.referenceAssetIds && msg.referenceAssetIds.length > 0) {
      const additionalRefs = await this.resolveReferences(msg.referenceAssetIds);
      sourceImageKeys = [...sourceImageKeys, ...additionalRefs.sourceImageKeys];
      parentVariantIds = [...parentVariantIds, ...additionalRefs.parentVariantIds];
    }

    // Validate we have at least one source
    if (sourceImageKeys.length === 0) {
      throw new ValidationError('No source images available');
    }

    // Always 'refine' for existing asset (source count doesn't matter)
    const operation: OperationType = 'refine';

    // Build recipe for storage (enables retry)
    const recipe: GenerationRecipe = {
      prompt: msg.prompt,
      assetType: asset.type,
      aspectRatio: msg.aspectRatio,
      sourceImageKeys,
      operation,
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
    // For existing asset refinement, lineage type is always 'refined'
    for (const parentId of parentVariantIds) {
      const lineage = await this.repo.createLineage({
        id: crypto.randomUUID(),
        parentVariantId: parentId,
        childVariantId: variantId,
        relationType: 'refined',
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
      sourceVariantId: parentVariantIds[0], // Primary source for workflow
      sourceImageKeys,
      parentVariantIds,
      operation,
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

    console.log(`[GenerationController] [${operation}] Started workflow for "${asset.name}" (${sourceImageKeys.length} refs)`);
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
        console.warn('[GenerationController] Failed to track image usage:', err);
      }
    }

    // Broadcast the variant update
    this.broadcast({ type: 'variant:updated', variant });

    // If this variant was created by a plan step, complete the step
    if (variant.plan_step_id) {
      await this.completePlanStep(variant.plan_step_id, data.variantId);
    }

    return { success: true, variant };
  }

  /**
   * Complete a plan step when its variant generation succeeds.
   * Also broadcasts plan updates to all clients.
   */
  private async completePlanStep(stepId: string, variantId: string): Promise<void> {
    try {
      const step = await this.repo.getPlanStepById(stepId);
      if (!step) {
        console.warn(`[GenerationController] Plan step ${stepId} not found for completion`);
        return;
      }

      // Complete the step with the variant ID as result
      const updatedStep = await this.repo.completeStep(stepId, `variant:${variantId}`);
      if (updatedStep) {
        this.broadcast({ type: 'plan:step_updated', step: updatedStep });
      }

      // Check if there are more steps; update plan status accordingly
      const plan = await this.repo.getPlanById(step.plan_id);
      if (!plan) return;

      const nextStep = await this.repo.getNextPendingStep(step.plan_id);
      const newStatus = nextStep ? 'paused' : 'completed';

      const updatedPlan = await this.repo.updatePlanStatusAndIndex(
        step.plan_id,
        newStatus,
        step.step_index + 1
      );

      if (updatedPlan) {
        this.broadcast({ type: 'plan:updated', plan: updatedPlan });
      }

      console.log(`[GenerationController] Completed plan step ${stepId}, plan status: ${newStatus}`);
    } catch (err) {
      console.error(`[GenerationController] Failed to complete plan step ${stepId}:`, err);
    }
  }

  /**
   * Handle POST /internal/fail-variant HTTP request
   * Marks a variant as failed with an error message.
   * Called by GenerationWorkflow when generation fails.
   * If the variant was created by a plan step, fails the step and plan.
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

    // If this variant was created by a plan step, fail the step and plan
    if (variant.plan_step_id) {
      await this.failPlanStep(variant.plan_step_id, data.error);
    }

    return { success: true, variant };
  }

  /**
   * Fail a plan step when its variant generation fails.
   * Also marks the entire plan as failed.
   */
  private async failPlanStep(stepId: string, error: string): Promise<void> {
    try {
      const step = await this.repo.getPlanStepById(stepId);
      if (!step) {
        console.warn(`[GenerationController] Plan step ${stepId} not found for failure`);
        return;
      }

      // Fail the step
      const updatedStep = await this.repo.failStep(stepId, error);
      if (updatedStep) {
        this.broadcast({ type: 'plan:step_updated', step: updatedStep });
      }

      // Fail the entire plan
      const updatedPlan = await this.repo.updatePlanStatus(step.plan_id, 'failed');
      if (updatedPlan) {
        this.broadcast({ type: 'plan:updated', plan: updatedPlan });
      }

      console.log(`[GenerationController] Failed plan step ${stepId} and plan ${step.plan_id}`);
    } catch (err) {
      console.error(`[GenerationController] Failed to fail plan step ${stepId}:`, err);
    }
  }

  // ==========================================================================
  // Plan Step Execution
  // ==========================================================================

  /**
   * Execute a plan step by triggering the appropriate generation/operation.
   * Called from SpaceDO when a plan step needs to be executed.
   *
   * @returns The variant/job ID if a generation was started, null otherwise
   */
  async executePlanStep(
    step: { id: string; action: string; params: string },
    meta: WebSocketMeta
  ): Promise<string | null> {
    const params = JSON.parse(step.params) as Record<string, unknown>;

    switch (step.action) {
      case 'generate':
        return this.executePlanGenerate(step.id, params, meta);

      case 'derive':
        return this.executePlanDerive(step.id, params, meta);

      case 'refine':
        return this.executePlanRefine(step.id, params, meta);

      case 'fork':
        await this.executePlanFork(step.id, params, meta);
        return null; // Fork is synchronous, no job ID

      // Non-generation actions (add_to_tray, set_prompt, clear_tray)
      // These should be handled by the frontend for now
      default:
        console.log(`[GenerationController] Plan step action '${step.action}' not handled server-side`);
        return null;
    }
  }

  /**
   * Execute a 'generate' plan step
   */
  private async executePlanGenerate(
    stepId: string,
    params: Record<string, unknown>,
    meta: WebSocketMeta
  ): Promise<string> {
    const variantId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const requestId = `plan_${stepId}_${Date.now()}`;

    const name = params.name as string || 'Generated Asset';
    const assetType = params.type as string || 'character';
    const prompt = params.prompt as string || `Create a ${assetType}`;
    const aspectRatio = params.aspectRatio as string | undefined;
    const referenceAssetIds = params.referenceAssetIds as string[] | undefined;
    const parentAssetId = params.parentAssetId as string | undefined;

    // Determine effective parent
    let effectiveParentAssetId = parentAssetId;
    if (!effectiveParentAssetId && referenceAssetIds && referenceAssetIds.length > 0) {
      effectiveParentAssetId = referenceAssetIds[0];
    }

    // Create asset
    const asset = await this.repo.createAsset({
      id: assetId,
      name,
      type: assetType,
      tags: [],
      parentAssetId: effectiveParentAssetId,
      createdBy: meta.userId,
    });
    this.broadcast({ type: 'asset:created', asset });

    // Resolve references
    const { sourceImageKeys, parentVariantIds } = referenceAssetIds
      ? await this.resolveReferences(referenceAssetIds)
      : { sourceImageKeys: [], parentVariantIds: [] };

    // Build recipe
    const recipe: GenerationRecipe = {
      prompt,
      assetType,
      aspectRatio,
      sourceImageKeys: sourceImageKeys.length > 0 ? sourceImageKeys : undefined,
      operation: 'derive',
    };

    // Create placeholder variant linked to the plan step
    const variant = await this.repo.createPlaceholderVariant({
      id: variantId,
      assetId,
      recipe: JSON.stringify(recipe),
      createdBy: meta.userId,
      planStepId: stepId,
    });

    // Set as active and broadcast
    await this.repo.updateAsset(assetId, { active_variant_id: variantId });
    asset.active_variant_id = variantId;
    this.broadcast({ type: 'variant:created', variant });
    this.broadcast({ type: 'asset:updated', asset });
    this.broadcast({
      type: 'generate:started',
      requestId,
      jobId: variantId,
      assetId,
      assetName: name,
    });

    // Create lineage
    for (const parentId of parentVariantIds) {
      const lineage = await this.repo.createLineage({
        id: crypto.randomUUID(),
        parentVariantId: parentId,
        childVariantId: variantId,
        relationType: 'derived',
      });
      this.broadcast({ type: 'lineage:created', lineage });
    }

    // Trigger workflow
    if (this.env.GENERATION_WORKFLOW) {
      const workflowInput: GenerationWorkflowInput = {
        requestId,
        jobId: variantId,
        spaceId: this.spaceId,
        userId: meta.userId,
        prompt,
        assetId,
        assetName: name,
        assetType,
        aspectRatio,
        sourceImageKeys: sourceImageKeys.length > 0 ? sourceImageKeys : undefined,
        parentVariantIds: parentVariantIds.length > 0 ? parentVariantIds : undefined,
        operation: 'derive',
      };

      const instance = await this.env.GENERATION_WORKFLOW.create({
        id: variantId,
        params: workflowInput,
      });

      const updatedVariant = await this.repo.updateVariantWorkflow(variantId, instance.id, 'processing');
      if (updatedVariant) {
        this.broadcast({ type: 'variant:updated', variant: updatedVariant });
      }
    }

    console.log(`[GenerationController] Executed plan step ${stepId}: generate "${name}"`);
    return variantId;
  }

  /**
   * Execute a 'derive' plan step
   */
  private async executePlanDerive(
    stepId: string,
    params: Record<string, unknown>,
    meta: WebSocketMeta
  ): Promise<string> {
    // derive is basically the same as generate but always requires references
    return this.executePlanGenerate(stepId, params, meta);
  }

  /**
   * Execute a 'refine' plan step
   */
  private async executePlanRefine(
    stepId: string,
    params: Record<string, unknown>,
    meta: WebSocketMeta
  ): Promise<string> {
    const variantId = crypto.randomUUID();
    const requestId = `plan_${stepId}_${Date.now()}`;

    const assetId = params.assetId as string;
    const prompt = params.prompt as string;

    if (!assetId) {
      throw new ValidationError('refine requires assetId');
    }

    const asset = await this.repo.getAssetById(assetId);
    if (!asset) {
      throw new NotFoundError(`Asset ${assetId} not found`);
    }

    // Get source variant
    const sourceVariantId = asset.active_variant_id;
    if (!sourceVariantId) {
      throw new ValidationError(`Asset ${assetId} has no active variant`);
    }

    const sourceVariant = await this.repo.getVariantById(sourceVariantId);
    if (!sourceVariant?.image_key) {
      throw new ValidationError(`Asset ${assetId} has no completed variant to refine`);
    }

    // Build recipe
    const recipe: GenerationRecipe = {
      prompt,
      assetType: asset.type,
      sourceImageKeys: [sourceVariant.image_key],
      operation: 'refine',
    };

    // Create placeholder variant linked to plan step
    const variant = await this.repo.createPlaceholderVariant({
      id: variantId,
      assetId,
      recipe: JSON.stringify(recipe),
      createdBy: meta.userId,
      planStepId: stepId,
    });

    // Set as active
    await this.repo.updateAsset(assetId, { active_variant_id: variantId });
    asset.active_variant_id = variantId;
    this.broadcast({ type: 'variant:created', variant });
    this.broadcast({ type: 'asset:updated', asset });
    this.broadcast({
      type: 'refine:started',
      requestId,
      jobId: variantId,
      assetId,
      assetName: asset.name,
    });

    // Create lineage (refined from source)
    const lineage = await this.repo.createLineage({
      id: crypto.randomUUID(),
      parentVariantId: sourceVariantId,
      childVariantId: variantId,
      relationType: 'refined',
    });
    this.broadcast({ type: 'lineage:created', lineage });

    // Trigger workflow
    if (this.env.GENERATION_WORKFLOW) {
      const workflowInput: GenerationWorkflowInput = {
        requestId,
        jobId: variantId,
        spaceId: this.spaceId,
        userId: meta.userId,
        prompt,
        assetId,
        assetName: asset.name,
        assetType: asset.type,
        sourceImageKeys: [sourceVariant.image_key],
        parentVariantIds: [sourceVariantId],
        operation: 'refine',
      };

      const instance = await this.env.GENERATION_WORKFLOW.create({
        id: variantId,
        params: workflowInput,
      });

      const updatedVariant = await this.repo.updateVariantWorkflow(variantId, instance.id, 'processing');
      if (updatedVariant) {
        this.broadcast({ type: 'variant:updated', variant: updatedVariant });
      }
    }

    console.log(`[GenerationController] Executed plan step ${stepId}: refine "${asset.name}"`);
    return variantId;
  }

  /**
   * Execute a 'fork' plan step
   * Fork is handled specially since it's synchronous (no workflow).
   * We mark the step complete immediately after forking.
   */
  private async executePlanFork(
    stepId: string,
    params: Record<string, unknown>,
    meta: WebSocketMeta
  ): Promise<void> {
    const sourceAssetId = params.sourceAssetId as string;
    const name = params.name as string;
    const assetType = params.type as string || 'character';
    const parentAssetId = params.parentAssetId as string | undefined;

    if (!sourceAssetId) {
      throw new ValidationError('fork requires sourceAssetId');
    }

    const sourceAsset = await this.repo.getAssetById(sourceAssetId);
    if (!sourceAsset?.active_variant_id) {
      throw new ValidationError(`Asset ${sourceAssetId} not found or has no active variant`);
    }

    // Fork creates a new asset+variant by copying the source variant
    // Get the source variant to copy it
    const sourceVariant = await this.repo.getVariantById(sourceAsset.active_variant_id);
    if (!sourceVariant) {
      throw new NotFoundError(`Source variant ${sourceAsset.active_variant_id} not found`);
    }

    const now = Date.now();
    const newAssetId = crypto.randomUUID();
    const newVariantId = crypto.randomUUID();

    // Create new asset
    const newAsset = await this.repo.createAsset({
      id: newAssetId,
      name,
      type: assetType,
      tags: [],
      parentAssetId,
      createdBy: meta.userId,
    });

    // Create new variant (copy of source)
    const newVariant: Variant = {
      id: newVariantId,
      asset_id: newAssetId,
      workflow_id: null,
      status: 'completed',
      error_message: null,
      image_key: sourceVariant.image_key,
      thumb_key: sourceVariant.thumb_key,
      recipe: sourceVariant.recipe,
      starred: false,
      created_by: meta.userId,
      created_at: now,
      updated_at: now,
      plan_step_id: null, // Fork is synchronous, doesn't need plan tracking
    };

    // Insert variant directly
    await this.sql.exec(
      `INSERT INTO variants (id, asset_id, workflow_id, status, error_message, image_key, thumb_key, recipe, starred, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newVariant.id,
      newVariant.asset_id,
      newVariant.workflow_id,
      newVariant.status,
      newVariant.error_message,
      newVariant.image_key,
      newVariant.thumb_key,
      newVariant.recipe,
      newVariant.starred ? 1 : 0,
      newVariant.created_by,
      newVariant.created_at,
      newVariant.updated_at
    );

    // Set as active variant
    await this.repo.updateAsset(newAssetId, { active_variant_id: newVariantId });
    newAsset.active_variant_id = newVariantId;

    // Create lineage
    const lineage = await this.repo.createLineage({
      id: crypto.randomUUID(),
      parentVariantId: sourceAsset.active_variant_id,
      childVariantId: newVariantId,
      relationType: 'forked',
    });

    // Broadcast fork result
    this.broadcast({ type: 'asset:forked', asset: newAsset, variant: newVariant, lineage });

    // Complete the step since fork is synchronous
    const updatedStep = await this.repo.completeStep(stepId, `asset:${newAssetId}`);
    if (updatedStep) {
      this.broadcast({ type: 'plan:step_updated', step: updatedStep });
    }

    // Check if plan is complete
    const step = await this.repo.getPlanStepById(stepId);
    if (step) {
      const nextStep = await this.repo.getNextPendingStep(step.plan_id);
      const newStatus = nextStep ? 'paused' : 'completed';
      const updatedPlan = await this.repo.updatePlanStatusAndIndex(
        step.plan_id,
        newStatus,
        step.step_index + 1
      );
      if (updatedPlan) {
        this.broadcast({ type: 'plan:updated', plan: updatedPlan });
      }
    }

    console.log(`[GenerationController] Executed plan step ${stepId}: fork "${name}"`);
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
   * Resolve explicit variant IDs to image keys (for ForgeTray UI)
   * Unlike resolveReferences, this uses the exact variants specified
   */
  private async resolveVariantReferences(
    referenceVariantIds: string[]
  ): Promise<{
    sourceImageKeys: string[];
    parentVariantIds: string[];
  }> {
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
