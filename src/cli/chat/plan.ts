/**
 * Plan Commands - View current plan
 *
 * Plans are now simple markdown documents managed by Claude.
 * The assistant creates and updates plans using the update_plan tool.
 *
 * Usage:
 *   npm run cli chat plan --space <id>   # View current plan
 */

import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { WebSocketClient, type SimplePlan } from '../lib/websocket-client';

/**
 * View current plan
 */
export async function handlePlan(parsed: ParsedArgs): Promise<void> {
  const spaceId = parsed.options.space;
  const isLocal = parsed.options.local === 'true';
  const env = isLocal ? 'local' : (parsed.options.env || 'stage');

  if (!spaceId) {
    console.error('Error: --space <id> is required');
    process.exitCode = 1;
    return;
  }

  let wsClient: WebSocketClient | null = null;

  try {
    wsClient = await WebSocketClient.create(env, spaceId);

    // Set up handlers - wait for a plan update or timeout
    const planReceived = new Promise<SimplePlan | null>((resolve) => {
      const timeoutId = setTimeout(() => resolve(null), 5000);
      wsClient!.setOnPlanUpdated((plan) => {
        clearTimeout(timeoutId);
        resolve(plan);
      });
    });

    await wsClient.connect();

    // Request sync to trigger current state (including any plan)
    wsClient.requestSync();

    // Wait for response
    const plan = await planReceived;

    if (!plan || plan.status === 'archived') {
      console.log('\nNo active plan.');
      console.log(`\nStart a conversation: npm run cli chat send "<message>" --space ${spaceId}`);
      return;
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Plan (${plan.status})`);
    console.log(`${'═'.repeat(60)}`);
    console.log();
    console.log(plan.content);
    console.log();
    console.log(`${'═'.repeat(60)}`);
    console.log(`ID: ${plan.id}`);
    console.log(`Session: ${plan.sessionId}`);
    console.log(`Updated: ${new Date(plan.updatedAt).toLocaleString()}`);
    console.log(`${'═'.repeat(60)}`);

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    wsClient?.disconnect();
  }
}
