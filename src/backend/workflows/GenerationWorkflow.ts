/**
 * GenerationWorkflow - Cloudflare Workflow for Gemini Image Generation
 *
 * Handles image generation with:
 * - Quota validation
 * - Source image fetching (for derive/compose)
 * - Gemini API call with retries
 * - R2 upload (full image + thumbnail)
 * - Variant application to SpaceDO
 * - Job tracking in D1
 * - Usage tracking for billing
 * - Result broadcast to WebSocket clients
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

export class GenerationWorkflow extends WorkflowEntrypoint<Env, GenerationWorkflowInput> {
  async run(event: WorkflowEvent<GenerationWorkflowInput>, step: WorkflowStep): Promise<GenerationWorkflowOutput> {
    const {
      requestId,
      jobId,
      spaceId,
      userId,
      prompt,
      assetId,
      assetName,
      assetType,
      model,
      aspectRatio,
      sourceVariantId,
      sourceImageKeys,
      parentVariantIds,
      type: jobType,
    } = event.payload;

    console.log(`[GenerationWorkflow] Starting workflow for jobId: ${jobId}, type: ${jobType}`);

    // Step 1: Update job status to processing
    await step.do('update-job-processing', async () => {
      if (!this.env.DB) return;

      await this.env.DB.prepare(`
        UPDATE jobs SET status = 'processing', updated_at = ? WHERE id = ?
      `).bind(Date.now(), jobId).run();
    });

    // Step 2: Broadcast job progress
    await step.do('broadcast-progress', async () => {
      await this.broadcastProgress(spaceId, jobId, 'processing');
    });

    // Step 3: Fetch source images (if derive/compose)
    let sourceImages: ImageInput[] = [];
    if (sourceImageKeys && sourceImageKeys.length > 0) {
      sourceImages = await step.do('fetch-sources', {
        retries: { limit: 2, delay: '3 seconds' },
      }, async () => {
        if (!this.env.IMAGES) {
          throw new Error('IMAGES R2 bucket not configured');
        }

        const images: ImageInput[] = [];
        for (let i = 0; i < sourceImageKeys.length; i++) {
          const imageKey = sourceImageKeys[i];
          const imageObject = await this.env.IMAGES.get(imageKey);
          if (!imageObject) {
            throw new Error(`Source image not found: ${imageKey}`);
          }

          const buffer = await imageObject.arrayBuffer();
          const base64 = arrayBufferToBase64(buffer);
          const mimeType = imageObject.httpMetadata?.contentType || 'image/png';

          images.push({
            data: base64,
            mimeType,
            label: `Image ${i + 1}:`,
          });
        }
        return images;
      });
    }

    // Step 4: Generate image with retries
    let generationResult: GenerationResult;
    try {
      generationResult = await step.do('generate-image', {
        retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
        timeout: '5 minutes',
      }, async () => {
        if (!this.env.GOOGLE_AI_API_KEY) {
          throw new Error('GOOGLE_AI_API_KEY not configured');
        }

        const nanoBanana = new NanoBananaService(this.env.GOOGLE_AI_API_KEY);
        const modelToUse = (model as 'gemini-3-pro-image-preview' | 'gemini-2.5-flash-image') || 'gemini-3-pro-image-preview';
        const aspectRatioToUse = (aspectRatio as '1:1' | '16:9' | '9:16' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '21:9') || '1:1';

        if (jobType === 'derive' && sourceImages.length === 1) {
          // Edit mode: single source image
          return nanoBanana.edit({
            image: sourceImages[0],
            prompt,
            model: modelToUse,
            aspectRatio: aspectRatioToUse,
          });
        } else if (sourceImages.length > 0) {
          // Compose mode: multiple source images
          return nanoBanana.compose({
            images: sourceImages,
            prompt,
            model: modelToUse,
            aspectRatio: aspectRatioToUse,
          });
        } else {
          // Generate mode: text-to-image
          return nanoBanana.generate({
            prompt,
            model: modelToUse,
            aspectRatio: aspectRatioToUse,
          });
        }
      });
    } catch (error) {
      console.error(`[GenerationWorkflow] Generation error:`, error);
      await this.handleFailure(spaceId, jobId, requestId, error instanceof Error ? error.message : 'Generation failed');
      return {
        requestId,
        jobId,
        success: false,
        error: error instanceof Error ? error.message : 'Generation failed',
      };
    }

    // Step 5: Upload to R2
    // Note: variantId is now the same as jobId (placeholder was created upfront)
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

        console.log(`[GenerationWorkflow] Uploaded full image: ${imgKey}`);

        // Create and upload thumbnail
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

          console.log(`[GenerationWorkflow] Uploaded thumbnail: ${thmbKey}`);
        } catch (thumbError) {
          // Fallback: use original as thumbnail
          console.warn(`[GenerationWorkflow] Thumbnail creation failed, using original:`, thumbError);
          await this.env.IMAGES.put(thmbKey, imageBuffer, {
            httpMetadata: { contentType: actualMimeType },
          });
        }

        return { imageKey: imgKey, thumbKey: thmbKey };
      });

      imageKey = uploadResult.imageKey;
      thumbKey = uploadResult.thumbKey;
    } catch (error) {
      console.error(`[GenerationWorkflow] Upload error:`, error);
      await this.handleFailure(spaceId, jobId, requestId, error instanceof Error ? error.message : 'Upload failed');
      return {
        requestId,
        jobId,
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    }

    // Step 6: Complete variant in SpaceDO (placeholder was created upfront)
    let variant: GeneratedVariant;
    try {
      variant = await step.do('complete-variant', async () => {
        if (!this.env.SPACES_DO) {
          throw new Error('SPACES_DO not configured');
        }

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
          throw new Error(`DO complete-variant failed: ${errorText}`);
        }

        const result = await response.json<{ success: boolean; variant: GeneratedVariant }>();
        return result.variant;
      });
    } catch (error) {
      console.error(`[GenerationWorkflow] Complete variant error:`, error);
      await this.handleFailure(spaceId, jobId, requestId, error instanceof Error ? error.message : 'Failed to complete variant');
      return {
        requestId,
        jobId,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to complete variant',
      };
    }

    // Step 7: Update job status to completed
    await step.do('update-job-completed', async () => {
      if (!this.env.DB) return;

      await this.env.DB.prepare(`
        UPDATE jobs SET status = 'completed', result_variant_id = ?, updated_at = ? WHERE id = ?
      `).bind(variantId, Date.now(), jobId).run();
    });

    // Note: Usage tracking is done in SpaceDO.httpCompleteVariant() after successful completion
    // This ensures we only track successful generations and uses the correct usage_events table

    // Step 8: Broadcast result
    await step.do('broadcast-result', async () => {
      await this.broadcastResult(spaceId, {
        requestId,
        jobId,
        success: true,
        variant,
      });
    });

    console.log(`[GenerationWorkflow] Completed workflow for jobId: ${jobId}, variantId: ${variantId}`);

    return {
      requestId,
      jobId,
      success: true,
      variant,
    };
  }

  /**
   * Broadcast job progress to SpaceDO
   */
  private async broadcastProgress(spaceId: string, jobId: string, status: string): Promise<void> {
    if (!this.env.SPACES_DO) return;

    const doId = this.env.SPACES_DO.idFromName(spaceId);
    const doStub = this.env.SPACES_DO.get(doId);

    await doStub.fetch(new Request('http://do/internal/job/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, status }),
    }));
  }

  /**
   * Broadcast successful result to SpaceDO
   */
  private async broadcastResult(spaceId: string, result: GenerationWorkflowOutput): Promise<void> {
    if (!this.env.SPACES_DO) return;

    const doId = this.env.SPACES_DO.idFromName(spaceId);
    const doStub = this.env.SPACES_DO.get(doId);

    await doStub.fetch(new Request('http://do/internal/generation-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    }));
  }

  /**
   * Handle workflow failure by marking the variant as failed
   */
  private async handleFailure(spaceId: string, jobId: string, requestId: string, error: string): Promise<void> {
    // Update D1 job status (legacy tracking)
    if (this.env.DB) {
      try {
        await this.env.DB.prepare(`
          UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?
        `).bind(error, Date.now(), jobId).run();
      } catch (err) {
        console.warn('[GenerationWorkflow] Failed to update job status:', err);
      }
    }

    // Mark the variant as failed (jobId === variantId now)
    if (this.env.SPACES_DO) {
      const doId = this.env.SPACES_DO.idFromName(spaceId);
      const doStub = this.env.SPACES_DO.get(doId);

      try {
        await doStub.fetch(new Request('http://do/internal/fail-variant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            variantId: jobId,
            error,
          }),
        }));
      } catch (fetchError) {
        console.error('[GenerationWorkflow] Failed to mark variant as failed:', fetchError);
      }
    }
  }
}
