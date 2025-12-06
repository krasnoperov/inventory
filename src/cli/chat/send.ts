/**
 * Send Command - Send a chat message (stateless)
 *
 * Usage: npm run cli chat send <message> --space <id>
 *
 * All state is stored on the server. No local state files required.
 *
 * Log format (aligned with watch.ts/listen.ts):
 *   {emoji} Section: count
 *      {status} item details
 *
 * Icons:
 *   ⏳ = pending approval
 *   ✓/✅ = complete/success
 *   ✗/❌ = failed/error
 *   🔄 = deferred (tray ops)
 */

import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { WebSocketClient } from '../lib/websocket-client';
import type { BotResponse } from '../../api/types';
import { truncate } from '../lib/utils';

export async function handleSend(parsed: ParsedArgs): Promise<void> {
  // Parse arguments
  const message = parsed.positionals[1]; // positionals[0] is 'send'
  const spaceId = parsed.options.space;
  const mode = (parsed.options.mode || 'actor') as 'advisor' | 'actor';
  const isLocal = parsed.options.local === 'true';
  const env = isLocal ? 'local' : (parsed.options.env || 'stage');

  // Validate arguments
  if (!message) {
    console.error('Error: Message is required');
    console.error('Usage: npm run cli chat send <message> --space <id>');
    process.exitCode = 1;
    return;
  }

  if (!spaceId) {
    console.error('Error: --space <id> is required');
    process.exitCode = 1;
    return;
  }

  // Create WebSocket client and connect
  let wsClient: WebSocketClient | null = null;

  try {
    wsClient = await WebSocketClient.create(env, spaceId);
    await wsClient.connect();

    console.log(`\nSending message to space ${spaceId}...`);
    console.log(`Mode: ${mode}`);
    console.log(`Message: "${truncate(message, 80)}"`);

    // Send via WebSocket (context comes from server session)
    const response = await wsClient.sendChatRequest({
      message,
      mode,
    });

    if (!response.success) {
      throw new Error(response.error || 'Chat request failed');
    }

    const botResponse = response.response as BotResponse;

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Response type: ${botResponse.type}`);
    console.log(`${'─'.repeat(60)}`);
    console.log(botResponse.message);

    // Handle different response types
    if (botResponse.type === 'action' && botResponse.pendingApprovals && botResponse.pendingApprovals.length > 0) {
      console.log(`\n⏳ [PENDING APPROVALS] ${botResponse.pendingApprovals.length}`);
      for (const approval of botResponse.pendingApprovals) {
        const params = approval.params as Record<string, unknown>;
        console.log(`   - [${approval.id.slice(0, 8)}] ${approval.tool}: ${truncate(String(params.name || params.prompt || ''), 50)}`);
      }
      console.log(`\n   To approve: npm run cli chat approve <id> --space ${spaceId}`);
      console.log(`   To reject:  npm run cli chat reject <id> --space ${spaceId}`);
      console.log(`   List all:   npm run cli chat approvals --space ${spaceId}`);
    }

    // Handle auto-executed actions
    if (botResponse.type === 'action' && botResponse.autoExecuted && botResponse.autoExecuted.length > 0) {
      console.log(`\n✅ [AUTO-EXECUTED] ${botResponse.autoExecuted.length}`);
      for (const executed of botResponse.autoExecuted) {
        const status = executed.success ? '✓' : '✗';
        console.log(`   ${status} ${executed.tool}`);

        if (executed.success && executed.result) {
          const resultStr = formatAutoExecutedResult(executed.tool, executed.result);
          if (resultStr) {
            console.log(`      → ${resultStr}`);
          }
        } else if (executed.error) {
          console.log(`      → Error: ${executed.error}`);
        }
      }
    }

    // Handle deferred actions (tray operations from agentic loop)
    // These are acknowledged to Claude but UI changes happen on frontend
    const deferredActions = (response.response as Record<string, unknown> | undefined)?.deferredActions as Array<{ tool: string; params: Record<string, unknown>; acknowledgment: string }> | undefined;
    if (!deferredActions && response.deferredActions) {
      // Check top-level response for deferredActions
      const topLevelDeferred = response.deferredActions as Array<{ tool: string; params: Record<string, unknown>; acknowledgment: string }> | undefined;
      if (topLevelDeferred && topLevelDeferred.length > 0) {
        console.log(`\n🔄 [DEFERRED] ${topLevelDeferred.length}`);
        for (const action of topLevelDeferred) {
          console.log(`   • ${action.acknowledgment || action.tool}`);
        }
      }
    } else if (deferredActions && deferredActions.length > 0) {
      console.log(`\n🔄 [DEFERRED] ${deferredActions.length}`);
      for (const action of deferredActions) {
        console.log(`   • ${action.acknowledgment || action.tool}`);
      }
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`To continue: npm run cli chat send "<message>" --space ${spaceId}`);
    console.log(`View history: npm run cli chat history --space ${spaceId}`);

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    wsClient?.disconnect();
  }
}

/**
 * Format auto-executed tool result for display
 */
function formatAutoExecutedResult(tool: string, result: unknown): string | null {
  if (!result) return null;

  switch (tool) {
    case 'describe': {
      if (typeof result === 'string') {
        return truncate(result, 100);
      }
      const desc = (result as Record<string, unknown>).description;
      if (typeof desc === 'string') {
        return truncate(desc, 100);
      }
      return null;
    }

    case 'search': {
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

    case 'compare': {
      if (typeof result === 'string') {
        return truncate(result, 100);
      }
      const comparison = (result as Record<string, unknown>).comparison;
      if (typeof comparison === 'string') {
        return truncate(comparison, 100);
      }
      return null;
    }

    default:
      if (typeof result === 'string') {
        return truncate(result, 80);
      }
      return null;
  }
}
