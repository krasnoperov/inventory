/**
 * Chat Command Handler
 *
 * CLI chat interface that simulates the web chat experience for testing
 * and iteration. Provides step-by-step execution with debugging features
 * like file-based state persistence and human-readable logs.
 *
 * Usage:
 *   npm run cli chat send <message> --space <id> --state <file>
 *   npm run cli chat execute --state <file>
 *   npm run cli chat show --state <file> [--section <name>]
 */

import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { handleSend } from '../chat/send';
import { handleExecute } from '../chat/execute';
import { handleShow } from '../chat/show';
import { handleAdvance } from '../chat/advance';
import { handleContext } from '../chat/context';
import { handleAssets } from '../chat/assets';

export async function handleChat(parsed: ParsedArgs): Promise<void> {
  const subcommand = parsed.positionals[0];

  switch (subcommand) {
    case 'send':
      await handleSend(parsed);
      break;

    case 'execute':
      await handleExecute(parsed);
      break;

    case 'show':
      await handleShow(parsed);
      break;

    case 'advance':
      await handleAdvance(parsed);
      break;

    case 'context':
      await handleContext(parsed);
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
Chat CLI - Step-by-step chat interface with debugging features

WORKFLOW:
  1. Send a message → inspect response in state file
  2. For plan responses → use 'advance' to execute steps
  3. For direct actions → use 'execute' to run pending actions
  4. Set context before sending to simulate viewing/forge state
  5. Continue conversation or start fresh

COMMANDS:

  send <message>     Send a chat message and save state (no execution)
    --space <id>     Space ID (required for new conversation)
    --state <file>   State file path (required)
    --mode <mode>    advisor | actor (default: actor)
    --env <env>      production | stage | local (default: stage)
    --local          Shortcut for local development

  advance            Execute next step in active plan (mirrors web UI "Next" button)
    --state <file>   State file path (required)
    --all            Execute all remaining steps (default: one step)
    --wait           Wait for jobs to complete (default: true)
    --timeout <ms>   Max wait time for jobs (default: 120000)

  execute            Execute pending direct actions (non-plan tool calls)
    --state <file>   State file path (required)
    --action <id>    Execute specific action only (optional)
    --wait           Wait for jobs to complete (default: true)
    --timeout <ms>   Max wait time for jobs (default: 120000)

  context            Set viewing/forge context (simulates browser UI state)
    --state <file>   State file path (required)
    --view <assetId> Set viewing context to an asset
    --add <assetIds> Add asset(s) to forge tray (comma-separated)
    --clear-tray     Clear all slots from forge tray
    --prompt <text>  Set the forge prompt
    --operation      Set operation type (generate|fork|derive|refine)

  assets             List space assets (for getting IDs to use with context)
    --state <file>   State file path (or use --space)
    --space <id>     Space ID
    --format         Output format: table | json | ids (default: table)

  show               Pretty-print state for evaluation
    --state <file>   State file path (required)
    --section <name> Section to show (default: all)
                     Options: all, conversation, pending, executed, autoexecuted,
                              artifacts, gemini, meta, plan, context

EXAMPLES:

  # Start a new conversation
  npm run cli chat send "Create a warrior character" \\
    --space space_abc123 --state ./test/warrior.json

  # List assets to get IDs
  npm run cli chat assets --state ./test/warrior.json

  # Set viewing context (simulate viewing an asset)
  npm run cli chat context --state ./test/warrior.json --view asset_xyz

  # Add assets to forge tray
  npm run cli chat context --state ./test/warrior.json \\
    --add asset_abc,asset_def --prompt "Derive a new character from these"

  # Inspect Claude's plan
  npm run cli chat show --state ./test/warrior.json --section plan

  # Execute plan step by step (like clicking "Next" in web UI)
  npm run cli chat advance --state ./test/warrior.json

  # Or execute entire plan at once
  npm run cli chat advance --state ./test/warrior.json --all

  # For direct actions (non-plan responses)
  npm run cli chat execute --state ./test/warrior.json

  # Continue the conversation
  npm run cli chat send "Add a flaming sword" --state ./test/warrior.json

STATE FILE:
  The state file captures everything for evaluation:
  - Chat history and context (forgeContext, viewingContext)
  - Active plan with step-by-step status
  - Pending actions with full Gemini request details
  - Executed actions with results
  - Created artifacts (assets, variants, jobs)

  You can inspect the JSON directly or use 'show' for formatted output.
`);
}
