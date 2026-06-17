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
import { handleVariants } from './commands/variants';
import { handleProductions } from './commands/productions';
import {
  AUDIO_FORGE_MEDIA_MODES,
  isAudioForgeMediaMode,
} from '../shared/mediaOperationMatrix';

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
    case 'variants':
    case 'variant':
      printVariantsHelp();
      return;
    case 'productions':
    case 'production':
      printProductionsHelp();
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
  runs --debug                   Inspect debug-only local run manifests
  runs show --latest --debug     Show the newest debug run manifest
  assets                         List website assets for the initialized space
  assets show <asset-id>          Show website asset variants and lineage
  assets download <variant-id> -o <file>
                                 Download a website variant media file locally
  assets delete <asset-id>        Delete an asset and its variants
  assets rename <asset-id> "<name>"   Rename an asset
  assets set-active <asset-id> <variant-id>
                                 Set the active variant of an asset
  variants delete <variant-id>    Delete a single variant
  variants retry <variant-id>     Retry a failed variant generation
  variants star <variant-id>      Star a variant (unstar to clear)
  variants rate <variant-id> approved|rejected
                                 Rate a variant for quality curation
  productions list --production-id <id>
                                 List Space-backed production placements
  productions export --production-id <id>
                                 Export production scene args from Space records

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
  audio speech generate "text" --name <name> -o <file>
  audio dialogue generate --input script.txt --name <name> -o <file>
  audio music batch "prompt" --name <name> --count <2-8> --output-dir <dir>
  audio sfx generate "prompt" --name <name> -o <file>

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
  pnpm run cli audio sfx generate "A short brass victory sting" --name "Victory Sting" -o victory.wav
  pnpm run cli video generate "A looping idle animation" --name "Idle Animation" --type animation -o idle.mp4
  pnpm run cli productions export --production-id s01e01-a2
  pnpm run cli assets
  pnpm run cli assets download variant_123 -o variant.mp4
  pnpm run cli assets rename asset_123 "Hero (moving)"
  pnpm run cli assets set-active asset_123 variant_456
  pnpm run cli variants retry variant_456
  pnpm run cli variants delete variant_456
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

Production metadata:
  --scene-label <label> --timeline-start-ms <ms> --duration-ms <ms>
  --shot-id <id> --production-id <id>
`);
    return;
  }

  if (command === 'refine') {
    console.log(`
Usage:
  pnpm run cli refine --variant <variant_id> "prompt" -o <file> [--space <id>]

Production metadata:
  --scene-label <label> --timeline-start-ms <ms> --duration-ms <ms>
  --shot-id <id> --production-id <id>
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

Production metadata:
  --scene-label <label> --timeline-start-ms <ms> --duration-ms <ms>
  --shot-id <id> --production-id <id>
`);
}

function printAudioHelp(positionals: string[]): void {
  const [first, second] = positionals.filter((value) => value !== 'help');
  const modes = AUDIO_FORGE_MEDIA_MODES.join('|');

  if (isAudioForgeMediaMode(first)) {
    if (second === 'generate') {
      console.log(`
Usage:
  pnpm run cli audio ${first} generate "prompt" --name <name> -o <file> [--space <id>]
  pnpm run cli audio ${first} generate --input <file> --name <name> -o <file> [--space <id>]
`);
      return;
    }

    if (second === 'batch') {
      console.log(`
Usage:
  pnpm run cli audio ${first} batch "prompt" --name <name> --count <2-8> --output-dir <dir> [--space <id>]
`);
      return;
    }

    console.log(`
Usage:
  pnpm run cli audio ${first} generate "prompt" --name <name> -o <file> [--space <id>]
  pnpm run cli audio ${first} batch "prompt" --name <name> --count <2-8> --output-dir <dir> [--space <id>]
`);
    return;
  }

  if (first === 'generate') {
    console.log(`
Usage:
  pnpm run cli audio generate "prompt" --name <name> --type <type> -o <file> [--space <id>]

Preferred mode form:
  pnpm run cli audio <${modes}> generate "prompt" --name <name> -o <file> [--space <id>]
`);
    return;
  }

  if (first === 'batch') {
    console.log(`
Usage:
  pnpm run cli audio batch "prompt" --name <name> --type <type> --count <2-8> --output-dir <dir> [--space <id>]

Preferred mode form:
  pnpm run cli audio <${modes}> batch "prompt" --name <name> --count <2-8> --output-dir <dir> [--space <id>]
`);
    return;
  }

  console.log(`
Usage:
  pnpm run cli audio <${modes}> generate "prompt" --name <name> -o <file> [--space <id>]
  pnpm run cli audio <${modes}> generate --input <file> --name <name> -o <file> [--space <id>]
  pnpm run cli audio <${modes}> batch "prompt" --name <name> --count <2-8> --output-dir <dir> [--space <id>]

Modes:
  speech      Spoken narration or voiceover
  dialogue    Multi-speaker scripts; use --input for multiline scripts
  music       Music cues and beds
  sfx         Sound effects

Low-level compatibility:
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

Production metadata:
  --scene-label <label> --timeline-start-ms <ms> --duration-ms <ms>
  --shot-id <id> --production-id <id>
`);
    return;
  }

  if (subcommand === 'refine') {
    console.log(`
Usage:
  pnpm run cli video refine --variant <variant_id> "prompt" -o <file> [--space <id>]

Production metadata:
  --scene-label <label> --timeline-start-ms <ms> --duration-ms <ms>
  --shot-id <id> --production-id <id>
`);
    return;
  }

  if (subcommand === 'derive') {
    console.log(`
Usage:
  pnpm run cli video derive --refs <variant_or_file,variant_or_file> --name <name> --type <type> "prompt" -o <file> [--space <id>]

Production metadata:
  --scene-label <label> --timeline-start-ms <ms> --duration-ms <ms>
  --shot-id <id> --production-id <id>
`);
    return;
  }

  console.log(`
Usage:
  pnpm run cli video generate "prompt" --name <name> --type <type> -o <file> [--space <id>]
  pnpm run cli video refine --variant <variant_id> "prompt" -o <file> [--space <id>]
  pnpm run cli video derive --refs <variant_or_file,variant_or_file> --name <name> --type <type> "prompt" -o <file> [--space <id>]

Production metadata:
  --scene-label <label> --timeline-start-ms <ms> --duration-ms <ms>
  --shot-id <id> --production-id <id>
`);
}

function printRunsHelp(): void {
  console.log(`
Usage:
  pnpm run cli runs --debug
  pnpm run cli runs show <run-id|manifest.json> --debug
  pnpm run cli runs show --latest --debug
  pnpm run cli runs export <run-id|manifest.json> --debug --format media -o media-run.json
  pnpm run cli runs export --latest --debug --format media -o media-run.json
  pnpm run cli runs export --latest --debug --format remotion -o keyframes.json

Formats:
  media             JSON media handoff data
  remotion          Legacy remotion-keyframes JSON marker

Local run manifests are debug-only artifacts, not a source of truth.

Timed scene assembly:
  pnpm run cli productions export --production-id <id> [-o scenes.args]
`);
}

function printVariantsHelp(): void {
  console.log(`
Usage:
  pnpm run cli variants delete <variant-id>
  pnpm run cli variants retry <variant-id>
  pnpm run cli variants star <variant-id>
  pnpm run cli variants unstar <variant-id>
  pnpm run cli variants rate <variant-id> <approved|rejected>

Options:
  --space <id>      Target space ID; defaults from the initialized project
  --env <env>       Environment (production|stage|local)
  --local           Shortcut for --env local
`);
}

function printProductionsHelp(): void {
  console.log(`
Usage:
  pnpm run cli productions list --production-id <id>
  pnpm run cli productions export --production-id <id> [-o scenes.args] [--media-dir media]
  pnpm run cli productions export --production-id <id> --json [-o scenes.json] [--media-dir media]
  pnpm run cli productions place --production-id <id> --variant <variant_id> --scene-label <label> --timeline-start-ms <ms>
  pnpm run cli productions delete <record-id>

Scene export downloads Space media through the CLI and emits --scene '<start>|<label>|<absolute path>' lines.
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
    case 'variants':
    case 'variant':
      await handleVariants(parsed);
      break;
    case 'productions':
    case 'production':
      await handleProductions(parsed);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

void main();
