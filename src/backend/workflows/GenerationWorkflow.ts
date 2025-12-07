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
import type { Env } from '../../core/types';
import type { GenerationWorkflowInput, GenerationWorkflowOutput, GeneratedVariant } from './types';
import { NanoBananaService, type GenerationResult, type ImageInput } from '../services/nanoBananaService';
import {
  detectImageType,
  base64ToBuffer,
  arrayBufferToBase64,
  createThumbnail,
  getBaseUrl,
  getExtensionForMimeType,
} from '../utils/image-utils';
import { loggers } from '../../shared/logger';

const log = loggers.generationWorkflow;

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
      sourceImageKeys,
      operation,
    } = event.payload;

    const refCount = sourceImageKeys?.length || 0;
    log.info('Starting workflow', { requestId, jobId, spaceId, assetName, operation, refCount });

    // Step 1: Update variant status to processing via DO
    await step.do('update-variant-processing', async () => {
      await this.updateVariantStatus(spaceId, jobId, 'processing');
    });

    // Step 2: Generate image with retries
    // Note: Source images are fetched inside this step to avoid persisting large blobs
    // in workflow state (which has SQLite size limits)
    let generationResult: GenerationResult;
    try {
      generationResult = await step.do('generate-image', {
        retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
        timeout: '5 minutes',
      }, async () => {
        if (!this.env.GOOGLE_AI_API_KEY) {
          throw new Error('GOOGLE_AI_API_KEY not configured');
        }

        // Fetch source images inline (not as a separate step) to avoid
        // persisting large blobs in workflow state which has SQLite size limits
        let sourceImages: ImageInput[] = [];
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

              sourceImages.push({
                data: base64,
                mimeType,
                label: `Image ${i + 1}:`,
              });
            }
            fetchTimer(true, { totalBytes, imageCount: sourceImages.length });
          } catch (error) {
            fetchTimer(false, { error: error instanceof Error ? error.message : String(error) });
            throw error;
          }
        }

        const nanoBanana = new NanoBananaService(this.env.GOOGLE_AI_API_KEY);
        const modelToUse = (model as 'gemini-3-pro-image-preview' | 'gemini-2.5-flash-image') || 'gemini-3-pro-image-preview';
        const aspectRatioToUse = (aspectRatio as '1:1' | '16:9' | '9:16' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '21:9') || '1:1';

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
            result = await nanoBanana.edit({
              image: sourceImages[0],
              prompt,
              model: modelToUse,
              aspectRatio: aspectRatioToUse,
            });
          } else if (geminiApi === 'compose') {
            result = await nanoBanana.compose({
              images: sourceImages,
              prompt,
              model: modelToUse,
              aspectRatio: aspectRatioToUse,
            });
          } else {
            result = await nanoBanana.generate({
              prompt,
              model: modelToUse,
              aspectRatio: aspectRatioToUse,
            });
          }
          timer(true, { imageSize: result.imageData?.length || 0, geminiApi });
          return result;
        } catch (error) {
          timer(false, { error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      });
    } catch (error) {
      log.error('Generation error', { requestId, jobId, spaceId, error: error instanceof Error ? error.message : String(error) });
      await this.handleFailure(spaceId, jobId, requestId, error instanceof Error ? error.message : 'Generation failed');
      return {
        requestId,
        jobId,
        success: false,
        error: error instanceof Error ? error.message : 'Generation failed',
      };
    }

    // Step 3: Upload to R2
    // Note: variantId === jobId (placeholder variant created before workflow started)
    const variantId = jobId;
    let imageKey: string;
    let thumbKey: string;

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
          return { imageKey: imgKey, thumbKey: thmbKey };
        } catch (error) {
          timer(false, { error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      });

      imageKey = uploadResult.imageKey;
      thumbKey = uploadResult.thumbKey;
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
