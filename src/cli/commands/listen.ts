/**
 * Listen Command - Connect to space WebSocket and stream all events
 *
 * Usage:
 *   npm run cli listen --space <id>           Listen to space events
 *   npm run cli listen --space <id> --json    Output raw JSON
 *
 * Log format (aligned with watch.ts):
 *   [HH:MM:SS.mmm] event_type
 *      Detail: value
 *      Detail: value
 *
 * Icons:
 *   ⏳ = executing/pending
 *   ✓/✅ = complete/success
 *   ✗/❌ = failed/error
 *   📋 = plan
 *   📦 = sync
 */

import process from 'node:process';
import WebSocket from 'ws';
import type { ParsedArgs } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

// Event type categories for coloring
const eventColors: Record<string, string> = {
  // Sync
  'sync:state': colors.cyan,
  // Assets
  'asset:created': colors.green,
  'asset:updated': colors.yellow,
  'asset:deleted': colors.red,
  'asset:forked': colors.green,
  // Variants
  'variant:created': colors.green,
  'variant:updated': colors.yellow,
  'variant:deleted': colors.red,
  // Jobs
  'job:progress': colors.blue,
  'job:completed': colors.green,
  'job:failed': colors.red,
  // Chat
  'chat:message': colors.cyan,
  'chat:response': colors.cyan,
  'chat:progress': colors.blue,
  'chat:error': colors.red,
  // Generation
  'generate:started': colors.magenta,
  'generate:result': colors.green,
  'generate:error': colors.red,
  'refine:started': colors.magenta,
  'refine:result': colors.green,
  'refine:error': colors.red,
  // Vision
  'describe:response': colors.cyan,
  'compare:response': colors.cyan,
  // Lineage
  'lineage:created': colors.blue,
  'lineage:severed': colors.yellow,
  // Presence
  'presence:update': colors.dim,
  // Approvals
  'approval:created': colors.yellow,
  'approval:updated': colors.green,
  'approval:deleted': colors.red,
  'approval:list': colors.cyan,
  // Auto-executed
  'auto_executed': colors.green,
  // Plans
  'simple_plan:updated': colors.magenta,
  'simple_plan:archived': colors.yellow,
  // Errors
  'error': colors.red,
};

export async function handleListen(parsed: ParsedArgs): Promise<void> {
  const isLocal = parsed.options.local === 'true';
  const env = isLocal ? 'local' : (parsed.options.env || 'stage');
  const spaceId = parsed.options.space;
  const jsonOutput = parsed.options.json === 'true';

  if (!spaceId) {
    console.error('Error: --space <id> is required');
    console.error('Usage: npm run cli listen --space <space_id>');
    process.exitCode = 1;
    return;
  }

  // Load config
  const config = await loadStoredConfig(env);
  if (!config) {
    console.error(`Not logged in to ${env} environment.`);
    console.error(`Run: npm run cli login --env ${env}`);
    process.exitCode = 1;
    return;
  }

  // Check token expiry
  if (config.token.expiresAt < Date.now()) {
    console.error(`Token expired for ${env} environment.`);
    console.error(`Run: npm run cli login --env ${env}`);
    process.exitCode = 1;
    return;
  }

  const baseUrl = resolveBaseUrl(env);
  const accessToken = config.token.accessToken;

  // Disable SSL verification for local dev
  if (env === 'local') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  // Build WebSocket URL
  const protocol = baseUrl.startsWith('https') ? 'wss' : 'ws';
  const host = baseUrl.replace(/^https?:\/\//, '');
  const wsUrl = `${protocol}://${host}/api/spaces/${spaceId}/ws`;

  console.log(`Connecting to space ${spaceId} on ${env}...`);
  console.log(`WebSocket URL: ${wsUrl}`);
  console.log('');

  const ws = new WebSocket(wsUrl, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  let connected = false;
  let messageCount = 0;

  ws.on('open', () => {
    connected = true;
    console.log(`${colors.green}Connected!${colors.reset} Listening for events...`);
    console.log(`${colors.dim}Press Ctrl+C to exit${colors.reset}`);
    console.log('');

    // Request initial sync
    ws.send(JSON.stringify({ type: 'sync:request' }));
  });

  ws.on('message', (data: WebSocket.Data) => {
    messageCount++;
    const timestamp = new Date().toISOString().slice(11, 23);

    try {
      const message = JSON.parse(data.toString());
      const messageType = message.type || 'unknown';

      if (jsonOutput) {
        // Raw JSON output
        console.log(JSON.stringify(message));
      } else {
        // Pretty formatted output
        const color = eventColors[messageType] || colors.reset;
        console.log(`${colors.dim}[${timestamp}]${colors.reset} ${color}${messageType}${colors.reset}`);

        // Print message details based on type
        printMessageDetails(message, messageType);
        console.log('');
      }
    } catch {
      // Non-JSON message
      if (jsonOutput) {
        console.log(JSON.stringify({ raw: data.toString() }));
      } else {
        console.log(`${colors.dim}[${timestamp}]${colors.reset} Raw: ${data.toString().slice(0, 100)}`);
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`${colors.red}WebSocket error:${colors.reset}`, err.message);
    process.exitCode = 1;
  });

  ws.on('close', (code, reason) => {
    console.log('');
    console.log(`${colors.yellow}Disconnected${colors.reset} (code: ${code}${reason ? `, reason: ${reason}` : ''})`);
    console.log(`Total messages received: ${messageCount}`);

    if (!connected) {
      console.error(`${colors.red}Failed to connect. Check space ID and permissions.${colors.reset}`);
      process.exitCode = 1;
    }
  });

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log('');
    console.log('Closing connection...');
    ws.close();
  });

  // Keep process alive
  await new Promise(() => {
    // Never resolves - process exits on disconnect or SIGINT
  });
}

function printMessageDetails(message: Record<string, unknown>, type: string): void {
  switch (type) {
    case 'sync:state': {
      const assets = (message.assets as unknown[]) || [];
      const variants = (message.variants as unknown[]) || [];
      const lineage = (message.lineage as unknown[]) || [];
      console.log(`   Assets: ${assets.length}, Variants: ${variants.length}, Lineage: ${lineage.length}`);
      break;
    }

    case 'asset:created':
    case 'asset:updated': {
      const asset = message.asset as { id?: string; name?: string; type?: string } | undefined;
      if (asset) {
        console.log(`   ${asset.name} (${asset.type}) [${asset.id}]`);
      }
      break;
    }

    case 'asset:deleted':
      console.log(`   ID: ${message.assetId}`);
      break;

    case 'asset:forked': {
      const asset = message.asset as { name?: string; type?: string } | undefined;
      const variant = message.variant as { id?: string } | undefined;
      if (asset) {
        console.log(`   ${asset.name} (${asset.type}) from variant ${variant?.id}`);
      }
      break;
    }

    case 'variant:created':
    case 'variant:updated': {
      const variant = message.variant as {
        id?: string;
        asset_id?: string;
        status?: string;
        error_message?: string;
      } | undefined;
      if (variant) {
        console.log(`   Variant: ${variant.id} [${variant.status}]`);
        if (variant.error_message) {
          console.log(`   ${colors.red}Error: ${variant.error_message}${colors.reset}`);
        }
      }
      break;
    }

    case 'variant:deleted':
      console.log(`   ID: ${message.variantId}`);
      break;

    case 'job:progress':
      console.log(`   Job: ${message.jobId} → ${message.status}`);
      break;

    case 'job:completed': {
      const variant = message.variant as { id?: string } | undefined;
      console.log(`   Job: ${message.jobId} → completed (variant: ${variant?.id})`);
      break;
    }

    case 'job:failed':
      console.log(`   Job: ${message.jobId} → ${colors.red}${message.error}${colors.reset}`);
      break;

    case 'chat:message': {
      const msg = message.message as { sender_type?: string; content?: string } | undefined;
      if (msg) {
        const preview = String(msg.content || '').slice(0, 80);
        console.log(`   [${msg.sender_type}] ${preview}${(msg.content?.length || 0) > 80 ? '...' : ''}`);
      }
      break;
    }

    case 'chat:response': {
      console.log(`   Request: ${message.requestId}`);
      console.log(`   Success: ${message.success}`);
      if (message.error) {
        console.log(`   ${colors.red}Error: ${message.error}${colors.reset}`);
      }
      const deferredActions = message.deferredActions as Array<{ tool: string }> | undefined;
      if (deferredActions && deferredActions.length > 0) {
        console.log(`   Deferred: ${deferredActions.map(a => a.tool).join(', ')}`);
      }
      break;
    }

    case 'chat:progress': {
      const status = message.status as string;
      const toolName = message.toolName as string;
      const toolParams = message.toolParams as Record<string, unknown> | undefined;
      const statusIcon = status === 'executing' ? '⏳' : status === 'complete' ? '✓' : '✗';
      const statusColor = status === 'complete' ? colors.green : status === 'failed' ? colors.red : colors.blue;
      console.log(`   ${statusColor}${statusIcon} ${toolName}${colors.reset}`);
      if (toolParams) {
        const paramStr = Object.entries(toolParams)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 30) : v}`)
          .join(', ');
        if (paramStr) {
          console.log(`     Params: ${paramStr}`);
        }
      }
      if (message.error) {
        console.log(`     ${colors.red}Error: ${message.error}${colors.reset}`);
      }
      if (message.result && status === 'complete') {
        const result = String(message.result).slice(0, 80);
        console.log(`     Result: ${result}${String(message.result).length > 80 ? '...' : ''}`);
      }
      break;
    }

    case 'chat:error':
    case 'generate:error':
    case 'refine:error':
      console.log(`   Request: ${message.requestId}`);
      console.log(`   ${colors.red}${message.code}: ${message.error}${colors.reset}`);
      break;

    case 'generate:started':
    case 'refine:started':
      console.log(`   Request: ${message.requestId}`);
      console.log(`   Job: ${message.jobId} for ${message.assetName} [${message.assetId}]`);
      break;

    case 'generate:result':
    case 'refine:result': {
      console.log(`   Request: ${message.requestId}`);
      console.log(`   Success: ${message.success}`);
      if (message.error) {
        console.log(`   ${colors.red}Error: ${message.error}${colors.reset}`);
      }
      const variant = message.variant as { id?: string } | undefined;
      if (variant) {
        console.log(`   Variant: ${variant.id}`);
      }
      break;
    }

    case 'describe:response':
    case 'compare:response': {
      console.log(`   Request: ${message.requestId}`);
      console.log(`   Success: ${message.success}`);
      const content = (message.description || message.comparison) as string | undefined;
      if (content) {
        const preview = content.slice(0, 100);
        console.log(`   ${preview}${content.length > 100 ? '...' : ''}`);
      }
      break;
    }

    case 'presence:update': {
      const presence = message.presence as Array<{ userId?: string; viewing?: string }> | undefined;
      if (presence) {
        console.log(`   Users: ${presence.length}`);
      }
      break;
    }

    case 'lineage:created': {
      const lineage = message.lineage as {
        parent_variant_id?: string;
        child_variant_id?: string;
        relation_type?: string;
      } | undefined;
      if (lineage) {
        console.log(`   ${lineage.parent_variant_id} → ${lineage.child_variant_id} (${lineage.relation_type})`);
      }
      break;
    }

    case 'lineage:severed':
      console.log(`   ID: ${message.lineageId}`);
      break;

    case 'approval:created': {
      const approval = message.approval as {
        id?: string;
        tool?: string;
        description?: string;
        status?: string;
      } | undefined;
      if (approval) {
        console.log(`   ${colors.yellow}⏳ ${approval.tool}${colors.reset}`);
        console.log(`   ID: ${approval.id}`);
        if (approval.description) {
          console.log(`   ${approval.description}`);
        }
      }
      break;
    }

    case 'approval:updated': {
      const approval = message.approval as {
        id?: string;
        tool?: string;
        status?: string;
        error_message?: string;
        result_job_id?: string;
      } | undefined;
      if (approval) {
        const statusIcon = approval.status === 'approved' ? '✅' :
                          approval.status === 'rejected' ? '❌' :
                          approval.status === 'executed' ? '✓' :
                          approval.status === 'failed' ? '✗' : '⏳';
        console.log(`   ${statusIcon} ${approval.tool} [${approval.status}]`);
        console.log(`   ID: ${approval.id}`);
        if (approval.error_message) {
          console.log(`   ${colors.red}Error: ${approval.error_message}${colors.reset}`);
        }
        if (approval.result_job_id) {
          console.log(`   Job: ${approval.result_job_id}`);
        }
      }
      break;
    }

    case 'approval:deleted':
      console.log(`   ID: ${message.approvalId}`);
      break;

    case 'approval:list': {
      const approvals = message.approvals as Array<{ id?: string; tool?: string; status?: string }> | undefined;
      if (approvals) {
        console.log(`   ${approvals.length} pending approval(s)`);
        for (const a of approvals.slice(0, 5)) {
          console.log(`     - [${a.id?.slice(0, 8)}] ${a.tool} (${a.status})`);
        }
        if (approvals.length > 5) {
          console.log(`     ... and ${approvals.length - 5} more`);
        }
      }
      break;
    }

    case 'auto_executed': {
      const autoExec = message.autoExecuted as {
        tool?: string;
        success?: boolean;
        result?: string;
        error?: string;
      } | undefined;
      if (autoExec) {
        const status = autoExec.success ? '✅' : '❌';
        console.log(`   ${status} ${autoExec.tool}`);
        if (autoExec.result) {
          const result = String(autoExec.result).slice(0, 80);
          console.log(`   Result: ${result}${String(autoExec.result).length > 80 ? '...' : ''}`);
        }
        if (autoExec.error) {
          console.log(`   ${colors.red}Error: ${autoExec.error}${colors.reset}`);
        }
      }
      break;
    }

    case 'simple_plan:updated': {
      const plan = message.plan as {
        id?: string;
        status?: string;
        content?: string;
      } | undefined;
      if (plan) {
        console.log(`   Plan: ${plan.id} [${plan.status}]`);
        if (plan.content) {
          const preview = plan.content.split('\n').slice(0, 2).join(' ').slice(0, 80);
          console.log(`   ${preview}${plan.content.length > 80 ? '...' : ''}`);
        }
      }
      break;
    }

    case 'simple_plan:archived':
      console.log(`   Plan archived: ${message.planId}`);
      break;

    case 'error':
      console.log(`   ${colors.red}${message.code}: ${message.message}${colors.reset}`);
      break;

    default:
      // Print first few keys for unknown types
      const keys = Object.keys(message).filter(k => k !== 'type').slice(0, 5);
      if (keys.length > 0) {
        console.log(`   Keys: ${keys.join(', ')}`);
      }
  }
}
