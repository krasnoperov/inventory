import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import {
  executeVideoCommand,
  type VideoForgeCommand,
} from './forge';
import { getCliGenerationCommands } from '../../shared/mediaOperationMatrix';
import {
  VIDEO_GENERATION_ASPECT_RATIOS,
  VIDEO_GENERATION_DURATION_SECONDS,
  VIDEO_GENERATION_TIERS,
  getVideoGenerationResolutionsForTier,
} from '../../shared/videoGenerationOptions';

export async function handleVideo(parsed: ParsedArgs): Promise<void> {
  try {
    const subcommand = parsed.positionals[0];
    const command = parseVideoCommand(subcommand);
    await executeVideoCommand(command, {
      ...parsed,
      positionals: parsed.positionals.slice(1),
    });
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    printUsage();
    process.exitCode = 1;
  }
}

function parseVideoCommand(value: string | undefined): VideoForgeCommand {
  const commands = getCliGenerationCommands('video');
  if (value && commands.includes(value as VideoForgeCommand)) {
    return value as VideoForgeCommand;
  }
  throw new Error('Video command is required: generate, refine, or derive');
}

function printUsage(): void {
  const aspectValues = VIDEO_GENERATION_ASPECT_RATIOS.join('|');
  const resolutionValues = Array.from(new Set(
    VIDEO_GENERATION_TIERS.flatMap((tier) => getVideoGenerationResolutionsForTier(tier))
  )).join('|');
  const durationValues = VIDEO_GENERATION_DURATION_SECONDS.join('|');
  const tierValues = VIDEO_GENERATION_TIERS.join('|');
  const resolutionByTier = VIDEO_GENERATION_TIERS
    .map((tier) => `${tier}: ${getVideoGenerationResolutionsForTier(tier).join(', ')}`)
    .join('; ');

  console.log(`
Usage:
  makefx video generate "prompt" --name <name> --type <type> -o <file> [--first-frame <variant_or_file>] [--last-frame <variant_or_file>] [--aspect ${aspectValues}] [--resolution ${resolutionValues}] [--duration ${durationValues}] [--tier ${tierValues}] [--audio] [--space <id>]
  makefx video generate --follow <variant_id> -o <file> [--space <id>]
  makefx video refine --variant <variant_id> "prompt" -o <file> [--aspect ${aspectValues}] [--resolution ${resolutionValues}] [--duration ${durationValues}] [--tier ${tierValues}] [--audio] [--space <id>]
  makefx video refine --follow <variant_id> -o <file> [--space <id>]
  makefx video derive --refs <variant_or_file,variant_or_file> --name <name> --type <type> "prompt" -o <file> [--aspect ${aspectValues}] [--resolution ${resolutionValues}] [--duration ${durationValues}] [--tier ${tierValues}] [--audio] [--space <id>]
  makefx video derive --first-frame <variant_or_file> [--last-frame <variant_or_file>] --name <name> --type <type> "prompt" -o <file> [--aspect ${aspectValues}] [--resolution ${resolutionValues}] [--duration ${durationValues}] [--tier ${tierValues}] [--audio] [--space <id>]
  makefx video derive --follow <variant_id> -o <file> [--space <id>]

Video:
  --aspect <ratio>      Veo aspect ratio: ${aspectValues}
  --resolution <value>  Veo output resolution (${resolutionByTier})
  --duration <seconds>  Veo output duration: ${durationValues}
  --tier <tier>         Veo model tier: ${tierValues}
  --first-frame <ref>   Veo start frame image variant or local image path
  --last-frame <ref>    Veo final frame image variant or local image path

Veo 3.1 frames:
  --first-frame resolves to the first referenceVariantId and becomes the Veo top-level image input.
  --last-frame resolves to the second referenceVariantId and becomes Veo config.lastFrame.
  Use both flags together for first/last-frame generation; --last-frame requires --first-frame.
  Frame flags disable style injection so style refs cannot be prepended ahead of the start/end frames.
  Do not combine frame flags with --refs or --style-preset. Use --refs when you want generic Veo reference images instead of first/last-frame inputs.

Audio:
  --audio       Request native synchronized Veo audio (default)
  --no-audio    Not supported by current Veo models; rejected before a job is created.

Production metadata:
  --scene-label <label> --timeline-start-ms <ms> --duration-ms <ms>
  --shot-id <id> --production-id <id>
`);
}
