/**
 * GenerationWorkflow - Cloudflare Workflow for Gemini Image Generation
 *
 * User Operations (from ForgeTray):
 * - generate: Create new asset from prompt only (0 refs) → Gemini generate()
 * - derive: Create new asset using refs as inspiration → Gemini compose()
 * - refine: Add variant to existing asset (1 ref) → Gemini edit()
 * - refine: Add variant to existing asset (2+ refs) → Gemini compose()
 *
 * Flow (per architecture.md):
 * 1. SpaceDO creates placeholder variant (status='pending') before triggering workflow
 * 2. Workflow updates variant to 'processing' via DO internal endpoint
 * 3. Workflow fetches source images from R2 (for derive/refine operations)
 * 4. Workflow calls appropriate Gemini API (generate/edit/compose) with retries
 * 5. Workflow uploads result to R2 (full + thumbnail)
 * 6. Workflow calls DO /internal/complete-variant → status='completed'
 * 7. SpaceDO broadcasts variant:updated to WebSocket clients
 *
 * On failure: Workflow calls DO /internal/fail-variant → status='failed'
 * Retry: Client sends variant:retry → SpaceDO resets to 'pending', triggers new workflow
 */

import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import type { Env } from '../../core/types';
import type { GenerationWorkflowInput, GenerationWorkflowOutput, GeneratedVariant } from './types';
import {
  NanoBananaService,
  GeminiSafetyError,
  GeminiRecitationError,
  GeminiRateLimitError,
  type GenerationResult,
  type ImageInput,
  type ImageSize,
} from '../services/nanoBananaService';
import {
  GoogleVeoService,
  determineVeoReferenceMode,
  type VideoAspectRatio,
  type VideoDurationSeconds,
  type VideoModel,
  type VideoResolution,
} from '../services/googleVeoService';
import { CustomModelProvider } from '../services/customModelProvider';
import { FakeImageProvider } from '../services/fakeImageProvider';
import { DEFAULT_IMAGE_MODEL_ID, type ImageModelId } from '../../shared/imageGenerationOptions';
import type { ImageGenerationProvider } from '../services/imageProvider';
import { FakeAudioProvider } from '../services/fakeAudioProvider';
import type { AudioGenerationProvider, AudioGenerationResult, AudioSidecar } from '../services/audioProvider';
import {
  ElevenLabsApiError,
  ElevenLabsAudioProvider,
  ElevenLabsMusicProvider,
  ElevenLabsSoundEffectProvider,
} from '../services/elevenLabsAudioProvider';
import { LyriaApiError, LyriaMusicProvider } from '../services/lyriaMusicProvider';
import { arrayBufferToBase64 } from '../utils/image-utils';
import {
  uploadGeneratedMedia,
  type MediaUploadResult,
} from './generation-media-upload';
import { loggers } from '../../shared/logger';
import { DEFAULT_MEDIA_KIND } from '../../shared/websocket-types';
import {
  DEFAULT_VIDEO_GENERATION_DURATION_SECONDS,
  DEFAULT_VIDEO_GENERATION_RESOLUTION,
  getVideoGenerationModelForTier,
  getVideoGenerationTierForModel,
  isVideoGenerationResolutionSupportedForTier,
  normalizeVideoGenerationDurationSeconds,
  normalizeVideoGenerationResolution,
  normalizeVideoGenerationTier,
} from '../../shared/videoGenerationOptions';

const log = loggers.generationWorkflow;
const FAKE_VIDEO_MP4_BASE64 = 'ZmFrZSB2aWRlbw==';

function getAudioProviderId(providerName: string): string {
  return providerName.split(':', 1)[0] || providerName;
}

function getAudioExtensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/mp4':
      return 'm4a';
    case 'audio/aac':
      return 'aac';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/flac':
      return 'flac';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/webm':
      return 'webm';
    case 'audio/L16':
      return 'pcm';
    case 'audio/basic':
      return 'ulaw';
    default:
      return 'bin';
  }
}

export class GenerationWorkflow extends WorkflowEntrypoint<Env, GenerationWorkflowInput> {
  async run(event: WorkflowEvent<GenerationWorkflowInput>, step: WorkflowStep): Promise<GenerationWorkflowOutput> {
    const {
      requestId,
      jobId,
      spaceId,
      prompt,
      assetName,
      model,
      aspectRatio,
      imageSize,
      sourceImageKeys,
      operation,
      styleImageKeys,
      veoReferenceMode,
      videoResolution,
      videoDurationSeconds,
      videoTier,
      generateAudio,
      modelProvider,
      mediaKind: requestedMediaKind,
    } = event.payload;
    const mediaKind = requestedMediaKind ?? DEFAULT_MEDIA_KIND;

    const refCount = sourceImageKeys?.length || 0;
    log.info('Starting workflow', { requestId, jobId, spaceId, assetName, operation, mediaKind, refCount });

    // Step 1: Update variant status to processing via DO
    await step.do('update-variant-processing', async () => {
      await this.updateVariantStatus(spaceId, jobId, 'processing');
    });

    if (mediaKind === 'audio') {
      return this.runAudioWorkflow(event, step);
    }

    if (mediaKind !== 'image' && mediaKind !== 'video') {
      const error = `Generation workflow does not support ${mediaKind} media`;
      await this.handleFailure(spaceId, jobId, requestId, error);
      return { requestId, jobId, success: false, error };
    }

    // Step 2: Generate image with retries
    // Note: Source images are fetched inside this step to avoid persisting large blobs
    // in workflow state (which has SQLite size limits)
    // variantId === jobId (placeholder variant created before the workflow started).
    const variantId = jobId;
    // Generate AND upload to R2 in a single step. Binary payloads (image/video
    // bytes) must never be a step return value — Cloudflare caps step output at
    // 1 MiB. See src/backend/workflows/README.md.
    let uploadResult: MediaUploadResult;
    try {
      uploadResult = await step.do(mediaKind === 'video' ? 'generate-and-upload-video' : 'generate-and-upload-image', {
        retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
        timeout: mediaKind === 'video' ? '10 minutes' : '5 minutes',
      }, async () => {
        // Fetch source images inline (not as a separate step) to avoid
        // persisting large blobs in workflow state which has SQLite size limits
        const sourceImages: ImageInput[] = [];
        if (sourceImageKeys && sourceImageKeys.length > 0) {
          if (!this.env.IMAGES) {
            throw new Error('IMAGES R2 bucket not configured');
          }

          const fetchTimer = log.startTimer('Fetch source images', {
            requestId, jobId, imageCount: sourceImageKeys.length,
          });

          try {
            let totalBytes = 0;
            for (let i = 0; i < sourceImageKeys.length; i++) {
              const imageKey = sourceImageKeys[i];
              const imageObject = await this.env.IMAGES.get(imageKey);
              if (!imageObject) {
                throw new Error(`Source image not found: ${imageKey}`);
              }

              const buffer = await imageObject.arrayBuffer();
              totalBytes += buffer.byteLength;
              const base64 = arrayBufferToBase64(buffer);
              const mimeType = imageObject.httpMetadata?.contentType || 'image/png';

              // Label style reference images distinctly from content references
              const styleKeyCount = styleImageKeys?.length || 0;
              let label: string;
              if (styleKeyCount > 0 && i < styleKeyCount) {
                label = `Style ref ${i + 1}:`;
              } else {
                label = `Image ${i + 1 - styleKeyCount}:`;
              }

              sourceImages.push({
                data: base64,
                mimeType,
                label,
              });
            }
            fetchTimer(true, { totalBytes, imageCount: sourceImages.length });
          } catch (error) {
            fetchTimer(false, { error: error instanceof Error ? error.message : String(error) });
            throw error;
          }
        }

        if (mediaKind === 'video') {
          const useFakeProvider = this.env.INVENTORY_IMAGE_PROVIDER === 'fake';
          const normalizedVideoTier =
            normalizeVideoGenerationTier(videoTier) ?? getVideoGenerationTierForModel(model);
          const modelToUse = (model as VideoModel) || getVideoGenerationModelForTier(normalizedVideoTier);
          const aspectRatioToUse: VideoAspectRatio = aspectRatio === '9:16' ? '9:16' : '16:9';
          const resolutionToUse = (
            normalizeVideoGenerationResolution(videoResolution) ?? DEFAULT_VIDEO_GENERATION_RESOLUTION
          ) as VideoResolution;
          if (
            normalizedVideoTier &&
            !isVideoGenerationResolutionSupportedForTier(resolutionToUse, normalizedVideoTier)
          ) {
            throw new NonRetryableError('Video resolution 4k is not supported for the lite tier');
          }
          const durationSecondsToUse = (
            normalizeVideoGenerationDurationSeconds(videoDurationSeconds) ?? DEFAULT_VIDEO_GENERATION_DURATION_SECONDS
          ) as VideoDurationSeconds;
          const styleImageCount = styleImageKeys?.length || 0;
          const referenceModeToUse = veoReferenceMode ?? determineVeoReferenceMode(sourceImages.length, styleImageCount);
          const generateAudioToUse = generateAudio === true;

          const timer = log.startTimer('Veo video generation', {
            requestId,
            jobId,
            spaceId,
            operation,
            model: modelToUse,
            refCount: sourceImages.length,
          });

          try {
            const result = useFakeProvider
              ? {
                  videoData: FAKE_VIDEO_MP4_BASE64,
                  videoMimeType: 'video/mp4',
                  model: modelToUse,
                  aspectRatio: aspectRatioToUse,
                  resolution: resolutionToUse,
                  durationSeconds: durationSecondsToUse,
                  referenceMode: referenceModeToUse,
                  generateAudio: generateAudioToUse,
                }
              : await new GoogleVeoService(this.env.GOOGLE_AI_API_KEY ?? '').generate({
                  prompt,
                  model: modelToUse,
                  aspectRatio: aspectRatioToUse,
                  resolution: resolutionToUse,
                  durationSeconds: durationSecondsToUse,
                  sourceImages,
                  styleImageCount,
                  referenceMode: referenceModeToUse,
                  generateAudio: generateAudioToUse,
                });
            timer(true, { resultSize: result.videoData.length });
            // Upload in-step; never return raw video bytes (1 MiB step-output cap).
            return await uploadGeneratedMedia(this.env, result, {
              spaceId, variantId, operation, refCount, modelProvider, requestId, jobId,
            });
          } catch (error) {
            timer(false, { error: error instanceof Error ? error.message : String(error) });
            throw error;
          }
        }

        // Select image generation provider
        let provider: ImageGenerationProvider;
        const useFakeProvider = this.env.INVENTORY_IMAGE_PROVIDER === 'fake';

        if (useFakeProvider) {
          provider = new FakeImageProvider();
        } else if (modelProvider === 'custom' && this.env.CUSTOM_MODEL_ENDPOINT) {
          provider = new CustomModelProvider(
            this.env.CUSTOM_MODEL_ENDPOINT,
            this.env.CUSTOM_MODEL_API_KEY
          );
        } else {
          if (!this.env.GOOGLE_AI_API_KEY) {
            throw new Error('GOOGLE_AI_API_KEY not configured');
          }
          provider = new NanoBananaService(this.env.GOOGLE_AI_API_KEY);
        }
        const modelToUse = (model as ImageModelId | undefined) || DEFAULT_IMAGE_MODEL_ID;
        const aspectRatioToUse = (aspectRatio as '1:1' | '16:9' | '9:16' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '21:9') || '1:1';
        const imageSizeToUse = (imageSize as ImageSize) || undefined;

        // Determine which Gemini API to call based on operation and ref count
        // geminiApi is the actual API method, operation is the user's intent
        const geminiApi: 'generate' | 'edit' | 'compose' =
          sourceImages.length === 0 ? 'generate' :
          (operation === 'refine' && sourceImages.length === 1) ? 'edit' :
          'compose';

        const timer = log.startTimer('Gemini image generation', {
          requestId, jobId, spaceId, operation, geminiApi, model: modelToUse, refCount: sourceImages.length,
        });

        log.info('Calling Gemini API', {
          requestId, jobId, operation, geminiApi, refCount: sourceImages.length,
        });

        try {
          // Call the appropriate Gemini API:
          // - generate(): pure text-to-image (0 refs)
          // - edit(): single image modification (refine with 1 ref)
          // - compose(): multi-image generation (derive or refine with 2+ refs)
          let result: GenerationResult;
          if (geminiApi === 'edit') {
            result = await provider.edit({
              image: sourceImages[0],
              prompt,
              model: modelToUse,
              aspectRatio: aspectRatioToUse,
              imageSize: imageSizeToUse,
            });
          } else if (geminiApi === 'compose') {
            result = await provider.compose({
              images: sourceImages,
              prompt,
              model: modelToUse,
              aspectRatio: aspectRatioToUse,
              imageSize: imageSizeToUse,
            });
          } else {
            result = await provider.generate({
              prompt,
              model: modelToUse,
              aspectRatio: aspectRatioToUse,
              imageSize: imageSizeToUse,
            });
          }
          timer(true, { resultSize: result.imageData?.length || 0, geminiApi });
          // Upload in-step; never return raw image bytes (1 MiB step-output cap).
          return await uploadGeneratedMedia(this.env, result, {
            spaceId, variantId, operation, refCount, modelProvider, requestId, jobId,
          });
        } catch (error) {
          timer(false, { error: error instanceof Error ? error.message : String(error) });

          // Safety and recitation errors should NOT be retried — the prompt itself is the problem
          if (error instanceof GeminiSafetyError || error instanceof GeminiRecitationError) {
            throw new NonRetryableError(error.message);
          }

          // Rate limit errors: add extra delay before the workflow retry kicks in
          if (error instanceof GeminiRateLimitError) {
            await new Promise(resolve => setTimeout(resolve, 20_000));
          }

          throw error;
        }
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isSafetyBlock = errorMessage.includes('Prompt blocked for safety') || errorMessage.includes('content matched existing material');
      const userMessage = isSafetyBlock ? errorMessage : 'Generation failed';

      log.error('Generation error', { requestId, jobId, spaceId, error: errorMessage, isSafetyBlock });
      await this.handleFailure(spaceId, jobId, requestId, isSafetyBlock ? errorMessage : (error instanceof Error ? error.message : userMessage));
      return {
        requestId,
        jobId,
        success: false,
        error: isSafetyBlock ? errorMessage : (error instanceof Error ? error.message : userMessage),
      };
    }

    // generate-and-upload-{image,video} already wrote the bytes to R2 and
    // returned only keys + metadata — nothing large crossed the step boundary.
    const {
      imageKey,
      thumbKey,
      mediaKey,
      mediaMimeType,
      mediaSizeBytes,
      mediaWidth,
      mediaHeight,
      mediaDurationMs,
      providerMetadata,
    } = uploadResult;

    // Step 3: Complete variant in SpaceDO (updates status to 'completed')
    let variant: GeneratedVariant;
    try {
      variant = await step.do('complete-variant', async () => {
        if (!this.env.SPACES_DO) {
          throw new Error('SPACES_DO not configured');
        }

        const timer = log.startTimer('DO completeVariant', { requestId, jobId, spaceId, variantId });

        try {
          const doId = this.env.SPACES_DO.idFromName(spaceId);
          const doStub = this.env.SPACES_DO.get(doId);

          // Call complete-variant endpoint to finalize the placeholder
          const response = await doStub.fetch(new Request('http://do/internal/complete-variant', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              variantId,
              imageKey,
              thumbKey,
              mediaKey,
              mediaMimeType,
              mediaSizeBytes,
              mediaWidth,
              mediaHeight,
              mediaDurationMs,
              providerMetadata,
            }),
          }));

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`DO complete-variant failed (${response.status}): ${errorText}`);
          }

          const result = await response.json<{ success: boolean; variant: GeneratedVariant }>();
          timer(true);
          return result.variant;
        } catch (error) {
          timer(false, { error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      });
    } catch (error) {
      log.error('Complete variant error', { requestId, jobId, spaceId, error: error instanceof Error ? error.message : String(error) });
      await this.handleFailure(spaceId, jobId, requestId, error instanceof Error ? error.message : 'Failed to complete variant');
      return {
        requestId,
        jobId,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to complete variant',
      };
    }

    // Note: Usage tracking is handled by SpaceDO when completing the variant
    // The complete-variant endpoint broadcasts variant:updated to all connected clients

    log.info('Completed workflow', { requestId, jobId, spaceId, assetName, operation, variantId });

    return {
      requestId,
      jobId,
      success: true,
      variant,
    };
  }

  private async runAudioWorkflow(
    event: WorkflowEvent<GenerationWorkflowInput>,
    step: WorkflowStep
  ): Promise<GenerationWorkflowOutput> {
    const {
      requestId,
      jobId,
      spaceId,
      prompt,
      assetName,
      assetType,
      model,
      operation,
      sourceImageKeys,
      voiceId,
      dialogueVoiceIds,
      musicProvider,
    } = event.payload;

    if (sourceImageKeys?.length) {
      const error = 'Audio generation does not support image references yet';
      await this.handleFailure(spaceId, jobId, requestId, error);
      return { requestId, jobId, success: false, error };
    }

    const variantId = jobId;
    let mediaKey: string;
    let mediaMimeType: string;
    let mediaSizeBytes: number;
    let mediaDurationMs: number | null;
    let audioProvider: string | null = null;
    let audioModel: string | null = null;
    let audioUsage: AudioGenerationResult['usage'] | null = null;
    let providerMetadata: Record<string, unknown> | null = null;
    let transcriptKey: string | null = null;
    let transcriptMimeType: string | null = null;
    let transcriptSizeBytes: number | null = null;
    let wordTimingsKey: string | null = null;
    let wordTimingsMimeType: string | null = null;
    let wordTimingsSizeBytes: number | null = null;
    let renderMetadataKey: string | null = null;
    let renderMetadataMimeType: string | null = null;
    let renderMetadataSizeBytes: number | null = null;

    try {
      const uploadResult = await step.do('generate-and-upload-audio', {
        retries: { limit: 2, delay: '3 seconds' },
        timeout: '10 minutes',
      }, async () => {
        if (!this.env.IMAGES) {
          throw new Error('IMAGES R2 bucket not configured');
        }

        const { provider, providerName } = this.createAudioProvider(assetType, { voiceId, dialogueVoiceIds, musicProvider });
        const timer = log.startTimer('Audio generation', {
          requestId, jobId, spaceId, operation, provider: providerName, assetType, model,
        });

        try {
          const result = await provider.generate({ prompt, model });
          const extension = getAudioExtensionForMimeType(result.audioMimeType);
          const key = `media/${spaceId}/${variantId}.${extension}`;
          await this.env.IMAGES.put(key, result.audioData, {
            httpMetadata: { contentType: result.audioMimeType },
          });
          const sidecars = await this.uploadAudioSidecars(spaceId, variantId, result);
          timer(true, {
            mediaKey: key,
            totalBytes: result.audioData.byteLength,
            durationMs: result.durationMs,
            provider: providerName,
            model: result.model,
          });
          return {
            mediaKey: key,
            mediaMimeType: result.audioMimeType,
            mediaSizeBytes: result.audioData.byteLength,
            mediaDurationMs: result.durationMs,
            audioProvider: getAudioProviderId(providerName),
            audioModel: result.model,
            audioUsage: result.usage ?? null,
            providerMetadata: {
              provider: getAudioProviderId(providerName),
              providerMode: providerName,
              model: result.model,
              operation,
              usage: result.usage ?? null,
            },
            ...sidecars,
          };
        } catch (error) {
          timer(false, { error: error instanceof Error ? error.message : String(error) });
          if (error instanceof ElevenLabsApiError && !error.retryable) {
            throw new NonRetryableError(error.message);
          }
          if (error instanceof LyriaApiError && !error.retryable) {
            throw new NonRetryableError(error.message);
          }
          throw error;
        }
      });

      mediaKey = uploadResult.mediaKey;
      mediaMimeType = uploadResult.mediaMimeType;
      mediaSizeBytes = uploadResult.mediaSizeBytes;
      mediaDurationMs = uploadResult.mediaDurationMs;
      audioProvider = uploadResult.audioProvider;
      audioModel = uploadResult.audioModel;
      audioUsage = uploadResult.audioUsage;
      providerMetadata = uploadResult.providerMetadata;
      transcriptKey = uploadResult.transcriptKey;
      transcriptMimeType = uploadResult.transcriptMimeType;
      transcriptSizeBytes = uploadResult.transcriptSizeBytes;
      wordTimingsKey = uploadResult.wordTimingsKey;
      wordTimingsMimeType = uploadResult.wordTimingsMimeType;
      wordTimingsSizeBytes = uploadResult.wordTimingsSizeBytes;
      renderMetadataKey = uploadResult.renderMetadataKey;
      renderMetadataMimeType = uploadResult.renderMetadataMimeType;
      renderMetadataSizeBytes = uploadResult.renderMetadataSizeBytes;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Audio generation failed';
      log.error('Audio generation error', { requestId, jobId, spaceId, error: errorMessage });
      await this.handleFailure(spaceId, jobId, requestId, errorMessage);
      return { requestId, jobId, success: false, error: errorMessage };
    }

    let variant: GeneratedVariant;
    try {
      variant = await step.do('complete-audio-variant', async () => {
        if (!this.env.SPACES_DO) {
          throw new Error('SPACES_DO not configured');
        }

        const timer = log.startTimer('DO completeAudioVariant', { requestId, jobId, spaceId, variantId });

        try {
          const doId = this.env.SPACES_DO.idFromName(spaceId);
          const doStub = this.env.SPACES_DO.get(doId);

          const response = await doStub.fetch(new Request('http://do/internal/complete-variant', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              variantId,
              imageKey: null,
              thumbKey: null,
              mediaKey,
              mediaMimeType,
              mediaSizeBytes,
              mediaDurationMs,
              transcriptKey,
              transcriptMimeType,
              transcriptSizeBytes,
              wordTimingsKey,
              wordTimingsMimeType,
              wordTimingsSizeBytes,
              renderMetadataKey,
              renderMetadataMimeType,
              renderMetadataSizeBytes,
              providerMetadata,
              audioProvider,
              audioModel,
              audioUsage,
            }),
          }));

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`DO complete-variant failed (${response.status}): ${errorText}`);
          }

          const result = await response.json<{ success: boolean; variant: GeneratedVariant }>();
          timer(true);
          return result.variant;
        } catch (error) {
          timer(false, { error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to complete audio variant';
      log.error('Complete audio variant error', { requestId, jobId, spaceId, error: errorMessage });
      await this.handleFailure(spaceId, jobId, requestId, errorMessage);
      return { requestId, jobId, success: false, error: errorMessage };
    }

    log.info('Completed audio workflow', { requestId, jobId, spaceId, assetName, operation, variantId });

    return {
      requestId,
      jobId,
      success: true,
      variant,
    };
  }

  private createAudioProvider(
    assetType: string,
    voiceOverrides: { voiceId?: string; dialogueVoiceIds?: string[]; musicProvider?: 'elevenlabs' | 'lyria' } = {}
  ): { provider: AudioGenerationProvider; providerName: string } {
    const provider = this.env.INVENTORY_AUDIO_PROVIDER || 'fake';
    if (assetType === 'music' && voiceOverrides.musicProvider === 'lyria') {
      return this.createLyriaMusicProvider();
    }
    if (assetType === 'music' && voiceOverrides.musicProvider === 'elevenlabs') {
      return this.createElevenLabsMusicProvider();
    }
    if (provider === 'fake') {
      return { provider: new FakeAudioProvider(), providerName: 'fake' };
    }
    if (provider === 'elevenlabs') {
      if (!this.env.ELEVENLABS_API_KEY) {
        throw new NonRetryableError('ELEVENLABS_API_KEY not configured');
      }
      if (assetType === 'music') {
        return this.createElevenLabsMusicProvider();
      }
      if (assetType === 'sfx') {
        return {
          provider: new ElevenLabsSoundEffectProvider({
            apiKey: this.env.ELEVENLABS_API_KEY,
            modelId: this.env.ELEVENLABS_SOUND_EFFECT_MODEL_ID,
            outputFormat: this.env.ELEVENLABS_SOUND_EFFECT_OUTPUT_FORMAT,
          }),
          providerName: 'elevenlabs:sfx',
        };
      }
      return {
        provider: new ElevenLabsAudioProvider({
          apiKey: this.env.ELEVENLABS_API_KEY,
          // UI-selected voices take precedence; env vars are the fallback default.
          voiceId: voiceOverrides.voiceId || this.env.ELEVENLABS_VOICE_ID || '',
          dialogueVoiceIds: voiceOverrides.dialogueVoiceIds?.length
            ? voiceOverrides.dialogueVoiceIds
            : parseCommaSeparated(this.env.ELEVENLABS_DIALOGUE_VOICE_IDS),
          modelId: this.env.ELEVENLABS_MODEL_ID,
          outputFormat: this.env.ELEVENLABS_AUDIO_OUTPUT_FORMAT,
        }),
        providerName: 'elevenlabs:speech',
      };
    }
    throw new NonRetryableError(`Unsupported INVENTORY_AUDIO_PROVIDER: ${provider}`);
  }

  private createElevenLabsMusicProvider(): { provider: AudioGenerationProvider; providerName: string } {
    if (!this.env.ELEVENLABS_API_KEY) {
      throw new NonRetryableError('ELEVENLABS_API_KEY not configured');
    }
    return {
      provider: new ElevenLabsMusicProvider({
        apiKey: this.env.ELEVENLABS_API_KEY,
        modelId: this.env.ELEVENLABS_MUSIC_MODEL_ID,
        outputFormat: this.env.ELEVENLABS_MUSIC_OUTPUT_FORMAT,
      }),
      providerName: 'elevenlabs:music',
    };
  }

  private createLyriaMusicProvider(): { provider: AudioGenerationProvider; providerName: string } {
    if (!this.env.LYRIA_PROJECT_ID) {
      throw new NonRetryableError('LYRIA_PROJECT_ID not configured');
    }
    return {
      provider: new LyriaMusicProvider({
        projectId: this.env.LYRIA_PROJECT_ID,
        location: this.env.LYRIA_LOCATION,
        modelId: this.env.LYRIA_MODEL_ID,
        accessToken: this.env.LYRIA_ACCESS_TOKEN,
        apiKey: this.env.LYRIA_API_KEY,
        baseUrl: this.env.LYRIA_BASE_URL,
      }),
      providerName: 'lyria:music',
    };
  }

  private async uploadAudioSidecars(
    spaceId: string,
    variantId: string,
    result: AudioGenerationResult
  ): Promise<{
    transcriptKey: string | null;
    transcriptMimeType: string | null;
    transcriptSizeBytes: number | null;
    wordTimingsKey: string | null;
    wordTimingsMimeType: string | null;
    wordTimingsSizeBytes: number | null;
    renderMetadataKey: string | null;
    renderMetadataMimeType: string | null;
    renderMetadataSizeBytes: number | null;
  }> {
    if (!this.env.IMAGES) {
      throw new Error('IMAGES R2 bucket not configured');
    }

    const transcript = await this.uploadAudioSidecar(spaceId, variantId, 'transcript.txt', result.transcript);
    const wordTimings = await this.uploadAudioSidecar(spaceId, variantId, 'word_timings.json', result.wordTimings);
    const renderMetadata = await this.uploadAudioSidecar(spaceId, variantId, 'render_metadata.json', result.renderMetadata);

    return {
      transcriptKey: transcript.key,
      transcriptMimeType: transcript.mimeType,
      transcriptSizeBytes: transcript.sizeBytes,
      wordTimingsKey: wordTimings.key,
      wordTimingsMimeType: wordTimings.mimeType,
      wordTimingsSizeBytes: wordTimings.sizeBytes,
      renderMetadataKey: renderMetadata.key,
      renderMetadataMimeType: renderMetadata.mimeType,
      renderMetadataSizeBytes: renderMetadata.sizeBytes,
    };
  }

  private async uploadAudioSidecar(
    spaceId: string,
    variantId: string,
    filename: string,
    sidecar: AudioSidecar | undefined
  ): Promise<{ key: string | null; mimeType: string | null; sizeBytes: number | null }> {
    if (!sidecar) {
      return { key: null, mimeType: null, sizeBytes: null };
    }
    if (!this.env.IMAGES) {
      throw new Error('IMAGES R2 bucket not configured');
    }
    const key = `sidecars/${spaceId}/${variantId}/${filename}`;
    await this.env.IMAGES.put(key, sidecar.data, {
      httpMetadata: { contentType: sidecar.mimeType },
    });
    return {
      key,
      mimeType: sidecar.mimeType,
      sizeBytes: sidecar.data.byteLength,
    };
  }

  /**
   * Update variant status via SpaceDO internal endpoint
   */
  private async updateVariantStatus(spaceId: string, variantId: string, status: string): Promise<void> {
    if (!this.env.SPACES_DO) return;

    const timer = log.startTimer('DO updateVariantStatus', { spaceId, variantId, status });

    try {
      const doId = this.env.SPACES_DO.idFromName(spaceId);
      const doStub = this.env.SPACES_DO.get(doId);

      await doStub.fetch(new Request('http://do/internal/variant/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId, status }),
      }));

      timer(true);
    } catch (error) {
      timer(false, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Handle workflow failure by marking the variant as failed in SpaceDO
   */
  private async handleFailure(spaceId: string, variantId: string, _requestId: string, error: string): Promise<void> {
    if (!this.env.SPACES_DO) return;

    const doId = this.env.SPACES_DO.idFromName(spaceId);
    const doStub = this.env.SPACES_DO.get(doId);

    try {
      await doStub.fetch(new Request('http://do/internal/fail-variant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId, error }),
      }));
    } catch (fetchError) {
      log.error('Failed to mark variant as failed', { spaceId, variantId, error: fetchError instanceof Error ? fetchError.message : String(fetchError) });
    }
  }
}

function parseCommaSeparated(value: string | undefined): string[] | undefined {
  const values = value
    ?.split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return values?.length ? values : undefined;
}
