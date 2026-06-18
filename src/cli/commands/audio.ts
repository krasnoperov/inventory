import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import {
  executeAudioCommand,
  type AudioForgeCommand,
} from './forge';
import {
  AUDIO_FORGE_MEDIA_MODES,
  getCliGenerationCommands,
  isAudioForgeMediaMode,
  type AudioForgeMediaMode,
} from '../../shared/mediaOperationMatrix';

interface AudioInvocation {
  command: AudioForgeCommand;
  mode?: AudioForgeMediaMode;
  positionals: string[];
}

export async function handleAudio(parsed: ParsedArgs): Promise<void> {
  try {
    const invocation = parseAudioInvocation(parsed.positionals);
    await executeAudioCommand(invocation.command, {
      ...parsed,
      positionals: invocation.positionals,
    }, undefined, { mode: invocation.mode });
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    printUsage();
    process.exitCode = 1;
  }
}

export function parseAudioInvocation(positionals: string[]): AudioInvocation {
  const [first, second, ...rest] = positionals;

  if (isAudioForgeMediaMode(first)) {
    if (!second) {
      throw new Error(`Audio ${first} command is required: generate or batch`);
    }
    return {
      mode: first,
      command: parseAudioCommand(second, first),
      positionals: rest,
    };
  }

  return {
    command: parseAudioCommand(first),
    positionals: positionals.slice(1),
  };
}

function parseAudioCommand(value: string | undefined, mode?: AudioForgeMediaMode): AudioForgeCommand {
  const commands = getCliGenerationCommands('audio');
  if (value && commands.includes(value as AudioForgeCommand)) {
    return value as AudioForgeCommand;
  }
  if (mode && value) {
    throw new Error(`Audio ${mode} supports only generate or batch`);
  }
  throw new Error('Audio command is required: generate or batch');
}

function printUsage(): void {
  const modes = AUDIO_FORGE_MEDIA_MODES.join('|');
  console.log(`
Usage:
  makefx audio <${modes}> generate "prompt" --name <name> -o <file> [--space <id>]
  makefx audio <${modes}> batch "prompt" --name <name> --count <2-8> --output-dir <dir> [--space <id>]

Low-level compatibility:
  makefx audio generate "prompt" --name <name> --type <type> -o <file> [--space <id>]
`);
}
