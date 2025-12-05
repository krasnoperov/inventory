#!/usr/bin/env node
import process from 'node:process';

// Must be set BEFORE any fetch calls for self-signed certs in local dev
if (process.argv.includes('--local') || process.argv.includes('--env') && process.argv[process.argv.indexOf('--env') + 1] === 'local') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

import { parseArgs } from './lib/utils';
import { handleLogin } from './commands/login';
import { handleLogout } from './commands/logout';
import { handleBilling } from './commands/billing';
import { handleChat } from './commands/chat';
import { handleSpaces } from './commands/spaces';
import { handleListen } from './commands/listen';
import { handleUpload } from './commands/upload';

async function main() {
  const [, , command, ...args] = process.argv;

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  try {
    const parsed = parseArgs(args);
    await dispatchCommand(command, parsed);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error('Unexpected error occurred');
    }
    process.exitCode = 1;
  }
}

function printHelp() {
  console.log(`
CLI Tool - Inventory

Authentication:
  login                        Authenticate with the API and store access token
  logout                       Remove stored credentials

Billing (Polar.sh):
  billing status               Show sync status (pending, failed, synced events)
  billing sync                 Trigger manual sync of pending events
  billing retry-failed         Retry all failed events

Spaces:
  spaces                       List all spaces
  spaces --details             List spaces with asset summaries
  spaces --id <id>             Show details for a specific space
  spaces create <name>         Create a new space

Chat:
  chat send <msg>              Send message to chat service (no execution)
  chat execute                 Execute pending actions
  chat show                    Display state for evaluation

Listen:
  listen --space <id>          Connect to space WebSocket and stream all events
  listen --space <id> --json   Output raw JSON for piping/processing

Upload:
  upload <file> --space <id> --asset <id>   Upload image to existing asset
  upload <file> --space <id> --name <name>  Upload and create new asset

Options:
  --env <environment>          Target environment (production|stage|local), default: stage
  --local                      Shortcut for local development

Examples:
  npm run cli login            Authenticate with stage environment
  npm run cli login --env production
  npm run cli logout
  npm run cli billing status   Show billing sync status
  npm run cli spaces --details List spaces with asset summaries
  npm run cli spaces create "My Game Assets"
  npm run cli listen --space space_123
  npm run cli chat send "Create a warrior" --space space_123 --state test.json
`);
}

async function dispatchCommand(command: string, parsed: Parameters<typeof parseArgs>[0] extends string[] ? ReturnType<typeof parseArgs> : never) {
  switch (command) {
    case 'login':
      await handleLogin(parsed);
      break;
    case 'logout':
      await handleLogout(parsed);
      break;
    case 'billing':
      await handleBilling(parsed);
      break;
    case 'chat':
      await handleChat(parsed);
      break;
    case 'spaces':
      await handleSpaces(parsed);
      break;
    case 'listen':
      await handleListen(parsed);
      break;
    case 'upload':
      await handleUpload(parsed);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

void main();
