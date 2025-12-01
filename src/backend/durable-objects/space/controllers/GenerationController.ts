/**
 * Generation Controller
 *
 * Handles workflow triggers for chat, generation, and refinement.
 * Also handles job status broadcasts and workflow result processing.
 */

import type { Variant, WebSocketMeta, ChatMessage, Asset } from '../types';
import type {
  ChatRequestMessage,
  GenerateRequestMessage,
  RefineRequestMessage,
  ChatWorkflowInput,
  ChatWorkflowOutput,
  GenerationWorkflowInput,
  GenerationWorkflowOutput,
  BotContextAsset,
} from '../../../workflows/types';
import type { ChatMessage as ApiChatMessage } from '../../../../api/types';
import { BaseController, type ControllerContext, NotFoundError, ValidationError } from './types';

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
   * Creates asset and triggers GenerationWorkflow
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

    const jobId = crypto.randomUUID();
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
    const { sourceImageKeys, parentVariantIds, jobType } = await this.resolveReferences(
      msg.referenceAssetIds || []
    );

    // Build workflow input
    const workflowInput: GenerationWorkflowInput = {
      requestId: msg.requestId,
      jobId,
      spaceId: this.spaceId,
      userId: meta.userId,
      prompt: msg.prompt || `Generate a ${msg.assetType} named "${msg.name}"`,
      assetId,
      assetName: msg.name,
      assetType: msg.assetType,
      aspectRatio: msg.aspectRatio,
      sourceImageKeys: sourceImageKeys.length > 0 ? sourceImageKeys : undefined,
      parentVariantIds: parentVariantIds.length > 0 ? parentVariantIds : undefined,
      type: jobType,
    };

    // Notify client that generation started
    this.broadcast({
      type: 'generate:started',
      requestId: msg.requestId,
      jobId,
      assetId,
      assetName: msg.name,
    });

    // Trigger the workflow
    const instance = await this.env.GENERATION_WORKFLOW.create({
      id: jobId,
      params: workflowInput,
    });

    console.log(`[GenerationController] Started GenerationWorkflow instance: ${instance.id}`);
  }

  /**
   * Handle refine:request WebSocket message
   * Triggers GenerationWorkflow for variant refinement
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

    const jobId = crypto.randomUUID();

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

    // Resolve additional references
    let sourceImageKeys = [sourceVariant.image_key];
    let parentVariantIds = [sourceVariantId];
    let jobType: 'derive' | 'compose' = 'derive';

    if (msg.referenceAssetIds && msg.referenceAssetIds.length > 0) {
      const additionalRefs = await this.resolveReferences(msg.referenceAssetIds);
      sourceImageKeys = [...sourceImageKeys, ...additionalRefs.sourceImageKeys];
      parentVariantIds = [...parentVariantIds, ...additionalRefs.parentVariantIds];

      if (sourceImageKeys.length > 1) {
        jobType = 'compose';
      }
    }

    // Build workflow input
    const workflowInput: GenerationWorkflowInput = {
      requestId: msg.requestId,
      jobId,
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
      type: jobType,
    };

    // Notify client that refinement started
    this.broadcast({
      type: 'generate:started',
      requestId: msg.requestId,
      jobId,
      assetId: msg.assetId,
      assetName: asset.name,
    });

    // Trigger the workflow
    const instance = await this.env.GENERATION_WORKFLOW.create({
      id: jobId,
      params: workflowInput,
    });

    console.log(`[GenerationController] Started GenerationWorkflow (refine) instance: ${instance.id}`);
  }

  // ==========================================================================
  // HTTP Handlers - Job Status
  // ==========================================================================

  /**
   * Handle POST /internal/job/progress HTTP request
   */
  httpJobProgress(jobId: string, status: string): void {
    this.broadcast({ type: 'job:progress', jobId, status });
  }

  /**
   * Handle POST /internal/job/completed HTTP request
   */
  httpJobCompleted(jobId: string, variant: Variant): void {
    this.broadcast({ type: 'job:completed', jobId, variant });
  }

  /**
   * Handle POST /internal/job/failed HTTP request
   */
  httpJobFailed(jobId: string, error: string): void {
    this.broadcast({ type: 'job:failed', jobId, error });
  }

  // ==========================================================================
  // HTTP Handlers - Workflow Results
  // ==========================================================================

  /**
   * Handle POST /internal/chat-result HTTP request
   * Broadcasts chat workflow result to all clients
   */
  httpChatResult(result: ChatWorkflowOutput): void {
    this.broadcast({
      type: 'chat:response',
      requestId: result.requestId,
      success: result.success,
      response: result.response,
      error: result.error,
    });
  }

  /**
   * Handle POST /internal/generation-result HTTP request
   * Broadcasts generation workflow result to all clients
   */
  httpGenerationResult(result: GenerationWorkflowOutput): void {
    this.broadcast({
      type: 'generate:result',
      requestId: result.requestId,
      jobId: result.jobId,
      success: result.success,
      variant: result.variant as unknown as Variant,
      error: result.error,
    });
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
    jobType: 'generate' | 'derive' | 'compose';
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

    // Determine job type based on number of references
    let jobType: 'generate' | 'derive' | 'compose' = 'generate';
    if (sourceImageKeys.length === 1) {
      jobType = 'derive';
    } else if (sourceImageKeys.length > 1) {
      jobType = 'compose';
    }

    return { sourceImageKeys, parentVariantIds, jobType };
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
