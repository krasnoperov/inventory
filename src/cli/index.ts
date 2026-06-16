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
import { handleSpaces } from './commands/spaces';
import { handleListen } from './commands/listen';
import { handleUpload } from './commands/upload';
import { handleGenerate, handleRefine, handleDerive, handleBatch } from './commands/forge';
import { handleAudio } from './commands/audio';
import { handleInit } from './commands/init';
import { handleRuns } from './commands/runs';
import { handleAssets } from './commands/assets';

declare const __INVENTORY_CLI_VERSION__: string | undefined;

export const CLI_VERSION =
  typeof __INVENTORY_CLI_VERSION__ === 'string' ? __INVENTORY_CLI_VERSION__ : '0.0.0-dev';

async function main() {
  const [, , command, ...args] = process.argv;

  if (command === '--version' || command === 'version') {
    console.log(CLI_VERSION);
    return;
  }

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

Version:
  --version                    Print the CLI build version

Authentication:
  login                        Authenticate with the API and store access token
  logout                       Remove stored credentials

Project:
  init --space <id>             Bind this directory to a website space
  runs                           List local generation run manifests
  runs show --latest             Show the newest local run manifest
  runs export --latest -o <file> Export keyframes for Remotion/video tools
  assets                         List website assets for the initialized space
  assets show <asset-id>          Show website asset variants and lineage
  assets download <variant-id> -o <file>
                                 Download a website variant media file locally

Billing (Polar.sh):
  billing status               Show sync status (pending, failed, synced events)
  billing sync                 Trigger manual sync of pending events
  billing retry-failed         Retry all failed events

Spaces:
  spaces                       List all spaces
  spaces --details             List spaces with asset summaries
  spaces --id <id>             Show details for a specific space
  spaces create <name>         Create a new space

Listen:
  listen --space <id>          Connect to space WebSocket and stream all events
  listen --space <id> --json   Output raw JSON for piping/processing

Upload:
  upload <file> --space <id> --asset <id>   Upload image, audio, or video to existing asset
  upload <file> --space <id> --name <name>  Upload media and create new asset

Forge:
  generate "prompt" --name <name> --type <type> -o <file>
  refine --variant <variant_id> "prompt" -o <file>
  derive --refs <variant_or_file,variant_or_file> --name <name> --type <type> "prompt" -o <file>
  batch "prompt" --name <name> --type <type> --count <2-8> --output-dir <dir>

Audio:
  audio generate "prompt" --name <name> --type <type> -o <file>
  audio batch "prompt" --name <name> --type <type> --count <2-8> --output-dir <dir>

Options:
  --env <environment>          Target environment (production|stage|local), default: stage
  --local                      Shortcut for local development

Examples:
  pnpm run cli init --space space_123
  pnpm run cli login            Authenticate with stage environment
  pnpm run cli login --env production
  pnpm run cli logout
  pnpm run cli billing status   Show billing sync status
  pnpm run cli spaces --details List spaces with asset summaries
  pnpm run cli spaces create "My Game Assets"
  pnpm run cli listen --space space_123
  pnpm run cli generate "A market background" --name "Market" --type scene -o market.png
  pnpm run cli batch "Three Russafa market keyframes" --name "Market Keyframe" --type scene --count 3 --output-dir keyframes
  pnpm run cli audio generate "A short brass victory sting" --name "Victory Sting" --type audio -o victory.wav
  pnpm run cli runs export --latest --format remotion -o keyframes.json
  pnpm run cli assets
  pnpm run cli assets download variant_123 -o variant.mp4
`);
}

async function dispatchCommand(command: string, parsed: Parameters<typeof parseArgs>[0] extends string[] ? ReturnType<typeof parseArgs> : never) {
  switch (command) {
    case 'init':
      await handleInit(parsed);
      break;
    case 'login':
      await handleLogin(parsed);
      break;
    case 'logout':
      await handleLogout(parsed);
      break;
    case 'billing':
      await handleBilling(parsed);
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
    case 'generate':
      await handleGenerate(parsed);
      break;
    case 'refine':
      await handleRefine(parsed);
      break;
    case 'derive':
      await handleDerive(parsed);
      break;
    case 'batch':
      await handleBatch(parsed);
      break;
    case 'audio':
      await handleAudio(parsed);
      break;
    case 'runs':
      await handleRuns(parsed);
      break;
    case 'assets':
      await handleAssets(parsed);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

void main();
