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
import type { ActorResponse } from '../../api/types';
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

        const timer = log.startTimer('Claude API call', { requestId, spaceId, mode });

        try {
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
            plan: activePlan, // SimplePlan (markdown-based)
          };

          const result = await claudeService.processMessage(message, context, history);
          timer(true, {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
          });
          return result;
        } catch (error) {
          timer(false, { error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
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

    // Step 3: Execute server-side safe tools (like update_plan) and store messages
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

      // Handle action response with approvals and tool calls
      if (response.type === 'action') {
        const actionResponse = response as ActorResponse;
        const approvalIds: string[] = [];
        const autoExecutedIds: string[] = [];
        const autoExecutedResults: Array<{ tool: string; params: Record<string, unknown>; result: unknown; success: boolean; error?: string }> = [];

        // Execute server-side safe tools (update_plan)
        // These need to run on the server to persist state and broadcast to all clients
        if (actionResponse.toolCalls && actionResponse.toolCalls.length > 0) {
          for (const toolCall of actionResponse.toolCalls) {
            if (toolCall.name === 'update_plan') {
              // Execute update_plan server-side
              const planContent = toolCall.params.content as string;
              const sessionId = event.payload.sessionId || spaceId; // Default to spaceId if no session

              try {
                const planResult = await doStub.fetch(new Request('http://do/internal/plan', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sessionId,
                    content: planContent,
                    createdBy: userId,
                  }),
                }));

                if (planResult.ok) {
                  const planData = await planResult.json() as { plan: { id: string } };
                  autoExecutedResults.push({
                    tool: 'update_plan',
                    params: toolCall.params,
                    result: { planId: planData.plan.id, updated: true },
                    success: true,
                  });
                  log.info('Executed update_plan', { requestId, spaceId, planId: planData.plan.id });
                } else {
                  const errorText = await planResult.text();
                  autoExecutedResults.push({
                    tool: 'update_plan',
                    params: toolCall.params,
                    result: null,
                    success: false,
                    error: errorText,
                  });
                  log.error('Failed to execute update_plan', { requestId, spaceId, error: errorText });
                }
              } catch (err) {
                autoExecutedResults.push({
                  tool: 'update_plan',
                  params: toolCall.params,
                  result: null,
                  success: false,
                  error: err instanceof Error ? err.message : String(err),
                });
                log.error('Error executing update_plan', { requestId, spaceId, error: err instanceof Error ? err.message : String(err) });
              }
            }
            // Other safe tools (add_to_tray, etc.) are executed on frontend
          }
        }

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

        // Store auto-executed results (from ClaudeService + our server-side executions)
        const allAutoExecuted = [
          ...(actionResponse.autoExecuted || []),
          ...autoExecutedResults,
        ];

        for (const autoExec of allAutoExecuted) {
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

        // Add server-executed tools to autoExecuted on response for frontend
        if (autoExecutedResults.length > 0) {
          actionResponse.autoExecuted = [
            ...(actionResponse.autoExecuted || []),
            ...autoExecutedResults,
          ];
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
