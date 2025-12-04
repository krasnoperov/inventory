/**
 * Plan Controller
 *
 * Handles multi-step assistant plan operations.
 * Plans are created by Claude and executed step-by-step with user approval.
 *
 * Features:
 * - Auto-advance: Execute steps automatically after approval
 * - Dependencies: Steps can depend on other steps
 * - Parallel execution: Multiple steps can execute concurrently (up to max_parallel)
 * - Revision support: Steps can be modified mid-execution
 */

import type { Plan, PlanStep, PlanStatus, WebSocketMeta } from '../types';
import { BaseController, type ControllerContext, NotFoundError, ValidationError } from './types';
import { loggers } from '../../../../shared/logger';

const log = loggers.planController;

/**
 * Callback to execute a plan step.
 * Used by auto-advance to trigger step execution.
 */
export type StepExecutor = (step: PlanStep, meta: WebSocketMeta) => Promise<void>;

export class PlanController extends BaseController {
  private stepExecutor: StepExecutor | null = null;

  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  /**
   * Set the step executor callback for auto-advance.
   * This should be called by SpaceDO during initialization.
   */
  setStepExecutor(executor: StepExecutor): void {
    this.stepExecutor = executor;
  }

  // ==========================================================================
  // WebSocket Handlers
  // ==========================================================================

  /**
   * Handle plan:approve - User approves a plan to start execution
   * If auto_advance is enabled, immediately starts executing steps.
   */
  async handleApprove(ws: WebSocket, meta: WebSocketMeta, planId: string): Promise<Plan> {
    this.requireEditor(meta);

    const plan = await this.repo.getPlanById(planId);
    if (!plan) {
      throw new NotFoundError(`Plan ${planId} not found`);
    }

    if (plan.status !== 'planning') {
      throw new ValidationError(`Plan ${planId} is not awaiting approval (status: ${plan.status})`);
    }

    const updated = await this.repo.updatePlanStatus(planId, 'executing');
    if (!updated) {
      throw new Error(`Failed to approve plan ${planId}`);
    }

    // Broadcast to all clients
    this.broadcast({ type: 'plan:updated', plan: updated });

    // If auto-advance is enabled, start executing steps
    if (plan.auto_advance && this.stepExecutor) {
      await this.autoAdvanceSteps(planId, meta);
    }

    return updated;
  }

  /**
   * Handle plan:set_auto_advance - Toggle auto-advance for a plan
   */
  async handleSetAutoAdvance(
    ws: WebSocket,
    meta: WebSocketMeta,
    planId: string,
    autoAdvance: boolean
  ): Promise<Plan> {
    this.requireEditor(meta);

    const plan = await this.repo.getPlanById(planId);
    if (!plan) {
      throw new NotFoundError(`Plan ${planId} not found`);
    }

    const updated = await this.repo.updatePlanAutoAdvance(planId, autoAdvance);
    if (!updated) {
      throw new Error(`Failed to update auto-advance for plan ${planId}`);
    }

    // Broadcast to all clients
    this.broadcast({ type: 'plan:updated', plan: updated });

    // If enabling auto-advance on an executing/paused plan, start advancing
    if (autoAdvance && (plan.status === 'executing' || plan.status === 'paused') && this.stepExecutor) {
      await this.autoAdvanceSteps(planId, meta);
    }

    return updated;
  }

  /**
   * Handle plan:reject - User rejects a plan
   */
  async handleReject(ws: WebSocket, meta: WebSocketMeta, planId: string): Promise<Plan> {
    this.requireEditor(meta);

    const plan = await this.repo.getPlanById(planId);
    if (!plan) {
      throw new NotFoundError(`Plan ${planId} not found`);
    }

    if (plan.status !== 'planning') {
      throw new ValidationError(`Plan ${planId} is not awaiting approval (status: ${plan.status})`);
    }

    const updated = await this.repo.updatePlanStatus(planId, 'cancelled');
    if (!updated) {
      throw new Error(`Failed to reject plan ${planId}`);
    }

    // Broadcast to all clients
    this.broadcast({ type: 'plan:updated', plan: updated });

    return updated;
  }

  /**
   * Handle plan:cancel - User cancels an in-progress plan
   */
  async handleCancel(ws: WebSocket, meta: WebSocketMeta, planId: string): Promise<Plan> {
    this.requireEditor(meta);

    const plan = await this.repo.getPlanById(planId);
    if (!plan) {
      throw new NotFoundError(`Plan ${planId} not found`);
    }

    if (plan.status === 'completed' || plan.status === 'cancelled') {
      throw new ValidationError(`Plan ${planId} is already ${plan.status}`);
    }

    const updated = await this.repo.updatePlanStatus(planId, 'cancelled');
    if (!updated) {
      throw new Error(`Failed to cancel plan ${planId}`);
    }

    // Broadcast to all clients
    this.broadcast({ type: 'plan:updated', plan: updated });

    return updated;
  }

  /**
   * Handle plan:advance - Execute next pending step(s)
   * Uses dependency-aware step selection.
   * Returns the first step that should be executed (caller handles actual execution)
   */
  async handleAdvance(
    ws: WebSocket,
    meta: WebSocketMeta,
    planId: string
  ): Promise<{ plan: Plan; step: PlanStep } | null> {
    this.requireEditor(meta);

    const plan = await this.repo.getPlanById(planId);
    if (!plan) {
      throw new NotFoundError(`Plan ${planId} not found`);
    }

    if (plan.status !== 'executing' && plan.status !== 'paused') {
      throw new ValidationError(`Plan ${planId} cannot be advanced (status: ${plan.status})`);
    }

    // Use dependency-aware step selection, respecting parallel limit
    const availableSlots = Math.max(0, plan.max_parallel - plan.active_step_count);
    if (availableSlots === 0) {
      // Already at max parallel - wait for a step to complete
      return null;
    }

    const executableSteps = await this.repo.getExecutableSteps(planId, 1);
    if (executableSteps.length === 0) {
      // Check if there are any pending steps at all
      const allPending = await this.repo.getAllPendingSteps(planId);
      if (allPending.length === 0) {
        // No more steps - plan is complete
        const completed = await this.repo.updatePlanStatus(planId, 'completed');
        if (completed) {
          this.broadcast({ type: 'plan:updated', plan: completed });
        }
        return null;
      }
      // Steps exist but are blocked by dependencies - nothing to do
      return null;
    }

    const nextStep = executableSteps[0];

    // Mark step as in progress
    const updatedStep = await this.repo.updateStepStatus(nextStep.id, 'in_progress');
    if (!updatedStep) {
      throw new Error(`Failed to start step ${nextStep.id}`);
    }

    // Increment active step count
    await this.repo.incrementActiveSteps(planId);

    // Update plan to executing if it was paused
    let updatedPlan = await this.repo.getPlanById(planId);
    if (updatedPlan && updatedPlan.status === 'paused') {
      updatedPlan = (await this.repo.updatePlanStatus(planId, 'executing')) ?? updatedPlan;
    }

    // Broadcast updates
    if (updatedPlan) {
      this.broadcast({ type: 'plan:updated', plan: updatedPlan });
    }
    this.broadcast({ type: 'plan:step_updated', step: updatedStep });

    return { plan: updatedPlan ?? plan, step: updatedStep };
  }

  /**
   * Handle plan:skip_step - Skip a pending step
   */
  async handleSkipStep(
    ws: WebSocket,
    meta: WebSocketMeta,
    stepId: string
  ): Promise<{ plan: Plan; step: PlanStep }> {
    this.requireEditor(meta);

    const step = await this.repo.getPlanStepById(stepId);
    if (!step) {
      throw new NotFoundError(`Step ${stepId} not found`);
    }

    if (step.status !== 'pending' && step.status !== 'blocked') {
      throw new ValidationError(`Step ${stepId} cannot be skipped (status: ${step.status})`);
    }

    const updatedStep = await this.repo.skipStep(stepId);
    if (!updatedStep) {
      throw new Error(`Failed to skip step ${stepId}`);
    }

    // If this step was blocking others, unblock them
    await this.unblockDependentSteps(step.plan_id, stepId);

    const plan = await this.repo.getPlanById(step.plan_id);
    if (!plan) {
      throw new NotFoundError(`Plan ${step.plan_id} not found`);
    }

    // Broadcast updates
    this.broadcast({ type: 'plan:step_updated', step: updatedStep });
    this.broadcast({ type: 'plan:updated', plan });

    // If auto-advance is enabled, continue
    if (plan.auto_advance && this.stepExecutor) {
      await this.autoAdvanceSteps(step.plan_id, meta);
    }

    return { plan, step: updatedStep };
  }

  /**
   * Handle plan:retry_step - Retry a failed step
   */
  async handleRetryStep(
    ws: WebSocket,
    meta: WebSocketMeta,
    stepId: string
  ): Promise<{ plan: Plan; step: PlanStep } | null> {
    this.requireEditor(meta);

    const step = await this.repo.getPlanStepById(stepId);
    if (!step) {
      throw new NotFoundError(`Step ${stepId} not found`);
    }

    if (step.status !== 'failed') {
      throw new ValidationError(`Step ${stepId} cannot be retried (status: ${step.status})`);
    }

    // Reset step to pending
    const updatedStep = await this.repo.updateStepStatus(stepId, 'pending');
    if (!updatedStep) {
      throw new Error(`Failed to reset step ${stepId}`);
    }

    // Unblock any steps that were blocked by this failure
    await this.unblockDependentSteps(step.plan_id, stepId);

    // Resume plan from paused/failed state
    const plan = await this.repo.getPlanById(step.plan_id);
    if (!plan) {
      throw new NotFoundError(`Plan ${step.plan_id} not found`);
    }

    let updatedPlan = plan;
    if (plan.status === 'failed' || plan.status === 'paused') {
      updatedPlan = (await this.repo.updatePlanStatus(step.plan_id, 'executing')) ?? plan;
    }

    // Broadcast updates
    this.broadcast({ type: 'plan:step_updated', step: updatedStep });
    this.broadcast({ type: 'plan:updated', plan: updatedPlan });

    // Execute the step
    return this.handleAdvance(ws, meta, step.plan_id);
  }

  // ==========================================================================
  // HTTP Handlers (Internal API)
  // ==========================================================================

  /**
   * Create a new plan with steps (called by ChatWorkflow)
   */
  async httpCreatePlan(data: {
    id: string;
    goal: string;
    createdBy: string;
    autoAdvance?: boolean;
    maxParallel?: number;
    steps: Array<{
      id: string;
      description: string;
      action: string;
      params: string;
      dependsOn?: string[];
    }>;
  }): Promise<{ plan: Plan; steps: PlanStep[] }> {
    // Create the plan
    const plan = await this.repo.createPlan({
      id: data.id,
      goal: data.goal,
      status: 'planning',
      createdBy: data.createdBy,
      autoAdvance: data.autoAdvance ?? false,
      maxParallel: data.maxParallel ?? 3,
    });

    // Create all steps
    const steps: PlanStep[] = [];
    for (let i = 0; i < data.steps.length; i++) {
      const stepData = data.steps[i];
      const step = await this.repo.createPlanStep({
        id: stepData.id,
        planId: data.id,
        stepIndex: i,
        description: stepData.description,
        action: stepData.action,
        params: stepData.params,
        dependsOn: stepData.dependsOn,
      });
      steps.push(step);
    }

    // Broadcast to all clients
    this.broadcast({ type: 'plan:created', plan, steps });

    return { plan, steps };
  }

  /**
   * Complete a plan step (called after step execution succeeds)
   * Optionally accepts meta for auto-advance continuation.
   */
  async httpCompleteStep(
    stepId: string,
    result: string,
    meta?: WebSocketMeta
  ): Promise<{ plan: Plan; step: PlanStep }> {
    const step = await this.repo.getPlanStepById(stepId);
    if (!step) {
      throw new NotFoundError(`Step ${stepId} not found`);
    }

    const updatedStep = await this.repo.completeStep(stepId, result);
    if (!updatedStep) {
      throw new Error(`Failed to complete step ${stepId}`);
    }

    // Decrement active step count
    await this.repo.decrementActiveSteps(step.plan_id);

    // Check if there are more executable steps
    const plan = await this.repo.getPlanById(step.plan_id);
    if (!plan) {
      throw new NotFoundError(`Plan ${step.plan_id} not found`);
    }

    const executableSteps = await this.repo.getExecutableSteps(step.plan_id, 1);
    const allPending = await this.repo.getAllPendingSteps(step.plan_id);

    // Determine new status
    let newStatus: PlanStatus;
    if (allPending.length === 0 && plan.active_step_count <= 1) {
      // No more pending steps and this was the last active step
      newStatus = 'completed';
    } else if (plan.auto_advance && executableSteps.length > 0) {
      // More steps ready and auto-advance enabled - stay executing
      newStatus = 'executing';
    } else {
      // Pause for user input
      newStatus = 'paused';
    }

    const updatedPlan = await this.repo.updatePlanStatusAndIndex(
      step.plan_id,
      newStatus,
      step.step_index + 1
    );

    // Broadcast updates
    this.broadcast({ type: 'plan:step_updated', step: updatedStep });
    if (updatedPlan) {
      this.broadcast({ type: 'plan:updated', plan: updatedPlan });
    }

    // If auto-advance is enabled and we have meta, continue execution
    if (
      plan.auto_advance &&
      this.stepExecutor &&
      meta &&
      newStatus === 'executing'
    ) {
      // Queue next batch of steps
      await this.autoAdvanceSteps(step.plan_id, meta);
    }

    return { plan: updatedPlan ?? plan, step: updatedStep };
  }

  /**
   * Fail a plan step (called when step execution fails)
   * Blocks dependent steps and pauses plan for user decision.
   */
  async httpFailStep(stepId: string, error: string): Promise<{ plan: Plan; step: PlanStep; blockedSteps: PlanStep[] }> {
    const step = await this.repo.getPlanStepById(stepId);
    if (!step) {
      throw new NotFoundError(`Step ${stepId} not found`);
    }

    const updatedStep = await this.repo.failStep(stepId, error);
    if (!updatedStep) {
      throw new Error(`Failed to fail step ${stepId}`);
    }

    // Decrement active step count
    await this.repo.decrementActiveSteps(step.plan_id);

    // Block all steps that depend on this failed step
    const blockedSteps = await this.repo.blockDependentSteps(step.plan_id, stepId);

    // Broadcast blocked step updates
    for (const blockedStep of blockedSteps) {
      this.broadcast({ type: 'plan:step_updated', step: blockedStep });
    }

    const plan = await this.repo.getPlanById(step.plan_id);
    if (!plan) {
      throw new NotFoundError(`Plan ${step.plan_id} not found`);
    }

    // Pause plan for user decision (retry, skip, or cancel)
    // Instead of failing the entire plan, we pause so user can decide
    const updatedPlan = await this.repo.updatePlanStatus(step.plan_id, 'paused');

    // Broadcast updates
    this.broadcast({ type: 'plan:step_updated', step: updatedStep });
    if (updatedPlan) {
      this.broadcast({ type: 'plan:updated', plan: updatedPlan });
    }

    return { plan: updatedPlan ?? plan, step: updatedStep, blockedSteps };
  }

  /**
   * Get the active plan with steps
   */
  async httpGetActivePlan(): Promise<{ plan: Plan; steps: PlanStep[] } | null> {
    const plan = await this.repo.getActivePlan();
    if (!plan) return null;

    const steps = await this.repo.getPlanSteps(plan.id);
    return { plan, steps };
  }

  /**
   * Get plan by ID with steps
   */
  async httpGetPlan(planId: string): Promise<{ plan: Plan; steps: PlanStep[] } | null> {
    const plan = await this.repo.getPlanById(planId);
    if (!plan) return null;

    const steps = await this.repo.getPlanSteps(planId);
    return { plan, steps };
  }

  /**
   * Apply a revision to a plan step (called by ChatWorkflow)
   * Actions: update_params, update_description, skip, insert_after
   */
  async httpApplyRevision(data: {
    planId: string;
    change: {
      stepId: string;
      action: 'update_params' | 'update_description' | 'skip' | 'insert_after';
      newParams?: Record<string, unknown>;
      newDescription?: string;
      newStep?: {
        id?: string;
        description: string;
        action: string;
        params: Record<string, unknown>;
        dependsOn?: string[];
      };
    };
  }): Promise<{ success: boolean; step?: PlanStep; newStepId?: string }> {
    const { planId, change } = data;

    // Verify plan exists
    const plan = await this.repo.getPlanById(planId);
    if (!plan) {
      throw new NotFoundError(`Plan ${planId} not found`);
    }

    // Verify step exists and is pending (can only revise pending steps)
    const step = await this.repo.getPlanStepById(change.stepId);
    if (!step) {
      throw new NotFoundError(`Step ${change.stepId} not found`);
    }

    if (step.status !== 'pending' && step.status !== 'blocked') {
      throw new ValidationError(
        `Cannot revise step ${change.stepId} - status is ${step.status}, must be pending or blocked`
      );
    }

    let updatedStep: PlanStep | null = null;
    let newStepId: string | undefined;

    switch (change.action) {
      case 'update_params':
        if (!change.newParams) {
          throw new ValidationError('update_params requires newParams');
        }
        updatedStep = await this.repo.updateStepParams(
          change.stepId,
          JSON.stringify(change.newParams)
        );
        break;

      case 'update_description':
        if (!change.newDescription) {
          throw new ValidationError('update_description requires newDescription');
        }
        updatedStep = await this.repo.updateStepDescription(
          change.stepId,
          change.newDescription
        );
        break;

      case 'skip':
        updatedStep = await this.repo.skipStep(change.stepId);
        // Unblock dependent steps if needed
        if (updatedStep) {
          await this.unblockDependentSteps(planId, change.stepId);
        }
        break;

      case 'insert_after': {
        if (!change.newStep) {
          throw new ValidationError('insert_after requires newStep');
        }
        const insertedStep = await this.repo.insertStepAfter(change.stepId, {
          id: change.newStep.id || `step_${Date.now()}`,
          description: change.newStep.description,
          action: change.newStep.action,
          params: JSON.stringify(change.newStep.params),
          dependsOn: change.newStep.dependsOn,
        });
        if (insertedStep) {
          newStepId = insertedStep.id;
          updatedStep = insertedStep;
          // Broadcast the new step
          this.broadcast({ type: 'plan:step_created', step: insertedStep });
        }
        break;
      }
    }

    if (!updatedStep) {
      return { success: false };
    }

    // Update plan revision tracking
    await this.repo.markPlanRevised(planId);

    // Broadcast step update
    this.broadcast({ type: 'plan:step_updated', step: updatedStep });

    // Refresh and broadcast plan
    const updatedPlan = await this.repo.getPlanById(planId);
    if (updatedPlan) {
      this.broadcast({ type: 'plan:updated', plan: updatedPlan });
    }

    return {
      success: true,
      step: updatedStep,
      newStepId,
    };
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Auto-advance: Execute up to max_parallel steps concurrently.
   * Called when auto_advance is enabled after approval or step completion.
   */
  private async autoAdvanceSteps(planId: string, meta: WebSocketMeta): Promise<void> {
    if (!this.stepExecutor) {
      log.warn('autoAdvanceSteps called but no stepExecutor set', { planId, spaceId: this.spaceId });
      return;
    }

    const plan = await this.repo.getPlanById(planId);
    if (!plan || !plan.auto_advance) return;

    // Check if plan is in executable state
    if (plan.status !== 'executing' && plan.status !== 'paused') return;

    // Calculate available slots
    const availableSlots = Math.max(0, plan.max_parallel - plan.active_step_count);
    if (availableSlots === 0) return;

    // Get executable steps up to available slots
    const executableSteps = await this.repo.getExecutableSteps(planId, availableSlots);
    if (executableSteps.length === 0) return;

    // Update plan to executing if paused
    if (plan.status === 'paused') {
      const updatedPlan = await this.repo.updatePlanStatus(planId, 'executing');
      if (updatedPlan) {
        this.broadcast({ type: 'plan:updated', plan: updatedPlan });
      }
    }

    // Start each step
    for (const step of executableSteps) {
      // Mark as in_progress
      const updatedStep = await this.repo.updateStepStatus(step.id, 'in_progress');
      if (!updatedStep) continue;

      // Increment active count
      await this.repo.incrementActiveSteps(planId);

      // Broadcast step update
      this.broadcast({ type: 'plan:step_updated', step: updatedStep });

      // Execute step (async - don't await, let it run in background)
      // The step executor should call httpCompleteStep or httpFailStep when done
      this.stepExecutor(updatedStep, meta).catch(err => {
        log.error('Step execution error', {
          stepId: step.id,
          planId,
          spaceId: this.spaceId,
          error: err instanceof Error ? err.message : String(err),
        });
        // Mark step as failed
        this.repo.failStep(step.id, err instanceof Error ? err.message : String(err));
        this.repo.decrementActiveSteps(planId);
      });
    }
  }

  /**
   * Unblock steps that were blocked due to a dependency that is now resolved.
   * Called after a step is skipped or retried.
   */
  private async unblockDependentSteps(planId: string, resolvedStepId: string): Promise<void> {
    const allSteps = await this.repo.getPlanSteps(planId);

    for (const step of allSteps) {
      if (step.status !== 'blocked') continue;
      if (!step.depends_on) continue;

      try {
        const deps = JSON.parse(step.depends_on) as string[];
        if (!deps.includes(resolvedStepId)) continue;

        // Check if all dependencies are now resolved (completed, skipped, or the resolved one)
        const allDepsResolved = deps.every(depId => {
          if (depId === resolvedStepId) return true;
          const depStep = allSteps.find(s => s.id === depId);
          return depStep && (depStep.status === 'completed' || depStep.status === 'skipped');
        });

        if (allDepsResolved) {
          const unblocked = await this.repo.unblockStep(step.id);
          if (unblocked) {
            this.broadcast({ type: 'plan:step_updated', step: unblocked });
          }
        }
      } catch {
        // Invalid JSON - skip
      }
    }
  }
}
