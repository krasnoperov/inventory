import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import {
  executeVideoCommand,
  type VideoForgeCommand,
} from './forge';
import { getCliGenerationCommands } from '../../shared/mediaOperationMatrix';

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
  console.log(`
Usage:
  makefx video generate "prompt" --name <name> --type <type> -o <file> [--resolution 720p|1080p|4k] [--duration 4|6|8] [--tier generate|fast|lite] [--audio|--no-audio] [--space <id>]
  makefx video refine --variant <variant_id> "prompt" -o <file> [--resolution 720p|1080p|4k] [--duration 4|6|8] [--tier generate|fast|lite] [--audio|--no-audio] [--space <id>]
  makefx video derive --refs <variant_or_file,variant_or_file> --name <name> --type <type> "prompt" -o <file> [--resolution 720p|1080p|4k] [--duration 4|6|8] [--tier generate|fast|lite] [--audio|--no-audio] [--space <id>]

Video:
  --resolution <value>  Veo output resolution: 720p, 1080p, or 4k
  --duration <seconds>  Veo output duration: 4, 6, or 8
  --tier <tier>         Veo model tier: generate, fast, or lite

Audio:
  --audio       Request native synchronized Veo audio
  --no-audio    Request a silent video (default)

Production metadata:
  --scene-label <label> --timeline-start-ms <ms> --duration-ms <ms>
  --shot-id <id> --production-id <id>
`);
}
