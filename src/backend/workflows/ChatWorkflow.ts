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
import type { BotResponse, ActorResponse, PlanResponse } from '../../api/types';

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
    } = event.payload;

    console.log(`[ChatWorkflow] Starting workflow for requestId: ${requestId}`);

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
        };

        return claudeService.processMessage(message, context, history);
      });
    } catch (error) {
      console.error(`[ChatWorkflow] Claude API error:`, error);
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
        console.warn('[ChatWorkflow] SPACES_DO not available, skipping message storage');
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
            steps: planResponse.plan.steps.map(s => ({
              id: s.id,
              description: s.description,
              action: s.action,
              params: JSON.stringify(s.params),
            })),
          }),
        }));
        if (!planResult.ok) {
          console.error('[ChatWorkflow] Failed to store plan:', await planResult.text());
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
              console.error('[ChatWorkflow] Failed to store approval:', await approvalResult.text());
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
              console.error('[ChatWorkflow] Failed to store auto-executed:', await autoExecResult.text());
            }
          }
        }

        if (approvalIds.length > 0) metadata.approvalIds = approvalIds;
        if (autoExecutedIds.length > 0) metadata.autoExecutedIds = autoExecutedIds;
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

    console.log(`[ChatWorkflow] Completed workflow for requestId: ${requestId}`);

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
      console.warn('[ChatWorkflow] SPACES_DO not available, cannot broadcast result');
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
      console.warn('[ChatWorkflow] SPACES_DO not available, cannot broadcast error');
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
