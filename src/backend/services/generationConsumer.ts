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

    try {
      // Update to processing and increment attempts
      await jobDao.updateJobStatus(jobId, 'processing');
      await jobDao.incrementAttempts(jobId);

      // Generate image
      if (!this.env.GOOGLE_AI_API_KEY) {
        throw new Error('GOOGLE_AI_API_KEY not configured');
      }

      const nanoBanana = new NanoBananaService(this.env.GOOGLE_AI_API_KEY);
      const result = await nanoBanana.generate({
        prompt,
        model: model as 'gemini-3-pro-image-preview' | 'gemini-2.5-flash-image',
        aspectRatio: aspectRatio as '1:1' | '16:9' | '9:16' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '21:9',
      });

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

      // Parse job input to get assetId
      const jobInput = JSON.parse(job.input);
      let assetId = jobInput.assetId || message.assetId;

      // If no assetId exists, we need to create the asset first
      // This shouldn't happen if the job route is properly creating assets,
      // but we handle it for robustness
      if (!assetId) {
        console.warn(`Job ${jobId} has no assetId, creating asset in DO`);
        assetId = crypto.randomUUID();
      }

      // Call SpaceDO to apply the variant
      if (!this.env.SPACES_DO) {
        throw new Error('SPACES_DO not configured');
      }

      const doId = this.env.SPACES_DO.idFromName(spaceId);
      const doStub = this.env.SPACES_DO.get(doId);

      // Parse job input to check for compose mode
      const isComposeJob = jobInput.sourceVariantIds && jobInput.sourceVariantIds.length > 0;

      const recipe = {
        type: isComposeJob ? 'compose' : 'generate',
        prompt,
        model: model || 'gemini-3-pro-image-preview',
        aspectRatio: aspectRatio || '1:1',
        inputs: isComposeJob ? jobInput.sourceVariantIds.map((id: string) => ({ variantId: id })) : [],
      };

      // Apply variant to DO with lineage if this is a compose job
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
            parentVariantIds: isComposeJob ? jobInput.sourceVariantIds : undefined,
            relationType: isComposeJob ? 'composed' : undefined,
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
    console.log(`[Queue] Processing message ${index + 1}/${batch.messages.length}`, {
      jobId: message.jobId,
      spaceId: message.spaceId,
      assetName: message.assetName,
      assetType: message.assetType,
      model: message.model,
      messageId: msg.id,
    });

    try {
      await consumer.processJob(message);
      msg.ack();
      console.log(`[Queue] Message ${msg.id} acknowledged (jobId: ${message.jobId})`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Queue] Message ${msg.id} failed, will retry`, {
        jobId: message.jobId,
        error: errorMessage,
      });
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
