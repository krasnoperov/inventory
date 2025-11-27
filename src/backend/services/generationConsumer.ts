import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import type { Database } from '../../db/types';
import type { Env } from '../../core/types';
import { JobDAO } from '../../dao/job-dao';
import { NanoBananaService } from './nanoBananaService';

// =============================================================================
// Queue Message Type
// =============================================================================

export interface GenerationMessage {
  jobId: string;
  spaceId: string;
  prompt: string;
  assetName: string;
  assetType: string;
  assetId?: string; // Optional: asset created by job route
  model?: string;
  aspectRatio?: string;
  sourceVariantId?: string; // For edit/reference jobs - single parent variant ID
  sourceImageKey?: string; // For edit/reference jobs - R2 key of source image
  sourceVariantIds?: string[]; // For compose jobs - parent variant IDs
}

// =============================================================================
// Generation Consumer - Queue Worker for Image Generation
// =============================================================================

/**
 * Processes image generation jobs from the queue.
 *
 * Workflow:
 * 1. Fetch job from D1
 * 2. Update status to 'processing'
 * 3. Generate image via NanoBananaService
 * 4. Upload to R2 (full image + thumbnail)
 * 5. Apply variant to SpaceDO (creates variant in DO state)
 * 6. Update job with result
 *
 * Error handling:
 * - Idempotent: skips already-processing jobs
 * - Retries: throws to let queue retry (up to 3 attempts)
 * - Stuck jobs: marks as 'stuck' after 3 failed attempts
 */
export class GenerationConsumer {
  constructor(private env: Env) {}

  /**
   * Convert ArrayBuffer to base64 string without stack overflow.
   * Uses chunked processing to handle large images safely.
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary);
  }

  async processJob(message: GenerationMessage): Promise<void> {
    const { jobId, spaceId, prompt, model, aspectRatio } = message;

    // Create database and DAO
    const db = new Kysely<Database>({
      dialect: new D1Dialect({ database: this.env.DB }),
    });
    const jobDao = new JobDAO(db);

    // Fetch job - idempotency check
    const job = await jobDao.getJobById(jobId);
    if (!job) {
      console.warn(`Job ${jobId} not found, skipping`);
      return;
    }

    if (job.status !== 'pending') {
      console.log(`Job ${jobId} status is ${job.status}, skipping (idempotent)`);
      return;
    }

    // Get DO stub for broadcasting
    const doId = this.env.SPACES_DO?.idFromName(spaceId);
    const doStub = doId ? this.env.SPACES_DO?.get(doId) : null;

    try {
      // Update to processing and increment attempts
      await jobDao.updateJobStatus(jobId, 'processing');
      await jobDao.incrementAttempts(jobId);

      // Broadcast job:progress to WebSocket clients
      if (doStub) {
        await doStub.fetch(
          new Request('http://do/internal/job/progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId, status: 'processing' }),
          })
        );
      }

      // Generate image
      if (!this.env.GOOGLE_AI_API_KEY) {
        throw new Error('GOOGLE_AI_API_KEY not configured');
      }

      const nanoBanana = new NanoBananaService(this.env.GOOGLE_AI_API_KEY);
      const jobInput = JSON.parse(job.input);

      let result;

      // Determine processing mode based on job type and inputs:
      // - 'derive' with sourceImageKey: Edit single image (new variant in same asset)
      // - 'derive' with sourceImageKeys: Compose with single reference (new asset)
      // - 'compose': Multi-image composition
      // - 'generate': Fresh text-to-image
      const hasSourceImage = jobInput.sourceImageKey;
      const hasSourceImageKeys = jobInput.sourceImageKeys?.length > 0;
      const hasSourceVariantIds = jobInput.sourceVariantIds?.length > 0;

      if (job.type === 'derive' && hasSourceImage) {
        // Derive mode (single source): Edit existing variant
        console.log(`[GenerationConsumer] Derive job (edit), fetching source image: ${jobInput.sourceImageKey}`);

        const sourceObject = await this.env.IMAGES.get(jobInput.sourceImageKey);
        if (!sourceObject) {
          throw new Error(`Source image not found: ${jobInput.sourceImageKey}`);
        }

        const sourceBuffer = await sourceObject.arrayBuffer();
        const sourceBase64 = this.arrayBufferToBase64(sourceBuffer);
        const sourceMimeType = sourceObject.httpMetadata?.contentType || 'image/png';

        result = await nanoBanana.edit({
          image: { data: sourceBase64, mimeType: sourceMimeType },
          prompt,
          model: model as 'gemini-3-pro-image-preview' | 'gemini-2.5-flash-image',
          aspectRatio: aspectRatio as '1:1' | '16:9' | '9:16' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '21:9',
        });
      } else if ((job.type === 'derive' || job.type === 'compose') && hasSourceImageKeys) {
        // Derive/Compose with sourceImageKeys: Generate using reference images
        console.log(`[GenerationConsumer] ${job.type} job with ${jobInput.sourceImageKeys.length} reference images`);

        const images = await Promise.all(
          jobInput.sourceImageKeys.map(async (imageKey: string, index: number) => {
            const imageObject = await this.env.IMAGES.get(imageKey);
            if (!imageObject) {
              throw new Error(`Source image not found: ${imageKey}`);
            }

            const buffer = await imageObject.arrayBuffer();
            const base64 = this.arrayBufferToBase64(buffer);
            const mimeType = imageObject.httpMetadata?.contentType || 'image/png';

            return { data: base64, mimeType, label: `Reference ${index + 1}:` };
          })
        );

        result = await nanoBanana.compose({
          images,
          prompt,
          model: model as 'gemini-3-pro-image-preview' | 'gemini-2.5-flash-image',
          aspectRatio: aspectRatio as '1:1' | '16:9' | '9:16' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '21:9',
        });
      } else if (job.type === 'compose' && hasSourceVariantIds) {
        // Compose mode: fetch all source images from R2 and pass to compose()
        console.log(`[GenerationConsumer] Compose job, fetching ${jobInput.sourceVariantIds.length} source images`);

        // We need to get the image keys for the source variants from DO
        const stateResponse = await doStub!.fetch(new Request('http://do/internal/state'));
        const state = await stateResponse.json() as { variants: Array<{ id: string; image_key: string }> };

        const images = await Promise.all(
          jobInput.sourceVariantIds.map(async (variantId: string, index: number) => {
            const variant = state.variants.find((v: { id: string }) => v.id === variantId);
            if (!variant) {
              throw new Error(`Source variant not found: ${variantId}`);
            }

            const imageObject = await this.env.IMAGES.get(variant.image_key);
            if (!imageObject) {
              throw new Error(`Source image not found: ${variant.image_key}`);
            }

            const buffer = await imageObject.arrayBuffer();
            const base64 = this.arrayBufferToBase64(buffer);
            const mimeType = imageObject.httpMetadata?.contentType || 'image/png';

            return { data: base64, mimeType, label: `Image ${index + 1}:` };
          })
        );

        result = await nanoBanana.compose({
          images,
          prompt,
          model: model as 'gemini-3-pro-image-preview' | 'gemini-2.5-flash-image',
          aspectRatio: aspectRatio as '1:1' | '16:9' | '9:16' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '21:9',
        });
      } else {
        // Generate mode: text-to-image
        result = await nanoBanana.generate({
          prompt,
          model: model as 'gemini-3-pro-image-preview' | 'gemini-2.5-flash-image',
          aspectRatio: aspectRatio as '1:1' | '16:9' | '9:16' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '21:9',
        });
      }

      // Upload to R2
      const variantId = crypto.randomUUID();
      const imageKey = `images/${spaceId}/${variantId}.png`;
      const thumbKey = `images/${spaceId}/${variantId}_thumb.png`;

      // Convert base64 to buffer
      const imageBuffer = Uint8Array.from(atob(result.imageData), c => c.charCodeAt(0));

      // Upload full image
      await this.env.IMAGES.put(imageKey, imageBuffer, {
        httpMetadata: {
          contentType: result.imageMimeType,
        },
      });

      // Upload thumbnail (same image for now)
      await this.env.IMAGES.put(thumbKey, imageBuffer, {
        httpMetadata: {
          contentType: result.imageMimeType,
        },
      });

      // Get assetId from already-parsed jobInput
      let assetId = jobInput.assetId || message.assetId;

      // If no assetId exists, we need to create the asset first
      // This shouldn't happen if the job route is properly creating assets,
      // but we handle it for robustness
      if (!assetId) {
        console.warn(`Job ${jobId} has no assetId, creating asset in DO`);
        assetId = crypto.randomUUID();
      }

      // Call SpaceDO to apply the variant
      if (!doStub) {
        throw new Error('SPACES_DO not configured');
      }

      // Build recipe based on job type
      // For derive jobs: sourceVariantId is the single source variant
      // For compose jobs: sourceVariantIds are multiple source variants
      const isDeriveJob = job.type === 'derive';
      const isComposeJob = job.type === 'compose';
      const hasInputs = jobInput.sourceVariantId || jobInput.sourceVariantIds?.length > 0;

      const recipe = {
        type: job.type || 'generate',
        prompt,
        model: model || 'gemini-3-pro-image-preview',
        aspectRatio: aspectRatio || '1:1',
        inputs: isDeriveJob && jobInput.sourceVariantId
          ? [{ variantId: jobInput.sourceVariantId, imageKey: jobInput.sourceImageKey }]
          : jobInput.sourceVariantIds?.length > 0
            ? jobInput.sourceVariantIds.map((id: string) => ({ variantId: id }))
            : [],
      };

      // Determine parent variants for lineage
      let parentVariantIds: string[] | undefined;
      let relationType: 'derived' | 'composed' | undefined;

      if (isDeriveJob && jobInput.sourceVariantId) {
        // Derive from single source variant
        parentVariantIds = [jobInput.sourceVariantId];
        relationType = 'derived';
      } else if (jobInput.sourceVariantIds?.length > 0) {
        // Compose from multiple variants (or derive with reference images)
        parentVariantIds = jobInput.sourceVariantIds;
        relationType = 'composed';
      }

      // Apply variant to DO with lineage
      const doResponse = await doStub.fetch(
        new Request('http://do/internal/apply-variant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId,
            variantId,
            assetId,
            imageKey,
            thumbKey,
            recipe: JSON.stringify(recipe),
            createdBy: job.created_by,
            parentVariantIds,
            relationType,
          }),
        })
      );

      if (!doResponse.ok) {
        const errorText = await doResponse.text();
        throw new Error(`DO apply-variant failed: ${errorText}`);
      }

      const doResult = await doResponse.json<{
        created: boolean;
        variant: {
          id: string;
          asset_id: string;
          job_id: string | null;
          image_key: string;
          thumb_key: string;
          recipe: string;
          created_by: string;
          created_at: number;
        };
      }>();

      // Update job to completed with the variant ID from the DO
      await jobDao.setJobResult(jobId, doResult.variant.id);

      // Broadcast job:completed to WebSocket clients
      await doStub.fetch(
        new Request('http://do/internal/job/completed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId,
            variant: doResult.variant,
          }),
        })
      );

      console.log(
        `Job ${jobId} completed successfully, variant: ${doResult.variant.id}, asset: ${doResult.variant.asset_id}`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Job ${jobId} failed:`, errorMessage);

      // Refresh job to get current attempts
      const currentJob = await jobDao.getJobById(jobId);
      if (!currentJob) {
        throw new Error(`Job ${jobId} disappeared during processing`);
      }

      if (currentJob.attempts >= 3) {
        // Mark as stuck after 3 attempts
        await jobDao.updateJobStatus(jobId, 'stuck', errorMessage);
        console.error(`Job ${jobId} marked as stuck after ${currentJob.attempts} attempts`);

        // Broadcast job:failed to WebSocket clients
        if (doStub) {
          await doStub.fetch(
            new Request('http://do/internal/job/failed', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jobId, error: errorMessage }),
            })
          );
        }
      } else {
        // Throw to let queue retry
        await jobDao.updateJobStatus(jobId, 'failed', errorMessage);
        throw error;
      }
    }
  }
}

// =============================================================================
// Queue Handler - Entry Point for Cloudflare Queue Consumer
// =============================================================================

/**
 * Handles batches of generation messages from the queue.
 *
 * Called by Cloudflare Workers queue consumer binding.
 */
export async function handleGenerationQueue(
  batch: MessageBatch<GenerationMessage>,
  env: Env
): Promise<void> {
  console.log('[Queue] handleGenerationQueue called', {
    queue: batch.queue,
    messageCount: batch.messages.length,
    timestamp: new Date().toISOString(),
  });

  const consumer = new GenerationConsumer(env);

  // Process all messages in the batch
  const promises = batch.messages.map(async (msg, index) => {
    const message = msg.body;

    // Build human-readable operation description
    const sourceCount = message.sourceVariantIds?.length || 0;
    const hasSingleSource = !!message.sourceVariantId;
    let operation: string;
    if (sourceCount > 1) {
      operation = `COMPOSE: Combining ${sourceCount} images into "${message.assetName}" (${message.assetType})`;
    } else if (sourceCount === 1) {
      operation = `COMPOSE: Single reference into "${message.assetName}" (${message.assetType})`;
    } else if (hasSingleSource && message.assetType === 'composite') {
      // Reference job: new asset using existing variant as style reference
      operation = `REFERENCE: Creating "${message.assetName}" (${message.assetType}) from reference`;
    } else if (hasSingleSource) {
      operation = `EDIT: Refining "${message.assetName}" (${message.assetType})`;
    } else {
      operation = `GENERATE: Creating new "${message.assetName}" (${message.assetType})`;
    }

    console.log(`[Queue] ${index + 1}/${batch.messages.length} | ${operation}`, {
      jobId: message.jobId,
      model: message.model || 'default',
      prompt: message.prompt?.slice(0, 80) + (message.prompt?.length > 80 ? '...' : ''),
    });

    try {
      await consumer.processJob(message);
      msg.ack();
      console.log(`[Queue] ✓ ${operation} - completed`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Queue] ✗ ${operation} - failed, will retry: ${errorMessage}`);
      msg.retry();
    }
  });

  const results = await Promise.allSettled(promises);
  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  console.log('[Queue] Batch processing complete', {
    queue: batch.queue,
    total: batch.messages.length,
    succeeded,
    failed,
  });
}
