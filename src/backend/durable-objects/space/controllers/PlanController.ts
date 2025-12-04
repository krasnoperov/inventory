/**
 * Plan Controller
 *
 * Handles multi-step assistant plan operations.
 * Plans are created by Claude and executed step-by-step with user approval.
 */

import type { Plan, PlanStep, PlanStatus, WebSocketMeta } from '../types';
import { BaseController, type ControllerContext, NotFoundError, ValidationError } from './types';

export class PlanController extends BaseController {
  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  // ==========================================================================
  // WebSocket Handlers
  // ==========================================================================

  /**
   * Handle plan:approve - User approves a plan to start execution
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
   * Handle plan:advance - Execute next pending step
   * Returns the step that should be executed (caller handles actual execution)
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

    const nextStep = await this.repo.getNextPendingStep(planId);
    if (!nextStep) {
      // No more steps - plan is complete
      const completed = await this.repo.updatePlanStatus(planId, 'completed');
      if (completed) {
        this.broadcast({ type: 'plan:updated', plan: completed });
      }
      return null;
    }

    // Mark step as in progress
    const updatedStep = await this.repo.updateStepStatus(nextStep.id, 'in_progress');
    if (!updatedStep) {
      throw new Error(`Failed to start step ${nextStep.id}`);
    }

    // Update plan to executing if it was paused
    let updatedPlan = plan;
    if (plan.status === 'paused') {
      updatedPlan = (await this.repo.updatePlanStatus(planId, 'executing')) ?? plan;
    }

    // Broadcast updates
    this.broadcast({ type: 'plan:updated', plan: updatedPlan });
    this.broadcast({ type: 'plan:step_updated', step: updatedStep });

    return { plan: updatedPlan, step: updatedStep };
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
    steps: Array<{
      id: string;
      description: string;
      action: string;
      params: string;
    }>;
  }): Promise<{ plan: Plan; steps: PlanStep[] }> {
    // Create the plan
    const plan = await this.repo.createPlan({
      id: data.id,
      goal: data.goal,
      status: 'planning',
      createdBy: data.createdBy,
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
      });
      steps.push(step);
    }

    // Broadcast to all clients
    this.broadcast({ type: 'plan:created', plan, steps });

    return { plan, steps };
  }

  /**
   * Complete a plan step (called after step execution succeeds)
   */
  async httpCompleteStep(stepId: string, result: string): Promise<{ plan: Plan; step: PlanStep }> {
    const step = await this.repo.getPlanStepById(stepId);
    if (!step) {
      throw new NotFoundError(`Step ${stepId} not found`);
    }

    const updatedStep = await this.repo.completeStep(stepId, result);
    if (!updatedStep) {
      throw new Error(`Failed to complete step ${stepId}`);
    }

    // Check if there are more steps
    const plan = await this.repo.getPlanById(step.plan_id);
    if (!plan) {
      throw new NotFoundError(`Plan ${step.plan_id} not found`);
    }

    const nextStep = await this.repo.getNextPendingStep(step.plan_id);
    const newStatus: PlanStatus = nextStep ? 'paused' : 'completed';

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

    return { plan: updatedPlan ?? plan, step: updatedStep };
  }

  /**
   * Fail a plan step (called when step execution fails)
   */
  async httpFailStep(stepId: string, error: string): Promise<{ plan: Plan; step: PlanStep }> {
    const step = await this.repo.getPlanStepById(stepId);
    if (!step) {
      throw new NotFoundError(`Step ${stepId} not found`);
    }

    const updatedStep = await this.repo.failStep(stepId, error);
    if (!updatedStep) {
      throw new Error(`Failed to fail step ${stepId}`);
    }

    // Mark plan as failed
    const plan = await this.repo.getPlanById(step.plan_id);
    if (!plan) {
      throw new NotFoundError(`Plan ${step.plan_id} not found`);
    }

    const updatedPlan = await this.repo.updatePlanStatus(step.plan_id, 'failed');

    // Broadcast updates
    this.broadcast({ type: 'plan:step_updated', step: updatedStep });
    if (updatedPlan) {
      this.broadcast({ type: 'plan:updated', plan: updatedPlan });
    }

    return { plan: updatedPlan ?? plan, step: updatedStep };
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
}
