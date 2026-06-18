import process from 'node:process';
import type { ParsedArgs, StoredConfig } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import { loadProjectConfig, type ProjectConfig } from '../lib/project-config';
import {
  loginCommandForEnvironment,
  resolveCommandEnvironment,
} from '../lib/command-context';
import { truncate } from '../lib/utils';
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

type AudioCommand = AudioForgeCommand | 'voices';

interface AudioInvocation {
  command: AudioCommand;
  mode?: AudioForgeMediaMode;
  positionals: string[];
}

interface VoiceSummary {
  voiceId: string;
  name: string;
  category: string | null;
  description: string | null;
  previewUrl: string | null;
  labels: Record<string, string>;
}

interface VoicesResponse {
  available: boolean;
  voices: VoiceSummary[];
  error?: string;
}

interface AudioDeps {
  loadConfig: (env: string) => Promise<StoredConfig | null>;
  loadProjectConfig: () => Promise<ProjectConfig | null>;
  resolveBaseUrl: (env: string) => string;
  fetch: typeof fetch;
  print: (message: string) => void;
  executeAudioCommand: typeof executeAudioCommand;
}

const defaultDeps: AudioDeps = {
  loadConfig: loadStoredConfig,
  loadProjectConfig,
  resolveBaseUrl,
  fetch,
  print: console.log,
  executeAudioCommand,
};

export async function handleAudio(parsed: ParsedArgs): Promise<void> {
  try {
    await executeAudio(parsed);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    printUsage();
    process.exitCode = 1;
  }
}

export async function executeAudio(
  parsed: ParsedArgs,
  deps: AudioDeps = defaultDeps
): Promise<VoicesResponse | Awaited<ReturnType<typeof executeAudioCommand>>> {
  const invocation = parseAudioInvocation(parsed.positionals);

  if (invocation.command === 'voices') {
    return executeAudioVoices({
      ...parsed,
      positionals: invocation.positionals,
    }, deps);
  }

  return deps.executeAudioCommand(invocation.command, {
    ...parsed,
    positionals: invocation.positionals,
  }, undefined, { mode: invocation.mode });
}

export function parseAudioInvocation(positionals: string[]): AudioInvocation {
  const [first, second, ...rest] = positionals;

  if (first === 'voices') {
    return {
      command: 'voices',
      positionals: positionals.slice(1),
    };
  }

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
  throw new Error('Audio command is required: generate, batch, or voices');
}

async function executeAudioVoices(parsed: ParsedArgs, deps: AudioDeps): Promise<VoicesResponse> {
  const projectConfig = await deps.loadProjectConfig();
  const env = resolveCommandEnvironment(parsed, projectConfig);
  const config = await deps.loadConfig(env);

  if (!config) {
    throw new Error(`Not logged in to ${env} environment. Run: ${loginCommandForEnvironment(env)}`);
  }
  if (config.token.expiresAt < Date.now()) {
    throw new Error(`Token expired for ${env} environment. Run: ${loginCommandForEnvironment(env)}`);
  }
  if (env === 'local') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const baseUrl = deps.resolveBaseUrl(env);
  const response = await deps.fetch(`${baseUrl}/api/voices`, {
    headers: {
      'Authorization': `Bearer ${config.token.accessToken}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Voice list request failed (${response.status}): ${errorText || response.statusText}`);
  }

  const body = await response.json() as VoicesResponse;
  if (parsed.options.json === 'true') {
    deps.print(JSON.stringify(body, null, 2));
  } else {
    printVoices(body, deps.print);
  }
  return body;
}

function printVoices(response: VoicesResponse, print: (message: string) => void): void {
  if (!response.available) {
    print('Voice library is unavailable: ElevenLabs is not the active audio provider or no API key is configured.');
    return;
  }

  if (response.voices.length === 0) {
    print(response.error || 'No voices found.');
    return;
  }

  print(`Found ${response.voices.length} voice(s):\n`);
  print(
    'Voice ID'.padEnd(28) +
    'Name'.padEnd(28) +
    'Category'.padEnd(14) +
    'Description'
  );
  print('-'.repeat(94));
  for (const voice of response.voices) {
    print(
      truncate(voice.voiceId, 26).padEnd(28) +
      truncate(voice.name, 26).padEnd(28) +
      truncate(voice.category || '-', 12).padEnd(14) +
      truncate(voice.description || formatLabels(voice.labels) || '-', 24)
    );
  }
}

function formatLabels(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([key, value]) => `${key}:${value}`)
    .join(', ');
}

function printUsage(): void {
  const modes = AUDIO_FORGE_MEDIA_MODES.join('|');
  console.log(`
Usage:
  makefx audio voices [--json]
  makefx audio <${modes}> generate "prompt" --name <name> -o <file> [--space <id>]
  makefx audio <${modes}> generate --follow <variant_id> -o <file> [--space <id>]
  makefx audio <${modes}> batch "prompt" --name <name> --count <2-8> --output-dir <dir> [--space <id>]
  makefx audio music generate "prompt" --provider lyria --name <name> -o <file> [--space <id>]

Voice selection:
  makefx audio speech generate "text" --voice <voice_id> --name <name> -o <file>
  makefx audio dialogue generate --input script.txt --voice <fallback_id> --dialogue-voices <voice_id,voice_id> --name <name> -o <file>

Low-level compatibility:
  makefx audio generate "prompt" --name <name> --type <type> -o <file> [--space <id>]
`);
}
