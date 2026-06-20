/**
 * Media upload helpers for GenerationWorkflow.
 *
 * Extracted into a standalone, Cloudflare-runtime-free module so the upload
 * logic can be unit-tested without importing `cloudflare:workers`, and so the
 * "no binary blob ever crosses a workflow step boundary" rule has one obvious
 * home. See ./README.md.
 *
 * The functions here generate R2 keys and return only keys + small scalar
 * metadata — never the binary payload itself — keeping every workflow step
 * output well under the Cloudflare Workflows 1 MiB cap.
 */

import type { Env } from '../../core/types';
import type { GenerationResult } from '../services/nanoBananaService';
import type { VideoGenerationResult } from '../services/googleVeoService';
import {
  detectImageType,
  base64ToBuffer,
  createThumbnail,
  getBaseUrl,
  getExtensionForMimeType,
  getImageDimensions,
} from '../utils/image-utils';
import { loggers } from '../../shared/logger';
import { getVideoGenerationTierForModel } from '../../shared/videoGenerationOptions';

const log = loggers.generationWorkflow;

export function getVideoExtensionForMimeType(mimeType: string): string {
  if (mimeType === 'video/webm') return 'webm';
  if (mimeType === 'video/quicktime') return 'mov';
  return 'mp4';
}

export function isVideoGenerationResult(
  result: GenerationResult | VideoGenerationResult
): result is VideoGenerationResult {
  return 'videoData' in result;
}

/**
 * Provider metadata persisted with a generated variant. Concrete (not
 * `Record<string, unknown>`) so the whole upload result satisfies the
 * Cloudflare Workflows `Serializable` step-output constraint.
 */
export type GeneratedMediaProviderMetadata = {
  provider: string;
  keySource?: 'platform' | 'byok';
  model: string;
  operation: string;
  sourceImageCount: number;
  aspectRatio?: string;
  resolution?: string;
  durationSeconds?: number;
  videoTier?: string;
  referenceMode?: string;
  generateAudio?: boolean;
  api?: string;
  imageSize?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
};

/**
 * Result of generating media and uploading it to R2. Contains only R2 keys and
 * small scalar metadata — never the binary payload itself, so it stays well
 * under the Cloudflare Workflows 1 MiB step-output cap.
 */
export type MediaUploadResult = {
  imageKey: string | null;
  thumbKey: string | null;
  mediaKey: string | null;
  mediaMimeType: string | null;
  mediaSizeBytes: number | null;
  mediaWidth: number | null;
  mediaHeight: number | null;
  mediaDurationMs: number | null;
  providerMetadata: GeneratedMediaProviderMetadata | null;
};

export type UploadGeneratedMediaContext = {
  spaceId: string;
  variantId: string;
  operation: string;
  refCount: number;
  modelProvider?: string;
  keySource?: 'platform' | 'byok';
  requestId: string;
  jobId: string;
};

/**
 * Upload a freshly generated image or video to R2 and return only keys +
 * metadata. MUST be called from inside the generate step so the binary payload
 * never crosses a workflow step boundary (Cloudflare caps step output at 1 MiB).
 */
export async function uploadGeneratedMedia(
  env: Env,
  generationResult: GenerationResult | VideoGenerationResult,
  ctx: UploadGeneratedMediaContext
): Promise<MediaUploadResult> {
  const { spaceId, variantId, operation, refCount, modelProvider, keySource, requestId, jobId } = ctx;

  if (!env.IMAGES) {
    throw new Error('IMAGES R2 bucket not configured');
  }

  const timer = log.startTimer('Upload to R2', { requestId, jobId });

  try {
    if (isVideoGenerationResult(generationResult)) {
      const videoMimeType = generationResult.videoMimeType || 'video/mp4';
      const extension = getVideoExtensionForMimeType(videoMimeType);
      const key = `media/${spaceId}/${variantId}.${extension}`;
      const videoBuffer = base64ToBuffer(generationResult.videoData);

      await env.IMAGES.put(key, videoBuffer, {
        httpMetadata: { contentType: videoMimeType },
      });

      timer(true, { mediaKey: key, totalBytes: videoBuffer.byteLength });

      return {
        imageKey: null,
        thumbKey: null,
        mediaKey: key,
        mediaMimeType: videoMimeType,
        mediaSizeBytes: videoBuffer.byteLength,
        mediaWidth: null,
        mediaHeight: null,
        mediaDurationMs: generationResult.durationSeconds * 1000,
        providerMetadata: {
          provider: env.INVENTORY_IMAGE_PROVIDER === 'fake' ? 'fake' : 'google-veo',
          keySource,
          model: generationResult.model,
          operation,
          aspectRatio: generationResult.aspectRatio,
          resolution: generationResult.resolution,
          durationSeconds: generationResult.durationSeconds,
          videoTier: getVideoGenerationTierForModel(generationResult.model),
          referenceMode: generationResult.referenceMode,
          generateAudio: generationResult.generateAudio,
          sourceImageCount: refCount,
        },
      };
    }

    // Detect actual image type from base64
    const actualMimeType = detectImageType(generationResult.imageData);
    const extension = getExtensionForMimeType(actualMimeType);

    const imgKey = `images/${spaceId}/${variantId}.${extension}`;
    const thmbKey = `images/${spaceId}/${variantId}_thumb.webp`;

    // Convert base64 to buffer
    const imageBuffer = base64ToBuffer(generationResult.imageData);
    const dimensions = getImageDimensions(imageBuffer);

    // Upload full image
    await env.IMAGES.put(imgKey, imageBuffer, {
      httpMetadata: { contentType: actualMimeType },
    });

    log.debug('Uploaded full image', { requestId, jobId, imageKey: imgKey });

    // Create and upload thumbnail
    let thumbSize = 0;
    try {
      const baseUrl = getBaseUrl(env);
      const { buffer: thumbBuffer, mimeType: thumbMimeType } = await createThumbnail(
        imgKey,
        baseUrl,
        env,
        {
          width: 512,
          height: 512,
          fit: 'cover',
          gravity: 'auto',
          quality: 80,
          format: 'webp',
        }
      );

      await env.IMAGES.put(thmbKey, thumbBuffer, {
        httpMetadata: { contentType: thumbMimeType },
      });
      thumbSize = thumbBuffer.byteLength;

      log.debug('Uploaded thumbnail', { requestId, jobId, thumbKey: thmbKey });
    } catch (thumbError) {
      // Fallback: use original as thumbnail
      log.warn('Thumbnail creation failed, using original', { requestId, jobId, error: thumbError instanceof Error ? thumbError.message : String(thumbError) });
      await env.IMAGES.put(thmbKey, imageBuffer, {
        httpMetadata: { contentType: actualMimeType },
      });
      thumbSize = imageBuffer.byteLength;
    }

    timer(true, {
      imageKey: imgKey,
      thumbKey: thmbKey,
      totalBytes: imageBuffer.byteLength + thumbSize,
    });

    const provider =
      env.INVENTORY_IMAGE_PROVIDER === 'fake'
        ? 'fake'
        : modelProvider === 'custom' && env.CUSTOM_MODEL_ENDPOINT
          ? 'custom'
          : 'gemini';
    const imageApi: 'generate' | 'edit' | 'compose' =
      refCount === 0 ? 'generate' :
      (operation === 'refine' && refCount === 1) ? 'edit' :
      'compose';

    return {
      imageKey: imgKey,
      thumbKey: thmbKey,
      mediaKey: imgKey,
      mediaMimeType: actualMimeType,
      mediaSizeBytes: imageBuffer.byteLength,
      mediaWidth: dimensions?.width ?? null,
      mediaHeight: dimensions?.height ?? null,
      mediaDurationMs: null,
      providerMetadata: {
        provider,
        keySource,
        model: generationResult.model,
        operation,
        api: imageApi,
        aspectRatio: generationResult.aspectRatio,
        imageSize: generationResult.imageSize,
        sourceImageCount: refCount,
        usage: generationResult.usage ?? null,
      },
    };
  } catch (error) {
    timer(false, { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
