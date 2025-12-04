/**
 * Watch Command - Watch for real-time updates from server
 *
 * Usage: npm run cli chat watch --space <id>
 *
 * Keeps WebSocket connection open and displays updates as they arrive.
 * Press Ctrl+C to stop watching.
 */

import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import {
  WebSocketClient,
  type SimplePlan,
  type PendingApproval,
  type AutoExecuted,
} from '../lib/websocket-client';
import { truncate } from '../lib/utils';

export async function handleWatch(parsed: ParsedArgs): Promise<void> {
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

    // Set up handlers for all event types
    wsClient.setOnPlanUpdated((plan: SimplePlan) => {
      console.log(`\n📋 [PLAN UPDATED] ${plan.id}`);
      console.log(`   Status: ${plan.status}`);
      console.log(`   Session: ${plan.sessionId}`);
      // Show first 3 lines of content
      const lines = plan.content.split('\n').slice(0, 3);
      for (const line of lines) {
        console.log(`   ${truncate(line, 60)}`);
      }
      if (plan.content.split('\n').length > 3) {
        console.log('   ...');
      }
    });

    wsClient.setOnPlanArchived((planId: string) => {
      console.log(`\n📋 [PLAN ARCHIVED] ${planId}`);
    });

    wsClient.setOnApprovalCreated((approval: PendingApproval) => {
      const params = JSON.parse(approval.params) as Record<string, unknown>;
      console.log(`\n⏳ [APPROVAL CREATED] ${approval.tool}`);
      console.log(`   ID: ${approval.id}`);
      console.log(`   Description: ${approval.description}`);
      if (params.prompt) {
        console.log(`   Prompt: "${truncate(String(params.prompt), 60)}"`);
      }
      console.log(`\n   To approve: npm run cli chat approve ${approval.id} --space ${spaceId}`);
    });

    wsClient.setOnApprovalUpdated((approval: PendingApproval) => {
      const status = approval.status === 'approved' ? '✅ APPROVED' :
                     approval.status === 'rejected' ? '❌ REJECTED' :
                     approval.status === 'executed' ? '✓ EXECUTED' :
                     approval.status === 'failed' ? '✗ FAILED' :
                     approval.status;
      console.log(`\n[APPROVAL ${status}] ${approval.id}`);
      console.log(`   Tool: ${approval.tool}`);
      if (approval.result_job_id) {
        console.log(`   Job ID: ${approval.result_job_id}`);
      }
      if (approval.error_message) {
        console.log(`   Error: ${approval.error_message}`);
      }
    });

    wsClient.setOnAutoExecuted((autoExec: AutoExecuted) => {
      const status = autoExec.success ? '✅' : '❌';
      console.log(`\n${status} [AUTO-EXECUTED] ${autoExec.tool}`);
      if (autoExec.result) {
        try {
          const result = JSON.parse(autoExec.result);
          console.log(`   Result: ${truncate(JSON.stringify(result), 80)}`);
        } catch {
          console.log(`   Result: ${truncate(autoExec.result, 80)}`);
        }
      }
      if (autoExec.error) {
        console.log(`   Error: ${autoExec.error}`);
      }
    });

    wsClient.setOnSyncState((data) => {
      console.log(`\n📦 [SYNC] ${data.assets.length} assets, ${data.variants.length} variants`);
    });

    wsClient.setOnError((error) => {
      console.error(`\n❌ [ERROR] ${error.message}`);
    });

    await wsClient.connect();

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Watching space ${spaceId} for updates...`);
    console.log(`Press Ctrl+C to stop`);
    console.log(`${'═'.repeat(60)}`);

    // Request initial sync
    wsClient.requestSync();

    // Keep the process alive until interrupted
    await new Promise<void>((resolve) => {
      const cleanup = () => {
        console.log('\n\nStopping watch...');
        wsClient?.disconnect();
        resolve();
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    });

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
    wsClient?.disconnect();
  }
}
