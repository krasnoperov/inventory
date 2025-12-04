/**
 * ChatWorkflow - Cloudflare Workflow for Claude Chat Processing
 *
 * Handles chat requests with:
 * - Quota validation
 * - Claude API call with retries
 * - Message storage in SpaceDO
 * - Usage tracking for billing
 * - Result broadcast to WebSocket clients
 */

import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../../core/types';
import type { ChatWorkflowInput, ChatWorkflowOutput } from './types';
import type { BotContext, BotResponseWithUsage } from '../services/claudeService';
import { ClaudeService } from '../services/claudeService';
import type { ActorResponse, PlanResponse, RevisionResponse, RevisionResult } from '../../api/types';
import { loggers } from '../../shared/logger';

const log = loggers.chatWorkflow;

export class ChatWorkflow extends WorkflowEntrypoint<Env, ChatWorkflowInput> {
  async run(event: WorkflowEvent<ChatWorkflowInput>, step: WorkflowStep): Promise<ChatWorkflowOutput> {
    const {
      requestId,
      spaceId,
      userId,
      message,
      mode,
      history,
      forgeContext,
      viewingContext,
      assets,
      personalizationContext,
      activePlan,
    } = event.payload;

    log.info('Starting workflow', { requestId, spaceId, userId, mode });

    // Step 1: Validate and check quota
    // Note: We skip quota check in workflow since it was already done in SpaceDO
    // before triggering the workflow. This avoids race conditions.

    // Step 2: Call Claude API (with retries)
    let claudeResult: BotResponseWithUsage;
    try {
      claudeResult = await step.do('process-claude', {
        retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
        timeout: '2 minutes',
      }, async () => {
        if (!this.env.ANTHROPIC_API_KEY) {
          throw new Error('ANTHROPIC_API_KEY not configured');
        }

        const claudeService = new ClaudeService(this.env.ANTHROPIC_API_KEY);

        // Build context for Claude
        const context: BotContext = {
          spaceId,
          spaceName: 'Space', // Could be passed from input if needed
          assets,
          mode,
          forge: forgeContext,
          viewing: viewingContext,
          personalizationContext,
          activePlan,
        };

        return claudeService.processMessage(message, context, history);
      });
    } catch (error) {
      log.error('Claude API error', { requestId, spaceId, error: error instanceof Error ? error.message : String(error) });
      await this.broadcastError(spaceId, requestId, userId, error instanceof Error ? error.message : 'Claude API error');
      return {
        requestId,
        userId,
        success: false,
        error: error instanceof Error ? error.message : 'Claude API error',
      };
    }

    // Step 3: Store messages, approvals, plans in SpaceDO
    await step.do('store-messages', async () => {
      if (!this.env.SPACES_DO) {
        log.warn('SPACES_DO not available, skipping message storage', { requestId, spaceId });
        return;
      }

      const doId = this.env.SPACES_DO.idFromName(spaceId);
      const doStub = this.env.SPACES_DO.get(doId);

      // Store user message
      await doStub.fetch(new Request('http://do/internal/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderType: 'user',
          senderId: userId,
          content: message,
          metadata: JSON.stringify({ mode }),
        }),
      }));

      // Build metadata for bot message
      const response = claudeResult.response;
      const metadata: Record<string, unknown> = { type: response.type, mode };

      // Handle plan response
      if (response.type === 'plan') {
        const planResponse = response as PlanResponse;
        // Store the plan in the database
        const planResult = await doStub.fetch(new Request('http://do/internal/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: planResponse.plan.id,
            goal: planResponse.plan.goal,
            createdBy: userId,
            autoAdvance: planResponse.plan.autoAdvance ?? false,
            steps: planResponse.plan.steps.map(s => ({
              id: s.id,
              description: s.description,
              action: s.action,
              params: JSON.stringify(s.params),
              dependsOn: s.dependsOn,
            })),
          }),
        }));
        if (!planResult.ok) {
          log.error('Failed to store plan', { requestId, spaceId, planId: planResponse.plan.id, error: await planResult.text() });
        }
        metadata.planId = planResponse.plan.id;
      }

      // Handle action response with approvals and auto-executed
      if (response.type === 'action') {
        const actionResponse = response as ActorResponse;
        const approvalIds: string[] = [];
        const autoExecutedIds: string[] = [];

        // Store pending approvals
        if (actionResponse.pendingApprovals && actionResponse.pendingApprovals.length > 0) {
          for (const approval of actionResponse.pendingApprovals) {
            const approvalResult = await doStub.fetch(new Request('http://do/internal/approval', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: approval.id,
                requestId,
                tool: approval.tool,
                params: JSON.stringify(approval.params),
                description: approval.description,
                createdBy: userId,
              }),
            }));
            if (approvalResult.ok) {
              approvalIds.push(approval.id);
            } else {
              log.error('Failed to store approval', { requestId, spaceId, approvalId: approval.id, error: await approvalResult.text() });
            }
          }
        }

        // Store auto-executed results
        if (actionResponse.autoExecuted && actionResponse.autoExecuted.length > 0) {
          for (const autoExec of actionResponse.autoExecuted) {
            const autoExecId = crypto.randomUUID();
            const autoExecResult = await doStub.fetch(new Request('http://do/internal/auto-executed', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: autoExecId,
                requestId,
                tool: autoExec.tool,
                params: JSON.stringify(autoExec.params),
                result: JSON.stringify(autoExec.result),
                success: autoExec.success,
                error: autoExec.error,
              }),
            }));
            if (autoExecResult.ok) {
              autoExecutedIds.push(autoExecId);
            } else {
              log.error('Failed to store auto-executed', { requestId, spaceId, autoExecId, error: await autoExecResult.text() });
            }
          }
        }

        if (approvalIds.length > 0) metadata.approvalIds = approvalIds;
        if (autoExecutedIds.length > 0) metadata.autoExecutedIds = autoExecutedIds;
      }

      // Handle revision response
      if (response.type === 'revision') {
        const revisionResponse = response as RevisionResponse;
        const autoApplied: RevisionResult[] = [];
        const pendingApprovalIds: string[] = [];

        // Auto-apply minor changes (update_params, update_description)
        for (const change of revisionResponse.revision.changes) {
          if (change.action === 'update_params' || change.action === 'update_description') {
            try {
              const revisionResult = await doStub.fetch(new Request('http://do/internal/plan/revision', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  planId: revisionResponse.revision.planId,
                  change,
                }),
              }));

              if (revisionResult.ok) {
                autoApplied.push({
                  stepId: change.stepId,
                  action: change.action,
                  success: true,
                });
              } else {
                const errorText = await revisionResult.text();
                log.error('Failed to apply revision', { requestId, spaceId, stepId: change.stepId, action: change.action, error: errorText });
                autoApplied.push({
                  stepId: change.stepId,
                  action: change.action,
                  success: false,
                  error: errorText,
                });
              }
            } catch (err) {
              log.error('Error applying revision', { requestId, spaceId, stepId: change.stepId, error: err instanceof Error ? err.message : String(err) });
              autoApplied.push({
                stepId: change.stepId,
                action: change.action,
                success: false,
                error: err instanceof Error ? err.message : 'Unknown error',
              });
            }
          } else {
            // Structural changes (skip, insert_after) - store as pending approval
            const approvalId = `rev_${Date.now()}_${change.stepId}`;
            const approvalResult = await doStub.fetch(new Request('http://do/internal/approval', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: approvalId,
                requestId,
                tool: `revise_plan:${change.action}`,
                params: JSON.stringify({
                  planId: revisionResponse.revision.planId,
                  change,
                }),
                description: `${change.action === 'skip' ? 'Skip step' : 'Insert new step after'}: ${change.stepId}`,
                createdBy: userId,
              }),
            }));
            if (approvalResult.ok) {
              pendingApprovalIds.push(approvalId);
            }
          }
        }

        // Update response with auto-applied results
        (revisionResponse as RevisionResponse).autoApplied = autoApplied;

        metadata.revisionPlanId = revisionResponse.revision.planId;
        metadata.revisionReason = revisionResponse.revision.reason;
        if (autoApplied.length > 0) metadata.autoAppliedRevisions = autoApplied;
        if (pendingApprovalIds.length > 0) metadata.pendingRevisionApprovals = pendingApprovalIds;
      }

      // Store bot response
      const botContent = response.type === 'advice'
        ? response.message
        : response.message || JSON.stringify(response);

      await doStub.fetch(new Request('http://do/internal/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderType: 'bot',
          senderId: 'claude',
          content: botContent,
          metadata: JSON.stringify(metadata),
        }),
      }));
    });

    // Note: Usage tracking is done in SpaceDO.httpChatResult() after successful completion
    // This ensures we only track successful requests and avoids the wrong table issue

    // Step 4: Broadcast result to WebSocket clients
    await step.do('broadcast-result', async () => {
      await this.broadcastResult(spaceId, {
        requestId,
        userId,
        success: true,
        response: claudeResult.response,
        usage: claudeResult.usage,
      });
    });

    log.info('Completed workflow', { requestId, spaceId, userId, responseType: claudeResult.response.type });

    return {
      requestId,
      userId,
      success: true,
      response: claudeResult.response,
      usage: claudeResult.usage,
    };
  }

  /**
   * Broadcast successful result to SpaceDO for WebSocket delivery
   */
  private async broadcastResult(spaceId: string, result: ChatWorkflowOutput): Promise<void> {
    if (!this.env.SPACES_DO) {
      log.warn('SPACES_DO not available, cannot broadcast result', { requestId: result.requestId, spaceId });
      return;
    }

    const doId = this.env.SPACES_DO.idFromName(spaceId);
    const doStub = this.env.SPACES_DO.get(doId);

    await doStub.fetch(new Request('http://do/internal/chat-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    }));
  }

  /**
   * Broadcast error to SpaceDO for WebSocket delivery
   */
  private async broadcastError(spaceId: string, requestId: string, userId: string, error: string): Promise<void> {
    if (!this.env.SPACES_DO) {
      log.warn('SPACES_DO not available, cannot broadcast error', { requestId, spaceId });
      return;
    }

    const doId = this.env.SPACES_DO.idFromName(spaceId);
    const doStub = this.env.SPACES_DO.get(doId);

    await doStub.fetch(new Request('http://do/internal/chat-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        userId,
        success: false,
        error,
      }),
    }));
  }
}
