/**
 * Generation Controller
 *
 * Handles workflow triggers for generation and refinement.
 * Creates placeholder variants upfront and updates them when workflows complete.
 *
 * Uses VariantFactory for shared variant creation logic.
 *
 * Billing:
 * - preCheck quota/rate limits BEFORE triggering workflows
 * - Track usage AFTER successful completion (not during workflow)
 */

import type { Variant, WebSocketMeta } from '../types';
import type { RotationController } from './RotationController';
import type { TileController } from './TileController';
import type {
  GenerateRequestMessage,
  RefineRequestMessage,
  BatchRequestMessage,
  GenerationEstimateRequestMessage,
  GenerationUsageEstimate,
  GenerationWorkflowInput,
} from '../../../workflows/types';
import { BaseController, type ControllerContext, NotFoundError, ValidationError } from './types';
import {
  preCheck,
  checkGenerationGuardrails,
  incrementRateLimit,
  trackImageGeneration,
  trackElevenLabsAudioGeneration,
  trackGeminiAudioGeneration,
  trackVideoGeneration,
  getVideoQuotaUnits,
  type GenerationLimitDenyReason,
  type ProviderUsageAttribution,
} from '../billing/usageCheck';
import {
  VariantFactory,
  determineOperation,
  type GenerationRecipe,
} from '../generation/VariantFactory';
import type { VariantMediaMetadata } from '../repository/SpaceRepository';
import { loggers } from '../../../../shared/logger';
import type { MusicGenerationProvider } from '../../../../shared/websocket-types';
import { resolveAudioProvider } from '../../../services/audioProviderSelection';
import { hasStoredProviderApiKey, type ProviderKeyProvider } from '../../../services/providerKeyVault';
import {
  DEFAULT_IMAGE_MODEL_ID,
  isImageModelId,
  isImageModelSelection,
  resolveImageModelSelection,
} from '../../../../shared/imageGenerationOptions';
import {
  DEFAULT_VIDEO_GENERATION_MODEL,
  VIDEO_GENERATION_AUDIO_ALWAYS_ON,
  getVideoGenerationModelForTier,
  normalizeVideoGenerationTier,
} from '../../../../shared/videoGenerationOptions';
import { trackVariantStorageUsage } from '../../../platform/platformUsage';
import { priceProviderUsageEvent, type ProviderPricingResult } from '../../../billing/providerPricing';

const log = loggers.generationController;

type GenerationBillingService = 'nanobanana' | 'lyria' | 'elevenlabs' | 'veo';
type ImageModelProvider = 'gemini' | 'custom';

interface ByokBillingContext {
  modelProvider?: ImageModelProvider;
}

type AudioUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type VideoBillingDimensions = {
  resolution?: string;
  durationSeconds?: number;
  generateAudio: boolean;
};

const ELEVENLABS_GENERATED_AUDIO_COST_BUFFER = 50;
const DEFAULT_LYRIA_MODEL_ID = 'lyria-3-clip-preview';
const DEFAULT_ELEVENLABS_SPEECH_MODEL_ID = 'eleven_v3';
const DEFAULT_ELEVENLABS_MUSIC_MODEL_ID = 'music_v1';
const DEFAULT_ELEVENLABS_SFX_MODEL_ID = 'eleven_text_to_sound_v2';

function getGenerationBillingService(
  env: ControllerContext['env'],
  mediaKind?: string,
  assetType?: string,
  musicProvider?: MusicGenerationProvider
): GenerationBillingService {
  if (mediaKind === 'video') {
    return 'veo';
  }
  if (mediaKind === 'audio' && assetType === 'music' && musicProvider === 'lyria') {
    return 'lyria';
  }
  if (mediaKind === 'audio' && resolveAudioProvider(env) === 'elevenlabs') {
    return 'elevenlabs';
  }
  return 'nanobanana';
}

function getQuotaEventNameForBillingService(service: GenerationBillingService): string {
  switch (service) {
    case 'elevenlabs':
      return 'elevenlabs_audio';
    case 'lyria':
      return 'gemini_audio';
    case 'veo':
      return 'gemini_videos';
    case 'nanobanana':
      return 'gemini_images';
  }
}

function getByokProviderForBillingService(service: GenerationBillingService): ProviderKeyProvider {
  switch (service) {
    case 'elevenlabs':
      return 'elevenlabs';
    case 'lyria':
      return 'lyria';
    case 'nanobanana':
    case 'veo':
      return 'google_ai';
  }
}

function normalizeImageModelProvider(value: unknown): ImageModelProvider | undefined {
  return value === 'gemini' || value === 'custom' ? value : undefined;
}

function isCustomImageProviderRequest(
  env: ControllerContext['env'],
  service: GenerationBillingService,
  context: ByokBillingContext
): boolean {
  return service === 'nanobanana' && context.modelProvider === 'custom' && Boolean(env.CUSTOM_MODEL_ENDPOINT);
}

async function hasByokForBillingService(
  env: ControllerContext['env'],
  userId: number,
  service: GenerationBillingService,
  context: ByokBillingContext = {}
): Promise<boolean> {
  if (isCustomImageProviderRequest(env, service, context)) {
    return false;
  }
  return hasStoredProviderApiKey(env.DB, userId, getByokProviderForBillingService(service));
}

function countPromptCharacters(prompt: string | undefined): number {
  if (!prompt) return 0;
  return Array.from(prompt).length;
}

function getElevenLabsAudioUsage(audioUsage: AudioUsage | null | undefined, prompt: string | undefined): AudioUsage {
  if (audioUsage?.totalTokens && audioUsage.totalTokens > 0) {
    return audioUsage;
  }

  const promptCharacters = countPromptCharacters(prompt);
  const totalTokens = promptCharacters > 0 ? promptCharacters : 1;
  return {
    inputTokens: totalTokens,
    outputTokens: 0,
    totalTokens,
  };
}

function parseObjectMetadata(value: Record<string, unknown> | string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
  return value;
}

function isByokProviderMetadata(value: Record<string, unknown> | string | null | undefined): boolean {
  return parseObjectMetadata(value)?.keySource === 'byok';
}

function toPositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

function getRecipeGenerateAudio(recipe: Pick<GenerationRecipe, 'generateAudio'> & { audio?: unknown }): boolean | undefined {
  return toBoolean(recipe.generateAudio) ?? toBoolean(recipe.audio);
}

function parseRecipeGenerateAudio(recipeJson: string | null | undefined): boolean | undefined {
  if (!recipeJson) return undefined;
  try {
    const parsed = JSON.parse(recipeJson) as Pick<GenerationRecipe, 'generateAudio'> & { audio?: unknown };
    return getRecipeGenerateAudio(parsed);
  } catch {
    return undefined;
  }
}

function getVideoBillingDimensions(data: {
  mediaDurationMs?: number | null;
  providerMetadata?: Record<string, unknown> | string | null;
}, variant: Variant): VideoBillingDimensions {
  const metadata = parseObjectMetadata(data.providerMetadata) ?? parseObjectMetadata(variant.provider_metadata);
  const resolution = typeof metadata?.resolution === 'string' ? metadata.resolution : undefined;
  const metadataDurationSeconds = toPositiveNumber(metadata?.durationSeconds)
    ?? toPositiveNumber(metadata?.duration_seconds);
  const dataDurationMs = toPositiveNumber(data.mediaDurationMs);
  const variantDurationMs = toPositiveNumber(variant.media_duration_ms);
  const durationSeconds = metadataDurationSeconds
    ?? (dataDurationMs === undefined ? undefined : Math.round(dataDurationMs / 1000))
    ?? (variantDurationMs === undefined ? undefined : Math.round(variantDurationMs / 1000));

  const metadataGenerateAudio = toBoolean(metadata?.generateAudio) ?? toBoolean(metadata?.generate_audio);
  return {
    resolution,
    durationSeconds,
    generateAudio: metadataGenerateAudio ?? parseRecipeGenerateAudio(variant.recipe) ?? VIDEO_GENERATION_AUDIO_ALWAYS_ON,
  };
}

function getMetadataString(metadata: Record<string, unknown> | null, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

function getProviderUsageAttribution(
  spaceId: string,
  variant: Variant,
  data: {
    requestId?: string | null;
    providerMetadata?: Record<string, unknown> | string | null;
  }
): ProviderUsageAttribution | undefined {
  const providerMetadata = parseObjectMetadata(data.providerMetadata) ?? parseObjectMetadata(variant.provider_metadata);
  if (getMetadataString(providerMetadata, 'provider') === 'fake') {
    return undefined;
  }

  return {
    spaceId,
    assetId: variant.asset_id,
    variantId: variant.id,
    workflowId: variant.workflow_id,
    requestId: data.requestId ?? null,
    mediaKind: variant.media_kind,
    provider: getMetadataString(providerMetadata, 'provider'),
    providerModel: getMetadataString(providerMetadata, 'model'),
    providerRequestId: getMetadataString(providerMetadata, 'providerRequestId', 'provider_request_id'),
    providerResponseId: getMetadataString(providerMetadata, 'providerResponseId', 'provider_response_id'),
    providerUsageId: getMetadataString(providerMetadata, 'providerUsageId', 'provider_usage_id'),
  };
}

function getQuotaCheckQuantity(
  service: GenerationBillingService,
  prompt: string | undefined,
  count = 1,
  assetType?: string,
  generateAudio?: boolean
): number {
  const requestedCount = Math.max(1, Math.floor(count));
  if (service === 'veo') {
    return getVideoQuotaUnits(requestedCount, generateAudio);
  }
  if (service !== 'elevenlabs') {
    return requestedCount;
  }
  const promptCharacters = getElevenLabsAudioUsage(undefined, prompt).totalTokens;
  const generatedAudioEstimate = promptCharacters + ELEVENLABS_GENERATED_AUDIO_COST_BUFFER;
  const perRequestQuantity = assetType === 'music' || assetType === 'sfx'
    ? generatedAudioEstimate
    : promptCharacters;
  return perRequestQuantity * requestedCount;
}

function getVideoGenerateAudio(mediaKind?: string | null, requestedGenerateAudio?: boolean): boolean | undefined {
  return mediaKind === 'video'
    ? requestedGenerateAudio ?? VIDEO_GENERATION_AUDIO_ALWAYS_ON
    : requestedGenerateAudio;
}

function getGenerationLimitErrorCode(
  denyReason: GenerationLimitDenyReason | undefined
): 'RATE_LIMITED' | 'PAID_GENERATION_REQUIRED' | 'PLATFORM_LIMIT_EXCEEDED' | 'PROVIDER_KEY_REQUIRED' | 'QUOTA_EXCEEDED' {
  if (denyReason === 'rate_limited') return 'RATE_LIMITED';
  if (denyReason === 'paid_generation_required') return 'PAID_GENERATION_REQUIRED';
  if (denyReason === 'platform_limit_exceeded') return 'PLATFORM_LIMIT_EXCEEDED';
  if (denyReason === 'provider_key_required') return 'PROVIDER_KEY_REQUIRED';
  return 'QUOTA_EXCEEDED';
}

function getElevenLabsModelForEstimate(
  env: ControllerContext['env'],
  assetType?: string
): string {
  if (assetType === 'music') {
    return env.ELEVENLABS_MUSIC_MODEL_ID || DEFAULT_ELEVENLABS_MUSIC_MODEL_ID;
  }
  if (assetType === 'sfx') {
    return env.ELEVENLABS_SOUND_EFFECT_MODEL_ID || DEFAULT_ELEVENLABS_SFX_MODEL_ID;
  }
  return env.ELEVENLABS_MODEL_ID || DEFAULT_ELEVENLABS_SPEECH_MODEL_ID;
}

function getVideoModelForEstimate(model?: string, videoTier?: string): string {
  if (model) return model;
  const normalizedTier = normalizeVideoGenerationTier(videoTier);
  return normalizedTier ? getVideoGenerationModelForTier(normalizedTier) : DEFAULT_VIDEO_GENERATION_MODEL;
}

function getImageModelForEstimate(model?: string): string {
  if (!model) return DEFAULT_IMAGE_MODEL_ID;
  if (isImageModelSelection(model)) return resolveImageModelSelection(model);
  if (isImageModelId(model)) return model;
  return model;
}

function estimateProviderPricing(
  env: ControllerContext['env'],
  input: {
    service: GenerationBillingService;
    quantity: number;
    model?: string;
    operation?: string;
    imageSize?: string;
    assetType?: string;
    videoResolution?: string;
    videoDurationSeconds?: number;
    generateAudio?: boolean;
    videoTier?: string;
  }
): ProviderPricingResult {
  const eventName = getQuotaEventNameForBillingService(input.service);
  const requestedQuantity = Math.max(1, Math.floor(input.quantity));
  const metadata: Record<string, unknown> = { operation: input.operation };

  if (input.service === 'nanobanana') {
    metadata.model = getImageModelForEstimate(input.model);
    metadata.imageSize = input.imageSize;
  } else if (input.service === 'veo') {
    metadata.model = getVideoModelForEstimate(input.model, input.videoTier);
    metadata.resolution = input.videoResolution;
    metadata.duration_seconds = input.videoDurationSeconds;
    metadata.generate_audio = input.generateAudio ?? VIDEO_GENERATION_AUDIO_ALWAYS_ON;
    metadata.video_count = 1;
  } else if (input.service === 'lyria') {
    metadata.provider = 'lyria';
    metadata.model = input.model || env.LYRIA_MODEL_ID || DEFAULT_LYRIA_MODEL_ID;
    metadata.asset_type = input.assetType;
  } else {
    metadata.provider = 'elevenlabs';
    metadata.model = input.model || getElevenLabsModelForEstimate(env, input.assetType);
    metadata.asset_type = input.assetType;
  }

  const price = priceProviderUsageEvent({
    eventName,
    quantity: requestedQuantity,
    metadata,
  });
  return price;
}

function serializeProviderPricing(price: ProviderPricingResult): GenerationUsageEstimate['providerPricing'] {
  return {
    provider: price.provider,
    model: price.model,
    unit: price.unit,
    quantity: price.quantity,
    unitPriceUsd: 'unitPriceUsd' in price ? price.unitPriceUsd : undefined,
    catalogVersion: price.catalogVersion,
    pricingSource: 'pricingSource' in price ? price.pricingSource : undefined,
    pricingReason: 'reason' in price ? price.reason : undefined,
  };
}

type GenerationPreflightInput = {
  env: ControllerContext['env'];
  spaceId: string;
  userId: number;
  billingService: GenerationBillingService;
  byokContext: ByokBillingContext;
  quotaQuantity: number;
  rateLimitQuantity: number;
  mediaKind?: 'image' | 'audio' | 'video' | null;
  assetType?: string;
  model?: string;
  operation?: string;
  imageSize?: string;
  videoResolution?: string;
  videoDurationSeconds?: number;
  generateAudio?: boolean;
  videoTier?: string;
};

async function buildGenerationUsageEstimate(input: GenerationPreflightInput & {
  operationKind: GenerationUsageEstimate['operation'];
}): Promise<GenerationUsageEstimate> {
  const byok = await hasByokForBillingService(input.env, input.userId, input.billingService, input.byokContext);
  const providerPricing = estimateProviderPricing(input.env, {
    service: input.billingService,
    quantity: input.quotaQuantity,
    model: input.model,
    operation: input.operation,
    imageSize: input.imageSize,
    assetType: input.assetType,
    videoResolution: input.videoResolution,
    videoDurationSeconds: input.videoDurationSeconds,
    generateAudio: input.generateAudio,
    videoTier: input.videoTier,
  });
  const base: GenerationUsageEstimate = {
    operation: input.operationKind,
    mediaKind: input.mediaKind ?? 'image',
    billingMode: byok ? 'byok' : 'managed',
    billingService: input.billingService,
    meterEventName: getQuotaEventNameForBillingService(input.billingService) as GenerationUsageEstimate['meterEventName'],
    quotaQuantity: input.quotaQuantity,
    rateLimitQuantity: input.rateLimitQuantity,
    platformWorkflowRuns: input.rateLimitQuantity,
    providerCostMicroUsd: byok ? 0 : providerPricing.amountMicroUsd,
    providerCostUsd: byok ? 0 : providerPricing.amountUsd,
    currency: 'USD',
    providerPricing: serializeProviderPricing(providerPricing),
    allowed: true,
  };

  if (!byok) {
    const check = await preCheck(
      input.env.DB,
      input.userId,
      input.billingService,
      undefined,
      input.quotaQuantity,
      input.rateLimitQuantity,
      input.env.ADMIN_USER_IDS
    );
    base.quota = {
      used: check.quotaUsed,
      limit: check.quotaLimit,
      remaining: check.quotaRemaining,
      requested: input.quotaQuantity,
    };
    base.rateLimit = {
      used: check.rateLimitUsed,
      limit: check.rateLimitMax,
      remaining: check.rateLimitRemaining,
      requested: input.rateLimitQuantity,
    };
    if (!check.allowed) {
      return {
        ...base,
        allowed: false,
        denyReason: check.denyReason,
        denyMessage: check.denyMessage,
        denyCode: getGenerationLimitErrorCode(check.denyReason),
      };
    }
  }

  const guardrail = await checkGenerationGuardrails(input.env.DB, {
    userId: input.userId,
    spaceId: input.spaceId,
    mode: byok ? 'byok' : 'managed',
    service: input.billingService,
    requestedRateLimitQuantity: byok ? input.rateLimitQuantity : 0,
    requestedProviderCostMicroUsd: byok
      ? 0
      : providerPricing.amountMicroUsd,
    requestedPlatformUsage: [{ usageType: 'workflow', quantity: input.rateLimitQuantity }],
    mediaKind: input.mediaKind ?? null,
    adminUserIds: input.env.ADMIN_USER_IDS,
  });
  if (!guardrail.allowed) {
    return {
      ...base,
      allowed: false,
      denyReason: guardrail.denyReason,
      denyMessage: guardrail.denyMessage,
      denyCode: getGenerationLimitErrorCode(guardrail.denyReason),
    };
  }

  return base;
}

async function preflightGenerationAdmission(input: GenerationPreflightInput): Promise<{ allowed: true } | { allowed: false; denyReason?: GenerationLimitDenyReason; denyMessage?: string }> {
  const estimate = await buildGenerationUsageEstimate({ ...input, operationKind: 'generate' });
  if (!estimate.allowed) {
    return {
      allowed: false,
      denyReason: estimate.denyReason as GenerationLimitDenyReason | undefined,
      denyMessage: estimate.denyMessage,
    };
  }
  await incrementRateLimit(input.env.DB, input.userId, input.rateLimitQuantity);
  return { allowed: true };
}

export class GenerationController extends BaseController {
  private readonly variantFactory: VariantFactory;
  private rotationCtrl?: RotationController;
  private tileCtrl?: TileController;

  constructor(ctx: ControllerContext) {
    super(ctx);
    this.variantFactory = new VariantFactory(ctx.spaceId, ctx.repo, ctx.env, ctx.broadcast);
  }

  /** Set pipeline controllers (called after all controllers are initialized to avoid circular deps) */
  setPipelineControllers(rotation: RotationController, tile: TileController): void {
    this.rotationCtrl = rotation;
    this.tileCtrl = tile;
  }

  // ==========================================================================
  // WebSocket Handlers - Workflow Triggers
  // ==========================================================================

  async handleGenerationEstimateRequest(
    ws: WebSocket,
    meta: WebSocketMeta,
    msg: GenerationEstimateRequestMessage
  ): Promise<void> {
    this.requireEditor(meta);

    let assetType = msg.assetType;
    let mediaKind = msg.mediaKind;
    if ((msg.operation === 'refine' || (!assetType && msg.assetId)) && msg.assetId) {
      const asset = await this.repo.getAssetById(msg.assetId);
      if (!asset) {
        this.send(ws, {
          type: 'generation:estimate',
          requestId: msg.requestId,
          success: false,
          error: 'Asset not found',
          code: 'ASSET_NOT_FOUND',
        });
        return;
      }
      assetType = assetType ?? asset.type;
      mediaKind = mediaKind ?? asset.media_kind;
    }

    const count = msg.operation === 'batch' ? Math.max(1, Math.floor(msg.count ?? 1)) : 1;
    const billingService = getGenerationBillingService(this.env, mediaKind, assetType, msg.musicProvider);
    const quotaQuantity = getQuotaCheckQuantity(
      billingService,
      msg.prompt,
      count,
      assetType,
      getVideoGenerateAudio(mediaKind, msg.generateAudio)
    );
    const userId = parseInt(meta.userId);
    const estimate = await buildGenerationUsageEstimate({
      env: this.env,
      spaceId: this.spaceId,
      userId,
      billingService,
      byokContext: { modelProvider: normalizeImageModelProvider(msg.modelProvider) },
      quotaQuantity,
      rateLimitQuantity: count,
      mediaKind: mediaKind ?? 'image',
      assetType,
      model: msg.model,
      operation: msg.operation === 'batch' ? 'generate' : msg.operation,
      operationKind: msg.operation,
      imageSize: msg.imageSize,
      videoResolution: msg.videoResolution,
      videoDurationSeconds: msg.videoDurationSeconds,
      generateAudio: getVideoGenerateAudio(mediaKind, msg.generateAudio),
      videoTier: msg.videoTier,
    });

    this.send(ws, {
      type: 'generation:estimate',
      requestId: msg.requestId,
      success: true,
      estimate,
    });
  }

  /**
   * Handle generate:request WebSocket message
   * Creates asset, placeholder variant, lineage, then triggers workflow
   */
  async handleGenerateRequest(
    ws: WebSocket,
    meta: WebSocketMeta,
    msg: GenerateRequestMessage
  ): Promise<void> {
    this.requireEditor(meta);

    if (!this.env.GENERATION_WORKFLOW) {
      throw new ValidationError('Generation workflow not configured');
    }

    const modelProvider = normalizeImageModelProvider(msg.modelProvider);

    // Check quota and rate limits before triggering workflow
    if (this.env.DB) {
      const billingService = getGenerationBillingService(this.env, msg.mediaKind, msg.assetType, msg.musicProvider);
      const quotaQuantity = getQuotaCheckQuantity(
        billingService,
        msg.prompt,
        1,
        msg.assetType,
        getVideoGenerateAudio(msg.mediaKind, msg.generateAudio)
      );
      const userId = parseInt(meta.userId);
      const check = await preflightGenerationAdmission({
        env: this.env,
        spaceId: this.spaceId,
        userId,
        billingService,
        byokContext: { modelProvider },
        quotaQuantity,
        rateLimitQuantity: 1,
        mediaKind: msg.mediaKind,
        assetType: msg.assetType,
        model: msg.model,
        operation: 'generate',
        imageSize: msg.imageSize,
        videoResolution: msg.videoResolution,
        videoDurationSeconds: msg.videoDurationSeconds,
        generateAudio: getVideoGenerateAudio(msg.mediaKind, msg.generateAudio),
        videoTier: msg.videoTier,
      });
      if (!check.allowed) {
        this.send(ws, {
          type: 'generate:error',
          requestId: msg.requestId,
          error: check.denyMessage || 'Request denied',
          code: getGenerationLimitErrorCode(check.denyReason),
        });
        return;
      }
    }

    // Use factory to create asset + variant + lineage
    const result = await this.variantFactory.createAssetWithVariant(
      {
        name: msg.name,
        assetType: msg.assetType,
        mediaKind: msg.mediaKind,
        prompt: msg.prompt,
        aspectRatio: msg.aspectRatio,
        model: msg.model,
        imageSize: msg.imageSize,
        parentAssetId: msg.parentAssetId,
        referenceAssetIds: msg.referenceAssetIds,
        referenceVariantIds: msg.referenceVariantIds,
        disableStyle: msg.disableStyle,
        stylePresetId: msg.stylePresetId,
        styleVariantIds: msg.styleVariantIds,
        voiceId: msg.voiceId,
        dialogueVoiceIds: msg.dialogueVoiceIds,
        musicProvider: msg.musicProvider,
        generateAudio: msg.generateAudio,
        videoResolution: msg.videoResolution,
        videoDurationSeconds: msg.videoDurationSeconds,
        videoTier: msg.videoTier,
        modelProvider,
      },
      meta
    );

    // Send generate:started so requestId can be correlated with variantId
    this.broadcast({
      type: 'generate:started',
      requestId: msg.requestId,
      jobId: result.variantId,
      assetId: result.assetId,
      assetName: msg.name,
    });

    // Determine operation and trigger workflow
    const operation = determineOperation(result.parentVariantIds.length > 0);
    await this.variantFactory.triggerWorkflow(
      msg.requestId,
      result.variantId,
      result,
      meta,
      operation
    );
  }

  /**
   * Handle refine:request WebSocket message
   * Creates placeholder variant, lineage, then triggers workflow for refinement
   */
  async handleRefineRequest(
    ws: WebSocket,
    meta: WebSocketMeta,
    msg: RefineRequestMessage
  ): Promise<void> {
    this.requireEditor(meta);

    if (!this.env.GENERATION_WORKFLOW) {
      throw new ValidationError('Generation workflow not configured');
    }

    const modelProvider = normalizeImageModelProvider(msg.modelProvider);

    // Check quota and rate limits before triggering workflow
    if (this.env.DB) {
      let billingMediaKind = msg.mediaKind;
      let billingAssetType: string | undefined;
      if (!billingMediaKind || billingMediaKind === 'audio') {
        const asset = await this.repo.getAssetById(msg.assetId);
        if (!asset) {
          throw new NotFoundError('Asset not found');
        }
        billingMediaKind = billingMediaKind ?? asset.media_kind;
        billingAssetType = asset.type;
      }
      const billingService = getGenerationBillingService(this.env, billingMediaKind, billingAssetType, msg.musicProvider);
      const quotaQuantity = getQuotaCheckQuantity(
        billingService,
        msg.prompt,
        1,
        billingAssetType,
        getVideoGenerateAudio(billingMediaKind, msg.generateAudio)
      );
      const userId = parseInt(meta.userId);
      const check = await preflightGenerationAdmission({
        env: this.env,
        spaceId: this.spaceId,
        userId,
        billingService,
        byokContext: { modelProvider },
        quotaQuantity,
        rateLimitQuantity: 1,
        mediaKind: billingMediaKind,
        assetType: billingAssetType,
        model: msg.model,
        operation: 'refine',
        imageSize: msg.imageSize,
        videoResolution: msg.videoResolution,
        videoDurationSeconds: msg.videoDurationSeconds,
        generateAudio: getVideoGenerateAudio(billingMediaKind, msg.generateAudio),
        videoTier: msg.videoTier,
      });
      if (!check.allowed) {
        this.send(ws, {
          type: 'refine:error',
          requestId: msg.requestId,
          error: check.denyMessage || 'Request denied',
          code: getGenerationLimitErrorCode(check.denyReason),
        });
        return;
      }
    }

    // Use factory to create refine variant + lineage
    const result = await this.variantFactory.createRefineVariant(
      {
        assetId: msg.assetId,
        mediaKind: msg.mediaKind,
        prompt: msg.prompt,
        aspectRatio: msg.aspectRatio,
        model: msg.model,
        imageSize: msg.imageSize,
        sourceVariantId: msg.sourceVariantId,
        sourceVariantIds: msg.sourceVariantIds,
        referenceAssetIds: msg.referenceAssetIds,
        disableStyle: msg.disableStyle,
        stylePresetId: msg.stylePresetId,
        styleVariantIds: msg.styleVariantIds,
        voiceId: msg.voiceId,
        dialogueVoiceIds: msg.dialogueVoiceIds,
        musicProvider: msg.musicProvider,
        generateAudio: msg.generateAudio,
        videoResolution: msg.videoResolution,
        videoDurationSeconds: msg.videoDurationSeconds,
        videoTier: msg.videoTier,
        modelProvider,
      },
      meta
    );

    // Send refine:started so requestId can be correlated with variantId
    this.broadcast({
      type: 'refine:started',
      requestId: msg.requestId,
      jobId: result.variantId,
      assetId: msg.assetId,
      assetName: result.asset.name,
    });

    // Trigger workflow
    await this.variantFactory.triggerWorkflow(
      msg.requestId,
      result.variantId,
      result,
      meta,
      'refine'
    );
  }

  /**
   * Handle batch:request WebSocket message
   * Creates multiple variants/assets and triggers workflows in parallel
   */
  async handleBatchRequest(
    ws: WebSocket,
    meta: WebSocketMeta,
    msg: BatchRequestMessage
  ): Promise<void> {
    this.requireEditor(meta);

    if (!this.env.GENERATION_WORKFLOW) {
      throw new ValidationError('Generation workflow not configured');
    }

    // Validate count
    if (msg.count < 2 || msg.count > 8) {
      throw new ValidationError('Batch count must be between 2 and 8');
    }

    if (msg.mediaKind === 'video') {
      this.send(ws, {
        type: 'batch:error',
        requestId: msg.requestId,
        error: 'Video batch generation is not supported',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const modelProvider = normalizeImageModelProvider(msg.modelProvider);

    // Check quota for the entire batch
    if (this.env.DB) {
      const billingService = getGenerationBillingService(this.env, msg.mediaKind, msg.assetType, msg.musicProvider);
      const quotaQuantity = getQuotaCheckQuantity(billingService, msg.prompt, msg.count, msg.assetType);
      const userId = parseInt(meta.userId);
      const check = await preflightGenerationAdmission({
        env: this.env,
        spaceId: this.spaceId,
        userId,
        billingService,
        byokContext: { modelProvider },
        quotaQuantity,
        rateLimitQuantity: msg.count,
        mediaKind: msg.mediaKind,
        assetType: msg.assetType,
        model: msg.model,
        operation: 'generate',
        imageSize: msg.imageSize,
      });
      if (!check.allowed) {
        this.send(ws, {
          type: 'batch:error',
          requestId: msg.requestId,
          error: check.denyMessage || 'Request denied',
          code: getGenerationLimitErrorCode(check.denyReason),
        });
        return;
      }
    }

    // Use factory to create batch variants
    const { batchId, results } = await this.variantFactory.createBatchVariants(
      {
        name: msg.name,
        assetType: msg.assetType,
        mediaKind: msg.mediaKind,
        prompt: msg.prompt,
        aspectRatio: msg.aspectRatio,
        model: msg.model,
        imageSize: msg.imageSize,
        parentAssetId: msg.parentAssetId,
        referenceAssetIds: msg.referenceAssetIds,
        referenceVariantIds: msg.referenceVariantIds,
        disableStyle: msg.disableStyle,
        stylePresetId: msg.stylePresetId,
        styleVariantIds: msg.styleVariantIds,
        voiceId: msg.voiceId,
        dialogueVoiceIds: msg.dialogueVoiceIds,
        musicProvider: msg.musicProvider,
        count: msg.count,
        mode: msg.mode,
        modelProvider,
      },
      meta
    );

    // Broadcast batch:started
    this.broadcast({
      type: 'batch:started',
      requestId: msg.requestId,
      batchId,
      jobIds: results.map(r => r.variantId),
      assetIds: [...new Set(results.map(r => r.assetId))],
      count: msg.count,
      mode: msg.mode,
    });

    // Trigger all workflows in parallel
    await this.variantFactory.triggerBatchWorkflows(
      msg.requestId,
      results,
      meta,
      results[0]?.styleImageKeys
    );
  }

  /**
   * Handle variant:retry WebSocket message
   * Retries a failed variant generation
   */
  async handleRetryRequest(
    ws: WebSocket,
    meta: WebSocketMeta,
    variantId: string
  ): Promise<void> {
    this.requireEditor(meta);

    if (!this.env.GENERATION_WORKFLOW) {
      throw new ValidationError('Generation workflow not configured');
    }

    // Get the failed variant
    const variant = await this.repo.getVariantById(variantId);
    if (!variant) {
      throw new NotFoundError('Variant not found');
    }

    if (variant.status !== 'failed') {
      throw new ValidationError('Can only retry failed variants');
    }

    // Parse the recipe to get original generation params
    let recipe: GenerationRecipe;
    try {
      recipe = JSON.parse(variant.recipe) as GenerationRecipe;
    } catch {
      throw new ValidationError('Invalid recipe format');
    }

    // Get the asset
    const asset = await this.repo.getAssetById(variant.asset_id);
    if (!asset) {
      throw new NotFoundError('Asset not found');
    }

    const retryMediaKind = variant.media_kind ?? asset.media_kind;
    const billingService = getGenerationBillingService(this.env, retryMediaKind, recipe.assetType, recipe.musicProvider);
    if (this.env.DB) {
      const quotaQuantity = getQuotaCheckQuantity(
        billingService,
        recipe.prompt,
        1,
        recipe.assetType,
        getVideoGenerateAudio(retryMediaKind, getRecipeGenerateAudio(recipe))
      );
      const userId = parseInt(meta.userId);
      const check = await preflightGenerationAdmission({
        env: this.env,
        spaceId: this.spaceId,
        userId,
        billingService,
        byokContext: { modelProvider: recipe.modelProvider },
        quotaQuantity,
        rateLimitQuantity: 1,
        mediaKind: retryMediaKind,
        assetType: recipe.assetType,
        model: recipe.model,
        operation: recipe.operation,
        imageSize: recipe.imageSize,
        videoResolution: recipe.videoResolution,
        videoDurationSeconds: recipe.videoDurationSeconds,
        generateAudio: getVideoGenerateAudio(retryMediaKind, getRecipeGenerateAudio(recipe)),
        videoTier: recipe.videoTier,
      });
      if (!check.allowed) {
        this.sendError(
          ws,
          getGenerationLimitErrorCode(check.denyReason),
          check.denyMessage || 'Request denied'
        );
        return;
      }
    }

    // Reset variant for retry
    const resetVariant = await this.repo.resetVariantForRetry(variantId);
    if (!resetVariant) {
      throw new NotFoundError('Failed to reset variant');
    }

    // Broadcast the reset
    this.broadcast({ type: 'variant:updated', variant: resetVariant });

    // Build workflow input from stored recipe
    const workflowInput: GenerationWorkflowInput = {
      requestId: crypto.randomUUID(),
      jobId: variantId,
      spaceId: this.spaceId,
      userId: meta.userId,
      prompt: recipe.prompt,
      assetId: variant.asset_id,
      assetName: asset.name,
      assetType: recipe.assetType,
      mediaKind: retryMediaKind,
      model: recipe.model,
      aspectRatio: recipe.aspectRatio,
      imageSize: recipe.imageSize,
      sourceImageKeys: recipe.sourceImageKeys,
      parentVariantIds: recipe.parentVariantIds,
      styleImageKeys: recipe.styleImageKeys,
      stylePresetId: recipe.stylePresetId,
      styleCollectionId: recipe.styleCollectionId,
      styleReferenceVariantIds: recipe.styleReferenceVariantIds,
      styleReferenceImageKeys: recipe.styleReferenceImageKeys,
      stylePrompt: recipe.stylePrompt,
      veoReferenceMode: recipe.veoReferenceMode,
      videoResolution: recipe.videoResolution,
      videoDurationSeconds: recipe.videoDurationSeconds,
      videoTier: recipe.videoTier,
      generateAudio: recipe.generateAudio,
      operation: recipe.operation,
      modelProvider: recipe.modelProvider,
      voiceId: recipe.voiceId,
      dialogueVoiceIds: recipe.dialogueVoiceIds?.length ? recipe.dialogueVoiceIds : undefined,
      musicProvider: recipe.musicProvider,
    };

    // Trigger the workflow
    const instance = await this.env.GENERATION_WORKFLOW.create({
      id: variantId,
      params: workflowInput,
    });

    // Update variant with new workflow ID
    const updatedVariant = await this.repo.updateVariantWorkflow(variantId, instance.id, 'processing');
    if (updatedVariant) {
      this.broadcast({ type: 'variant:updated', variant: updatedVariant });
    }

    log.info('Retrying variant', {
      spaceId: this.spaceId,
      userId: meta.userId,
      variantId,
      operation: recipe.operation,
      workflowId: instance.id,
    });
  }

  // ==========================================================================
  // HTTP Handlers - Variant Lifecycle (GenerationWorkflow)
  // ==========================================================================

  /**
   * Handle POST /internal/variant/status HTTP request
   * Updates a variant's status (e.g., pending → processing).
   * Called by GenerationWorkflow at workflow start.
   */
  async httpUpdateVariantStatus(data: {
    variantId: string;
    status: string;
  }): Promise<{ success: boolean }> {
    const variant = await this.repo.updateVariantStatus(data.variantId, data.status);
    if (!variant) {
      throw new NotFoundError('Variant not found');
    }

    // Broadcast the status update
    this.broadcast({ type: 'variant:updated', variant });

    return { success: true };
  }

  /**
   * Handle POST /internal/complete-variant HTTP request
   * Updates a placeholder variant with generated images.
   * Called by GenerationWorkflow when generation succeeds.
   * Tracks usage for successful generations.
   * If the variant was created by a plan step, completes the step.
   */
  async httpCompleteVariant(data: {
    variantId: string;
    imageKey?: string | null;
    thumbKey?: string | null;
    mediaKey?: string | null;
    mediaMimeType?: string | null;
    mediaSizeBytes?: number | null;
    mediaWidth?: number | null;
    mediaHeight?: number | null;
    mediaDurationMs?: number | null;
    transcriptKey?: string | null;
    transcriptMimeType?: string | null;
    transcriptSizeBytes?: number | null;
    wordTimingsKey?: string | null;
    wordTimingsMimeType?: string | null;
    wordTimingsSizeBytes?: number | null;
    renderMetadataKey?: string | null;
    renderMetadataMimeType?: string | null;
    renderMetadataSizeBytes?: number | null;
    providerMetadata?: Record<string, unknown> | string | null;
    requestId?: string | null;
    audioProvider?: string | null;
    audioModel?: string | null;
    audioUsage?: AudioUsage | null;
  }): Promise<{ success: boolean; variant: Variant }> {
    // Idempotency: if already completed with same keys, return success
    const existing = await this.repo.getVariantById(data.variantId);
    if (!existing) {
      throw new NotFoundError('Variant not found');
    }

    const imageKey = data.imageKey ?? null;
    const thumbKey = data.thumbKey ?? null;
    const mediaKey = data.mediaKey ?? imageKey;
    const existingMediaKey = existing.media_key ?? existing.image_key;

    if (
      existing.status === 'completed' &&
      existing.image_key === imageKey &&
      existing.thumb_key === thumbKey &&
      existingMediaKey === mediaKey
    ) {
      return { success: true, variant: existing };
    }
    if (hasAudioSidecarKeys(data) && existing.media_kind !== 'audio') {
      throw new ValidationError('Audio sidecars can only be attached to audio variants');
    }

    const mediaMetadata: VariantMediaMetadata = {
      mediaKey,
      mimeType: data.mediaMimeType,
      sizeBytes: data.mediaSizeBytes,
      width: data.mediaWidth,
      height: data.mediaHeight,
      durationMs: data.mediaDurationMs,
    };
    if (data.transcriptKey !== undefined) mediaMetadata.transcriptKey = data.transcriptKey;
    if (data.transcriptMimeType !== undefined) mediaMetadata.transcriptMimeType = data.transcriptMimeType;
    if (data.transcriptSizeBytes !== undefined) mediaMetadata.transcriptSizeBytes = data.transcriptSizeBytes;
    if (data.wordTimingsKey !== undefined) mediaMetadata.wordTimingsKey = data.wordTimingsKey;
    if (data.wordTimingsMimeType !== undefined) mediaMetadata.wordTimingsMimeType = data.wordTimingsMimeType;
    if (data.wordTimingsSizeBytes !== undefined) mediaMetadata.wordTimingsSizeBytes = data.wordTimingsSizeBytes;
    if (data.renderMetadataKey !== undefined) mediaMetadata.renderMetadataKey = data.renderMetadataKey;
    if (data.renderMetadataMimeType !== undefined) mediaMetadata.renderMetadataMimeType = data.renderMetadataMimeType;
    if (data.renderMetadataSizeBytes !== undefined) mediaMetadata.renderMetadataSizeBytes = data.renderMetadataSizeBytes;
    if (data.providerMetadata !== undefined) mediaMetadata.providerMetadata = data.providerMetadata;

    const variant = await this.repo.completeVariant(
      data.variantId,
      imageKey,
      thumbKey,
      mediaMetadata
    );

    if (!variant) {
      throw new NotFoundError('Variant not found');
    }
    const providerUsageAttribution = getProviderUsageAttribution(this.spaceId, variant, data);

    // Track usage for successful generation
    const byokGeneration = isByokProviderMetadata(data.providerMetadata) || isByokProviderMetadata(variant.provider_metadata);
    if (
      this.env.DB &&
      variant.created_by &&
      !byokGeneration &&
      (variant.media_kind === 'image' || variant.media_kind === 'video')
    ) {
      try {
        // Parse recipe to get operation type
        let operation = 'derive';
        let usageModel = DEFAULT_IMAGE_MODEL_ID;
        let imageSize: string | undefined;
        try {
          const recipe = JSON.parse(variant.recipe);
          // Handle legacy 'create'/'combine' operations
          const recipeOp = recipe.operation || 'derive';
          operation = recipeOp === 'create' || recipeOp === 'combine' ? 'derive' : recipeOp;
          if (typeof recipe.model === 'string' && recipe.model.length > 0) {
            usageModel = recipe.model;
          }
          if (typeof recipe.imageSize === 'string' && recipe.imageSize.length > 0) {
            imageSize = recipe.imageSize;
          }
        } catch {
          // Ignore parse errors
        }

        if (variant.media_kind === 'video') {
          const billingDimensions = getVideoBillingDimensions(data, variant);
          await trackVideoGeneration(
            this.env.DB,
            parseInt(variant.created_by),
            1,
            usageModel,
            operation,
            billingDimensions.resolution,
            billingDimensions.durationSeconds,
            billingDimensions.generateAudio,
            this.env.ADMIN_USER_IDS,
            providerUsageAttribution
          );
        } else {
          await trackImageGeneration(
            this.env.DB,
            parseInt(variant.created_by),
            1,
            usageModel,
            operation,
            imageSize,
            this.env.ADMIN_USER_IDS,
            providerUsageAttribution
          );
        }
      } catch (err) {
        log.warn('Failed to track generation usage', {
          spaceId: this.spaceId,
          variantId: data.variantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (
      this.env.DB &&
      variant.created_by &&
      !byokGeneration &&
      variant.media_kind === 'audio' &&
      data.audioProvider === 'elevenlabs'
    ) {
      try {
        let operation = 'generate';
        let assetType: string | undefined;
        let prompt: string | undefined;
        try {
          const recipe = JSON.parse(variant.recipe);
          operation = recipe.operation || operation;
          assetType = recipe.assetType;
          prompt = typeof recipe.prompt === 'string' ? recipe.prompt : undefined;
        } catch {
          // Ignore parse errors
        }

        const audioUsage = getElevenLabsAudioUsage(data.audioUsage, prompt);
        await trackElevenLabsAudioGeneration(
          this.env.DB,
          parseInt(variant.created_by),
          audioUsage.totalTokens,
          data.audioModel || 'unknown',
          operation,
          assetType,
          audioUsage,
          this.env.ADMIN_USER_IDS,
          providerUsageAttribution
        );
      } catch (err) {
        log.warn('Failed to track ElevenLabs audio usage', {
          spaceId: this.spaceId,
          variantId: data.variantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (
      this.env.DB &&
      variant.created_by &&
      !byokGeneration &&
      variant.media_kind === 'audio' &&
      data.audioProvider === 'lyria'
    ) {
      try {
        let operation = 'generate';
        let assetType: string | undefined;
        try {
          const recipe = JSON.parse(variant.recipe);
          operation = recipe.operation || operation;
          assetType = recipe.assetType;
        } catch {
          // Ignore parse errors
        }

        await trackGeminiAudioGeneration(
          this.env.DB,
          parseInt(variant.created_by),
          1,
          data.audioModel || 'unknown',
          operation,
          assetType,
          data.mediaDurationMs,
          data.audioUsage ?? undefined,
          this.env.ADMIN_USER_IDS,
          providerUsageAttribution
        );
      } catch (err) {
        log.warn('Failed to track Lyria audio usage', {
          spaceId: this.spaceId,
          variantId: data.variantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    try {
      await trackVariantStorageUsage(this.env.DB, this.env.IMAGES, {
        spaceId: this.spaceId,
        variant,
        reason: 'generated',
      });
    } catch (err) {
      log.warn('Failed to track generated storage usage', {
        spaceId: this.spaceId,
        variantId: data.variantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Broadcast the variant update
    this.broadcast({ type: 'variant:updated', variant });

    // Batch progress tracking
    if (variant.batch_id) {
      const progress = await this.repo.getBatchProgress(variant.batch_id);
      this.broadcast({
        type: 'batch:progress',
        batchId: variant.batch_id,
        completedCount: progress.completedCount,
        failedCount: progress.failedCount,
        totalCount: progress.totalCount,
        variant,
      });
      if (progress.pendingCount === 0) {
        this.broadcast({
          type: 'batch:completed',
          batchId: variant.batch_id,
          completedCount: progress.completedCount,
          failedCount: progress.failedCount,
          totalCount: progress.totalCount,
        });
      }
    }

    // Pipeline advancement hooks (rotation/tile sets)
    try {
      const rotView = await this.repo.getRotationViewByVariant(data.variantId);
      if (rotView && this.rotationCtrl) {
        await this.rotationCtrl.advanceRotation(rotView.rotation_set_id);
      }

      const tilePos = await this.repo.getTilePositionByVariant(data.variantId);
      if (tilePos && this.tileCtrl) {
        await this.tileCtrl.advanceTileSet(tilePos.tile_set_id);
      }

      // Single-shot grid/sheet slicing: the grid/sheet variant has no
      // tile_position or rotation_view, so the above hooks won't match.
      // Detect via recipe.generationMode and slice into individual cells.
      if (!rotView && !tilePos) {
        try {
          const recipe = JSON.parse(variant.recipe);
          if (recipe.generationMode === 'single-shot') {
            if (recipe.gridWidth && recipe.gridHeight && this.tileCtrl) {
              // Single-shot tile grid — slice into individual tile variants
              await this.tileCtrl.sliceSingleShotGrid(variant);
            } else if (recipe.gridLayout && this.rotationCtrl) {
              // Single-shot rotation sheet — slice into individual view variants
              await this.rotationCtrl.sliceSingleShotSheet(variant);
            }
          }
        } catch {
          // Not a single-shot variant or parse error — ignore
        }
      }
    } catch (hookErr) {
      log.error('Pipeline advancement hook failed', {
        variantId: data.variantId,
        error: hookErr instanceof Error ? hookErr.message : String(hookErr),
      });
      // Don't fail the variant completion for hook errors
    }

    return { success: true, variant };
  }

  /**
   * Handle POST /internal/fail-variant HTTP request
   * Marks a variant as failed with an error message.
   * Called by GenerationWorkflow when generation fails.
   */
  async httpFailVariant(data: {
    variantId: string;
    error: string;
  }): Promise<{ success: boolean; variant: Variant }> {
    const variant = await this.repo.failVariant(data.variantId, data.error);

    if (!variant) {
      throw new NotFoundError('Variant not found');
    }

    // Broadcast the variant update
    this.broadcast({ type: 'variant:updated', variant });

    // Also broadcast job:failed for frontend job tracking
    // Note: jobId === variantId (placeholder variant created before workflow starts)
    this.broadcast({ type: 'job:failed', jobId: data.variantId, error: data.error });

    // Batch progress tracking
    if (variant.batch_id) {
      const progress = await this.repo.getBatchProgress(variant.batch_id);
      this.broadcast({
        type: 'batch:progress',
        batchId: variant.batch_id,
        completedCount: progress.completedCount,
        failedCount: progress.failedCount,
        totalCount: progress.totalCount,
        variant,
      });
      if (progress.pendingCount === 0) {
        this.broadcast({
          type: 'batch:completed',
          batchId: variant.batch_id,
          completedCount: progress.completedCount,
          failedCount: progress.failedCount,
          totalCount: progress.totalCount,
        });
      }
    }

    // Pipeline failure hooks (rotation/tile sets)
    try {
      const rotView = await this.repo.getRotationViewByVariant(data.variantId);
      if (rotView && this.rotationCtrl) {
        await this.repo.failRotationSet(rotView.rotation_set_id, data.error);
        this.broadcast({
          type: 'rotation:failed',
          rotationSetId: rotView.rotation_set_id,
          error: data.error,
          failedStep: rotView.step_index,
        });
      }

      const tilePos = await this.repo.getTilePositionByVariant(data.variantId);
      if (tilePos && this.tileCtrl) {
        // Mark individual tile position as failed (not the entire set)
        await this.repo.updateTilePositionStatus(tilePos.id, 'failed');
        this.broadcast({
          type: 'tileset:tile_failed',
          tileSetId: tilePos.tile_set_id,
          variantId: data.variantId,
          gridX: tilePos.grid_x,
          gridY: tilePos.grid_y,
          error: data.error,
        });
        // Continue pipeline — advance to next tile
        await this.tileCtrl.advanceTileSet(tilePos.tile_set_id);
      }
    } catch (hookErr) {
      log.error('Pipeline failure hook failed', {
        variantId: data.variantId,
        error: hookErr instanceof Error ? hookErr.message : String(hookErr),
      });
    }

    return { success: true, variant };
  }
}

function hasAudioSidecarKeys(data: {
  transcriptKey?: string | null;
  wordTimingsKey?: string | null;
  renderMetadataKey?: string | null;
}): boolean {
  return Boolean(data.transcriptKey || data.wordTimingsKey || data.renderMetadataKey);
}
