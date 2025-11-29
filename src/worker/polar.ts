// Polar Billing Worker: Cron-based sync to Polar.sh
// Handles:
// - Scheduled usage event sync (every 5 minutes)
// - Scheduled customer creation retry (for failed signups)
//
// This worker runs autonomously on cron - no HTTP API needed.
// CLI uses main worker API with user auth for status/retry.

import 'reflect-metadata';
import { Hono } from 'hono';
import { createContainer } from '../core/container';
import { UsageService } from '../backend/services/usageService';
import type { Env } from '../core/types';

const app = new Hono<{ Bindings: Env }>();

// Health check endpoint (for monitoring)
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', worker: 'polar' });
});

// Export polar worker
export default {
  // Minimal HTTP handler (just health check)
  fetch: app.fetch,

  // Cron handler for scheduled sync
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[Polar Worker] Cron triggered at ${new Date(event.scheduledTime).toISOString()}`);

    const container = createContainer(env);
    const usageService = container.get(UsageService);

    // Run both syncs
    ctx.waitUntil(
      (async () => {
        try {
          // Sync pending usage events
          const eventsResult = await usageService.syncPendingEvents(100);
          console.log(`[Polar Worker] Events sync: ${eventsResult.synced} synced, ${eventsResult.failed} failed`);

          // Sync missing Polar customers (retry failed signups)
          const customersResult = await usageService.syncMissingCustomers(50);
          console.log(`[Polar Worker] Customers sync: ${customersResult.created} created, ${customersResult.failed} failed`);

          // Warn on high failure rates (visible in CF logs/analytics)
          if (eventsResult.failed > 10 || customersResult.failed > 5) {
            console.warn('[Polar Worker] HIGH FAILURE RATE:', {
              eventsFailed: eventsResult.failed,
              customersFailed: customersResult.failed,
            });
          }
        } catch (error) {
          console.error('[Polar Worker] Sync error:', error);
        }
      })()
    );
  },
};
