import process from 'node:process';
import type { ParsedArgs, StoredConfig } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import { loadProjectConfig, type ProjectConfig } from '../lib/project-config';
import {
  loginCommandForEnvironment,
  resolveCommandEnvironment,
  resolveCommandSpace,
} from '../lib/command-context';
import {
  WebSocketClient,
  type PipelineClient,
  type RotationConfig,
  type RotationGenerationMode,
  type RotationPipelineResult,
  type TileSetPipelineResult,
  type TileType,
} from '../lib/websocket-client';
import { isCliRotationEnabled, rotationDisabledMessage } from '../lib/feature-flags';

type PipelineCommand = 'rotation' | 'tileset';
type PipelineResult =
  | RotationPipelineResult
  | TileSetPipelineResult
  | { type: 'rotation:cancelled'; rotationSetId: string }
  | { type: 'tileset:cancelled'; tileSetId: string };

interface PipelineDeps {
  loadConfig: (env: string) => Promise<StoredConfig | null>;
  loadProjectConfig: () => Promise<ProjectConfig | null>;
  resolveBaseUrl: (env: string) => string;
  createClient: (env: string, spaceId: string) => Promise<PipelineClient>;
  isRotationEnabled?: () => boolean;
  print: (message: string) => void;
}

interface PipelineContext {
  env: string;
  spaceId: string;
}

const ROTATION_CONFIGS: RotationConfig[] = ['4-directional', '8-directional', 'turnaround'];
const TILE_TYPES: TileType[] = ['terrain', 'building', 'decoration', 'custom'];
const GENERATION_MODES: RotationGenerationMode[] = ['sequential', 'single-shot'];

const defaultDeps: PipelineDeps = {
  loadConfig: loadStoredConfig,
  loadProjectConfig,
  resolveBaseUrl,
  createClient: (env, spaceId) => WebSocketClient.create(env, spaceId),
  isRotationEnabled: isCliRotationEnabled,
  print: console.log,
};

export async function handleRotation(parsed: ParsedArgs): Promise<void> {
  await handlePipelineCommand('rotation', parsed);
}

export async function handleTileSet(parsed: ParsedArgs): Promise<void> {
  await handlePipelineCommand('tileset', parsed);
}

async function handlePipelineCommand(command: PipelineCommand, parsed: ParsedArgs): Promise<void> {
  try {
    const result = await executePipelineCommand(command, parsed, defaultDeps);
    if ('status' in result && (result.status === 'failed' || result.status === 'cancelled')) {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error:', message);
    if (message !== rotationDisabledMessage()) {
      printUsage(command);
    }
    process.exitCode = 1;
  }
}

export async function executePipelineCommand(
  command: PipelineCommand,
  parsed: ParsedArgs,
  deps: PipelineDeps = defaultDeps
): Promise<PipelineResult> {
  const rotationEnabled = deps.isRotationEnabled ?? isCliRotationEnabled;
  if (command === 'rotation' && !rotationEnabled()) {
    throw new Error(rotationDisabledMessage());
  }

  const ctx = await buildContext(parsed, deps);
  const client = await deps.createClient(ctx.env, ctx.spaceId);

  try {
    if (parsed.options.json === 'true') {
      client.setConnectionLogging?.(false);
    }
    await client.connect();
    if (command === 'rotation') {
      return await executeRotation(parsed, ctx, client, deps);
    }
    return await executeTileSet(parsed, ctx, client, deps);
  } finally {
    client.disconnect();
  }
}

async function buildContext(parsed: ParsedArgs, deps: PipelineDeps): Promise<PipelineContext> {
  const projectConfig = await deps.loadProjectConfig();
  const env = resolveCommandEnvironment(parsed, projectConfig);
  const spaceId = resolveCommandSpace(parsed, projectConfig);
  if (!spaceId) {
    throw new Error('--space is required, or run: makefx init --space <id>');
  }

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

  // Kept as a dependency so tests can assert the same environment resolution
  // path used by other CLI commands without opening an HTTP connection here.
  deps.resolveBaseUrl(env);
  return { env, spaceId };
}

async function executeRotation(
  parsed: ParsedArgs,
  ctx: PipelineContext,
  client: PipelineClient,
  deps: PipelineDeps
): Promise<PipelineResult> {
  const subcommand = parsed.positionals[0];
  const json = parsed.options.json === 'true';

  if (subcommand === 'cancel') {
    const rotationSetId = parsed.positionals[1];
    if (!rotationSetId) throw new Error('Usage: makefx rotation cancel <rotation-set-id>');
    const result = await client.cancelRotation(rotationSetId);
    printJsonOrText(json, result, `Cancelled rotation set ${rotationSetId}`, deps);
    return result;
  }

  const sourceVariantId = optionValue(parsed, 'variant')
    || optionValue(parsed, 'source-variant')
    || parsed.positionals[0];
  if (!sourceVariantId) {
    throw new Error('Source variant is required: makefx rotation --variant <variant-id>');
  }

  const config = parseRotationConfig(optionValue(parsed, 'config') || '4-directional');
  const generationMode = parseGenerationMode(optionValue(parsed, 'mode') || 'sequential');
  const waitForCompletion = parsed.options.detach !== 'true';
  const timeoutMs = parseTimeoutMs(parsed.options.timeout);

  if (!json) {
    deps.print(`Starting ${config} rotation from variant ${sourceVariantId} in space ${ctx.spaceId}...`);
  }

  const result = await client.sendRotationRequest({
    sourceVariantId,
    config,
    subjectDescription: optionValue(parsed, 'subject') || optionValue(parsed, 'description'),
    aspectRatio: optionValue(parsed, 'aspect'),
    disableStyle: parsed.options['no-style'] === 'true',
    generationMode,
    waitForCompletion,
    timeoutMs,
    onStarted: json ? undefined : (started) => {
      deps.print(`Rotation set ${started.rotationSetId} started for asset ${started.assetId}`);
      deps.print(`Views: ${started.directions.join(', ')} (${started.totalSteps} total)`);
      if (!waitForCompletion) {
        deps.print('Detached. Use `makefx listen` or `makefx assets show` to watch progress.');
      }
    },
    onStepCompleted: json ? undefined : (step) => {
      deps.print(`Rotation ${step.rotationSetId}: ${step.step + 1}/${step.total} ${step.direction} -> ${step.variantId}`);
    },
  });

  printRotationResult(result, json, deps);
  return result;
}

async function executeTileSet(
  parsed: ParsedArgs,
  ctx: PipelineContext,
  client: PipelineClient,
  deps: PipelineDeps
): Promise<PipelineResult> {
  const subcommand = parsed.positionals[0];
  const json = parsed.options.json === 'true';

  if (subcommand === 'cancel') {
    const tileSetId = parsed.positionals[1];
    if (!tileSetId) throw new Error('Usage: makefx tileset cancel <tile-set-id>');
    const result = await client.cancelTileSet(tileSetId);
    printJsonOrText(json, result, `Cancelled tile set ${tileSetId}`, deps);
    return result;
  }

  const prompt = parsed.positionals.join(' ').trim();
  if (!prompt) {
    throw new Error('Prompt is required: makefx tileset "prompt" --type terrain --grid 3x3');
  }

  const tileType = parseTileType(optionValue(parsed, 'type') || 'terrain');
  const { width, height } = parseGrid(parsed);
  const generationMode = parseGenerationMode(optionValue(parsed, 'mode') || 'sequential');
  const seedVariantId = optionValue(parsed, 'seed-variant') || optionValue(parsed, 'seed');
  if (generationMode === 'single-shot' && seedVariantId) {
    throw new Error('--seed-variant is only supported with sequential tile-set generation');
  }
  const waitForCompletion = parsed.options.detach !== 'true';
  const timeoutMs = parseTimeoutMs(parsed.options.timeout);

  if (!json) {
    deps.print(`Starting ${width}x${height} ${tileType} tile set in space ${ctx.spaceId}...`);
  }

  const result = await client.sendTileSetRequest({
    tileType,
    gridWidth: width,
    gridHeight: height,
    prompt,
    seedVariantId,
    aspectRatio: optionValue(parsed, 'aspect'),
    disableStyle: parsed.options['no-style'] === 'true',
    generationMode,
    waitForCompletion,
    timeoutMs,
    onStarted: json ? undefined : (started) => {
      deps.print(`Tile set ${started.tileSetId} started for asset ${started.assetId}`);
      deps.print(`Grid: ${started.gridWidth}x${started.gridHeight} (${started.totalTiles} tiles)`);
      if (!waitForCompletion) {
        deps.print('Detached. Use `makefx listen` or `makefx assets show` to watch progress.');
      }
    },
    onTileCompleted: json ? undefined : (tile) => {
      deps.print(`Tile set ${tile.tileSetId}: ${tile.step}/${tile.total} (${tile.gridX},${tile.gridY}) -> ${tile.variantId}`);
    },
    onTileFailed: json ? undefined : (tile) => {
      deps.print(`Tile set ${tile.tileSetId}: tile (${tile.gridX},${tile.gridY}) failed: ${tile.error}`);
    },
  });

  printTileSetResult(result, json, deps);
  return result;
}

function parseRotationConfig(value: string): RotationConfig {
  if (ROTATION_CONFIGS.includes(value as RotationConfig)) {
    return value as RotationConfig;
  }
  throw new Error(`Invalid rotation config: ${value}. Expected ${ROTATION_CONFIGS.join('|')}`);
}

function parseTileType(value: string): TileType {
  if (TILE_TYPES.includes(value as TileType)) {
    return value as TileType;
  }
  throw new Error(`Invalid tile type: ${value}. Expected ${TILE_TYPES.join('|')}`);
}

function parseGenerationMode(value: string): RotationGenerationMode {
  if (GENERATION_MODES.includes(value as RotationGenerationMode)) {
    return value as RotationGenerationMode;
  }
  throw new Error(`Invalid generation mode: ${value}. Expected ${GENERATION_MODES.join('|')}`);
}

function parseGrid(parsed: ParsedArgs): { width: number; height: number } {
  const grid = optionValue(parsed, 'grid');
  if (grid) {
    const match = /^(\d+)(?:x(\d+))?$/.exec(grid);
    if (!match) {
      throw new Error('Invalid grid size. Use --grid 3 or --grid 3x4');
    }
    const width = Number(match[1]);
    const height = Number(match[2] || match[1]);
    validateGridDimension(width, 'width');
    validateGridDimension(height, 'height');
    return { width, height };
  }

  const width = Number(optionValue(parsed, 'width') || '3');
  const height = Number(optionValue(parsed, 'height') || String(width));
  validateGridDimension(width, 'width');
  validateGridDimension(height, 'height');
  return { width, height };
}

function validateGridDimension(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 2 || value > 5) {
    throw new Error(`Grid ${label} must be an integer between 2 and 5`);
  }
}

function parseTimeoutMs(value: string | undefined): number | undefined {
  if (!value || value === 'true') return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('--timeout must be a positive number of seconds');
  }
  return Math.ceil(seconds * 1000);
}

function optionValue(parsed: ParsedArgs, key: string): string | undefined {
  const value = parsed.options[key];
  return !value || value === 'true' ? undefined : value;
}

function printRotationResult(result: RotationPipelineResult, json: boolean, deps: PipelineDeps): void {
  if (json) {
    deps.print(JSON.stringify(result, null, 2));
    return;
  }

  if (result.status === 'started') {
    deps.print(`Rotation queued: ${result.rotationSetId}`);
    return;
  }
  if (result.status === 'completed') {
    deps.print(`Rotation completed: ${result.rotationSetId} (${result.views?.length ?? 0} views)`);
    return;
  }
  if (result.status === 'failed') {
    deps.print(`Rotation failed at step ${result.failedStep}: ${result.error}`);
    return;
  }
  deps.print(`Rotation cancelled: ${result.rotationSetId}`);
}

function printTileSetResult(result: TileSetPipelineResult, json: boolean, deps: PipelineDeps): void {
  if (json) {
    deps.print(JSON.stringify(result, null, 2));
    return;
  }

  if (result.status === 'started') {
    deps.print(`Tile set queued: ${result.tileSetId}`);
    return;
  }
  if (result.status === 'completed') {
    deps.print(`Tile set completed: ${result.tileSetId} (${result.positions?.length ?? 0} positions)`);
    return;
  }
  if (result.status === 'failed') {
    deps.print(`Tile set failed at step ${result.failedStep}: ${result.error}`);
    return;
  }
  deps.print(`Tile set cancelled: ${result.tileSetId}`);
}

function printJsonOrText(
  json: boolean,
  result: PipelineResult,
  text: string,
  deps: PipelineDeps
): void {
  deps.print(json ? JSON.stringify(result, null, 2) : text);
}

function printUsage(command: PipelineCommand): void {
  if (command === 'rotation') {
    if (!isCliRotationEnabled()) {
      console.log(rotationDisabledMessage());
      return;
    }

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
    return;
  }

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
