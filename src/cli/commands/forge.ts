import { stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { ParsedArgs, StoredConfig } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import {
  downloadImage,
  looksLikeFilePath,
  uploadLocalImageAsReference,
  type UploadedImage,
} from '../lib/image-transfer';
import {
  WebSocketClient,
  type GenerateResult,
  type Variant,
} from '../lib/websocket-client';

type ForgeCommand = 'generate' | 'refine' | 'derive';

interface SpaceState {
  assets: unknown[];
  variants: unknown[];
  lineage: unknown[];
}

interface ForgeClient {
  connect(): Promise<void>;
  disconnect(): void;
  requestSync(): void;
  setOnSyncState(handler: (state: SpaceState) => void): void;
  sendGenerateRequest(params: {
    name: string;
    assetType: string;
    prompt?: string;
    referenceVariantIds?: string[];
    aspectRatio?: string;
    parentAssetId?: string;
    disableStyle?: boolean;
  }): Promise<GenerateResult>;
  sendRefineRequest(params: {
    assetId: string;
    prompt: string;
    sourceVariantIds?: string[];
    aspectRatio?: string;
    disableStyle?: boolean;
  }): Promise<GenerateResult>;
}

interface CommandDeps {
  loadConfig: (env: string) => Promise<StoredConfig | null>;
  resolveBaseUrl: (env: string) => string;
  createClient: (env: string, spaceId: string) => Promise<ForgeClient>;
  uploadLocalReference: (input: {
    baseUrl: string;
    accessToken: string;
    spaceId: string;
    filePath: string;
    assetName?: string;
  }) => Promise<UploadedImage>;
  downloadImage: (input: {
    baseUrl: string;
    accessToken?: string;
    imageKey: string;
    outputPath: string;
    force?: boolean;
  }) => Promise<void>;
  fileExists: (filePath: string) => Promise<boolean>;
}

const defaultDeps: CommandDeps = {
  loadConfig: loadStoredConfig,
  resolveBaseUrl,
  createClient: WebSocketClient.create,
  uploadLocalReference: uploadLocalImageAsReference,
  downloadImage,
  fileExists: async (filePath) => {
    try {
      const fileStat = await stat(filePath);
      return fileStat.isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  },
};

interface CommandContext {
  env: string;
  spaceId: string;
  baseUrl: string;
  accessToken: string;
  force: boolean;
}

export async function handleGenerate(parsed: ParsedArgs): Promise<void> {
  await handleForgeCommand('generate', parsed);
}

export async function handleRefine(parsed: ParsedArgs): Promise<void> {
  await handleForgeCommand('refine', parsed);
}

export async function handleDerive(parsed: ParsedArgs): Promise<void> {
  await handleForgeCommand('derive', parsed);
}

async function handleForgeCommand(command: ForgeCommand, parsed: ParsedArgs): Promise<void> {
  try {
    await executeForgeCommand(command, parsed, defaultDeps);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    printUsage(command);
    process.exitCode = 1;
  }
}

export async function executeForgeCommand(
  command: ForgeCommand,
  parsed: ParsedArgs,
  deps: CommandDeps = defaultDeps
): Promise<GenerateResult> {
  const ctx = await buildContext(parsed, deps);
  const client = await deps.createClient(ctx.env, ctx.spaceId);

  try {
    await client.connect();

    switch (command) {
      case 'generate':
        return await executeGenerate(parsed, ctx, client, deps);
      case 'refine':
        return await executeRefine(parsed, ctx, client, deps);
      case 'derive':
        return await executeDerive(parsed, ctx, client, deps);
    }
  } finally {
    client.disconnect();
  }
}

async function executeGenerate(
  parsed: ParsedArgs,
  ctx: CommandContext,
  client: ForgeClient,
  deps: CommandDeps
): Promise<GenerateResult> {
  const prompt = getPrompt(parsed, 'generate');
  const outputPath = getOutputPath(parsed);
  const name = requireOption(parsed, 'name');
  const assetType = requireOption(parsed, 'type');

  console.log(`Generating "${name}" in space ${ctx.spaceId}...`);
  const result = await client.sendGenerateRequest({
    name,
    assetType,
    prompt,
    aspectRatio: parsed.options.aspect,
    parentAssetId: parsed.options.parent,
    disableStyle: parsed.options['no-style'] === 'true',
  });

  await downloadResult(result, outputPath, ctx, deps);
  printResult(result, outputPath, ctx);
  return result;
}

async function executeRefine(
  parsed: ParsedArgs,
  ctx: CommandContext,
  client: ForgeClient,
  deps: CommandDeps
): Promise<GenerateResult> {
  const prompt = getPrompt(parsed, 'refine');
  const outputPath = getOutputPath(parsed);
  const sourceVariantId = requireOption(parsed, 'variant');
  const state = await requestSpaceState(client);
  const variants = state.variants as Variant[];
  const sourceVariant = variants.find((variant) => variant.id === sourceVariantId);
  if (!sourceVariant) {
    throw new Error(`Variant not found in space sync state: ${sourceVariantId}`);
  }

  console.log(`Refining variant ${sourceVariantId}...`);
  const result = await client.sendRefineRequest({
    assetId: sourceVariant.asset_id,
    prompt,
    sourceVariantIds: [sourceVariantId],
    aspectRatio: parsed.options.aspect,
    disableStyle: parsed.options['no-style'] === 'true',
  });

  await downloadResult(result, outputPath, ctx, deps);
  printResult(result, outputPath, ctx);
  return result;
}

async function executeDerive(
  parsed: ParsedArgs,
  ctx: CommandContext,
  client: ForgeClient,
  deps: CommandDeps
): Promise<GenerateResult> {
  const prompt = getPrompt(parsed, 'derive');
  const outputPath = getOutputPath(parsed);
  const name = requireOption(parsed, 'name');
  const assetType = requireOption(parsed, 'type');
  const refs = parseRefs(requireOption(parsed, 'refs'));
  const referenceVariantIds = await resolveReferenceVariantIds(refs, ctx, deps);

  console.log(`Deriving "${name}" from ${referenceVariantIds.length} reference(s)...`);
  const result = await client.sendGenerateRequest({
    name,
    assetType,
    prompt,
    referenceVariantIds,
    aspectRatio: parsed.options.aspect,
    parentAssetId: parsed.options.parent,
    disableStyle: parsed.options['no-style'] === 'true',
  });

  await downloadResult(result, outputPath, ctx, deps);
  printResult(result, outputPath, ctx);
  return result;
}

async function buildContext(parsed: ParsedArgs, deps: CommandDeps): Promise<CommandContext> {
  const env = parsed.options.local === 'true' ? 'local' : (parsed.options.env || 'stage');
  const spaceId = requireOption(parsed, 'space');
  const config = await deps.loadConfig(env);

  if (!config) {
    throw new Error(`Not logged in to ${env} environment. Run: npm run cli -- login --env ${env}`);
  }
  if (config.token.expiresAt < Date.now()) {
    throw new Error(`Token expired for ${env} environment. Run: npm run cli -- login --env ${env}`);
  }
  if (env === 'local') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  return {
    env,
    spaceId,
    baseUrl: deps.resolveBaseUrl(env),
    accessToken: config.token.accessToken,
    force: parsed.options.force === 'true',
  };
}

export function parseRefs(value: string): string[] {
  const refs = value
    .split(',')
    .map((ref) => ref.trim())
    .filter(Boolean);
  if (refs.length === 0) {
    throw new Error('--refs must include at least one reference');
  }
  return refs;
}

export async function resolveReferenceVariantIds(
  refs: string[],
  ctx: Pick<CommandContext, 'baseUrl' | 'accessToken' | 'spaceId'>,
  deps: Pick<CommandDeps, 'fileExists' | 'uploadLocalReference'>
): Promise<string[]> {
  const variantIds: string[] = [];

  for (const ref of refs) {
    const exists = await deps.fileExists(ref);
    if (exists) {
      const uploaded = await deps.uploadLocalReference({
        baseUrl: ctx.baseUrl,
        accessToken: ctx.accessToken,
        spaceId: ctx.spaceId,
        filePath: ref,
      });
      variantIds.push(uploaded.variant.id);
      continue;
    }

    if (looksLikeFilePath(ref)) {
      throw new Error(`Reference file not found: ${ref}`);
    }

    variantIds.push(ref);
  }

  return variantIds;
}

function requestSpaceState(client: ForgeClient): Promise<SpaceState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for space sync state'));
    }, 30000);

    client.setOnSyncState((state) => {
      clearTimeout(timer);
      resolve(state);
    });
    client.requestSync();
  });
}

async function downloadResult(
  result: GenerateResult,
  outputPath: string,
  ctx: CommandContext,
  deps: Pick<CommandDeps, 'downloadImage'>
): Promise<void> {
  if (!result.success || !result.variant?.image_key) {
    throw new Error(result.error || 'Generation failed without an image');
  }

  await deps.downloadImage({
    baseUrl: ctx.baseUrl,
    accessToken: ctx.accessToken,
    imageKey: result.variant.image_key,
    outputPath,
    force: ctx.force,
  });
}

function printResult(result: GenerateResult, outputPath: string, ctx: CommandContext): void {
  const variant = result.variant;
  if (!variant) return;

  console.log('\nDone.\n');
  console.log(`  Asset:   ${variant.asset_id}`);
  console.log(`  Variant: ${variant.id}`);
  console.log(`  Image:   ${variant.image_key}`);
  console.log(`  Local:   ${outputPath}`);
  console.log(`  Web:     ${ctx.baseUrl}/spaces/${ctx.spaceId}/assets/${variant.asset_id}`);
}

function getPrompt(parsed: ParsedArgs, command: ForgeCommand): string {
  const prompt = parsed.positionals.join(' ').trim();
  if (!prompt) {
    throw new Error(`Prompt is required for ${command}`);
  }
  return prompt;
}

function getOutputPath(parsed: ParsedArgs): string {
  const outputPath = parsed.options.o || parsed.options.output;
  if (!outputPath) {
    throw new Error('Output path is required: pass -o <file> or --output <file>');
  }
  return path.normalize(outputPath);
}

function requireOption(parsed: ParsedArgs, name: string): string {
  const value = parsed.options[name];
  if (!value || value === 'true') {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function printUsage(command: ForgeCommand): void {
  if (command === 'generate') {
    console.log(`
Usage:
  npm run cli -- generate "prompt" --space <id> --name <name> --type <type> -o <file>
`);
    return;
  }

  if (command === 'refine') {
    console.log(`
Usage:
  npm run cli -- refine --space <id> --variant <variant_id> "prompt" -o <file>
`);
    return;
  }

  console.log(`
Usage:
  npm run cli -- derive --space <id> --refs <variant_or_file,variant_or_file> --name <name> --type <type> "prompt" -o <file>
`);
}
