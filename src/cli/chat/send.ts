/**
 * Send Command - Send a chat message and save state
 *
 * Usage: npm run cli chat send <message> --space <id> --state <file>
 */

import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { WebSocketClient } from '../lib/websocket-client';
import { loadState, saveStateWithLog } from './state';
import {
  createInitialState,
  buildGeminiRequest,
  type ConversationState,
  type PendingAction,
  type PlanState,
} from './types';
import type { BotResponse } from '../../api/types';
import { truncate } from '../lib/utils';
import { getNextStepNumber, formatSendStep, type LogEntry } from './logger';

export async function handleSend(parsed: ParsedArgs): Promise<void> {
  // Parse arguments
  const message = parsed.positionals[1]; // positionals[0] is 'send'
  const statePath = parsed.options.state;
  const spaceId = parsed.options.space;
  const mode = (parsed.options.mode || 'actor') as 'advisor' | 'actor';
  const isLocal = parsed.options.local === 'true';
  const env = isLocal ? 'local' : (parsed.options.env || 'stage');

  // Validate arguments
  if (!message) {
    console.error('Error: Message is required');
    console.error('Usage: npm run cli chat send <message> --space <id> --state <file>');
    process.exitCode = 1;
    return;
  }

  if (!statePath) {
    console.error('Error: --state <file> is required');
    process.exitCode = 1;
    return;
  }

  // Load existing state or require space ID for new conversation
  let state = await loadState(statePath);

  if (!state) {
    if (!spaceId) {
      console.error('Error: --space <id> is required for new conversations');
      process.exitCode = 1;
      return;
    }
    state = createInitialState(spaceId, env);
  }

  // Ensure activePlan field exists (for older state files without this field)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (state.activePlan === undefined) {
    state.activePlan = null;
  }

  // Create WebSocket client and connect
  let wsClient: WebSocketClient | null = null;

  try {
    wsClient = await WebSocketClient.create(env, state.meta.spaceId);
    await wsClient.connect();

    console.log(`\nSending message to space ${state.meta.spaceId}...`);
    console.log(`Mode: ${mode}`);
    console.log(`Message: "${truncate(message, 80)}"`);

    // Build forge context for WebSocket format
    // The CLI ForgeContext uses 'slots' which maps to WebSocket 'items'
    const forgeContext = state.conversation.context.forgeContext ? {
      items: state.conversation.context.forgeContext.slots?.map(slot => ({
        assetId: slot.assetId,
        assetName: slot.assetName,
        assetType: '', // CLI slots don't have assetType, WebSocket expects it
        variantId: slot.variantId,
      })) || [],
      prompt: state.conversation.context.forgeContext.prompt,
    } : undefined;

    // Send via WebSocket
    const response = await wsClient.sendChatRequest({
      message,
      mode,
      forgeContext,
      viewingContext: state.conversation.context.viewingContext,
    });

    if (!response.success) {
      throw new Error(response.error || 'Chat request failed');
    }

    const botResponse = response.response as BotResponse;

    console.log(`\nResponse type: ${botResponse.type}`);
    console.log(`Message: ${truncate(botResponse.message, 200)}`);

    // Update state
    state.lastStep = {
      type: 'send',
      timestamp: new Date().toISOString(),
      request: { message, mode },
      response: botResponse,
    };
    state.meta.updatedAt = new Date().toISOString();

    // Add to history
    state.conversation.history.push(
      { role: 'user', content: message },
      { role: 'assistant', content: botResponse.message }
    );

    // Handle different response types
    state.pendingActions = [];

    if (botResponse.type === 'action' && botResponse.pendingApprovals) {
      // Action response with pending approvals
      state.pendingActions = botResponse.pendingApprovals.map(approval => {
        const pendingAction: PendingAction = {
          id: approval.id,
          tool: approval.tool,
          params: approval.params,
          description: approval.description,
          status: 'pending',
          geminiRequest: buildGeminiRequest(approval),
        };
        return pendingAction;
      });

      console.log(`\nPending actions: ${state.pendingActions.length}`);
      for (const action of state.pendingActions) {
        console.log(`  - ${action.tool}: ${truncate(String(action.params.name || action.params.prompt || ''), 50)}`);
      }

      // Clear any active plan when we get direct actions
      state.activePlan = null;
    }

    if (botResponse.type === 'plan') {
      // Plan response - store for step-by-step execution
      const planState: PlanState = {
        plan: botResponse.plan,
        currentStepIndex: 0,
        status: 'awaiting_approval',
        stepResults: [],
      };
      state.activePlan = planState;

      console.log(`\nPlan: ${botResponse.plan.goal}`);
      console.log(`Steps: ${botResponse.plan.steps.length}`);
      for (let i = 0; i < botResponse.plan.steps.length; i++) {
        const step = botResponse.plan.steps[i];
        const prompt = step.params.prompt as string | undefined;
        console.log(`  ${i + 1}. [${step.action}] ${step.description}`);
        if (prompt) {
          console.log(`      Prompt: "${truncate(prompt, 60)}"`);
        }
      }
    }

    // Handle auto-executed actions (describe_image, search_assets, etc.)
    if (botResponse.type === 'action' && botResponse.autoExecuted) {
      state.autoExecuted = botResponse.autoExecuted;

      console.log(`\nAuto-executed: ${botResponse.autoExecuted.length}`);
      for (const executed of botResponse.autoExecuted) {
        const status = executed.success ? '✓' : '✗';
        console.log(`  ${status} ${executed.tool}`);

        // Display result summary based on tool type
        if (executed.success && executed.result) {
          const resultStr = formatAutoExecutedResult(executed.tool, executed.result);
          if (resultStr) {
            console.log(`    → ${resultStr}`);
          }
        } else if (executed.error) {
          console.log(`    → Error: ${executed.error}`);
        }
      }
    } else {
      // Clear auto-executed if not in response
      state.autoExecuted = [];
    }

    // Build log entry
    const stepNumber = getNextStepNumber(state);
    const logContent = formatSendStep(stepNumber, {
      message,
      mode,
      response: botResponse,
      pendingActions: state.pendingActions,
      autoExecuted: state.autoExecuted || [],
      activePlan: state.activePlan,
    });

    const logEntry: LogEntry = {
      stepNumber,
      type: 'send',
      timestamp: new Date().toISOString(),
      content: logContent,
    };

    // Save state with log
    await saveStateWithLog(statePath, state, logEntry);

    console.log(`\nState saved to: ${statePath}`);

    // Show next steps based on response type
    if (state.activePlan) {
      console.log(`\nPlan awaiting approval. Next steps:`);
      console.log(`  1. Review plan: npm run cli chat show --state ${statePath} --section plan`);
      console.log(`  2. Execute step 1: npm run cli chat advance --state ${statePath}`);
      console.log(`  3. Or execute all: npm run cli chat advance --state ${statePath} --all`);
    } else if (state.pendingActions.length > 0) {
      console.log(`\nNext steps:`);
      console.log(`  1. Inspect: npm run cli chat show --state ${statePath} --section pending`);
      console.log(`  2. Execute: npm run cli chat execute --state ${statePath}`);
    } else {
      console.log(`\nTo continue conversation:`);
      console.log(`  npm run cli chat send "<message>" --state ${statePath}`);
    }
  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    // Always disconnect WebSocket
    wsClient?.disconnect();
  }
}

/**
 * Format auto-executed tool result for display
 */
function formatAutoExecutedResult(tool: string, result: unknown): string | null {
  if (!result) return null;

  switch (tool) {
    case 'describe_image': {
      // Description is usually a string
      if (typeof result === 'string') {
        return truncate(result, 100);
      }
      // Or might be an object with description field
      const desc = (result as Record<string, unknown>).description;
      if (typeof desc === 'string') {
        return truncate(desc, 100);
      }
      return null;
    }

    case 'search_assets': {
      // Result is usually an array of assets
      if (Array.isArray(result)) {
        if (result.length === 0) {
          return 'No assets found';
        }
        const names = result.slice(0, 3).map((a: Record<string, unknown>) => a.name || a.id).join(', ');
        return result.length > 3
          ? `Found ${result.length} assets: ${names}...`
          : `Found ${result.length} asset(s): ${names}`;
      }
      return null;
    }

    case 'compare_variants': {
      // Comparison result is usually a string analysis
      if (typeof result === 'string') {
        return truncate(result, 100);
      }
      const comparison = (result as Record<string, unknown>).comparison;
      if (typeof comparison === 'string') {
        return truncate(comparison, 100);
      }
      return null;
    }

    case 'add_to_tray':
    case 'remove_from_tray':
    case 'clear_tray':
    case 'set_prompt': {
      // Tray operations return confirmation
      if (typeof result === 'string') {
        return result;
      }
      const message = (result as Record<string, unknown>).message;
      if (typeof message === 'string') {
        return message;
      }
      return 'Done';
    }

    default:
      // For unknown tools, try to stringify
      if (typeof result === 'string') {
        return truncate(result, 80);
      }
      return null;
  }
}
