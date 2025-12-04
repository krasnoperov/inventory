/**
 * Plan Executor
 *
 * Handles execution of plan steps (generate, derive, refine, fork).
 * Uses VariantFactory for variant creation to avoid duplication with GenerationController.
 *
 * Also handles plan step lifecycle (completion/failure) which is triggered
 * by workflow callbacks in GenerationController.
 */

import type { Variant, WebSocketMeta, PlanStep, Plan } from '../types';
import type { GenerationWorkflowInput, OperationType } from '../../../workflows/types';
import type { SpaceRepository, SqlStorage } from '../repository/SpaceRepository';
import type { BroadcastFn } from '../controllers/types';
import type { Env } from '../../../../core/types';
import { VariantFactory, determineOperation, type GenerationRecipe } from './VariantFactory';
import { ValidationError, NotFoundError } from '../controllers/types';
import { loggers } from '../../../../shared/logger';

const log = loggers.generationController;

// ============================================================================
// Types
// ============================================================================

/** Parsed plan step for execution */
export interface ParsedPlanStep {
  id: string;
  action: string;
  params: Record<string, unknown>;
}

/** Result of step execution */
export interface StepExecutionResult {
  /** Variant/job ID if generation was started */
  variantId: string | null;
  /** Whether the step completed synchronously (e.g., fork) */
  synchronous: boolean;
}

// ============================================================================
// Plan Executor
// ============================================================================

export class PlanExecutor {
  private readonly factory: VariantFactory;

  constructor(
    private readonly spaceId: string,
    private readonly repo: SpaceRepository,
    private readonly sql: SqlStorage,
    private readonly env: Env,
    private readonly broadcast: BroadcastFn
  ) {
    this.factory = new VariantFactory(spaceId, repo, env, broadcast);
  }

  // ==========================================================================
  // Public Methods - Step Execution
  // ==========================================================================

  /**
   * Execute a plan step by triggering the appropriate generation/operation.
   * Called from SpaceDO when a plan step needs to be executed.
   *
   * @returns The variant/job ID if a generation was started, null otherwise
   */
  async executeStep(
    step: { id: string; action: string; params: string },
    meta: WebSocketMeta
  ): Promise<string | null> {
    const params = JSON.parse(step.params) as Record<string, unknown>;
    const parsed: ParsedPlanStep = { id: step.id, action: step.action, params };

    switch (step.action) {
      case 'generate':
        return this.executeGenerate(parsed, meta);

      case 'derive':
        return this.executeDerive(parsed, meta);

      case 'refine':
        return this.executeRefine(parsed, meta);

      case 'fork':
        await this.executeFork(parsed, meta);
        return null; // Fork is synchronous, no job ID

      default:
        log.debug('Plan step action not handled server-side', {
          spaceId: this.spaceId,
          stepId: step.id,
          action: step.action,
        });
        return null;
    }
  }

  // ==========================================================================
  // Public Methods - Step Lifecycle
  // ==========================================================================

  /**
   * Complete a plan step when its variant generation succeeds.
   * Called from GenerationController.httpCompleteVariant.
   */
  async completeStep(stepId: string, variantId: string): Promise<void> {
    try {
      const step = await this.repo.getPlanStepById(stepId);
      if (!step) {
        log.warn('Plan step not found for completion', { spaceId: this.spaceId, stepId });
        return;
      }

      // Complete the step with the variant ID as result
      const updatedStep = await this.repo.completeStep(stepId, `variant:${variantId}`);
      if (updatedStep) {
        this.broadcast({ type: 'plan:step_updated', step: updatedStep });
      }

      // Decrement active step count
      await this.repo.decrementActiveSteps(step.plan_id);

      // Check if there are more steps; update plan status accordingly
      const plan = await this.repo.getPlanById(step.plan_id);
      if (!plan) return;

      const allPending = await this.repo.getAllPendingSteps(step.plan_id);
      const newStatus = (allPending.length === 0 && plan.active_step_count <= 1)
        ? 'completed'
        : 'paused';

      const updatedPlan = await this.repo.updatePlanStatusAndIndex(
        step.plan_id,
        newStatus,
        step.step_index + 1
      );

      if (updatedPlan) {
        this.broadcast({ type: 'plan:updated', plan: updatedPlan });
      }

      log.info('Completed plan step', { spaceId: this.spaceId, stepId, planStatus: newStatus });
    } catch (err) {
      log.error('Failed to complete plan step', {
        spaceId: this.spaceId,
        stepId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Fail a plan step when its variant generation fails.
   * Called from GenerationController.httpFailVariant.
   */
  async failStep(stepId: string, error: string): Promise<void> {
    try {
      const step = await this.repo.getPlanStepById(stepId);
      if (!step) {
        log.warn('Plan step not found for failure', { spaceId: this.spaceId, stepId });
        return;
      }

      // Fail the step
      const updatedStep = await this.repo.failStep(stepId, error);
      if (updatedStep) {
        this.broadcast({ type: 'plan:step_updated', step: updatedStep });
      }

      // Decrement active step count
      await this.repo.decrementActiveSteps(step.plan_id);

      // Fail the entire plan
      const updatedPlan = await this.repo.updatePlanStatus(step.plan_id, 'failed');
      if (updatedPlan) {
        this.broadcast({ type: 'plan:updated', plan: updatedPlan });
      }

      log.info('Failed plan step', { spaceId: this.spaceId, stepId, planId: step.plan_id });
    } catch (err) {
      log.error('Failed to mark plan step as failed', {
        spaceId: this.spaceId,
        stepId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ==========================================================================
  // Private Methods - Step Executors
  // ==========================================================================

  /**
   * Execute a 'generate' plan step (create new asset, optionally with references)
   */
  private async executeGenerate(step: ParsedPlanStep, meta: WebSocketMeta): Promise<string> {
    const { params } = step;
    const requestId = `plan_${step.id}_${Date.now()}`;

    const name = (params.name as string) || 'Generated Asset';
    const assetType = (params.type as string) || 'character';
    const prompt = (params.prompt as string) || `Create a ${assetType}`;
    const aspectRatio = params.aspectRatio as string | undefined;
    const referenceAssetIds = params.referenceAssetIds as string[] | undefined;
    const parentAssetId = params.parentAssetId as string | undefined;

    // Use factory to create asset + variant
    const result = await this.factory.createAssetWithVariant(
      {
        name,
        assetType,
        prompt,
        aspectRatio,
        parentAssetId,
        referenceAssetIds,
        planStepId: step.id,
      },
      meta
    );

    // Broadcast generate:started
    this.broadcast({
      type: 'generate:started',
      requestId,
      jobId: result.variantId,
      assetId: result.assetId,
      assetName: name,
    });

    // Trigger workflow
    await this.factory.triggerWorkflow(
      requestId,
      result.variantId,
      result,
      meta,
      determineOperation(result.parentVariantIds.length > 0)
    );

    log.info('Executed plan step', {
      spaceId: this.spaceId,
      stepId: step.id,
      action: 'generate',
      assetName: name,
      variantId: result.variantId,
    });

    return result.variantId;
  }

  /**
   * Execute a 'derive' plan step (same as generate but always requires references)
   */
  private async executeDerive(step: ParsedPlanStep, meta: WebSocketMeta): Promise<string> {
    return this.executeGenerate(step, meta);
  }

  /**
   * Execute a 'refine' plan step (add variant to existing asset)
   */
  private async executeRefine(step: ParsedPlanStep, meta: WebSocketMeta): Promise<string> {
    const { params } = step;
    const requestId = `plan_${step.id}_${Date.now()}`;

    const assetId = params.assetId as string;
    const prompt = params.prompt as string;

    if (!assetId) {
      throw new ValidationError('refine requires assetId');
    }

    // Use factory to create refine variant
    const result = await this.factory.createRefineVariant(
      {
        assetId,
        prompt,
        planStepId: step.id,
      },
      meta
    );

    // Set as active variant
    await this.repo.updateAsset(assetId, { active_variant_id: result.variantId });
    result.asset.active_variant_id = result.variantId;
    this.broadcast({ type: 'asset:updated', asset: result.asset });

    // Broadcast refine:started
    this.broadcast({
      type: 'refine:started',
      requestId,
      jobId: result.variantId,
      assetId,
      assetName: result.asset.name,
    });

    // Trigger workflow
    await this.factory.triggerWorkflow(
      requestId,
      result.variantId,
      result,
      meta,
      'refine'
    );

    log.info('Executed plan step: refine', {
      spaceId: this.spaceId,
      stepId: step.id,
      assetName: result.asset.name,
      variantId: result.variantId,
    });

    return result.variantId;
  }

  /**
   * Execute a 'fork' plan step (synchronous - copies variant to new asset)
   */
  private async executeFork(step: ParsedPlanStep, meta: WebSocketMeta): Promise<void> {
    const { params } = step;

    const sourceAssetId = params.sourceAssetId as string;
    const name = params.name as string;
    const assetType = (params.type as string) || 'character';
    const parentAssetId = params.parentAssetId as string | undefined;

    if (!sourceAssetId) {
      throw new ValidationError('fork requires sourceAssetId');
    }

    const sourceAsset = await this.repo.getAssetById(sourceAssetId);
    if (!sourceAsset?.active_variant_id) {
      throw new ValidationError(`Asset ${sourceAssetId} not found or has no active variant`);
    }

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
      plan_step_id: null,
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
    const updatedStep = await this.repo.completeStep(step.id, `asset:${newAssetId}`);
    if (updatedStep) {
      this.broadcast({ type: 'plan:step_updated', step: updatedStep });
    }

    // Update plan status
    const planStep = await this.repo.getPlanStepById(step.id);
    if (planStep) {
      await this.repo.decrementActiveSteps(planStep.plan_id);

      const plan = await this.repo.getPlanById(planStep.plan_id);
      const allPending = await this.repo.getAllPendingSteps(planStep.plan_id);
      const newStatus = (allPending.length === 0 && plan && plan.active_step_count <= 1)
        ? 'completed'
        : 'paused';

      const updatedPlan = await this.repo.updatePlanStatusAndIndex(
        planStep.plan_id,
        newStatus,
        planStep.step_index + 1
      );
      if (updatedPlan) {
        this.broadcast({ type: 'plan:updated', plan: updatedPlan });
      }
    }

    log.info('Executed plan step: fork', {
      spaceId: this.spaceId,
      stepId: step.id,
      assetName: name,
      newAssetId,
    });
  }
}
