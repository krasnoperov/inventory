/**
 * Approvals Command - List, approve, or reject pending approvals
 *
 * Usage:
 *   npm run cli chat approvals --space <id>          # List pending
 *   npm run cli chat approve <id> --space <id>       # Approve one
 *   npm run cli chat reject <id> --space <id>        # Reject one
 */

import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { WebSocketClient, type PendingApproval } from '../lib/websocket-client';
import { truncate } from '../lib/utils';

/**
 * List pending approvals
 */
export async function handleApprovals(parsed: ParsedArgs): Promise<void> {
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

    // Set up handler for approval list
    let approvals: PendingApproval[] = [];
    const listReceived = new Promise<void>((resolve) => {
      wsClient!.setOnApprovalList((list) => {
        approvals = list;
        resolve();
      });
    });

    await wsClient.connect();

    // Request approval list
    wsClient.listApprovals();

    // Wait for response (with timeout)
    const timeout = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Timeout waiting for approvals')), 10000);
    });

    await Promise.race([listReceived, timeout]);

    if (approvals.length === 0) {
      console.log('\nNo pending approvals.');
      return;
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Pending Approvals (${approvals.length})`);
    console.log(`${'═'.repeat(60)}`);

    for (const approval of approvals) {
      const params = JSON.parse(approval.params) as Record<string, unknown>;
      const created = new Date(approval.created_at).toLocaleString();

      console.log(`\n[${approval.id}]`);
      console.log(`  Tool: ${approval.tool}`);
      console.log(`  Description: ${approval.description}`);
      if (params.name) {
        console.log(`  Name: ${params.name}`);
      }
      if (params.prompt) {
        console.log(`  Prompt: "${truncate(String(params.prompt), 60)}"`);
      }
      console.log(`  Status: ${approval.status}`);
      console.log(`  Created: ${created}`);
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`\nTo approve: npm run cli chat approve <id> --space ${spaceId}`);
    console.log(`To reject:  npm run cli chat reject <id> --space ${spaceId}`);

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    wsClient?.disconnect();
  }
}

/**
 * Approve a pending approval
 */
export async function handleApprove(parsed: ParsedArgs): Promise<void> {
  const approvalId = parsed.positionals[1]; // positionals[0] is 'approve'
  const spaceId = parsed.options.space;
  const isLocal = parsed.options.local === 'true';
  const env = isLocal ? 'local' : (parsed.options.env || 'stage');

  if (!approvalId) {
    console.error('Error: Approval ID is required');
    console.error('Usage: npm run cli chat approve <id> --space <id>');
    process.exitCode = 1;
    return;
  }

  if (!spaceId) {
    console.error('Error: --space <id> is required');
    process.exitCode = 1;
    return;
  }

  let wsClient: WebSocketClient | null = null;

  try {
    wsClient = await WebSocketClient.create(env, spaceId);

    // Set up handler for approval update - resolve with the approval
    const updateReceived = new Promise<PendingApproval>((resolve) => {
      wsClient!.setOnApprovalUpdated((approval) => {
        if (approval.id === approvalId) {
          resolve(approval);
        }
      });
    });

    await wsClient.connect();

    console.log(`\nApproving ${approvalId}...`);

    // Send approval
    wsClient.approveApproval(approvalId);

    // Wait for response (with timeout)
    const timeout = new Promise<PendingApproval>((_, reject) => {
      setTimeout(() => reject(new Error('Timeout waiting for approval update')), 30000);
    });

    const updated = await Promise.race([updateReceived, timeout]);

    console.log(`✅ Approved: ${updated.description}`);
    console.log(`Status: ${updated.status}`);
    if (updated.result_job_id) {
      console.log(`Job ID: ${updated.result_job_id}`);
    }

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    wsClient?.disconnect();
  }
}

/**
 * Reject a pending approval
 */
export async function handleReject(parsed: ParsedArgs): Promise<void> {
  const approvalId = parsed.positionals[1]; // positionals[0] is 'reject'
  const spaceId = parsed.options.space;
  const isLocal = parsed.options.local === 'true';
  const env = isLocal ? 'local' : (parsed.options.env || 'stage');

  if (!approvalId) {
    console.error('Error: Approval ID is required');
    console.error('Usage: npm run cli chat reject <id> --space <id>');
    process.exitCode = 1;
    return;
  }

  if (!spaceId) {
    console.error('Error: --space <id> is required');
    process.exitCode = 1;
    return;
  }

  let wsClient: WebSocketClient | null = null;

  try {
    wsClient = await WebSocketClient.create(env, spaceId);

    // Set up handler for approval update - resolve with the approval
    const updateReceived = new Promise<PendingApproval>((resolve) => {
      wsClient!.setOnApprovalUpdated((approval) => {
        if (approval.id === approvalId) {
          resolve(approval);
        }
      });
    });

    await wsClient.connect();

    console.log(`\nRejecting ${approvalId}...`);

    // Send rejection
    wsClient.rejectApproval(approvalId);

    // Wait for response (with timeout)
    const timeout = new Promise<PendingApproval>((_, reject) => {
      setTimeout(() => reject(new Error('Timeout waiting for rejection update')), 10000);
    });

    const updated = await Promise.race([updateReceived, timeout]);

    console.log(`❌ Rejected: ${updated.description}`);
    console.log(`Status: ${updated.status}`);

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    wsClient?.disconnect();
  }
}
