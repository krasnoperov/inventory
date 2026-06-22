import type { Env } from '../core/types';
import { createContainer } from '../core/container';
import { registerRoutes } from './routes';
import { UsageService } from './services/usageService';
import { SpaceRetentionService } from './services/spaceRetentionService';
import { createOpenApiRouter } from './routes/openapi';
import { contentNegotiation } from './middleware/content-negotiation';

export type Bindings = Env;

const app = createOpenApiRouter();

// Middleware to set up container
app.use('*', async (c, next) => {
  const container = createContainer(c.env);
  c.set('container', container);

  // In-process dispatcher to this same worker. SSR route loaders call this
  // instead of fetching the public origin: a Worker fetching its own hostname
  // mid-invocation fails under run_worker_first and 500s authed document
  // renders. A direct app.fetch() is a function call, not a network subrequest.
  c.set('serverFetch', (input, init) => {
    let executionCtx: ExecutionContext | undefined;
    try {
      executionCtx = c.executionCtx;
    } catch {
      executionCtx = undefined;
    }
    return Promise.resolve(app.fetch(new Request(input, init), c.env, executionCtx));
  });

  await next();
});

// Public markdown, LLM discovery, and agent-readable content negotiation.
app.use('*', contentNegotiation());

// Global error handler - catches unhandled errors in routes
app.onError((err, c) => {
  console.error('Unhandled route error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// Register all routes
registerRoutes(app);

// Scheduled handler - sync usage events to Polar
async function handleScheduled(
  controller: ScheduledController,
  env: Env
): Promise<void> {
  const container = createContainer(env);

  try {
    const retention = await container.get(SpaceRetentionService).sweepExpiredDeletedSpaces();
    if (retention.spacesScanned > 0 || retention.errors.length > 0) {
      console.log('[Scheduled] Space deletion retention sweep complete', retention);
    }
  } catch (error) {
    console.error('[Scheduled] Space deletion retention sweep failed:', error);
  }

  if (!env.POLAR_ACCESS_TOKEN) {
    console.log('[Scheduled] Polar not configured, skipping usage sync');
    return;
  }

  try {
    const usageService = container.get(UsageService);

    // Sync pending events (in batches)
    let totalSynced = 0;
    let totalFailed = 0;
    const maxBatches = 10; // Safety limit
    let batchCount = 0;
    let batchResult;

    do {
      batchResult = await usageService.syncPendingEvents(100);
      totalSynced += batchResult.synced;
      totalFailed += batchResult.failed;
      batchCount++;
    } while (batchResult.synced > 0 && batchCount < maxBatches);

    if (totalSynced > 0 || totalFailed > 0) {
      console.log(`[Scheduled] Synced ${totalSynced} events, ${totalFailed} failed`);
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
  scheduled: handleScheduled,
};

// Also export the app and handlers for the unified worker
export { app, handleScheduled };
