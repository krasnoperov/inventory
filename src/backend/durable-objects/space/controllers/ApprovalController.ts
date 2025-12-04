/**
 * Approval Controller
 *
 * Handles pending approval operations for trust zones.
 * Approvals are tool calls that require user confirmation before execution.
 */

import type { PendingApproval, AutoExecuted, WebSocketMeta } from '../types';
import { BaseController, type ControllerContext, NotFoundError } from './types';

export class ApprovalController extends BaseController {
  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  // ==========================================================================
  // WebSocket Handlers
  // ==========================================================================

  /**
   * Handle approval:approve - User approves a pending action
   */
  async handleApprove(
    ws: WebSocket,
    meta: WebSocketMeta,
    approvalId: string
  ): Promise<PendingApproval> {
    this.requireEditor(meta);

    const approval = await this.repo.getApprovalById(approvalId);
    if (!approval) {
      throw new NotFoundError(`Approval ${approvalId} not found`);
    }

    if (approval.status !== 'pending') {
      throw new Error(`Approval ${approvalId} is not pending (status: ${approval.status})`);
    }

    const updated = await this.repo.approveApproval(approvalId, meta.userId);
    if (!updated) {
      throw new Error(`Failed to approve ${approvalId}`);
    }

    // Broadcast to all clients
    this.broadcast({ type: 'approval:updated', approval: updated });

    return updated;
  }

  /**
   * Handle approval:reject - User rejects a pending action
   */
  async handleReject(
    ws: WebSocket,
    meta: WebSocketMeta,
    approvalId: string
  ): Promise<PendingApproval> {
    this.requireEditor(meta);

    const approval = await this.repo.getApprovalById(approvalId);
    if (!approval) {
      throw new NotFoundError(`Approval ${approvalId} not found`);
    }

    if (approval.status !== 'pending') {
      throw new Error(`Approval ${approvalId} is not pending (status: ${approval.status})`);
    }

    const updated = await this.repo.rejectApproval(approvalId, meta.userId);
    if (!updated) {
      throw new Error(`Failed to reject ${approvalId}`);
    }

    // Broadcast to all clients
    this.broadcast({ type: 'approval:updated', approval: updated });

    return updated;
  }

  /**
   * Handle approval:list - Get all pending approvals
   */
  async handleList(ws: WebSocket, _meta: WebSocketMeta): Promise<void> {
    const approvals = await this.repo.getPendingApprovals();
    this.send(ws, { type: 'approval:list', approvals });
  }

  // ==========================================================================
  // HTTP Handlers (Internal API)
  // ==========================================================================

  /**
   * Create a new pending approval (called by ChatWorkflow)
   */
  async httpCreateApproval(data: {
    id: string;
    requestId: string;
    planId?: string | null;
    planStepId?: string | null;
    tool: string;
    params: string;
    description: string;
    createdBy: string;
  }): Promise<PendingApproval> {
    const approval = await this.repo.createApproval({
      id: data.id,
      requestId: data.requestId,
      planId: data.planId,
      planStepId: data.planStepId,
      tool: data.tool,
      params: data.params,
      description: data.description,
      createdBy: data.createdBy,
    });

    // Broadcast to all clients
    this.broadcast({ type: 'approval:created', approval });

    return approval;
  }

  /**
   * Mark approval as executed (called after tool execution succeeds)
   */
  async httpExecuteApproval(approvalId: string, resultJobId: string): Promise<PendingApproval> {
    const approval = await this.repo.getApprovalById(approvalId);
    if (!approval) {
      throw new NotFoundError(`Approval ${approvalId} not found`);
    }

    const updated = await this.repo.executeApproval(approvalId, resultJobId);
    if (!updated) {
      throw new Error(`Failed to mark approval ${approvalId} as executed`);
    }

    // Broadcast to all clients
    this.broadcast({ type: 'approval:updated', approval: updated });

    return updated;
  }

  /**
   * Mark approval as failed (called when tool execution fails)
   */
  async httpFailApproval(approvalId: string, errorMessage: string): Promise<PendingApproval> {
    const approval = await this.repo.getApprovalById(approvalId);
    if (!approval) {
      throw new NotFoundError(`Approval ${approvalId} not found`);
    }

    const updated = await this.repo.failApproval(approvalId, errorMessage);
    if (!updated) {
      throw new Error(`Failed to mark approval ${approvalId} as failed`);
    }

    // Broadcast to all clients
    this.broadcast({ type: 'approval:updated', approval: updated });

    return updated;
  }

  /**
   * Get all pending approvals
   */
  async httpGetPending(): Promise<PendingApproval[]> {
    return this.repo.getPendingApprovals();
  }

  /**
   * Get approval by ID
   */
  async httpGetById(approvalId: string): Promise<PendingApproval | null> {
    return this.repo.getApprovalById(approvalId);
  }

  // ==========================================================================
  // Auto-Executed Handlers (safe tools)
  // ==========================================================================

  /**
   * Store an auto-executed tool result (called by ChatWorkflow for safe tools)
   */
  async httpCreateAutoExecuted(data: {
    id: string;
    requestId: string;
    tool: string;
    params: string;
    result: string;
    success: boolean;
    error?: string;
  }): Promise<AutoExecuted> {
    const autoExecuted = await this.repo.createAutoExecuted({
      id: data.id,
      requestId: data.requestId,
      tool: data.tool,
      params: data.params,
      result: data.result,
      success: data.success,
      error: data.error,
    });

    // Broadcast to all clients
    this.broadcast({ type: 'auto_executed', autoExecuted });

    return autoExecuted;
  }
}
