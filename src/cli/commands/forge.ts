import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { ParsedArgs, StoredConfig } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import { loadProjectConfig, type ProjectConfig } from '../lib/project-config';
import { placeProductionRecordForCli } from './productions';
import {
  loginCommandForEnvironment,
  resolveCommandEnvironment,
  resolveCommandSpace,
} from '../lib/command-context';
import {
  createRunId,
  manifestMediaFromVariant,
  saveRunManifest,
  type RunManifest,
  type RunManifestMedia,
  type RunManifestImage,
  type RunManifestScene,
} from '../lib/run-manifest';
import {
  downloadFile,
  downloadImage,
  looksLikeFilePath,
  uploadLocalImageAsReference,
  type UploadedImage,
} from '../lib/image-transfer';
import {
  getGenerationRequestTimeoutMs,
  WebSocketClient,
  type BatchResult,
  type GenerationEstimateResult,
  type GenerateStarted,
  type GenerateResult,
  type Variant,
} from '../lib/websocket-client';
import type { GenerationEstimateOperation, MediaKind, MusicGenerationProvider } from '../../shared/websocket-types';
import {
  DEFAULT_VIDEO_GENERATION_TIER,
  doesVideoGenerationModelSupportAudioToggle,
  getVideoGenerationModelForTier,
  isVideoGenerationResolutionSupportedForTier,
  normalizeVideoGenerationAspectRatio,
  normalizeVideoGenerationDurationSeconds,
  normalizeVideoGenerationResolution,
  normalizeVideoGenerationTier,
  type VideoGenerationAspectRatio,
  type VideoGenerationDurationSeconds,
  type VideoGenerationResolution,
  type VideoGenerationTier,
} from '../../shared/videoGenerationOptions';
import {
  IMAGE_MODEL_IDS,
  IMAGE_MODEL_SELECTIONS,
  getImageModelCapabilities,
  getImageModelMaxReferenceImages,
  isImageAspectRatio,
  isImageAspectRatioSupportedByModel,
  isImageSizeSupportedByModel,
  isImageModelSelection,
  normalizeImageSize,
  type ImageAspectRatio,
  type ImageModelSelection,
  type ImageSize,
} from '../../shared/imageGenerationOptions';
import {
  cliGenerationSupportsRefs,
  getCliGenerationMediaKind,
  getCliGenerationProfile,
  getMediaOperationEntry,
  isAudioForgeMediaMode,
  type AudioForgeMediaMode,
  type MediaGenerationCommand,
} from '../../shared/mediaOperationMatrix';
import { apiFetch } from '../../shared/api/client';
import type { PlaceProductionRecordRequest, ProductionRecord } from '../../shared/api/schemas';

export type ForgeCommand = MediaGenerationCommand;
export type AudioForgeCommand = Extract<MediaGenerationCommand, 'generate' | 'batch'>;
export type VideoForgeCommand = Extract<MediaGenerationCommand, 'generate' | 'refine' | 'derive'>;
type GenerationMediaKind = MediaKind;
const CLI_GENERATION_MEDIA_KIND = getCliGenerationMediaKind('top-level');

interface SpaceState {
  assets: unknown[];
  variants: unknown[];
  lineage: unknown[];
}

interface SpaceAsset {
  id: string;
  name?: string | null;
  type?: string | null;
  media_kind?: MediaKind;
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
    model?: string;
    aspectRatio?: string;
    imageSize?: string;
    disableStyle?: boolean;
    stylePresetId?: string;
    mediaKind?: MediaKind;
    voiceId?: string;
    dialogueVoiceIds?: string[];
    musicProvider?: MusicGenerationProvider;
    generateAudio?: boolean;
    videoResolution?: VideoGenerationResolution;
    videoDurationSeconds?: VideoGenerationDurationSeconds;
    videoTier?: VideoGenerationTier;
    onStarted?: (data: GenerateStarted) => void;
  }): Promise<GenerateResult>;
  sendRefineRequest(params: {
    assetId: string;
    prompt: string;
    sourceVariantIds?: string[];
    model?: string;
    aspectRatio?: string;
    imageSize?: string;
    disableStyle?: boolean;
    stylePresetId?: string;
    mediaKind?: MediaKind;
    generateAudio?: boolean;
    videoResolution?: VideoGenerationResolution;
    videoDurationSeconds?: VideoGenerationDurationSeconds;
    videoTier?: VideoGenerationTier;
    onStarted?: (data: GenerateStarted) => void;
  }): Promise<GenerateResult>;
  sendBatchRequest(params: {
    name: string;
    assetType: string;
    prompt: string;
    count: number;
    mode: 'explore' | 'set';
    referenceVariantIds?: string[];
    model?: string;
    aspectRatio?: string;
    imageSize?: string;
    disableStyle?: boolean;
    stylePresetId?: string;
    mediaKind?: MediaKind;
    voiceId?: string;
    dialogueVoiceIds?: string[];
    musicProvider?: MusicGenerationProvider;
  }): Promise<BatchResult>;
  sendGenerationEstimateRequest(params: {
    operation: GenerationEstimateOperation;
    assetId?: string;
    assetType?: string;
    mediaKind?: MediaKind;
    prompt?: string;
    count?: number;
    model?: string;
    imageSize?: string;
    musicProvider?: MusicGenerationProvider;
    generateAudio?: boolean;
    videoResolution?: VideoGenerationResolution;
    videoDurationSeconds?: VideoGenerationDurationSeconds;
    videoTier?: VideoGenerationTier;
  }): Promise<GenerationEstimateResult>;
  followVariant(params: {
    variantId: string;
    requestId?: string;
    timeoutMs?: number;
    onUpdate?: (variant: Variant) => void;
  }): Promise<GenerateResult>;
  cancelFollowVariant?(variantId: string, requestId?: string): void;
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
  downloadFile?: typeof downloadFile;
  fileExists: (filePath: string) => Promise<boolean>;
  saveRunManifest: (manifest: RunManifest, cwd?: string) => Promise<string>;
  placeProductionRecord?: (input: {
    baseUrl: string;
    accessToken: string;
    spaceId: string;
    fetch?: typeof fetch;
    record: PlaceProductionRecordRequest;
  }) => Promise<ProductionRecord>;
  fetch?: typeof fetch;
  createRunId: () => string;
  getWorkingDir?: () => string;
}

const defaultDeps: CommandDeps = {
  loadConfig: loadStoredConfig,
  loadProjectConfig,
  resolveBaseUrl,
  createClient: WebSocketClient.create,
  uploadLocalReference: uploadLocalImageAsReference,
  downloadImage,
  downloadFile,
  saveRunManifest,
  placeProductionRecord: placeProductionRecordForCli,
  fetch,
  createRunId,
  getWorkingDir: () => process.cwd(),
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
  projectRoot?: string;
  workingDir: string;
}

interface ExecuteForgeOptions {
  mediaKind?: GenerationMediaKind;
  saveBatchManifest?: boolean;
  audioMode?: AudioForgeMediaMode;
}

interface ExecuteAudioOptions {
  mode?: AudioForgeMediaMode;
}

interface AudioVoiceOptions {
  voiceId?: string;
  dialogueVoiceIds?: string[];
}

interface VideoGenerationOptions {
  aspectRatio?: VideoGenerationAspectRatio;
  videoResolution?: VideoGenerationResolution;
  videoDurationSeconds?: VideoGenerationDurationSeconds;
  videoTier?: VideoGenerationTier;
}

interface FollowCommandOptions {
  audioMode?: AudioForgeMediaMode;
}

interface GenerationRecipeSummary {
  prompt?: string;
  assetType?: string;
  mediaKind?: MediaKind;
  parentVariantIds?: string[];
}

interface StylePresetSummary {
  id: string;
  name: string;
  enabled: boolean | number;
  is_default: boolean | number;
  collection_name: string | null;
  reference_count: number;
}

interface StyleSelection {
  stylePresetId?: string;
  preset?: StylePresetSummary;
}

const ESTIMATE_METER_LABELS: Record<string, string> = {
  gemini_images: 'Gemini image',
  gemini_videos: 'Veo video unit',
  gemini_audio: 'Lyria generation',
  elevenlabs_audio: 'ElevenLabs unit',
};

function formatEstimatedUsd(microUsd: number): string {
  if (!Number.isFinite(microUsd) || microUsd <= 0) return '$0.00';
  if (microUsd < 10_000) return '<$0.01';
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

function formatEstimateQuantity(quantity: number, singular: string): string {
  const normalized = Number.isFinite(quantity) ? quantity : 0;
  const suffix = normalized === 1 ? singular : `${singular}s`;
  return `${normalized.toLocaleString()} ${suffix}`;
}

async function printPreflightEstimate(
  client: ForgeClient,
  params: Parameters<ForgeClient['sendGenerationEstimateRequest']>[0]
): Promise<void> {
  let result: GenerationEstimateResult;
  try {
    result = await client.sendGenerationEstimateRequest(params);
  } catch (error) {
    console.warn(`Preflight estimate unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  if (!result.success || !result.estimate) {
    console.warn(`Preflight estimate unavailable: ${result.error || 'unknown error'}`);
    return;
  }

  const estimate = result.estimate;
  const meterLabel = ESTIMATE_METER_LABELS[estimate.meterEventName] ?? estimate.meterEventName;
  const quotaLine = estimate.quota?.limit === null || estimate.quota?.limit === undefined
    ? undefined
    : `${estimate.quota.used.toLocaleString()} used / ${estimate.quota.limit.toLocaleString()} limit`;
  console.log('Preflight estimate:');
  console.log(`  Usage: ${formatEstimateQuantity(estimate.quotaQuantity, meterLabel)}, ${formatEstimateQuantity(estimate.platformWorkflowRuns, 'workflow')}`);
  console.log(`  Estimated provider cost: ${formatEstimatedUsd(estimate.providerCostMicroUsd)}${estimate.billingMode === 'byok' ? ' (BYOK)' : ''}`);
  if (quotaLine) {
    console.log(`  Quota: ${quotaLine}`);
  }

  if (!estimate.allowed) {
    throw new Error(estimate.denyMessage || 'Preflight check denied this generation request');
  }
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
  deps: CommandDeps = defaultDeps,
  options: ExecuteForgeOptions = {}
): Promise<GenerateResult | BatchResult> {
  const mediaKind = options.mediaKind || CLI_GENERATION_MEDIA_KIND;
  if (parsed.options.follow) {
    if (command === 'batch') {
      throw new Error('--follow is only supported for single-output generation commands');
    }
    const ctx = await buildContext(parsed, deps);
    const client = await deps.createClient(ctx.env, ctx.spaceId);
    try {
      await client.connect();
      return await executeFollow(parsed, ctx, client, deps, command, mediaKind);
    } finally {
      client.disconnect();
    }
  }

  const saveBatchManifest = options.saveBatchManifest ?? mediaKind === 'image';
  const imageOptions = parseImageGenerationOptions(parsed, mediaKind);
  validateImageCommandReferenceCount(command, parsed, mediaKind, imageOptions.model);
  validateVideoAudioOptions(parsed, mediaKind);
  parseVideoGenerationOptions(parsed, mediaKind);
  if (command !== 'batch') {
    validateProductionMetadataOptions(parsed);
  }
  const ctx = await buildContext(parsed, deps);
  const client = await deps.createClient(ctx.env, ctx.spaceId);

  try {
    await client.connect();

    switch (command) {
      case 'generate':
        return await executeGenerate(parsed, ctx, client, deps, mediaKind, { audioMode: options.audioMode });
      case 'refine':
        return await executeRefine(parsed, ctx, client, deps, mediaKind);
      case 'derive':
        return await executeDerive(parsed, ctx, client, deps, mediaKind, { audioMode: options.audioMode });
      case 'batch':
        return await executeBatch(parsed, ctx, client, deps, mediaKind, saveBatchManifest);
    }
  } finally {
    client.disconnect();
  }
}

export async function executeAudioCommand(
  command: AudioForgeCommand,
  parsed: ParsedArgs,
  deps: CommandDeps = defaultDeps,
  options: ExecuteAudioOptions = {}
): Promise<GenerateResult | BatchResult> {
  const audioProfile = getCliGenerationProfile('audio');
  if (!audioProfile.commands.includes(command)) {
    throw new Error(`Audio generation does not support ${command}`);
  }

  const modeEntry = options.mode ? getMediaOperationEntry(options.mode) : undefined;
  if (modeEntry && !modeEntry.cliCommands.includes(command)) {
    throw new Error(`Audio ${modeEntry.label.toLowerCase()} supports only ${modeEntry.cliCommands.join(' or ')}`);
  }

  if (!cliGenerationSupportsRefs('audio') && parsed.options.refs) {
    throw new Error('Audio generation does not support --refs yet');
  }

  if (parsed.options.input && command !== 'generate') {
    throw new Error('Audio --input is only supported with generate');
  }

  const audioParsed = await prepareAudioParsedArgs(parsed, options.mode);

  return executeForgeCommand(command, audioParsed, deps, {
    mediaKind: audioProfile.mediaKind,
    saveBatchManifest: audioProfile.savesBatchManifest,
    audioMode: options.mode,
  });
}

export async function executeVideoCommand(
  command: VideoForgeCommand,
  parsed: ParsedArgs,
  deps: CommandDeps = defaultDeps
): Promise<GenerateResult | BatchResult> {
  const videoProfile = getCliGenerationProfile('video');
  if (!videoProfile.commands.includes(command)) {
    throw new Error(`Video generation does not support ${command}`);
  }

  return executeForgeCommand(command, parsed, deps, {
    mediaKind: videoProfile.mediaKind,
    saveBatchManifest: videoProfile.savesBatchManifest,
  });
}

async function prepareAudioParsedArgs(
  parsed: ParsedArgs,
  mode?: AudioForgeMediaMode
): Promise<ParsedArgs> {
  const options = { ...parsed.options };
  const positionals = [...parsed.positionals];
  const effectiveMode = mode ?? getAudioModeFromType(options.type);

  validateAudioProviderOption(options.provider, effectiveMode);

  if (mode) {
    options.type = getMediaOperationEntry(mode).assetType;
  }

  validateAudioVoiceOptions(options);

  if (options.input) {
    if (positionals.join(' ').trim()) {
      throw new Error('Pass either prompt text or --input <file>, not both');
    }
    const input = await readFile(options.input, 'utf8');
    positionals.push(input);
  }

  if (!options.follow) {
    validateAudioModeRequiredVoiceOptions(options, effectiveMode);
  }

  return { options, positionals };
}

function validateAudioModeRequiredVoiceOptions(
  options: Record<string, string>,
  mode?: AudioForgeMediaMode
): void {
  if (mode === 'speech' && !normalizeCliOption(options.voice)) {
    throw new Error('Speech generation requires --voice <voice_id>. Run: makefx audio voices');
  }
  if (mode === 'dialogue' && !normalizeCliOption(options['dialogue-voices'] ?? options.dialogueVoices)) {
    throw new Error('Dialogue generation requires --dialogue-voices <voice_id,voice_id>. Run: makefx audio voices');
  }
}

async function executeGenerate(
  parsed: ParsedArgs,
  ctx: CommandContext,
  client: ForgeClient,
  deps: CommandDeps,
  mediaKind: GenerationMediaKind,
  followOptions: FollowCommandOptions = {}
): Promise<GenerateResult> {
  const prompt = getPrompt(parsed, 'generate');
  const outputPath = getOutputPath(parsed);
  const name = requireOption(parsed, 'name');
  const assetType = requireOption(parsed, 'type');
  const musicProvider = parseMusicProviderOption(parsed, mediaKind, assetType);
  const startedAt = new Date().toISOString();
  const scene = parseSceneMetadata(parsed, {
    prompt,
    refs: [],
    referenceVariantIds: [],
    mediaKind,
  });
  const imageOptions = parseImageGenerationOptions(parsed, mediaKind);
  const videoAudioOptions = parseVideoAudioOptions(parsed, mediaKind);
  const videoOptions = parseVideoGenerationOptions(parsed, mediaKind);
  const styleSelection = await resolveStyleSelection(parsed, ctx, deps);

  await printPreflightEstimate(client, {
    operation: 'generate',
    assetType,
    mediaKind,
    prompt,
    count: 1,
    model: imageOptions.model,
    imageSize: imageOptions.imageSize,
    ...(musicProvider ? { musicProvider } : {}),
    ...videoAudioOptions,
    ...videoOptions,
  });

  printStyleSelection(styleSelection);
  console.log(`Generating "${name}" in space ${ctx.spaceId}...`);
  const audioVoiceOptions = mediaKind === 'audio' ? parseAudioVoiceOptions(parsed) : {};
  const result = await client.sendGenerateRequest({
    name,
    assetType,
    prompt,
    ...imageOptions,
    aspectRatio: imageOptions.aspectRatio ?? videoOptions.aspectRatio,
    disableStyle: parsed.options['no-style'] === 'true',
    ...(styleSelection.stylePresetId ? { stylePresetId: styleSelection.stylePresetId } : {}),
    mediaKind,
    ...audioVoiceOptions,
    ...(musicProvider ? { musicProvider } : {}),
    ...videoAudioOptions,
    ...videoOptions,
    onStarted: (started) => printFollowHint(started, ctx, outputPath, 'generate', mediaKind, followOptions),
  });

  const productionRecord = await placeProductionRecordFromScene({
    command: 'generate',
    result,
    outputPath,
    ctx,
    deps,
    scene,
  });
  const manifestPath = await saveGenerationManifest({
    command: 'generate',
    result,
    outputPath,
    ctx,
    deps,
    mediaKind,
    prompt,
    name,
    assetType,
    startedAt,
    refs: [],
    referenceVariantIds: [],
    scene,
  });
  await downloadResult(result, outputPath, ctx, deps);
  printResult(result, outputPath, ctx, manifestPath, productionRecord);
  return result;
}

function getAudioModeFromType(type: string | undefined): AudioForgeMediaMode | undefined {
  return isAudioForgeMediaMode(type) ? type : undefined;
}

function validateAudioProviderOption(
  value: string | undefined,
  mode?: AudioForgeMediaMode
): void {
  if (!value) return;
  if (mode !== 'music') {
    throw new Error('--provider is only supported for audio music');
  }
  if (value !== 'elevenlabs' && value !== 'lyria') {
    throw new Error('--provider must be elevenlabs or lyria');
  }
}

function parseMusicProviderOption(
  parsed: ParsedArgs,
  mediaKind: GenerationMediaKind,
  assetType: string
): MusicGenerationProvider | undefined {
  const value = parsed.options.provider;
  if (!value) return undefined;
  if (mediaKind !== 'audio' || assetType !== 'music') {
    throw new Error('--provider is only supported for audio music');
  }
  if (value === 'elevenlabs' || value === 'lyria') return value;
  throw new Error('--provider must be elevenlabs or lyria');
}

async function executeRefine(
  parsed: ParsedArgs,
  ctx: CommandContext,
  client: ForgeClient,
  deps: CommandDeps,
  mediaKind: GenerationMediaKind
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
  const sourceAsset = (state.assets as SpaceAsset[]).find((asset) => asset.id === sourceVariant.asset_id);
  const startedAt = new Date().toISOString();
  const scene = parseSceneMetadata(parsed, {
    prompt,
    refs: [sourceVariantId],
    referenceVariantIds: [sourceVariantId],
    mediaKind,
  });
  const imageOptions = parseImageGenerationOptions(parsed, mediaKind);
  const videoAudioOptions = parseVideoAudioOptions(parsed, mediaKind);
  const videoOptions = parseVideoGenerationOptions(parsed, mediaKind);
  const styleSelection = await resolveStyleSelection(parsed, ctx, deps);

  await printPreflightEstimate(client, {
    operation: 'refine',
    assetId: sourceVariant.asset_id,
    assetType: sourceAsset?.type || undefined,
    mediaKind,
    prompt,
    count: 1,
    model: imageOptions.model,
    imageSize: imageOptions.imageSize,
    ...videoAudioOptions,
    ...videoOptions,
  });

  printStyleSelection(styleSelection);
  console.log(`Refining variant ${sourceVariantId}...`);
  const result = await client.sendRefineRequest({
    assetId: sourceVariant.asset_id,
    prompt,
    sourceVariantIds: [sourceVariantId],
    ...imageOptions,
    aspectRatio: imageOptions.aspectRatio ?? videoOptions.aspectRatio,
    disableStyle: parsed.options['no-style'] === 'true',
    ...(styleSelection.stylePresetId ? { stylePresetId: styleSelection.stylePresetId } : {}),
    mediaKind,
    ...videoAudioOptions,
    ...videoOptions,
    onStarted: (started) => printFollowHint(started, ctx, outputPath, 'refine', mediaKind),
  });

  const productionRecord = await placeProductionRecordFromScene({
    command: 'refine',
    result,
    outputPath,
    ctx,
    deps,
    scene,
  });
  const manifestPath = await saveGenerationManifest({
    command: 'refine',
    result,
    outputPath,
    ctx,
    deps,
    mediaKind,
    prompt,
    name: sourceAsset?.name || sourceVariant.asset_id,
    assetType: sourceAsset?.type || 'variant',
    startedAt,
    refs: [sourceVariantId],
    referenceVariantIds: [sourceVariantId],
    scene,
  });
  await downloadResult(result, outputPath, ctx, deps);
  printResult(result, outputPath, ctx, manifestPath, productionRecord);
  return result;
}

async function executeDerive(
  parsed: ParsedArgs,
  ctx: CommandContext,
  client: ForgeClient,
  deps: CommandDeps,
  mediaKind: GenerationMediaKind,
  followOptions: FollowCommandOptions = {}
): Promise<GenerateResult> {
  const prompt = getPrompt(parsed, 'derive');
  const outputPath = getOutputPath(parsed);
  const name = requireOption(parsed, 'name');
  const assetType = requireOption(parsed, 'type');
  const refs = parseRefs(requireOption(parsed, 'refs'));
  const imageOptions = parseImageGenerationOptions(parsed, mediaKind);
  if (mediaKind === 'image') {
    validateImageReferenceCount(imageOptions.model, refs.length);
  }
  const state = await requestSpaceState(client);
  const referenceVariantIds = await resolveReferenceVariantIds(
    refs,
    ctx,
    deps,
    state.variants as Variant[],
    mediaKind
  );
  const startedAt = new Date().toISOString();
  const scene = parseSceneMetadata(parsed, {
    prompt,
    refs,
    referenceVariantIds,
    mediaKind,
  });
  const videoAudioOptions = parseVideoAudioOptions(parsed, mediaKind);
  const videoOptions = parseVideoGenerationOptions(parsed, mediaKind);
  const styleSelection = await resolveStyleSelection(parsed, ctx, deps);

  await printPreflightEstimate(client, {
    operation: 'derive',
    assetType,
    mediaKind,
    prompt,
    count: 1,
    model: imageOptions.model,
    imageSize: imageOptions.imageSize,
    ...videoAudioOptions,
    ...videoOptions,
  });

  printStyleSelection(styleSelection);
  console.log(`Deriving "${name}" from ${referenceVariantIds.length} reference(s)...`);
  const result = await client.sendGenerateRequest({
    name,
    assetType,
    prompt,
    referenceVariantIds,
    ...imageOptions,
    aspectRatio: imageOptions.aspectRatio ?? videoOptions.aspectRatio,
    disableStyle: parsed.options['no-style'] === 'true',
    ...(styleSelection.stylePresetId ? { stylePresetId: styleSelection.stylePresetId } : {}),
    mediaKind,
    ...videoAudioOptions,
    ...videoOptions,
    onStarted: (started) => printFollowHint(started, ctx, outputPath, 'derive', mediaKind, followOptions),
  });

  const productionRecord = await placeProductionRecordFromScene({
    command: 'derive',
    result,
    outputPath,
    ctx,
    deps,
    scene,
  });
  const manifestPath = await saveGenerationManifest({
    command: 'derive',
    result,
    outputPath,
    ctx,
    deps,
    mediaKind,
    prompt,
    name,
    assetType,
    startedAt,
    refs,
    referenceVariantIds,
    scene,
  });
  await downloadResult(result, outputPath, ctx, deps);
  printResult(result, outputPath, ctx, manifestPath, productionRecord);
  return result;
}

async function executeFollow(
  parsed: ParsedArgs,
  ctx: CommandContext,
  client: ForgeClient,
  deps: CommandDeps,
  command: Exclude<ForgeCommand, 'batch'>,
  mediaKind: GenerationMediaKind
): Promise<GenerateResult> {
  const variantId = normalizeCliOption(parsed.options.follow);
  if (!variantId) {
    throw new Error('--follow requires a variant ID');
  }

  const outputPath = getOutputPath(parsed);
  const timeoutMs = parseFollowTimeoutMs(parsed, mediaKind);
  console.log(`Following variant ${variantId} in space ${ctx.spaceId}...`);

  const state = await requestSpaceState(client);
  const variants = state.variants as Variant[];
  const initialVariant = variants.find((variant) => variant.id === variantId);
  if (!initialVariant) {
    throw new Error(`Variant not found in space sync state: ${variantId}`);
  }

  const initialStatus = initialVariant.status;
  const requestId = `follow:${variantId}`;
  let result = resultFromTerminalVariant(initialVariant, requestId);
  if (!result) {
    console.log(`  Status: ${initialStatus}`);
    let lastStatus = initialStatus;
    const followPromise = client.followVariant({
      variantId,
      requestId,
      timeoutMs,
      onUpdate: (variant) => {
        if (variant.status !== lastStatus) {
          lastStatus = variant.status;
          console.log(`  Status: ${variant.status}`);
        }
      },
    });
    const refreshedState = await requestSpaceState(client);
    const refreshedVariant = (refreshedState.variants as Variant[]).find((variant) => variant.id === variantId);
    result = refreshedVariant ? resultFromTerminalVariant(refreshedVariant, requestId) : undefined;
    if (result) {
      client.cancelFollowVariant?.(variantId, requestId);
    } else {
      result = await followPromise;
    }
  }

  if (!result.success || !result.variant) {
    throw new Error(result.error || 'Generation failed without a completed variant');
  }

  const completedVariant = result.variant;
  const asset = (state.assets as SpaceAsset[]).find((candidate) => candidate.id === completedVariant.asset_id);
  const recipe = parseGenerationRecipe(completedVariant.recipe);
  const followMediaKind = completedVariant.media_kind || recipe.mediaKind || mediaKind;
  const referenceVariantIds = recipe.parentVariantIds || [];
  const prompt = recipe.prompt || '';
  const scene = parseSceneMetadata(parsed, {
    prompt,
    refs: referenceVariantIds,
    referenceVariantIds,
    mediaKind: followMediaKind,
  });

  const productionRecord = await placeProductionRecordFromScene({
    command,
    result,
    outputPath,
    ctx,
    deps,
    scene,
  });
  const manifestPath = await saveFollowManifest({
    command,
    variant: completedVariant,
    asset,
    recipe,
    outputPath,
    ctx,
    deps,
    mediaKind: followMediaKind,
    prompt,
    referenceVariantIds,
    scene,
  });

  await downloadResult(result, outputPath, ctx, deps);
  printResult(result, outputPath, ctx, manifestPath, productionRecord);
  return result;
}

async function saveFollowManifest(input: {
  command: Exclude<ForgeCommand, 'batch'>;
  variant: Variant;
  asset?: SpaceAsset;
  recipe: GenerationRecipeSummary;
  outputPath: string;
  ctx: CommandContext;
  deps: CommandDeps;
  mediaKind: GenerationMediaKind;
  prompt: string;
  referenceVariantIds: string[];
  scene?: RunManifestScene;
}): Promise<string> {
  const completedAt = new Date().toISOString();
  const media = [manifestMediaFromVariant({
    index: 0,
    variant: input.variant,
    localPath: input.outputPath,
    baseUrl: input.ctx.baseUrl,
    spaceId: input.ctx.spaceId,
  })];

  return input.deps.saveRunManifest({
    version: 1,
    runId: input.deps.createRunId(),
    command: input.command,
    mediaKind: input.mediaKind,
    success: true,
    environment: input.ctx.env,
    spaceId: input.ctx.spaceId,
    baseUrl: input.ctx.baseUrl,
    prompt: input.prompt,
    name: input.asset?.name || input.variant.asset_id,
    assetType: input.recipe.assetType || input.asset?.type || 'variant',
    count: 1,
    mode: input.command,
    refs: input.referenceVariantIds,
    referenceVariantIds: input.referenceVariantIds,
    outputDir: path.dirname(input.outputPath) || '.',
    workingDir: input.ctx.workingDir,
    createdAt: timestampToIso(input.variant.created_at) || completedAt,
    completedAt,
    scene: input.scene,
    media,
    images: media.filter(isImageManifestMedia),
    failed: [],
  }, input.ctx.projectRoot);
}

function resultFromTerminalVariant(variant: Variant, requestId: string): GenerateResult | undefined {
  if (variant.status === 'completed') {
    return {
      type: 'generate:result',
      requestId,
      jobId: variant.id,
      success: true,
      variant,
    };
  }
  if (variant.status === 'failed') {
    return {
      type: 'generate:result',
      requestId,
      jobId: variant.id,
      success: false,
      error: variant.error_message || 'Generation failed',
    };
  }
  return undefined;
}

function parseGenerationRecipe(recipeJson: string): GenerationRecipeSummary {
  try {
    const parsed = JSON.parse(recipeJson) as Record<string, unknown>;
    return {
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt : undefined,
      assetType: typeof parsed.assetType === 'string' ? parsed.assetType : undefined,
      mediaKind: isMediaKind(parsed.mediaKind) ? parsed.mediaKind : undefined,
      parentVariantIds: Array.isArray(parsed.parentVariantIds)
        ? parsed.parentVariantIds.filter((value): value is string => typeof value === 'string')
        : undefined,
    };
  } catch {
    return {};
  }
}

function isMediaKind(value: unknown): value is MediaKind {
  return value === 'image' || value === 'audio' || value === 'video';
}

function parseFollowTimeoutMs(parsed: ParsedArgs, mediaKind: GenerationMediaKind): number {
  const timeout = readOptionalOption(parsed, 'timeout', 'timeout');
  if (timeout === undefined) return getGenerationRequestTimeoutMs(mediaKind);

  const seconds = Number(timeout);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('--timeout must be a positive number of seconds');
  }
  return Math.ceil(seconds * 1000);
}

function timestampToIso(timestamp: number | undefined): string | undefined {
  if (!timestamp || !Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp).toISOString();
}

async function executeBatch(
  parsed: ParsedArgs,
  ctx: CommandContext,
  client: ForgeClient,
  deps: CommandDeps,
  mediaKind: GenerationMediaKind,
  saveBatchManifest: boolean
): Promise<BatchResult> {
  const prompt = getPrompt(parsed, 'batch');
  const outputDir = getOutputDir(parsed);
  const name = requireOption(parsed, 'name');
  const assetType = requireOption(parsed, 'type');
  const musicProvider = parseMusicProviderOption(parsed, mediaKind, assetType);
  const count = parseBatchCount(requireOption(parsed, 'count'));
  const mode = parseBatchMode(parsed.options.mode || 'explore');
  const refs = parsed.options.refs ? parseRefs(parsed.options.refs) : [];
  const imageOptions = parseImageGenerationOptions(parsed, mediaKind);
  if (mediaKind === 'image') {
    validateImageReferenceCount(imageOptions.model, refs.length);
  }
  const state = await requestSpaceState(client);
  const referenceVariantIds = refs.length > 0
    ? await resolveReferenceVariantIds(refs, ctx, deps, state.variants as Variant[], mediaKind)
    : undefined;
  const startedAt = new Date().toISOString();
  const runId = deps.createRunId();
  const styleSelection = await resolveStyleSelection(parsed, ctx, deps);

  await printPreflightEstimate(client, {
    operation: 'batch',
    assetType,
    mediaKind,
    prompt,
    count,
    model: imageOptions.model,
    imageSize: imageOptions.imageSize,
    ...(musicProvider ? { musicProvider } : {}),
  });

  const mediaLabel = mediaKind === 'image' ? 'image' : mediaKind === 'video' ? 'video' : 'audio file';
  printStyleSelection(styleSelection);
  console.log(`Batch generating ${count} ${mediaLabel}(s) for "${name}"...`);
  const audioVoiceOptions = mediaKind === 'audio' ? parseAudioVoiceOptions(parsed) : {};
  const result = await client.sendBatchRequest({
    name,
    assetType,
    prompt,
    count,
    mode,
    referenceVariantIds,
    ...imageOptions,
    aspectRatio: imageOptions.aspectRatio,
    disableStyle: parsed.options['no-style'] === 'true',
    ...(styleSelection.stylePresetId ? { stylePresetId: styleSelection.stylePresetId } : {}),
    mediaKind,
    ...audioVoiceOptions,
    ...(musicProvider ? { musicProvider } : {}),
  });

  const sortedVariants = [...result.variants].sort((a, b) => a.created_at - b.created_at);
  const media: RunManifestMedia[] = [];
  for (let index = 0; index < sortedVariants.length; index += 1) {
    const variant = sortedVariants[index];
    const outputPath = path.join(outputDir, `${slugify(name)}-${String(index + 1).padStart(2, '0')}.${getOutputExtension(variant, mediaKind)}`);
    await downloadResult({ type: 'generate:result', requestId: result.requestId, jobId: variant.id, success: true, variant }, outputPath, ctx, deps);
    if (saveBatchManifest) {
      media.push(manifestMediaFromVariant({
        index,
        variant,
        localPath: outputPath,
        baseUrl: ctx.baseUrl,
        spaceId: ctx.spaceId,
      }));
    }
  }

  const manifestPath = saveBatchManifest
    ? await deps.saveRunManifest({
      version: 1,
      runId,
      command: 'batch',
      mediaKind,
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
      workingDir: ctx.workingDir,
      createdAt: startedAt,
      completedAt: new Date().toISOString(),
      media,
      images: media.filter(isImageManifestMedia),
      failed: result.failed,
    }, ctx.projectRoot)
    : undefined;

  printBatchResult(result, outputDir, manifestPath, ctx, mediaKind);
  if (!result.success) {
    const failures = result.failed.map((failure) => `${failure.variantId}: ${failure.error}`).join('; ');
    throw new Error(`Batch generation completed with ${result.failed.length} failure(s): ${failures || 'unknown error'}`);
  }

  return result;
}

async function saveGenerationManifest(input: {
  command: Exclude<ForgeCommand, 'batch'>;
  result: GenerateResult;
  outputPath: string;
  ctx: CommandContext;
  deps: CommandDeps;
  mediaKind: GenerationMediaKind;
  prompt: string;
  name: string;
  assetType: string;
  startedAt: string;
  refs: string[];
  referenceVariantIds: string[];
  scene?: RunManifestScene;
}): Promise<string | undefined> {
  const { result, ctx, deps } = input;
  if (!result.success || !result.variant) return undefined;
  const completedAt = new Date().toISOString();
  const media = [manifestMediaFromVariant({
    index: 0,
    variant: result.variant,
    localPath: input.outputPath,
    baseUrl: ctx.baseUrl,
    spaceId: ctx.spaceId,
  })];

  return deps.saveRunManifest({
    version: 1,
    runId: deps.createRunId(),
    command: input.command,
    mediaKind: input.mediaKind,
    success: true,
    environment: ctx.env,
    spaceId: ctx.spaceId,
    baseUrl: ctx.baseUrl,
    prompt: input.prompt,
    name: input.name,
    assetType: input.assetType,
    count: 1,
    mode: input.command,
    refs: input.refs,
    referenceVariantIds: input.referenceVariantIds,
    outputDir: path.dirname(input.outputPath) || '.',
    workingDir: ctx.workingDir,
    createdAt: input.startedAt,
    completedAt,
    scene: input.scene,
    media,
    images: media.filter(isImageManifestMedia),
    failed: [],
  }, ctx.projectRoot);
}

async function placeProductionRecordFromScene(input: {
  command: Exclude<ForgeCommand, 'batch'>;
  result: GenerateResult;
  outputPath: string;
  ctx: CommandContext;
  deps: CommandDeps;
  scene?: RunManifestScene;
}): Promise<ProductionRecord | undefined> {
  const { scene, result, ctx, deps } = input;
  if (!scene || !result.success || !result.variant) return undefined;
  if (!deps.placeProductionRecord) return undefined;

  const record: PlaceProductionRecordRequest = {
    productionId: scene.productionId!,
    variantId: result.variant.id,
    shotId: scene.shotId,
    sceneLabel: scene.sceneLabel!,
    timelineStartMs: scene.timelineStartMs!,
    durationMs: scene.durationMs,
    motionPrompt: scene.motionPrompt,
    sourceRefs: scene.sourceRefs,
    sourceVariantIds: scene.sourceVariantIds,
    metadata: {
      command: input.command,
      localPath: input.outputPath,
    },
  };

  return deps.placeProductionRecord({
    baseUrl: ctx.baseUrl,
    accessToken: ctx.accessToken,
    spaceId: ctx.spaceId,
    record,
  });
}

async function buildContext(parsed: ParsedArgs, deps: CommandDeps): Promise<CommandContext> {
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

  return {
    env,
    spaceId,
    baseUrl: deps.resolveBaseUrl(env),
    accessToken: config.token.accessToken,
    force: parsed.options.force === 'true',
    projectRoot: projectConfig?.projectRoot,
    workingDir: deps.getWorkingDir?.() || process.cwd(),
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
  variants: Variant[] = [],
  mediaKind: GenerationMediaKind = CLI_GENERATION_MEDIA_KIND
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

    validateReferenceVariant(ref, variants, mediaKind);
    variantIds.push(ref);
  }

  return variantIds;
}

function validateReferenceVariant(ref: string, variants: Variant[], mediaKind: GenerationMediaKind): void {
  const variant = variants.find((candidate) => candidate.id === ref);
  if (!variant) {
    throw new Error(`Reference variant not found in space sync state: ${ref}`);
  }
  if (variant.status !== 'completed') {
    throw new Error(`Reference variant is not completed: ${ref}`);
  }

  if (mediaKind === 'image' && !variant.image_key) {
    throw new Error(`Reference variant has no image: ${ref}`);
  }

  if (mediaKind === 'video') {
    const referenceMediaKind = variant.media_kind || CLI_GENERATION_MEDIA_KIND;
    if (referenceMediaKind !== 'image' && referenceMediaKind !== 'video') {
      throw new Error(`Video generation references must be image or video variants: ${ref}`);
    }
    if (!variant.image_key && !variant.media_key) {
      throw new Error(`Reference variant has no image or video media: ${ref}`);
    }
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

async function resolveStyleSelection(
  parsed: ParsedArgs,
  ctx: CommandContext,
  deps: Pick<CommandDeps, 'fetch'>
): Promise<StyleSelection> {
  const stylePresetRef = readStylePresetOption(parsed);
  if (parsed.options['no-style'] === 'true') {
    if (stylePresetRef) {
      throw new Error('--style-preset cannot be used with --no-style');
    }
    return {};
  }
  if (!stylePresetRef) return {};

  const response = await apiFetch('GET /api/spaces/:id/style-presets', {
    baseUrl: ctx.baseUrl,
    fetch: deps.fetch ?? fetch,
    params: { id: ctx.spaceId },
    headers: {
      'Authorization': `Bearer ${ctx.accessToken}`,
      'Accept': 'application/json',
    },
  });
  const presets = response.presets as StylePresetSummary[];
  const byId = presets.find((preset) => preset.id === stylePresetRef);
  const byName = presets.filter((preset) => preset.name === stylePresetRef);
  const preset = byId ?? (byName.length === 1 ? byName[0] : undefined);
  if (!preset) {
    if (byName.length > 1) {
      throw new Error(`Style preset name is ambiguous: ${stylePresetRef}. Use a preset ID.`);
    }
    throw new Error(`Style preset not found: ${stylePresetRef}`);
  }
  if (!isTruthyFlag(preset.enabled)) {
    throw new Error(`Style preset is disabled: ${preset.name} (${preset.id})`);
  }
  return { stylePresetId: preset.id, preset };
}

function readStylePresetOption(parsed: ParsedArgs): string | undefined {
  return (
    readOptionalOption(parsed, 'style-preset', 'stylePreset') ??
    readOptionalOption(parsed, 'preset', 'preset')
  );
}

function printStyleSelection(selection: StyleSelection): void {
  if (selection.preset) {
    const preset = selection.preset;
    const defaultLabel = isTruthyFlag(preset.is_default) ? ', default' : '';
    console.log(`Style preset: ${preset.name} (${preset.id}${defaultLabel})`);
    console.log(`  References: ${preset.reference_count}`);
    console.log(`  Collection: ${preset.collection_name || '-'}`);
    return;
  }
}

function isTruthyFlag(value: boolean | number): boolean {
  return value === true || value === 1;
}

async function downloadResult(
  result: GenerateResult,
  outputPath: string,
  ctx: CommandContext,
  deps: Pick<CommandDeps, 'downloadImage' | 'downloadFile'>
): Promise<void> {
  const variant = result.variant;
  if (!result.success || !variant) {
    throw new Error(result.error || 'Generation failed without a completed variant');
  }

  if ((variant.media_kind || CLI_GENERATION_MEDIA_KIND) === 'image' && variant.image_key) {
    await deps.downloadImage({
      baseUrl: ctx.baseUrl,
      accessToken: ctx.accessToken,
      imageKey: variant.image_key,
      outputPath,
      force: ctx.force,
    });
    return;
  }

  if (!variant.media_key) {
    throw new Error(result.error || `Generation failed without downloadable media for ${variant.media_kind}`);
  }

  if (!deps.downloadFile) {
    throw new Error('Generic media download is not configured');
  }

  await deps.downloadFile({
    baseUrl: ctx.baseUrl,
    accessToken: ctx.accessToken,
    requestPath: `/api/spaces/${encodeURIComponent(ctx.spaceId)}/variants/${encodeURIComponent(variant.id)}/media`,
    outputPath,
    force: ctx.force,
  });
}

function printResult(
  result: GenerateResult,
  outputPath: string,
  ctx: CommandContext,
  manifestPath?: string,
  productionRecord?: ProductionRecord
): void {
  const variant = result.variant;
  if (!variant) return;

  console.log('\nDone.\n');
  console.log(`  Asset:   ${variant.asset_id}`);
  console.log(`  Variant: ${variant.id}`);
  console.log(`  Media:   ${variant.media_key || variant.image_key || '-'}`);
  if (variant.image_key && variant.media_key !== variant.image_key) {
    console.log(`  Image:   ${variant.image_key}`);
  }
  console.log(`  Local:   ${outputPath}`);
  if (manifestPath) {
    console.log(`  Debug manifest: ${manifestPath}`);
  }
  if (productionRecord) {
    console.log(`  Production: ${productionRecord.production_id} (${productionRecord.id})`);
  }
  console.log(`  Web:     ${ctx.baseUrl}/spaces/${ctx.spaceId}/assets/${variant.asset_id}`);
}

function printFollowHint(
  started: GenerateStarted,
  ctx: CommandContext,
  outputPath: string,
  command: Exclude<ForgeCommand, 'batch'>,
  mediaKind: GenerationMediaKind,
  options: FollowCommandOptions = {}
): void {
  console.log(`  Started variant: ${started.jobId}`);
  console.log(`  Follow: ${formatFollowCommand(started.jobId, outputPath, ctx, command, mediaKind, options)}`);
}

function formatFollowCommand(
  variantId: string,
  outputPath: string,
  ctx: CommandContext,
  command: Exclude<ForgeCommand, 'batch'>,
  mediaKind: GenerationMediaKind,
  options: FollowCommandOptions = {}
): string {
  const baseCommand = mediaKind === 'audio'
    ? ['makefx', 'audio', options.audioMode, 'generate'].filter((part): part is string => Boolean(part))
    : mediaKind === 'video'
      ? ['makefx', 'video', command]
      : ['makefx', command];
  const envArgs = ctx.env === 'local' ? ['--local'] : ['--env', ctx.env];
  return [
    ...baseCommand,
    '--follow',
    variantId,
    '-o',
    outputPath,
    ...envArgs,
    '--space',
    ctx.spaceId,
  ].map(shellQuote).join(' ');
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
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

function validateAudioVoiceOptions(options: Record<string, string>): void {
  if (!options.voice && !options['dialogue-voices'] && !options.dialogueVoices) {
    return;
  }

  if (options.voice !== undefined && !normalizeCliOption(options.voice)) {
    throw new Error('--voice requires a voice ID');
  }

  const dialogueVoices = options['dialogue-voices'] ?? options.dialogueVoices;
  if (dialogueVoices !== undefined && !normalizeCliOption(dialogueVoices)) {
    throw new Error('--dialogue-voices requires a comma-separated voice ID list');
  }

  if (options.type === 'music' || options.type === 'sfx') {
    throw new Error('Voice selection is only supported for speech and dialogue audio');
  }
}

function parseAudioVoiceOptions(parsed: ParsedArgs): AudioVoiceOptions {
  const voiceId = normalizeCliOption(parsed.options.voice);
  const dialogueVoiceIds = parseDialogueVoiceIds(
    parsed.options['dialogue-voices'] ?? parsed.options.dialogueVoices
  );
  return {
    ...(voiceId ? { voiceId } : {}),
    ...(dialogueVoiceIds ? { dialogueVoiceIds } : {}),
  };
}

function validateVideoAudioOptions(parsed: ParsedArgs, mediaKind: GenerationMediaKind): void {
  const hasAudioFlag = parsed.options.audio !== undefined || parsed.options['no-audio'] !== undefined || parsed.options.noAudio !== undefined;
  if (!hasAudioFlag) return;
  if (mediaKind !== 'video') {
    throw new Error('--audio and --no-audio are only supported for video generation');
  }
  if (parsed.options.audio !== undefined && (parsed.options['no-audio'] !== undefined || parsed.options.noAudio !== undefined)) {
    throw new Error('Pass either --audio or --no-audio, not both');
  }
  if (parsed.options['no-audio'] !== undefined || parsed.options.noAudio !== undefined) {
    const tierValue =
      readOptionalOption(parsed, 'tier', 'tier') ??
      readOptionalOption(parsed, 'video-tier', 'videoTier');
    const videoTier = tierValue === undefined
      ? DEFAULT_VIDEO_GENERATION_TIER
      : normalizeVideoGenerationTier(tierValue);
    if (!videoTier) {
      throw new Error('--tier must be generate, fast, or lite');
    }

    const model = getVideoGenerationModelForTier(videoTier);
    if (!doesVideoGenerationModelSupportAudioToggle(model)) {
      throw new Error(`${model} does not support --no-audio. Use the default audio-enabled output or omit the flag.`);
    }
  }
}

function parseVideoAudioOptions(
  parsed: ParsedArgs,
  mediaKind: GenerationMediaKind
): { generateAudio?: boolean } {
  if (mediaKind === 'video') {
    if (parsed.options.audio !== undefined) return { generateAudio: true };
    if (parsed.options['no-audio'] !== undefined || parsed.options.noAudio !== undefined) {
      return { generateAudio: false };
    }
  }
  return {};
}

function parseVideoGenerationOptions(
  parsed: ParsedArgs,
  mediaKind: GenerationMediaKind
): VideoGenerationOptions {
  const resolutionValue =
    readOptionalOption(parsed, 'resolution', 'resolution') ??
    readOptionalOption(parsed, 'video-resolution', 'videoResolution');
  const durationValue =
    readOptionalOption(parsed, 'duration', 'duration') ??
    readOptionalOption(parsed, 'video-duration', 'videoDuration');
  const tierValue =
    readOptionalOption(parsed, 'tier', 'tier') ??
    readOptionalOption(parsed, 'video-tier', 'videoTier');
  const aspectValue = mediaKind === 'video'
    ? readOptionalOption(parsed, 'aspect', 'aspect')
    : undefined;

  if (resolutionValue === undefined && durationValue === undefined && tierValue === undefined && aspectValue === undefined) {
    return {};
  }

  if (mediaKind !== 'video') {
    throw new Error('--resolution, --duration, and --tier are only supported for video generation');
  }

  const videoResolution = resolutionValue === undefined
    ? undefined
    : normalizeVideoGenerationResolution(resolutionValue);
  if (resolutionValue !== undefined && !videoResolution) {
    throw new Error('--resolution must be 720p, 1080p, or 4k');
  }

  const videoDurationSeconds = durationValue === undefined
    ? undefined
    : normalizeVideoGenerationDurationSeconds(durationValue);
  if (durationValue !== undefined && !videoDurationSeconds) {
    throw new Error('--duration must be 4, 6, or 8');
  }

  const videoTier = tierValue === undefined
    ? undefined
    : normalizeVideoGenerationTier(tierValue);
  if (tierValue !== undefined && !videoTier) {
    throw new Error('--tier must be generate, fast, or lite');
  }
  if (videoResolution && videoTier && !isVideoGenerationResolutionSupportedForTier(videoResolution, videoTier)) {
    throw new Error('--resolution 4k is not supported with --tier lite');
  }

  const aspectRatio = aspectValue === undefined
    ? undefined
    : normalizeVideoGenerationAspectRatio(aspectValue);
  if (aspectValue !== undefined && !aspectRatio) {
    throw new Error('--aspect must be 16:9 or 9:16');
  }

  return {
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(videoResolution ? { videoResolution } : {}),
    ...(videoDurationSeconds ? { videoDurationSeconds } : {}),
    ...(videoTier ? { videoTier } : {}),
  };
}

function parseDialogueVoiceIds(value: string | undefined): string[] | undefined {
  const normalized = normalizeCliOption(value);
  if (!normalized) return undefined;

  const voiceIds = normalized.split(',').map((voiceId) => voiceId.trim());
  if (!voiceIds.some(Boolean)) {
    throw new Error('--dialogue-voices must include at least one voice ID');
  }
  return voiceIds;
}

function normalizeCliOption(value: string | undefined): string | undefined {
  if (value === undefined || value === 'true') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseImageGenerationOptions(
  parsed: ParsedArgs,
  mediaKind: GenerationMediaKind
): { model?: ImageModelSelection; imageSize?: ImageSize; aspectRatio?: ImageAspectRatio } {
  if (mediaKind !== 'image') return {};

  const model = parseImageModelOption(readOptionalOption(parsed, 'model', 'model'));
  const imageSize = parseImageSizeOption(readOptionalOption(parsed, 'size', 'size'));
  const aspectRatio = parseImageAspectRatioOption(readOptionalOption(parsed, 'aspect', 'aspect'));

  if (imageSize && !isImageSizeSupportedByModel(model, imageSize)) {
    const supportedSizes = getImageModelCapabilities(model).supportedImageSizes.join(', ');
    throw new Error(`--model ${model ?? 'pro'} supports only --size ${supportedSizes}`);
  }

  if (aspectRatio && !isImageAspectRatioSupportedByModel(model, aspectRatio)) {
    const supportedAspectRatios = getImageModelCapabilities(model).supportedAspectRatios.join(', ');
    throw new Error(`--model ${model ?? 'pro'} supports only --aspect ${supportedAspectRatios}`);
  }

  return {
    ...(model ? { model } : {}),
    ...(imageSize ? { imageSize } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
  };
}

function parseImageModelOption(value: string | undefined): ImageModelSelection | undefined {
  if (!value) return undefined;
  if (isImageModelSelection(value)) return value;
  if (value === IMAGE_MODEL_IDS.pro) return 'pro';
  if (value === IMAGE_MODEL_IDS.flash) return 'flash';
  throw new Error('--model must be pro or flash');
}

function parseImageSizeOption(value: string | undefined): ImageSize | undefined {
  if (!value) return undefined;
  const normalized = normalizeImageSize(value);
  if (!normalized) {
    throw new Error('--size must be 1K, 2K, or 4K');
  }
  return normalized;
}

function parseImageAspectRatioOption(value: string | undefined): ImageAspectRatio | undefined {
  if (!value) return undefined;
  if (!isImageAspectRatio(value)) {
    const supportedAspectRatios = getImageModelCapabilities().supportedAspectRatios.join(', ');
    throw new Error(`--aspect must be ${supportedAspectRatios}`);
  }
  return value;
}

function validateImageReferenceCount(
  model: ImageModelSelection | undefined,
  referenceCount: number
): void {
  const maxReferenceImages = getImageModelMaxReferenceImages(model);
  if (referenceCount <= maxReferenceImages) return;

  const noun = maxReferenceImages === 1 ? 'reference' : 'references';
  throw new Error(`--model ${model ?? 'pro'} supports at most ${maxReferenceImages} ${noun}`);
}

function validateImageCommandReferenceCount(
  command: ForgeCommand,
  parsed: ParsedArgs,
  mediaKind: GenerationMediaKind,
  model: ImageModelSelection | undefined
): void {
  if (mediaKind !== 'image') return;
  if (command !== 'derive' && command !== 'batch') return;
  if (!parsed.options.refs) return;
  validateImageReferenceCount(model, parseRefs(parsed.options.refs).length);
}

function parseSceneMetadata(
  parsed: ParsedArgs,
  input: {
    prompt: string;
    refs: string[];
    referenceVariantIds: string[];
    mediaKind: GenerationMediaKind;
  }
): RunManifestScene | undefined {
  const productionId = readOptionalOption(parsed, 'production-id', 'productionId');
  const shotId = readOptionalOption(parsed, 'shot-id', 'shotId');
  const sceneLabel = readOptionalOption(parsed, 'scene-label', 'sceneLabel');
  const timelineStartValue = readOptionalOption(parsed, 'timeline-start-ms', 'timelineStartMs');
  const durationValue = readOptionalOption(parsed, 'duration-ms', 'durationMs');

  if (!productionId && !shotId && !sceneLabel && timelineStartValue === undefined && durationValue === undefined) {
    return undefined;
  }

  if (!productionId || !sceneLabel || timelineStartValue === undefined) {
    throw new Error('Production metadata requires --production-id, --scene-label, and --timeline-start-ms');
  }

  return {
    productionId,
    shotId,
    sceneLabel,
    timelineStartMs: timelineStartValue === undefined ? undefined : parseNonNegativeInteger(timelineStartValue, '--timeline-start-ms'),
    durationMs: durationValue === undefined ? undefined : parseNonNegativeInteger(durationValue, '--duration-ms'),
    motionPrompt: input.mediaKind === 'video' ? input.prompt : undefined,
    sourceRefs: input.refs,
    sourceVariantIds: input.referenceVariantIds,
  };
}

function validateProductionMetadataOptions(parsed: ParsedArgs): void {
  const productionId = readOptionalOption(parsed, 'production-id', 'productionId');
  const shotId = readOptionalOption(parsed, 'shot-id', 'shotId');
  const sceneLabel = readOptionalOption(parsed, 'scene-label', 'sceneLabel');
  const timelineStartValue = readOptionalOption(parsed, 'timeline-start-ms', 'timelineStartMs');
  const durationValue = readOptionalOption(parsed, 'duration-ms', 'durationMs');

  if (!productionId && !shotId && !sceneLabel && timelineStartValue === undefined && durationValue === undefined) {
    return;
  }

  if (!productionId || !sceneLabel || timelineStartValue === undefined) {
    throw new Error('Production metadata requires --production-id, --scene-label, and --timeline-start-ms');
  }
}

function readOptionalOption(parsed: ParsedArgs, kebabName: string, camelName: string): string | undefined {
  const value = parsed.options[kebabName] ?? parsed.options[camelName];
  if (value === undefined || value === 'true') return undefined;
  return value;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'image';
}

function getOutputExtension(variant: Variant, mediaKind: GenerationMediaKind): string {
  if (mediaKind === 'image') return 'png';

  const keyExtension = path.extname(variant.media_key || '').replace(/^\./, '').toLowerCase();
  if (keyExtension) return keyExtension;

  if (mediaKind === 'video') {
    if (variant.media_mime_type === 'video/quicktime') return 'mov';
    if (variant.media_mime_type === 'video/webm') return 'webm';
    if (variant.media_mime_type === 'video/x-m4v') return 'm4v';
    return 'mp4';
  }

  if (variant.media_mime_type === 'audio/mpeg') return 'mp3';
  if (variant.media_mime_type === 'audio/mp4') return 'm4a';
  if (variant.media_mime_type === 'audio/aac') return 'aac';
  if (variant.media_mime_type === 'audio/ogg') return 'ogg';
  if (variant.media_mime_type === 'audio/flac') return 'flac';
  return 'wav';
}

function isImageManifestMedia(media: RunManifestMedia): media is RunManifestImage {
  return media.mediaKind === 'image' && Boolean(media.imageKey);
}

function requireOption(parsed: ParsedArgs, name: string): string {
  const value = parsed.options[name];
  if (!value || value === 'true') {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function cliOptionValues(values: readonly (string | number)[]): string {
  return values.join('|');
}

function cliImageSizeValues(): string {
  return cliOptionValues(Array.from(new Set(
    IMAGE_MODEL_SELECTIONS.flatMap((model) => getImageModelCapabilities(model).supportedImageSizes)
  )));
}

function cliImageAspectValues(): string {
  return cliOptionValues(getImageModelCapabilities().supportedAspectRatios);
}

function printUsage(command: ForgeCommand): void {
  if (command === 'generate') {
    console.log(`
Usage:
  makefx generate "prompt" --name <name> --type <type> -o <file> [--model pro|flash] [--size ${cliImageSizeValues()}] [--aspect ${cliImageAspectValues()}] [--space <id>]
  makefx generate --follow <variant_id> -o <file> [--space <id>]

Production metadata:
  --scene-label <label> --timeline-start-ms <ms> --duration-ms <ms>
  --shot-id <id> --production-id <id>
`);
    return;
  }

  if (command === 'refine') {
    console.log(`
Usage:
  makefx refine --variant <variant_id> "prompt" -o <file> [--model pro|flash] [--size ${cliImageSizeValues()}] [--aspect ${cliImageAspectValues()}] [--space <id>]
  makefx refine --follow <variant_id> -o <file> [--space <id>]

Production metadata:
  --scene-label <label> --timeline-start-ms <ms> --duration-ms <ms>
  --shot-id <id> --production-id <id>
`);
    return;
  }

  if (command === 'batch') {
    console.log(`
Usage:
  makefx batch "prompt" --name <name> --type <type> --count <2-8> --output-dir <dir> [--model pro|flash] [--size ${cliImageSizeValues()}] [--aspect ${cliImageAspectValues()}]
`);
    return;
  }

  console.log(`
Usage:
  makefx derive --refs <variant_or_file,variant_or_file> --name <name> --type <type> "prompt" -o <file> [--model pro|flash] [--size ${cliImageSizeValues()}] [--aspect ${cliImageAspectValues()}] [--space <id>]
  makefx derive --follow <variant_id> -o <file> [--space <id>]

Production metadata:
  --scene-label <label> --timeline-start-ms <ms> --duration-ms <ms>
  --shot-id <id> --production-id <id>
`);
}

function printBatchResult(
  result: BatchResult,
  outputDir: string,
  manifestPath: string | undefined,
  ctx: CommandContext,
  mediaKind: GenerationMediaKind
): void {
  console.log('\nDone.\n');
  console.log(`  Batch:   ${result.batchId}`);
  console.log(`  ${mediaKind === 'image' ? 'Images' : 'Media'}:  ${result.variants.length}`);
  if (result.failed.length > 0) {
    console.log(`  Failed:  ${result.failed.length}`);
  }
  console.log(`  Local:   ${outputDir}`);
  if (manifestPath) {
    console.log(`  Debug manifest: ${manifestPath}`);
  }
  if (result.variants[0]) {
    console.log(`  Web:     ${ctx.baseUrl}/spaces/${ctx.spaceId}/assets/${result.variants[0].asset_id}`);
  }
}
