import { Hono } from 'hono';
import type { Env } from '../core/types';
import { createContainer } from '../core/container';
import { registerRoutes } from './routes';
import { uploadSecurityMiddleware } from './middleware/upload-security';
import type { AppContext } from './routes/types';
import { handleGenerationQueue } from './services/generationConsumer';
import { UsageService } from './services/usageService';

export type Bindings = Env;

const app = new Hono<AppContext>();

// Middleware to set up container
app.use('*', async (c, next) => {
  const container = createContainer(c.env);
  c.set('container', container);
  await next();
});

// Apply upload security middleware to upload routes
app.use('/api/upload/*', uploadSecurityMiddleware());

// Register all routes
registerRoutes(app);

// Queue handler - delegates to generation consumer
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleQueue(batch: MessageBatch<any>, env: Env): Promise<void> {
  await handleGenerationQueue(batch, env);
}

// Scheduled handler - sync usage events to Polar
async function handleScheduled(
  controller: ScheduledController,
  env: Env
): Promise<void> {
  const container = createContainer(env);

  // Only run if Polar is configured
  if (!env.POLAR_ACCESS_TOKEN) {
    console.log('[Scheduled] Polar not configured, skipping usage sync');
    return;
  }

  try {
    const usageService = container.get(UsageService);

    // Sync pending events (in batches)
    let totalSynced = 0;
    let batchSynced: number;
    const maxBatches = 10; // Safety limit
    let batchCount = 0;

    do {
      batchSynced = await usageService.syncPendingEvents(100);
      totalSynced += batchSynced;
      batchCount++;
    } while (batchSynced > 0 && batchCount < maxBatches);

    if (totalSynced > 0) {
      console.log(`[Scheduled] Synced ${totalSynced} usage events to Polar`);
    }

    // Cleanup old synced events (older than 90 days)
    const deleted = await usageService.cleanupOldEvents(90);
    if (deleted > 0) {
      console.log(`[Scheduled] Cleaned up ${deleted} old usage events`);
    }
  } catch (error) {
    console.error('[Scheduled] Usage sync failed:', error);
    // Don't throw - cron should not fail the worker
  }
}

// No custom notFound handler needed!
// With not_found_handling = "single-page-application" in wrangler.toml:
// - API routes that match will return their responses
// - Unmatched routes fall through to Assets middleware
// - Assets serves the file if it exists, or index.html for SPA routing

// Export as default for standalone use
export default {
  fetch: app.fetch,
  queue: handleQueue,
  scheduled: handleScheduled,
};

// Also export the app and handlers for the unified worker
export { app, handleQueue, handleScheduled };