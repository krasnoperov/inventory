import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import {
  executeAudioCommand,
  type AudioForgeCommand,
} from './forge';
import { getCliGenerationCommands } from '../../shared/mediaOperationMatrix';

export async function handleAudio(parsed: ParsedArgs): Promise<void> {
  try {
    const subcommand = parsed.positionals[0];
    const command = parseAudioCommand(subcommand);
    await executeAudioCommand(command, {
      ...parsed,
      positionals: parsed.positionals.slice(1),
    });
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    printUsage();
    process.exitCode = 1;
  }
}

function parseAudioCommand(value: string | undefined): AudioForgeCommand {
  const commands = getCliGenerationCommands('audio');
  if (value && commands.includes(value as AudioForgeCommand)) {
    return value as AudioForgeCommand;
  }
  throw new Error('Audio command is required: generate or batch');
}

function printUsage(): void {
  console.log(`
Usage:
  pnpm run cli audio generate "prompt" --name <name> --type <type> -o <file> [--space <id>]
  pnpm run cli audio batch "prompt" --name <name> --type <type> --count <2-8> --output-dir <dir> [--space <id>]
`);
}
