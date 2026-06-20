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
import { handleUsage } from './commands/usage';
import { handleRotation, handleTileSet } from './commands/pipelines';
import {
  AUDIO_FORGE_MEDIA_MODES,
  isAudioForgeMediaMode,
} from '../shared/mediaOperationMatrix';
import {
  DEFAULT_IMAGE_MODEL_SELECTION,
  IMAGE_MODEL_CAPABILITIES,
  IMAGE_MODEL_SELECTIONS,
} from '../shared/imageGenerationOptions';
import {
  VIDEO_GENERATION_ASPECT_RATIOS,
  VIDEO_GENERATION_DURATION_SECONDS,
  VIDEO_GENERATION_TIERS,
  getVideoGenerationResolutionsForTier,
} from '../shared/videoGenerationOptions';

declare const __INVENTORY_CLI_VERSION__: string | undefined;

export const CLI_VERSION =
  typeof __INVENTORY_CLI_VERSION__ === 'string' ? __INVENTORY_CLI_VERSION__ : '0.1.0-dev';

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--') {
    argv.shift();
  }
  const [command, ...args] = argv;

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

function optionValues(values: readonly (string | number)[]): string {
  return values.join('|');
}

function uniqueValues<T extends string | number>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

function imageSizeValues(): string {
  return optionValues(uniqueValues(IMAGE_MODEL_SELECTIONS.flatMap((model) => IMAGE_MODEL_CAPABILITIES[model].supportedImageSizes)));
}

function imageAspectValues(): string {
  return optionValues(IMAGE_MODEL_CAPABILITIES[DEFAULT_IMAGE_MODEL_SELECTION].supportedAspectRatios);
}

function imageCapabilityHelp(): string {
  const sizeLines = IMAGE_MODEL_SELECTIONS
    .map((model) => `${model}: ${IMAGE_MODEL_CAPABILITIES[model].supportedImageSizes.join(', ')}`)
    .join('; ');
  const referenceLines = IMAGE_MODEL_SELECTIONS
    .map((model) => `${model}: ${IMAGE_MODEL_CAPABILITIES[model].maxReferenceImages}`)
    .join('; ');

  return `Image:
  --model <value>   Image model: ${optionValues(IMAGE_MODEL_SELECTIONS)}
  --size <value>    Output size (${sizeLines})
  --aspect <ratio>  Aspect ratio: ${imageAspectValues()}
  --refs <refs>     Reference limit (${referenceLines})`;
}

function videoResolutionValues(): string {
  return optionValues(uniqueValues(VIDEO_GENERATION_TIERS.flatMap((tier) => getVideoGenerationResolutionsForTier(tier))));
}

function videoAspectValues(): string {
  return optionValues(VIDEO_GENERATION_ASPECT_RATIOS);
}

function videoDurationValues(): string {
  return optionValues(VIDEO_GENERATION_DURATION_SECONDS);
}

function videoTierValues(): string {
  return optionValues(VIDEO_GENERATION_TIERS);
}

function videoCapabilityHelp(): string {
  const resolutionLines = VIDEO_GENERATION_TIERS
    .map((tier) => `${tier}: ${getVideoGenerationResolutionsForTier(tier).join(', ')}`)
    .join('; ');

  return `Video:
  --aspect <ratio>      Veo aspect ratio: ${videoAspectValues()}
  --resolution <value>  Veo output resolution (${resolutionLines})
  --duration <seconds>  Veo output duration: ${videoDurationValues()}
  --tier <tier>         Veo model tier: ${videoTierValues()}`;
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
    case 'usage':
      printUsageHelp();
      return;
    case 'variants':
    case 'variant':
      printVariantsHelp();
      return;
    case 'rotation':
      printRotationHelp();
      return;
    case 'tileset':
    case 'tile-set':
      printTileSetHelp();
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
Make Effects CLI

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
  rotation --variant <variant-id>
                                 Generate rotation views from a completed image variant
  rotation cancel <rotation-set-id>
                                 Cancel an active rotation pipeline
  tileset "prompt" --type terrain --grid 3x3
                                 Generate a consistent tile set
  tileset cancel <tile-set-id>    Cancel an active tile-set pipeline
  productions list --production-id <id>
                                 List Space-backed production placements
  productions export --production-id <id>
                                 Export production scene args from Space records
  usage [summary] [--space <id>] Show platform storage and workflow consumption

Billing (Polar.sh):
  billing status               Show sync status (pending, failed, synced events)
  billing check                Run operational checks for workers, meters, and sync health
  billing reconcile --user-id <id>
                               Compare local billable usage with Polar usage
  billing retry-failed         Retry all failed events

Spaces:
  spaces                       List all spaces
  spaces --json                List all spaces as JSON
  spaces --details [--json]    List spaces with asset summaries
  spaces --id <id> [--json]    Show details for a specific space
  spaces create <name>         Create a new space

Listen:
  listen --space <id>          Connect to space WebSocket and stream all events
  listen --space <id> --json   Output raw JSON for piping/processing

Upload:
  upload <file> --asset <id> [--space <id>]   Upload image, audio, or video to existing asset
  upload <file> --name <name> [--space <id>]  Upload media and create new asset

Forge:
  generate "prompt" --name <name> --type <type> -o <file>
  generate --follow <variant_id> -o <file>
  refine --variant <variant_id> "prompt" -o <file>
  derive --refs <variant_or_file,variant_or_file> --name <name> --type <type> "prompt" -o <file>
  batch "prompt" --name <name> --type <type> --count <2-8> --output-dir <dir>

Audio:
  audio voices
  audio speech generate "text" --name <name> -o <file>
  audio dialogue generate --input script.txt --name <name> -o <file>
  audio music batch "prompt" --name <name> --count <2-8> --output-dir <dir>
  audio sfx generate "prompt" --name <name> -o <file>

Video:
  video generate "prompt" --name <name> --type <type> -o <file> [--aspect ${videoAspectValues()}] [--resolution ${videoResolutionValues()}] [--duration ${videoDurationValues()}] [--tier ${videoTierValues()}] [--audio]
  video generate --follow <variant_id> -o <file>
  video refine --variant <variant_id> "prompt" -o <file> [--aspect ${videoAspectValues()}] [--resolution ${videoResolutionValues()}] [--duration ${videoDurationValues()}] [--tier ${videoTierValues()}] [--audio]
  video derive --refs <variant_or_file,variant_or_file> --name <name> --type <type> "prompt" -o <file> [--aspect ${videoAspectValues()}] [--resolution ${videoResolutionValues()}] [--duration ${videoDurationValues()}] [--tier ${videoTierValues()}] [--audio]

Options:
  --env <environment>          Target environment (production|stage|local), default: production
  --local                      Shortcut for local development

Examples:
  makefx init --space space_123
  makefx init --space space_123 --json
  makefx login            Authenticate with production environment
  makefx login --env stage
  makefx logout
  makefx billing status   Show billing sync status
  makefx billing check    Check billing production readiness
  makefx spaces --details List spaces with asset summaries
  makefx spaces create "My Game Assets" --init
  makefx listen --space space_123
  makefx generate "A market background" --name "Market" --type scene -o market.png
  makefx batch "Three Russafa market keyframes" --name "Market Keyframe" --type scene --count 3 --output-dir keyframes
  makefx audio sfx generate "A short brass victory sting" --name "Victory Sting" -o victory.wav
  makefx video generate "A looping idle animation" --name "Idle Animation" --type animation --duration 6 --resolution 1080p --tier fast -o idle.mp4
  makefx productions export --production-id s01e01-a2
  makefx assets
  makefx usage --from 2026-06-01
  makefx assets download variant_123 -o variant.mp4
  makefx assets rename asset_123 "Hero (moving)"
  makefx assets set-active asset_123 variant_456
  makefx variants retry variant_456
  makefx variants delete variant_456
  makefx rotation --variant variant_456 --config 8-directional
  makefx tileset "grass and stone path tiles" --type terrain --grid 3x3
`);
}

function printInitHelp(): void {
  console.log(`
Usage:
  makefx init --space <id> [--env production|stage|local]
  makefx init --space <id> --json
`);
}

function printLoginHelp(): void {
  console.log(`
Usage:
  makefx login [--env production|stage|local]
  makefx login --local
`);
}

function printLogoutHelp(): void {
  console.log(`
Usage:
  makefx logout
  makefx logout [--env production|stage|local]
  makefx logout --local
`);
}

function printBillingHelp(): void {
  console.log(`
Billing Commands - Polar.sh Usage Sync

Usage:
  makefx billing <subcommand> [--env <environment>]

Subcommands:
  status           Show sync status (pending, failed, synced events)
  check            Run operational checks for workers, Polar meters, and sync health
  reconcile        Compare local billable usage with Polar usage for one user
  retry-failed     Reset failed events for retry (next cron will sync them)

Options:
  --env <env>      Target environment (production|stage|local), default: production
  --local          Shortcut for local development
`);
}

function printSpacesHelp(): void {
  console.log(`
Usage:
  makefx spaces
  makefx spaces --json
  makefx spaces --details [--json]
  makefx spaces --id <space_id> [--json]
  makefx spaces create <name>
  makefx spaces create --name "My Space" [--init] [--json]
`);
}

function printListenHelp(): void {
  console.log(`
Usage:
  makefx listen --space <space_id>
  makefx listen --space <space_id> --json
`);
}

function printUploadHelp(): void {
  console.log(`
Usage:
  makefx upload <file> --asset <id> [--space <id>]     Upload media to existing asset
  makefx upload <file> --name <name> [--space <id>]    Create new asset

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
  makefx generate "prompt" --name <name> --type <type> -o <file> [--model ${optionValues(IMAGE_MODEL_SELECTIONS)}] [--size ${imageSizeValues()}] [--aspect <ratio>] [--space <id>]
  makefx generate --follow <variant_id> -o <file> [--space <id>]

${imageCapabilityHelp()}

Production metadata:
  --scene-label <label> --timeline-start-ms <ms> --duration-ms <ms>
  --shot-id <id> --production-id <id>
`);
    return;
  }

  if (command === 'refine') {
    console.log(`
Usage:
  makefx refine --variant <variant_id> "prompt" -o <file> [--model ${optionValues(IMAGE_MODEL_SELECTIONS)}] [--size ${imageSizeValues()}] [--aspect <ratio>] [--space <id>]
  makefx refine --follow <variant_id> -o <file> [--space <id>]

${imageCapabilityHelp()}

Production metadata:
  --scene-label <label> --timeline-start-ms <ms> --duration-ms <ms>
  --shot-id <id> --production-id <id>
`);
    return;
  }

  if (command === 'batch') {
    console.log(`
Usage:
  makefx batch "prompt" --name <name> --type <type> --count <2-8> --output-dir <dir> [--model ${optionValues(IMAGE_MODEL_SELECTIONS)}] [--size ${imageSizeValues()}] [--aspect <ratio>]

${imageCapabilityHelp()}
`);
    return;
  }

  console.log(`
Usage:
  makefx derive --refs <variant_or_file,variant_or_file> --name <name> --type <type> "prompt" -o <file> [--model ${optionValues(IMAGE_MODEL_SELECTIONS)}] [--size ${imageSizeValues()}] [--aspect <ratio>] [--space <id>]
  makefx derive --follow <variant_id> -o <file> [--space <id>]

${imageCapabilityHelp()}

Production metadata:
  --scene-label <label> --timeline-start-ms <ms> --duration-ms <ms>
  --shot-id <id> --production-id <id>
`);
}

function printAudioHelp(positionals: string[]): void {
  const [first, second] = positionals.filter((value) => value !== 'help');
  const modes = AUDIO_FORGE_MEDIA_MODES.join('|');

  if (first === 'voices') {
    console.log(`
Usage:
  makefx audio voices [--json]

Lists ElevenLabs voices available to the connected account when ElevenLabs is the active audio provider.
`);
    return;
  }

  if (isAudioForgeMediaMode(first)) {
    if (second === 'generate') {
      console.log(`
Usage:
  makefx audio ${first} generate "prompt" --name <name> -o <file> [--space <id>]
  makefx audio ${first} generate --input <file> --name <name> -o <file> [--space <id>]
  makefx audio ${first} generate --follow <variant_id> -o <file> [--space <id>]
${first === 'music' ? '  makefx audio music generate "prompt" --provider lyria --name <name> -o <file> [--space <id>]\n' : ''}
${first === 'music' ? 'Provider selection:\n  --provider <elevenlabs|lyria>        Music provider (default: server default)\n' : ''}
${first === 'speech' || first === 'dialogue' ? 'Voice selection:\n  --voice <voice_id>                    Speech voice, or dialogue fallback voice\n  --dialogue-voices <id,id,...>         Dialogue voices ordered by first speaker appearance\n' : ''}
`);
      return;
    }

    if (second === 'batch') {
      console.log(`
Usage:
  makefx audio ${first} batch "prompt" --name <name> --count <2-8> --output-dir <dir> [--space <id>]
${first === 'music' ? '  makefx audio music batch "prompt" --provider lyria --name <name> --count <2-8> --output-dir <dir> [--space <id>]\n' : ''}
${first === 'music' ? 'Provider selection:\n  --provider <elevenlabs|lyria>        Music provider (default: server default)\n' : ''}
`);
      return;
    }

    console.log(`
Usage:
  makefx audio ${first} generate "prompt" --name <name> -o <file> [--space <id>]
  makefx audio ${first} batch "prompt" --name <name> --count <2-8> --output-dir <dir> [--space <id>]
${first === 'music' ? '\nProvider selection:\n  --provider <elevenlabs|lyria>        Music provider (default: server default)\n' : ''}
${first === 'speech' || first === 'dialogue' ? '\nVoice selection:\n  --voice <voice_id>                    Speech voice, or dialogue fallback voice\n  --dialogue-voices <id,id,...>         Dialogue voices ordered by first speaker appearance\n' : ''}
`);
    return;
  }

  if (first === 'generate') {
    console.log(`
Usage:
  makefx audio generate "prompt" --name <name> --type <type> -o <file> [--space <id>]

Preferred mode form:
  makefx audio <${modes}> generate "prompt" --name <name> -o <file> [--space <id>]
`);
    return;
  }

  if (first === 'batch') {
    console.log(`
Usage:
  makefx audio batch "prompt" --name <name> --type <type> --count <2-8> --output-dir <dir> [--space <id>]

Preferred mode form:
  makefx audio <${modes}> batch "prompt" --name <name> --count <2-8> --output-dir <dir> [--space <id>]
`);
    return;
  }

  console.log(`
Usage:
  makefx audio <${modes}> generate "prompt" --name <name> -o <file> [--space <id>]
  makefx audio <${modes}> generate --input <file> --name <name> -o <file> [--space <id>]
  makefx audio <${modes}> generate --follow <variant_id> -o <file> [--space <id>]
  makefx audio <${modes}> batch "prompt" --name <name> --count <2-8> --output-dir <dir> [--space <id>]
  makefx audio voices [--json]
  makefx audio music generate "prompt" --provider <elevenlabs|lyria> --name <name> -o <file> [--space <id>]

Modes:
  speech      Spoken narration or voiceover
  dialogue    Multi-speaker scripts; use --input for multiline scripts
  music       Music cues and beds
  sfx         Sound effects

Voice selection:
  --voice <voice_id>                    Speech voice, or dialogue fallback voice
  --dialogue-voices <id,id,...>         Dialogue voices ordered by first speaker appearance

Low-level compatibility:
  makefx audio generate "prompt" --name <name> --type <type> -o <file> [--space <id>]
  makefx audio batch "prompt" --name <name> --type <type> --count <2-8> --output-dir <dir> [--space <id>]
`);
}

function printVideoHelp(positionals: string[]): void {
  const subcommand = positionals.find((value) => value !== 'help');
  if (subcommand === 'generate') {
    console.log(`
Usage:
  makefx video generate "prompt" --name <name> --type <type> -o <file> [--aspect ${videoAspectValues()}] [--resolution ${videoResolutionValues()}] [--duration ${videoDurationValues()}] [--tier ${videoTierValues()}] [--audio] [--space <id>]
  makefx video generate --follow <variant_id> -o <file> [--space <id>]

${videoCapabilityHelp()}

Audio:
  Video defaults to generated audio. Current Veo models do not support --no-audio; the CLI rejects it before creating a job.

Production metadata:
  --scene-label <label> --timeline-start-ms <ms> --duration-ms <ms>
  --shot-id <id> --production-id <id>
`);
    return;
  }

  if (subcommand === 'refine') {
    console.log(`
Usage:
  makefx video refine --variant <variant_id> "prompt" -o <file> [--aspect ${videoAspectValues()}] [--resolution ${videoResolutionValues()}] [--duration ${videoDurationValues()}] [--tier ${videoTierValues()}] [--audio] [--space <id>]
  makefx video refine --follow <variant_id> -o <file> [--space <id>]

${videoCapabilityHelp()}

Audio:
  Video defaults to generated audio. Current Veo models do not support --no-audio; the CLI rejects it before creating a job.

Production metadata:
  --scene-label <label> --timeline-start-ms <ms> --duration-ms <ms>
  --shot-id <id> --production-id <id>
`);
    return;
  }

  if (subcommand === 'derive') {
    console.log(`
Usage:
  makefx video derive --refs <variant_or_file,variant_or_file> --name <name> --type <type> "prompt" -o <file> [--aspect ${videoAspectValues()}] [--resolution ${videoResolutionValues()}] [--duration ${videoDurationValues()}] [--tier ${videoTierValues()}] [--audio] [--space <id>]
  makefx video derive --follow <variant_id> -o <file> [--space <id>]

${videoCapabilityHelp()}

Audio:
  Video defaults to generated audio. Current Veo models do not support --no-audio; the CLI rejects it before creating a job.

Production metadata:
  --scene-label <label> --timeline-start-ms <ms> --duration-ms <ms>
  --shot-id <id> --production-id <id>
`);
    return;
  }

  console.log(`
Usage:
  makefx video generate "prompt" --name <name> --type <type> -o <file> [--aspect ${videoAspectValues()}] [--resolution ${videoResolutionValues()}] [--duration ${videoDurationValues()}] [--tier ${videoTierValues()}] [--audio] [--space <id>]
  makefx video generate --follow <variant_id> -o <file> [--space <id>]
  makefx video refine --variant <variant_id> "prompt" -o <file> [--aspect ${videoAspectValues()}] [--resolution ${videoResolutionValues()}] [--duration ${videoDurationValues()}] [--tier ${videoTierValues()}] [--audio] [--space <id>]
  makefx video derive --refs <variant_or_file,variant_or_file> --name <name> --type <type> "prompt" -o <file> [--aspect ${videoAspectValues()}] [--resolution ${videoResolutionValues()}] [--duration ${videoDurationValues()}] [--tier ${videoTierValues()}] [--audio] [--space <id>]

${videoCapabilityHelp()}

Audio:
  Video defaults to generated audio. Current Veo models do not support --no-audio; the CLI rejects it before creating a job.

Production metadata:
  --scene-label <label> --timeline-start-ms <ms> --duration-ms <ms>
  --shot-id <id> --production-id <id>
`);
}

function printRunsHelp(): void {
  console.log(`
Usage:
  makefx runs --debug
  makefx runs show <run-id|manifest.json> --debug
  makefx runs show --latest --debug
  makefx runs export <run-id|manifest.json> --debug --format media -o media-run.json
  makefx runs export --latest --debug --format media -o media-run.json
  makefx runs export --latest --debug --format remotion -o keyframes.json

Formats:
  media             JSON media handoff data
  remotion          Legacy remotion-keyframes JSON marker

Local run manifests are debug-only artifacts, not a source of truth.

Timed scene assembly:
  makefx productions export --production-id <id> [-o scenes.args]
`);
}

function printVariantsHelp(): void {
  console.log(`
Usage:
  makefx variants delete <variant-id>
  makefx variants retry <variant-id>
  makefx variants star <variant-id>
  makefx variants unstar <variant-id>
  makefx variants rate <variant-id> <approved|rejected>

Options:
  --space <id>      Target space ID; defaults from the initialized project
  --env <env>       Environment (production|stage|local)
  --local           Shortcut for --env local
`);
}

function printRotationHelp(): void {
  console.log(`
Usage:
  makefx rotation --variant <variant-id> [--config 4-directional|8-directional|turnaround]
  makefx rotation --variant <variant-id> --mode single-shot --subject "hero knight"
  makefx rotation cancel <rotation-set-id>

Options:
  --space <id>       Target space ID; defaults from the initialized project
  --config <config>  4-directional, 8-directional, or turnaround (default: 4-directional)
  --subject <text>   Optional subject description for consistency prompts
  --aspect <ratio>   Optional generation aspect ratio
  --mode <mode>      sequential or single-shot (default: sequential)
  --no-style         Disable the space style anchor
  --detach           Return after the pipeline starts instead of waiting for completion
  --timeout <sec>    Override the pipeline wait timeout
  --json             Print machine-readable output
`);
}

function printTileSetHelp(): void {
  console.log(`
Usage:
  makefx tileset "prompt" --type terrain --grid 3x3
  makefx tileset "prompt" --type custom --width 4 --height 2 --seed-variant <variant-id>
  makefx tileset cancel <tile-set-id>

Options:
  --space <id>        Target space ID; defaults from the initialized project
  --type <type>       terrain, building, decoration, or custom (default: terrain)
  --grid <size>       Square size or WIDTHxHEIGHT, each dimension 2-5 (default: 3)
  --width <n>         Grid width, 2-5
  --height <n>        Grid height, 2-5
  --seed-variant <id> Optional completed image variant to place at the center (sequential mode only)
  --aspect <ratio>    Optional generation aspect ratio
  --mode <mode>       sequential or single-shot (default: sequential)
  --no-style          Disable the space style anchor
  --detach            Return after the pipeline starts instead of waiting for completion
  --timeout <sec>     Override the pipeline wait timeout
  --json              Print machine-readable output
`);
}

function printProductionsHelp(): void {
  console.log(`
Usage:
  makefx productions list --production-id <id>
  makefx productions export --production-id <id> [-o scenes.args] [--media-dir media]
  makefx productions export --production-id <id> --json [-o scenes.json] [--media-dir media]
  makefx productions place --production-id <id> --variant <variant_id> --scene-label <label> --timeline-start-ms <ms>
  makefx productions delete <record-id>

Scene export downloads Space media through the CLI and emits --scene '<start>|<label>|<absolute path>' lines.
`);
}

function printAssetsHelp(): void {
  console.log(`
Usage:
  makefx assets
  makefx assets --json
  makefx assets show <asset-id>
  makefx assets show <asset-id> --json
  makefx assets download <variant-id|legacy-image-key> -o output-file
`);
}

function printUsageHelp(): void {
  console.log(`
Usage:
  makefx usage [summary] [--space <id>] [--from <date>] [--to <date>]
  makefx usage --json

Options:
  --space <id>      Target space ID; defaults from the initialized project
  --from <date>     Include usage at or after this date or ISO timestamp
  --to <date>       Include usage at or before this date or ISO timestamp
  --json            Print machine-readable output
  --env <env>       Environment (production|stage|local)
  --local           Shortcut for --env local
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
    case 'usage':
      await handleUsage(parsed);
      break;
    case 'variants':
    case 'variant':
      await handleVariants(parsed);
      break;
    case 'rotation':
      await handleRotation(parsed);
      break;
    case 'tileset':
    case 'tile-set':
      await handleTileSet(parsed);
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
