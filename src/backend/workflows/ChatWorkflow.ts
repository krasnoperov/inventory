/**
 * ChatWorkflow - Cloudflare Workflow for Claude Chat Processing
 *
 * Implements an agentic loop where Claude can:
 * - Call tools (describe, compare, search)
 * - Receive tool results
 * - Continue generating until it decides to stop
 *
 * Handles:
 * - Quota validation (done before workflow starts)
 * - Claude API calls with retries
 * - Tool execution in backend (describe, compare, search)
 * - Deferred actions for frontend (tray operations)
 * - Pending approvals for generating tools
 * - Progress broadcasts to WebSocket clients
 * - Message storage in SpaceDO
 * - Usage tracking for billing
 */

import Anthropic from '@anthropic-ai/sdk';
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../../core/types';
import type { ChatWorkflowInput, ChatWorkflowOutput, DeferredAction } from './types';
import type { BotContext, AgenticLoopResponse, ClaudeUsage, ToolUseBlock } from '../services/claudeService';
import { ClaudeService } from '../services/claudeService';
import {
  executeTools,
  buildToolResultMessage,
} from '../services/toolExecutor';
import type { ActorResponse, PendingApproval, AutoExecutedAction } from '../../api/types';
import { loggers } from '../../shared/logger';

const log = loggers.chatWorkflow;

/** Maximum iterations to prevent infinite loops */
const MAX_ITERATIONS = 10;

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

    // Get DO stub for tool execution and messaging
    if (!this.env.SPACES_DO) {
      log.error('SPACES_DO not available', { requestId, spaceId });
      return {
        requestId,
        userId,
        success: false,
        error: 'Internal error: SPACES_DO not configured',
      };
    }

    const doId = this.env.SPACES_DO.idFromName(spaceId);
    const doStub = this.env.SPACES_DO.get(doId);

    // Store user message first
    await step.do('store-user-message', async () => {
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
      return { done: true };
    });

    // Build context for Claude
    const context: BotContext = {
      spaceId,
      spaceName: 'Space',
      assets,
      mode,
      forge: forgeContext,
      viewing: viewingContext,
      personalizationContext,
      plan: activePlan,
    };

    // Track total usage across all iterations
    const totalUsage: ClaudeUsage = { inputTokens: 0, outputTokens: 0 };

    // Collect deferred actions for frontend
    const allDeferredActions: DeferredAction[] = [];

    // Collect all pending approvals
    const allPendingApprovals: PendingApproval[] = [];

    // Track all auto-executed tools for storage
    const allAutoExecutedResults: AutoExecutedAction[] = [];

    // Build conversation history for continuation
    let conversationHistory: Anthropic.MessageParam[] = history.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));
    conversationHistory.push({ role: 'user', content: message });

    // Final response from Claude
    let finalResponse: AgenticLoopResponse | null = null;

    // =========================================================================
    // AGENTIC LOOP
    // =========================================================================
    // Claude may respond with tool_use blocks requesting tool execution.
    // We execute tools in the backend and send results back to Claude.
    // The loop continues until Claude responds with text only (no tool_use).
    //
    // Tool categories:
    // - EXECUTABLE: describe, compare, search - execute and return results
    // - DEFERRED: add_to_tray, set_prompt, etc - acknowledge, queue for frontend
    // - GENERATING: generate, derive, refine - break loop, create approval
    //
    // Flow per iteration:
    // 1. Call Claude API
    // 2. If tool_use blocks → execute tools → broadcast progress → continue
    // 3. If generating tool → break loop, return pending approval
    // 4. If text only → done, return final response
    // =========================================================================
    try {
      let iteration = 0;

      while (iteration < MAX_ITERATIONS) {
        iteration++;
        log.info('Agentic loop iteration', { requestId, spaceId, iteration });

        // Call Claude
        const claudeResultJson = await step.do(`process-claude-${iteration}`, {
          retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
          timeout: '2 minutes',
        }, async () => {
          if (!this.env.ANTHROPIC_API_KEY) {
            throw new Error('ANTHROPIC_API_KEY not configured');
          }

          const claudeService = new ClaudeService(this.env.ANTHROPIC_API_KEY);

          let result: AgenticLoopResponse;
          if (iteration === 1) {
            result = await claudeService.processMessageForAgenticLoop(message, context, history);
          } else {
            // For subsequent iterations, we need to call with proper continuation
            // But since we're using step.do, we serialize and deserialize
            result = await claudeService.processMessageForAgenticLoop(message, context, history);
          }

          // Return a serializable version
          return JSON.stringify({
            response: result.response,
            toolUseBlocks: result.toolUseBlocks,
            textContent: result.textContent,
            isComplete: result.isComplete,
            usage: result.usage,
            rawContent: result.rawContent,
          });
        });

        // Parse the result
        const currentResponse = JSON.parse(claudeResultJson as string) as AgenticLoopResponse;

        // Accumulate usage
        totalUsage.inputTokens += currentResponse.usage.inputTokens;
        totalUsage.outputTokens += currentResponse.usage.outputTokens;

        // Check if Claude is done (no tool calls or stop_reason is not 'tool_use')
        if (currentResponse.isComplete || currentResponse.toolUseBlocks.length === 0) {
          log.info('Agentic loop complete', { requestId, spaceId, iteration, reason: 'isComplete' });
          finalResponse = currentResponse;
          break;
        }

        // Execute tools
        const toolExecResultJson = await step.do(`execute-tools-${iteration}`, async () => {
          const result = await executeTools(
            currentResponse.toolUseBlocks as ToolUseBlock[],
            {
              doStub,
              imagesBucket: this.env.IMAGES,
              anthropicApiKey: this.env.ANTHROPIC_API_KEY,
              forgeContext,
              viewingContext,
            },
            requestId
          );
          return JSON.stringify(result);
        });

        const toolExecResult = JSON.parse(toolExecResultJson as string);

        // Accumulate usage from tool execution (vision calls)
        if (toolExecResult.totalUsage) {
          totalUsage.inputTokens += toolExecResult.totalUsage.inputTokens;
          totalUsage.outputTokens += toolExecResult.totalUsage.outputTokens;
        }

        // Collect deferred actions (tray ops) - these are acknowledged to Claude
        // but actual state changes happen on frontend after response is received.
        // Example: add_to_tray returns "Added Hero to tray" to Claude, but
        // the ForgeTray UI update happens when frontend applies deferredActions.
        if (toolExecResult.deferredActions) {
          allDeferredActions.push(...toolExecResult.deferredActions);
        }

        // Collect pending approvals (generating tools) - these break the loop
        // and return to user for approval before execution
        if (toolExecResult.pendingApprovals) {
          allPendingApprovals.push(...toolExecResult.pendingApprovals);
        }

        // Track auto-executed tools for history display
        if (toolExecResult.toolResults) {
          for (const result of toolExecResult.toolResults) {
            const toolBlock = currentResponse.toolUseBlocks.find((b: ToolUseBlock) => b.id === result.toolUseId);
            allAutoExecutedResults.push({
              tool: result.toolName,
              params: toolBlock?.input || {},
              result: result.result,
              success: result.success,
              error: result.error,
            });
          }
        }

        // Broadcast progress for each tool
        await step.do(`broadcast-progress-${iteration}`, async () => {
          for (const result of toolExecResult.toolResults || []) {
            const toolBlock = currentResponse.toolUseBlocks.find((b: ToolUseBlock) => b.id === result.toolUseId);
            await this.broadcastProgress(spaceId, requestId, {
              toolName: result.toolName,
              toolParams: toolBlock?.input || {},
              status: result.success ? 'complete' : 'failed',
              result: result.success ? String(result.result).slice(0, 200) : undefined,
              error: result.error,
            });
          }
          return { done: true };
        });

        // If there are pending approvals, stop the loop
        if (!toolExecResult.shouldContinue) {
          log.info('Agentic loop stopped', { requestId, spaceId, iteration, reason: 'pending_approvals' });
          finalResponse = currentResponse;
          break;
        }

        // Build tool results for next Claude call
        const toolResultBlocks = buildToolResultMessage(toolExecResult.toolResults || []);

        // Continue with Claude - send tool results
        const continuedResultJson = await step.do(`continue-claude-${iteration}`, {
          retries: { limit: 2, delay: '3 seconds', backoff: 'exponential' },
          timeout: '2 minutes',
        }, async () => {
          if (!this.env.ANTHROPIC_API_KEY) {
            throw new Error('ANTHROPIC_API_KEY not configured');
          }

          const claudeService = new ClaudeService(this.env.ANTHROPIC_API_KEY);
          const result = await claudeService.continueWithToolResults(
            context,
            conversationHistory,
            currentResponse.rawContent as Anthropic.ContentBlock[],
            toolResultBlocks
          );
          return JSON.stringify({
            response: result.response,
            toolUseBlocks: result.toolUseBlocks,
            textContent: result.textContent,
            isComplete: result.isComplete,
            usage: result.usage,
            rawContent: result.rawContent,
          });
        });

        const continuedResponse = JSON.parse(continuedResultJson as string) as AgenticLoopResponse;

        // Accumulate usage from continuation
        totalUsage.inputTokens += continuedResponse.usage.inputTokens;
        totalUsage.outputTokens += continuedResponse.usage.outputTokens;

        // Update conversation history for next iteration
        conversationHistory = [
          ...conversationHistory,
          { role: 'assistant' as const, content: currentResponse.rawContent as Anthropic.ContentBlock[] },
          { role: 'user' as const, content: toolResultBlocks },
        ];

        // Check if Claude is now done
        if (continuedResponse.isComplete || continuedResponse.toolUseBlocks.length === 0) {
          log.info('Agentic loop complete after continuation', { requestId, spaceId, iteration });
          finalResponse = continuedResponse;
          break;
        }

        // Update for next iteration - need to continue with more tools
        // This would require more iterations of the loop
        finalResponse = continuedResponse;
      }

      // If we hit max iterations, use the last response
      if (!finalResponse) {
        log.warn('Agentic loop reached max iterations', { requestId, spaceId, maxIterations: MAX_ITERATIONS });
        throw new Error('No response from Claude');
      }

    } catch (error) {
      log.error('Agentic loop error', { requestId, spaceId, error: error instanceof Error ? error.message : String(error) });
      await this.broadcastError(spaceId, requestId, userId, error instanceof Error ? error.message : 'Claude API error');
      return {
        requestId,
        userId,
        success: false,
        error: error instanceof Error ? error.message : 'Claude API error',
      };
    }

    // Handle update_plan tool if present
    await step.do('handle-update-plan', async () => {
      const response = finalResponse!.response;
      if (response.type !== 'action') return { done: true };

      const actionResponse = response as ActorResponse;
      if (!actionResponse.toolCalls) return { done: true };

      for (const toolCall of actionResponse.toolCalls) {
        if (toolCall.name === 'update_plan') {
          const planContent = toolCall.params.content as string;
          const sessionId = event.payload.sessionId || spaceId;

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
              allAutoExecutedResults.push({
                tool: 'update_plan',
                params: toolCall.params,
                result: { planId: planData.plan.id, updated: true },
                success: true,
              });
              log.info('Executed update_plan', { requestId, spaceId, planId: planData.plan.id });
            }
          } catch (err) {
            log.error('Failed to execute update_plan', { requestId, spaceId, error: err instanceof Error ? err.message : String(err) });
          }
        }
      }
      return { done: true };
    });

    // Store pending approvals in database
    await step.do('store-approvals', async () => {
      for (const approval of allPendingApprovals) {
        await doStub.fetch(new Request('http://do/internal/approval', {
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
      }
      return { done: true };
    });

    // Store auto-executed results
    await step.do('store-auto-executed', async () => {
      for (const autoExec of allAutoExecutedResults) {
        const autoExecId = crypto.randomUUID();
        await doStub.fetch(new Request('http://do/internal/auto-executed', {
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
      }
      return { done: true };
    });

    // Store bot message
    await step.do('store-bot-message', async () => {
      const response = finalResponse!.response;
      const metadata: Record<string, unknown> = { type: response.type, mode };

      if (allPendingApprovals.length > 0) {
        metadata.approvalIds = allPendingApprovals.map(a => a.id);
      }

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
      return { done: true };
    });

    // Build final response with deferred actions and pending approvals
    const responseWithExtras = { ...finalResponse.response } as ActorResponse;

    // Remove toolCalls - they were already executed during the agentic loop
    // This prevents double execution in the frontend
    delete responseWithExtras.toolCalls;

    // Add pending approvals from agentic loop
    if (allPendingApprovals.length > 0) {
      responseWithExtras.pendingApprovals = [
        ...(responseWithExtras.pendingApprovals || []),
        ...allPendingApprovals,
      ];
    }

    // Add auto-executed results
    if (allAutoExecutedResults.length > 0) {
      responseWithExtras.autoExecuted = [
        ...(responseWithExtras.autoExecuted || []),
        ...allAutoExecutedResults,
      ];
    }

    // Broadcast final result
    await step.do('broadcast-result', async () => {
      await this.broadcastResult(spaceId, {
        requestId,
        userId,
        success: true,
        response: responseWithExtras,
        usage: totalUsage,
        deferredActions: allDeferredActions.length > 0 ? allDeferredActions : undefined,
      });
      return { done: true };
    });

    log.info('Completed workflow', { requestId, spaceId, userId, responseType: finalResponse.response.type });

    return {
      requestId,
      userId,
      success: true,
      response: responseWithExtras,
      usage: totalUsage,
      deferredActions: allDeferredActions.length > 0 ? allDeferredActions : undefined,
    };
  }

  /**
   * Broadcast progress update for tool execution
   */
  private async broadcastProgress(
    spaceId: string,
    requestId: string,
    progress: {
      toolName: string;
      toolParams: Record<string, unknown>;
      status: 'executing' | 'complete' | 'failed';
      result?: string;
      error?: string;
    }
  ): Promise<void> {
    if (!this.env.SPACES_DO) return;

    const doId = this.env.SPACES_DO.idFromName(spaceId);
    const doStub = this.env.SPACES_DO.get(doId);

    await doStub.fetch(new Request('http://do/internal/chat-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'chat:progress',
        requestId,
        ...progress,
      }),
    }));
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
