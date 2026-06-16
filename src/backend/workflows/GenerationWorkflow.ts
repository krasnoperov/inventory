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
import { CustomModelProvider } from '../services/customModelProvider';
import { FakeImageProvider } from '../services/fakeImageProvider';
import type { ImageGenerationProvider } from '../services/imageProvider';
import { FakeAudioProvider } from '../services/fakeAudioProvider';
import type { AudioGenerationProvider, AudioGenerationResult, AudioSidecar } from '../services/audioProvider';
import {
  ElevenLabsApiError,
  ElevenLabsAudioProvider,
  ElevenLabsMusicProvider,
  ElevenLabsSoundEffectProvider,
} from '../services/elevenLabsAudioProvider';
import {
  detectImageType,
  base64ToBuffer,
  arrayBufferToBase64,
  createThumbnail,
  getBaseUrl,
  getExtensionForMimeType,
  getImageDimensions,
} from '../utils/image-utils';
import { loggers } from '../../shared/logger';
import { DEFAULT_MEDIA_KIND } from '../../shared/websocket-types';

const log = loggers.generationWorkflow;

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

    if (mediaKind !== 'image') {
      const error = `Generation workflow does not support ${mediaKind} media`;
      await this.handleFailure(spaceId, jobId, requestId, error);
      return { requestId, jobId, success: false, error };
    }

    // Step 2: Generate image with retries
    // Note: Source images are fetched inside this step to avoid persisting large blobs
    // in workflow state (which has SQLite size limits)
    let generationResult: GenerationResult;
    try {
      generationResult = await step.do('generate-image', {
        retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
        timeout: '5 minutes',
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
        const modelToUse = (model as 'gemini-3-pro-image-preview' | 'gemini-2.5-flash-image') || 'gemini-3-pro-image-preview';
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
          return result;
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

    // Step 3: Upload to R2
    // Note: variantId === jobId (placeholder variant created before workflow started)
    const variantId = jobId;
    let imageKey: string;
    let thumbKey: string;
    let mediaMimeType: string | null = null;
    let mediaSizeBytes: number | null = null;
    let mediaWidth: number | null = null;
    let mediaHeight: number | null = null;

    try {
      const uploadResult = await step.do('upload-r2', {
        retries: { limit: 2, delay: '3 seconds' },
      }, async () => {
        if (!this.env.IMAGES) {
          throw new Error('IMAGES R2 bucket not configured');
        }

        const timer = log.startTimer('Upload to R2', { requestId, jobId });

        try {
          // Detect actual image type from base64
          const actualMimeType = detectImageType(generationResult.imageData);
          const extension = getExtensionForMimeType(actualMimeType);

          const imgKey = `images/${spaceId}/${variantId}.${extension}`;
          const thmbKey = `images/${spaceId}/${variantId}_thumb.webp`;

          // Convert base64 to buffer
          const imageBuffer = base64ToBuffer(generationResult.imageData);
          const dimensions = getImageDimensions(imageBuffer);

          // Upload full image
          await this.env.IMAGES.put(imgKey, imageBuffer, {
            httpMetadata: { contentType: actualMimeType },
          });

          log.debug('Uploaded full image', { requestId, jobId, imageKey: imgKey });

          // Create and upload thumbnail
          let thumbSize = 0;
          try {
            const baseUrl = getBaseUrl(this.env);
            const { buffer: thumbBuffer, mimeType: thumbMimeType } = await createThumbnail(
              imgKey,
              baseUrl,
              this.env,
              {
                width: 512,
                height: 512,
                fit: 'cover',
                gravity: 'auto',
                quality: 80,
                format: 'webp',
              }
            );

            await this.env.IMAGES.put(thmbKey, thumbBuffer, {
              httpMetadata: { contentType: thumbMimeType },
            });
            thumbSize = thumbBuffer.byteLength;

            log.debug('Uploaded thumbnail', { requestId, jobId, thumbKey: thmbKey });
          } catch (thumbError) {
            // Fallback: use original as thumbnail
            log.warn('Thumbnail creation failed, using original', { requestId, jobId, error: thumbError instanceof Error ? thumbError.message : String(thumbError) });
            await this.env.IMAGES.put(thmbKey, imageBuffer, {
              httpMetadata: { contentType: actualMimeType },
            });
            thumbSize = imageBuffer.byteLength;
          }

          timer(true, {
            imageKey: imgKey,
            thumbKey: thmbKey,
            totalBytes: imageBuffer.byteLength + thumbSize,
          });
          return {
            imageKey: imgKey,
            thumbKey: thmbKey,
            mediaMimeType: actualMimeType,
            mediaSizeBytes: imageBuffer.byteLength,
            mediaWidth: dimensions?.width ?? null,
            mediaHeight: dimensions?.height ?? null,
          };
        } catch (error) {
          timer(false, { error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      });

      imageKey = uploadResult.imageKey;
      thumbKey = uploadResult.thumbKey;
      mediaMimeType = uploadResult.mediaMimeType;
      mediaSizeBytes = uploadResult.mediaSizeBytes;
      mediaWidth = uploadResult.mediaWidth;
      mediaHeight = uploadResult.mediaHeight;
    } catch (error) {
      log.error('Upload error', { requestId, jobId, spaceId, error: error instanceof Error ? error.message : String(error) });
      await this.handleFailure(spaceId, jobId, requestId, error instanceof Error ? error.message : 'Upload failed');
      return {
        requestId,
        jobId,
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    }

    // Step 5: Complete variant in SpaceDO (updates status to 'completed')
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
              mediaKey: imageKey,
              mediaMimeType,
              mediaSizeBytes,
              mediaWidth,
              mediaHeight,
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

        const { provider, providerName } = this.createAudioProvider(assetType);
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
            ...sidecars,
          };
        } catch (error) {
          timer(false, { error: error instanceof Error ? error.message : String(error) });
          if (error instanceof ElevenLabsApiError && !error.retryable) {
            throw new NonRetryableError(error.message);
          }
          throw error;
        }
      });

      mediaKey = uploadResult.mediaKey;
      mediaMimeType = uploadResult.mediaMimeType;
      mediaSizeBytes = uploadResult.mediaSizeBytes;
      mediaDurationMs = uploadResult.mediaDurationMs;
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

  private createAudioProvider(assetType: string): { provider: AudioGenerationProvider; providerName: string } {
    const provider = this.env.INVENTORY_AUDIO_PROVIDER || 'fake';
    if (provider === 'fake') {
      return { provider: new FakeAudioProvider(), providerName: 'fake' };
    }
    if (provider === 'elevenlabs') {
      if (!this.env.ELEVENLABS_API_KEY) {
        throw new NonRetryableError('ELEVENLABS_API_KEY not configured');
      }
      if (assetType === 'music') {
        return {
          provider: new ElevenLabsMusicProvider({
            apiKey: this.env.ELEVENLABS_API_KEY,
            modelId: this.env.ELEVENLABS_MUSIC_MODEL_ID,
            outputFormat: this.env.ELEVENLABS_MUSIC_OUTPUT_FORMAT,
          }),
          providerName: 'elevenlabs:music',
        };
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
          voiceId: this.env.ELEVENLABS_VOICE_ID || '',
          dialogueVoiceIds: parseCommaSeparated(this.env.ELEVENLABS_DIALOGUE_VOICE_IDS),
          modelId: this.env.ELEVENLABS_MODEL_ID,
          outputFormat: this.env.ELEVENLABS_AUDIO_OUTPUT_FORMAT,
        }),
        providerName: 'elevenlabs:speech',
      };
    }
    throw new NonRetryableError(`Unsupported INVENTORY_AUDIO_PROVIDER: ${provider}`);
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
