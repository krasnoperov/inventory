import { stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { ParsedArgs, StoredConfig } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import { loadProjectConfig, type ProjectConfig } from '../lib/project-config';
import {
  createRunId,
  manifestImageFromVariant,
  saveRunManifest,
  type RunManifest,
} from '../lib/run-manifest';
import {
  downloadImage,
  looksLikeFilePath,
  uploadLocalImageAsReference,
  type UploadedImage,
} from '../lib/image-transfer';
import {
  WebSocketClient,
  type BatchResult,
  type GenerateResult,
  type Variant,
} from '../lib/websocket-client';

type ForgeCommand = 'generate' | 'refine' | 'derive' | 'batch';

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
  sendBatchRequest(params: {
    name: string;
    assetType: string;
    prompt: string;
    count: number;
    mode: 'explore' | 'set';
    referenceVariantIds?: string[];
    aspectRatio?: string;
    parentAssetId?: string;
    disableStyle?: boolean;
  }): Promise<BatchResult>;
}

interface CommandDeps {
  loadConfig: (env: string) => Promise<StoredConfig | null>;
  loadProjectConfig: () => Promise<ProjectConfig | null>;
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
  saveRunManifest: (manifest: RunManifest) => Promise<string>;
  createRunId: () => string;
}

const defaultDeps: CommandDeps = {
  loadConfig: loadStoredConfig,
  loadProjectConfig,
  resolveBaseUrl,
  createClient: WebSocketClient.create,
  uploadLocalReference: uploadLocalImageAsReference,
  downloadImage,
  saveRunManifest,
  createRunId,
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

export async function handleBatch(parsed: ParsedArgs): Promise<void> {
  await handleForgeCommand('batch', parsed);
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
): Promise<GenerateResult | BatchResult> {
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
      case 'batch':
        return await executeBatch(parsed, ctx, client, deps);
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
  const state = await requestSpaceState(client);
  const referenceVariantIds = await resolveReferenceVariantIds(
    refs,
    ctx,
    deps,
    state.variants as Variant[]
  );

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

async function executeBatch(
  parsed: ParsedArgs,
  ctx: CommandContext,
  client: ForgeClient,
  deps: CommandDeps
): Promise<BatchResult> {
  const prompt = getPrompt(parsed, 'batch');
  const outputDir = getOutputDir(parsed);
  const name = requireOption(parsed, 'name');
  const assetType = requireOption(parsed, 'type');
  const count = parseBatchCount(requireOption(parsed, 'count'));
  const mode = parseBatchMode(parsed.options.mode || 'explore');
  const refs = parsed.options.refs ? parseRefs(parsed.options.refs) : [];
  const state = await requestSpaceState(client);
  const referenceVariantIds = refs.length > 0
    ? await resolveReferenceVariantIds(refs, ctx, deps, state.variants as Variant[])
    : undefined;
  const startedAt = new Date().toISOString();
  const runId = deps.createRunId();

  console.log(`Batch generating ${count} image(s) for "${name}"...`);
  const result = await client.sendBatchRequest({
    name,
    assetType,
    prompt,
    count,
    mode,
    referenceVariantIds,
    aspectRatio: parsed.options.aspect,
    parentAssetId: parsed.options.parent,
    disableStyle: parsed.options['no-style'] === 'true',
  });

  const sortedVariants = [...result.variants].sort((a, b) => a.created_at - b.created_at);
  const images = [];
  for (let index = 0; index < sortedVariants.length; index += 1) {
    const variant = sortedVariants[index];
    const outputPath = path.join(outputDir, `${slugify(name)}-${String(index + 1).padStart(2, '0')}.png`);
    await downloadResult({ type: 'generate:result', requestId: result.requestId, jobId: variant.id, success: true, variant }, outputPath, ctx, deps);
    images.push(manifestImageFromVariant({
      index,
      variant,
      localPath: outputPath,
      baseUrl: ctx.baseUrl,
      spaceId: ctx.spaceId,
    }));
  }

  const manifestPath = await deps.saveRunManifest({
    version: 1,
    runId,
    command: 'batch',
    success: result.success,
    environment: ctx.env,
    spaceId: ctx.spaceId,
    baseUrl: ctx.baseUrl,
    prompt,
    name,
    assetType,
    count,
    mode,
    refs,
    referenceVariantIds: referenceVariantIds || [],
    outputDir,
    createdAt: startedAt,
    completedAt: new Date().toISOString(),
    images,
    failed: result.failed,
  });

  printBatchResult(result, outputDir, manifestPath, ctx);
  if (!result.success) {
    const failures = result.failed.map((failure) => `${failure.variantId}: ${failure.error}`).join('; ');
    throw new Error(`Batch generation completed with ${result.failed.length} failure(s): ${failures || 'unknown error'}`);
  }

  return result;
}

async function buildContext(parsed: ParsedArgs, deps: CommandDeps): Promise<CommandContext> {
  const projectConfig = await deps.loadProjectConfig();
  const env = parsed.options.local === 'true'
    ? 'local'
    : parsed.options.env || projectConfig?.environment || 'stage';
  const spaceId = parsed.options.space || projectConfig?.spaceId;
  if (!spaceId || spaceId === 'true') {
    throw new Error('--space is required, or run: pnpm run cli init --space <id>');
  }
  const config = await deps.loadConfig(env);

  if (!config) {
    throw new Error(`Not logged in to ${env} environment. Run: pnpm run cli login --env ${env}`);
  }
  if (config.token.expiresAt < Date.now()) {
    throw new Error(`Token expired for ${env} environment. Run: pnpm run cli login --env ${env}`);
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
  deps: Pick<CommandDeps, 'fileExists' | 'uploadLocalReference'>,
  variants: Variant[] = []
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

    validateReferenceVariant(ref, variants);
    variantIds.push(ref);
  }

  return variantIds;
}

function validateReferenceVariant(ref: string, variants: Variant[]): void {
  const variant = variants.find((candidate) => candidate.id === ref);
  if (!variant) {
    throw new Error(`Reference variant not found in space sync state: ${ref}`);
  }
  if (variant.status !== 'completed' || !variant.image_key) {
    throw new Error(`Reference variant is not completed or has no image: ${ref}`);
  }
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

function getOutputDir(parsed: ParsedArgs): string {
  const outputDir = parsed.options['output-dir'] || parsed.options.outputDir;
  if (!outputDir) {
    throw new Error('Output directory is required: pass --output-dir <dir>');
  }
  return path.normalize(outputDir);
}

function parseBatchCount(value: string): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 2 || count > 8) {
    throw new Error('--count must be an integer between 2 and 8');
  }
  return count;
}

function parseBatchMode(value: string): 'explore' | 'set' {
  if (value === 'explore' || value === 'set') return value;
  throw new Error('--mode must be either explore or set');
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'image';
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
  pnpm run cli generate "prompt" --space <id> --name <name> --type <type> -o <file>
`);
    return;
  }

  if (command === 'refine') {
    console.log(`
Usage:
  pnpm run cli refine --space <id> --variant <variant_id> "prompt" -o <file>
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
  pnpm run cli derive --space <id> --refs <variant_or_file,variant_or_file> --name <name> --type <type> "prompt" -o <file>
`);
}

function printBatchResult(
  result: BatchResult,
  outputDir: string,
  manifestPath: string,
  ctx: CommandContext
): void {
  console.log('\nDone.\n');
  console.log(`  Batch:   ${result.batchId}`);
  console.log(`  Images:  ${result.variants.length}`);
  if (result.failed.length > 0) {
    console.log(`  Failed:  ${result.failed.length}`);
  }
  console.log(`  Local:   ${outputDir}`);
  console.log(`  Manifest: ${manifestPath}`);
  if (result.variants[0]) {
    console.log(`  Web:     ${ctx.baseUrl}/spaces/${ctx.spaceId}/assets/${result.variants[0].asset_id}`);
  }
}
