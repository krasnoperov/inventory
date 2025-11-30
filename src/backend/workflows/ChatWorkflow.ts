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
      await this.broadcastError(spaceId, requestId, error instanceof Error ? error.message : 'Claude API error');
      return {
        requestId,
        success: false,
        error: error instanceof Error ? error.message : 'Claude API error',
      };
    }

    // Step 3: Store messages in SpaceDO
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

      // Store bot response
      const botContent = claudeResult.response.type === 'advice'
        ? claudeResult.response.message
        : claudeResult.response.message || JSON.stringify(claudeResult.response);

      await doStub.fetch(new Request('http://do/internal/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderType: 'bot',
          senderId: 'claude',
          content: botContent,
          metadata: JSON.stringify({ type: claudeResult.response.type }),
        }),
      }));
    });

    // Step 4: Track usage for billing
    await step.do('track-usage', async () => {
      if (!this.env.DB) {
        console.warn('[ChatWorkflow] DB not available, skipping usage tracking');
        return;
      }

      // Import and use UsageService
      // Note: In workflow context, we need to be careful with DI
      // For simplicity, we'll do a direct insert here
      const now = Date.now();
      const month = new Date(now).toISOString().slice(0, 7); // YYYY-MM

      try {
        await this.env.DB.prepare(`
          INSERT INTO usage_records (user_id, service, operation, input_units, output_units, model, month, created_at)
          VALUES (?, 'claude', 'chat', ?, ?, ?, ?, ?)
        `).bind(
          parseInt(userId),
          claudeResult.usage.inputTokens,
          claudeResult.usage.outputTokens,
          'claude-sonnet-4-20250514',
          month,
          now
        ).run();
      } catch (err) {
        console.warn('[ChatWorkflow] Failed to track usage:', err);
      }
    });

    // Step 5: Broadcast result to WebSocket clients
    await step.do('broadcast-result', async () => {
      await this.broadcastResult(spaceId, {
        requestId,
        success: true,
        response: claudeResult.response,
        usage: claudeResult.usage,
      });
    });

    console.log(`[ChatWorkflow] Completed workflow for requestId: ${requestId}`);

    return {
      requestId,
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
  private async broadcastError(spaceId: string, requestId: string, error: string): Promise<void> {
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
        success: false,
        error,
      }),
    }));
  }
}
