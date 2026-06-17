#!/usr/bin/env node
import process from 'node:process';
import type { ParsedArgs } from './lib/types';

import { parseArgs } from './lib/utils';
import { handleLogin } from './commands/login';
import { handleLogout } from './commands/logout';
import { handleBilling } from './commands/billing';
import { handleSpaces } from './commands/spaces';
import { handleListen } from './commands/listen';
import { handleUpload } from './commands/upload';
import { handleGenerate, handleRefine, handleDerive, handleBatch } from './commands/forge';
import { handleAudio } from './commands/audio';
import { handleVideo } from './commands/video';
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

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  try {
    const parsed = parseArgs(args);
    if (command === 'help') {
      printRequestedHelp(parsed);
      return;
    }
    if (isHelpRequest(args)) {
      printCommandHelp(command, parsed.positionals);
      return;
    }
    configureLocalTls(args);
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

function configureLocalTls(args: string[]): void {
  // Must be set before any fetch calls for self-signed certs in local dev.
  if (args.includes('--local') || args.includes('--env') && args[args.indexOf('--env') + 1] === 'local') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }
}

function isHelpRequest(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}

function printRequestedHelp(parsed: ParsedArgs): void {
  const command = parsed.positionals[0];
  if (!command) {
    printHelp();
    return;
  }
  printCommandHelp(command, parsed.positionals.slice(1));
}

function printCommandHelp(command: string, positionals: string[]): void {
  switch (command) {
    case 'init':
      printInitHelp();
      return;
    case 'login':
      printLoginHelp();
      return;
    case 'logout':
      printLogoutHelp();
      return;
    case 'billing':
      printBillingHelp();
      return;
    case 'spaces':
      printSpacesHelp();
      return;
    case 'listen':
      printListenHelp();
      return;
    case 'upload':
      printUploadHelp();
      return;
    case 'generate':
    case 'refine':
    case 'derive':
    case 'batch':
      printForgeHelp(command);
      return;
    case 'audio':
      printAudioHelp(positionals);
      return;
    case 'video':
      printVideoHelp(positionals);
      return;
    case 'runs':
      printRunsHelp();
      return;
    case 'assets':
      printAssetsHelp();
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
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
  billing check                Run operational checks for workers, meters, and sync health
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
  upload <file> --asset <id> [--space <id>]   Upload image, audio, or video to existing asset
  upload <file> --name <name> [--space <id>]  Upload media and create new asset

Forge:
  generate "prompt" --name <name> --type <type> -o <file>
  refine --variant <variant_id> "prompt" -o <file>
  derive --refs <variant_or_file,variant_or_file> --name <name> --type <type> "prompt" -o <file>
  batch "prompt" --name <name> --type <type> --count <2-8> --output-dir <dir>

Audio:
  audio generate "prompt" --name <name> --type <type> -o <file>
  audio batch "prompt" --name <name> --type <type> --count <2-8> --output-dir <dir>

Video:
  video generate "prompt" --name <name> --type <type> -o <file>
  video refine --variant <variant_id> "prompt" -o <file>
  video derive --refs <variant_or_file,variant_or_file> --name <name> --type <type> "prompt" -o <file>

Options:
  --env <environment>          Target environment (production|stage|local), default: production
  --local                      Shortcut for local development

Examples:
  pnpm run cli init --space space_123
  pnpm run cli init --space space_123 --json
  pnpm run cli login            Authenticate with production environment
  pnpm run cli login --env stage
  pnpm run cli logout
  pnpm run cli billing status   Show billing sync status
  pnpm run cli billing check    Check billing production readiness
  pnpm run cli spaces --details List spaces with asset summaries
  pnpm run cli spaces create "My Game Assets" --init
  pnpm run cli listen --space space_123
  pnpm run cli generate "A market background" --name "Market" --type scene -o market.png
  pnpm run cli batch "Three Russafa market keyframes" --name "Market Keyframe" --type scene --count 3 --output-dir keyframes
  pnpm run cli audio generate "A short brass victory sting" --name "Victory Sting" --type audio -o victory.wav
  pnpm run cli video generate "A looping idle animation" --name "Idle Animation" --type animation -o idle.mp4
  pnpm run cli runs export --latest --format remotion -o keyframes.json
  pnpm run cli assets
  pnpm run cli assets download variant_123 -o variant.mp4
`);
}

function printInitHelp(): void {
  console.log(`
Usage:
  pnpm run cli init --space <id> [--env production|stage|local]
  pnpm run cli init --space <id> --json
`);
}

function printLoginHelp(): void {
  console.log(`
Usage:
  pnpm run cli login [--env production|stage|local]
  pnpm run cli login --local
`);
}

function printLogoutHelp(): void {
  console.log(`
Usage:
  pnpm run cli logout
  pnpm run cli logout [--env production|stage|local]
  pnpm run cli logout --local
`);
}

function printBillingHelp(): void {
  console.log(`
Billing Commands - Polar.sh Usage Sync

Usage:
  pnpm run cli billing <subcommand> [--env <environment>]

Subcommands:
  status           Show sync status (pending, failed, synced events)
  check            Run operational checks for workers, Polar meters, and sync health
  retry-failed     Reset failed events for retry (next cron will sync them)

Options:
  --env <env>      Target environment (production|stage|local), default: production
  --local          Shortcut for local development
`);
}

function printSpacesHelp(): void {
  console.log(`
Usage:
  pnpm run cli spaces
  pnpm run cli spaces --details
  pnpm run cli spaces --id <space_id>
  pnpm run cli spaces create <name>
  pnpm run cli spaces create --name "My Space" [--init] [--json]
`);
}

function printListenHelp(): void {
  console.log(`
Usage:
  pnpm run cli listen --space <space_id>
  pnpm run cli listen --space <space_id> --json
`);
}

function printUploadHelp(): void {
  console.log(`
Usage:
  pnpm run cli upload <file> --asset <id> [--space <id>]     Upload media to existing asset
  pnpm run cli upload <file> --name <name> [--space <id>]    Create new asset

Options:
  --space <id>      Target space ID; defaults from initialized project
  --asset <id>      Target asset ID (upload as new variant)
  --name <name>     New asset name (creates asset + variant)
  --type <type>     Asset type for new assets (default: character)
  --media-kind <k>  Optional explicit kind: image, audio, or video
  --parent <id>     Parent asset ID for new assets
  --env <env>       Environment (production|stage|local)
  --local           Shortcut for --env local
`);
}

function printForgeHelp(command: string): void {
  if (command === 'generate') {
    console.log(`
Usage:
  pnpm run cli generate "prompt" --name <name> --type <type> -o <file> [--space <id>]
`);
    return;
  }

  if (command === 'refine') {
    console.log(`
Usage:
  pnpm run cli refine --variant <variant_id> "prompt" -o <file> [--space <id>]
`);
    return;
  }

  if (command === 'batch') {
    console.log(`
Usage:
  pnpm run cli batch "prompt" --name <name> --type <type> --count <2-8> --output-dir <dir>
`);
    return;
  }

  console.log(`
Usage:
  pnpm run cli derive --refs <variant_or_file,variant_or_file> --name <name> --type <type> "prompt" -o <file> [--space <id>]
`);
}

function printAudioHelp(positionals: string[]): void {
  const subcommand = positionals.find((value) => value !== 'help');
  if (subcommand === 'generate') {
    console.log(`
Usage:
  pnpm run cli audio generate "prompt" --name <name> --type <type> -o <file> [--space <id>]
`);
    return;
  }

  if (subcommand === 'batch') {
    console.log(`
Usage:
  pnpm run cli audio batch "prompt" --name <name> --type <type> --count <2-8> --output-dir <dir> [--space <id>]
`);
    return;
  }

  console.log(`
Usage:
  pnpm run cli audio generate "prompt" --name <name> --type <type> -o <file> [--space <id>]
  pnpm run cli audio batch "prompt" --name <name> --type <type> --count <2-8> --output-dir <dir> [--space <id>]
`);
}

function printVideoHelp(positionals: string[]): void {
  const subcommand = positionals.find((value) => value !== 'help');
  if (subcommand === 'generate') {
    console.log(`
Usage:
  pnpm run cli video generate "prompt" --name <name> --type <type> -o <file> [--space <id>]
`);
    return;
  }

  if (subcommand === 'refine') {
    console.log(`
Usage:
  pnpm run cli video refine --variant <variant_id> "prompt" -o <file> [--space <id>]
`);
    return;
  }

  if (subcommand === 'derive') {
    console.log(`
Usage:
  pnpm run cli video derive --refs <variant_or_file,variant_or_file> --name <name> --type <type> "prompt" -o <file> [--space <id>]
`);
    return;
  }

  console.log(`
Usage:
  pnpm run cli video generate "prompt" --name <name> --type <type> -o <file> [--space <id>]
  pnpm run cli video refine --variant <variant_id> "prompt" -o <file> [--space <id>]
  pnpm run cli video derive --refs <variant_or_file,variant_or_file> --name <name> --type <type> "prompt" -o <file> [--space <id>]
`);
}

function printRunsHelp(): void {
  console.log(`
Usage:
  pnpm run cli runs
  pnpm run cli runs show <run-id|manifest.json>
  pnpm run cli runs show --latest
  pnpm run cli runs export <run-id|manifest.json> --format remotion -o keyframes.json
  pnpm run cli runs export --latest --format remotion -o keyframes.json
`);
}

function printAssetsHelp(): void {
  console.log(`
Usage:
  pnpm run cli assets
  pnpm run cli assets --json
  pnpm run cli assets show <asset-id>
  pnpm run cli assets show <asset-id> --json
  pnpm run cli assets download <variant-id|legacy-image-key> -o output-file
`);
}

async function dispatchCommand(command: string, parsed: ReturnType<typeof parseArgs>) {
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
    case 'video':
      await handleVideo(parsed);
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
