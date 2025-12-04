/**
 * Chat Command Handler
 *
 * CLI chat interface for the Inventory Forge assistant.
 * All state is stored on the server - no local state files required.
 *
 * Usage:
 *   npm run cli chat send <message> --space <id>    # Send a message
 *   npm run cli chat history --space <id>           # View chat history
 *   npm run cli chat approvals --space <id>         # List pending approvals
 *   npm run cli chat approve <id> --space <id>      # Approve an action
 *   npm run cli chat reject <id> --space <id>       # Reject an action
 *   npm run cli chat plan --space <id>              # View active plan
 *   npm run cli chat plan:approve <id> --space <id> # Approve a plan
 *   npm run cli chat plan:advance <id> --space <id> # Advance plan step
 *   npm run cli chat plan:cancel <id> --space <id>  # Cancel a plan
 *   npm run cli chat watch --space <id>             # Watch for updates
 *   npm run cli chat assets --space <id>            # List space assets
 */

import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { handleSend } from '../chat/send';
import { handleHistory } from '../chat/history';
import { handleApprovals, handleApprove, handleReject } from '../chat/approvals';
import { handleWatch } from '../chat/watch';
import { handleAssets } from '../chat/assets';
import { handlePlan, handlePlanApprove, handlePlanAdvance, handlePlanCancel } from '../chat/plan';

export async function handleChat(parsed: ParsedArgs): Promise<void> {
  const subcommand = parsed.positionals[0];

  switch (subcommand) {
    case 'send':
      await handleSend(parsed);
      break;

    case 'history':
      await handleHistory(parsed);
      break;

    case 'approvals':
      await handleApprovals(parsed);
      break;

    case 'approve':
      await handleApprove(parsed);
      break;

    case 'reject':
      await handleReject(parsed);
      break;

    case 'plan':
      await handlePlan(parsed);
      break;

    case 'plan:approve':
      await handlePlanApprove(parsed);
      break;

    case 'plan:advance':
      await handlePlanAdvance(parsed);
      break;

    case 'plan:cancel':
      await handlePlanCancel(parsed);
      break;

    case 'watch':
      await handleWatch(parsed);
      break;

    case 'assets':
      await handleAssets(parsed);
      break;

    case 'help':
    case undefined:
      printChatHelp();
      break;

    default:
      console.error(`Unknown chat subcommand: ${subcommand}`);
      printChatHelp();
      process.exitCode = 1;
  }
}

function printChatHelp(): void {
  console.log(`
Chat CLI - Stateless chat interface (all state stored on server)

COMMANDS:

  send <message>       Send a chat message
    --space <id>       Space ID (required)
    --mode <mode>      advisor | actor (default: actor)
    --env <env>        production | stage | local (default: stage)
    --local            Shortcut for --env local

  history              View chat history from server
    --space <id>       Space ID (required)
    --limit <n>        Max messages to show (default: 50)

  approvals            List pending approvals
    --space <id>       Space ID (required)

  approve <id>         Approve a pending action
    --space <id>       Space ID (required)

  reject <id>          Reject a pending action
    --space <id>       Space ID (required)

  plan                 View active plan
    --space <id>       Space ID (required)

  plan:approve <id>    Approve a plan (start execution)
    --space <id>       Space ID (required)

  plan:advance <id>    Advance to the next step
    --space <id>       Space ID (required)

  plan:cancel <id>     Cancel a plan
    --space <id>       Space ID (required)

  watch                Watch for real-time updates (Ctrl+C to stop)
    --space <id>       Space ID (required)

  assets               List space assets
    --space <id>       Space ID (required)
    --format           Output format: table | json | ids (default: table)

EXAMPLES:

  # Start a conversation
  npm run cli chat send "Create a warrior character" --space space_abc123

  # View chat history
  npm run cli chat history --space space_abc123

  # View current plan
  npm run cli chat plan --space space_abc123

  # Approve and start a plan
  npm run cli chat plan:approve plan_123 --space space_abc123

  # Continue to next step
  npm run cli chat plan:advance plan_123 --space space_abc123

  # List pending approvals
  npm run cli chat approvals --space space_abc123

  # Approve an action
  npm run cli chat approve abc123-def456 --space space_abc123

  # Watch for real-time updates
  npm run cli chat watch --space space_abc123

NOTES:

  All state (chat history, plans, approvals) is stored on the server.
  Multiple clients (web, CLI) can interact with the same conversation.
  Use 'watch' to see updates from other clients in real-time.
  Plans execute on the server - use 'watch' to monitor progress.
`);
}
