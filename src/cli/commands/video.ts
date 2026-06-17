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
  pnpm run cli video generate "prompt" --name <name> --type <type> -o <file> [--space <id>]
  pnpm run cli video refine --variant <variant_id> "prompt" -o <file> [--space <id>]
  pnpm run cli video derive --refs <variant_or_file,variant_or_file> --name <name> --type <type> "prompt" -o <file> [--space <id>]
`);
}
