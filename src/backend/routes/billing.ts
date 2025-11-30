import { Hono } from 'hono';
import type { AppContext } from './types';
import { authMiddleware } from '../middleware/auth-middleware';
import { UsageService } from '../services/usageService';
import { PolarService } from '../services/polarService';
import { UsageEventDAO } from '../../dao/usage-event-dao';
import { UserDAO } from '../../dao/user-dao';

const billingRoutes = new Hono<AppContext>();

// Apply auth middleware to all routes except internal ones
billingRoutes.use('/api/billing/*', authMiddleware);

/**
 * Get current usage statistics for the authenticated user
 * GET /api/billing/usage
 */
billingRoutes.get('/api/billing/usage', async (c) => {
  const userId = c.get('userId')!;
  const usageService = c.get('container').get(UsageService);

  // Get usage stats
  const stats = await usageService.getUserUsageStats(userId);

  return c.json({
    period: {
      start: stats.period.start.toISOString(),
      end: stats.period.end.toISOString(),
    },
    usage: stats.usage,
    estimatedCost: stats.estimatedCost,
  });
});

/**
 * Get customer portal URL for billing management
 * GET /api/billing/portal
 */
billingRoutes.get('/api/billing/portal', async (c) => {
  const userId = c.get('userId')!;
  const usageService = c.get('container').get(UsageService);

  // Get return URL from query param or use default
  const returnUrl = c.req.query('return_url');

  // Get portal URL
  const portalUrl = await usageService.getCustomerPortalUrl(userId, returnUrl);

  if (!portalUrl) {
    return c.json({
      error: 'Billing portal not available',
      message: 'Billing is not configured for this account',
    }, 503);
  }

  return c.json({ url: portalUrl });
});

/**
 * Get billing status for healthbar UI
 * GET /api/billing/status
 *
 * Returns meter usage with percentages for displaying a healthbar:
 * - meters: array of { name, consumed, credited, remaining, percentUsed, hasLimit }
 * - subscription: { status, renewsAt } if subscribed
 * - portalUrl: link to manage billing
 *
 * Side effect: Refreshes local D1 quota_limits cache from Polar API.
 * This ensures quota limits stay fresh when user views billing page.
 */
billingRoutes.get('/api/billing/status', async (c) => {
  const userId = c.get('userId')!;
  const container = c.get('container');
  const polarService = container.get(PolarService);
  const userDAO = container.get(UserDAO);

  // Get full billing status from Polar
  const status = await polarService.getBillingStatus(userId);

  // Refresh local D1 quota_limits cache (non-blocking)
  // This keeps local limits in sync when user views billing page
  if (status.meters.length > 0) {
    const limits: Record<string, number | null> = {};
    for (const meter of status.meters) {
      limits[meter.meterSlug] = meter.hasLimit ? meter.credited : null;
    }
    userDAO.update(userId, {
      quota_limits: JSON.stringify(limits),
      quota_limits_updated_at: new Date().toISOString(),
    }).catch(err => console.warn('Failed to refresh local quota_limits:', err));
  }

  // Format response for frontend healthbar
  return c.json({
    configured: status.configured,
    hasSubscription: status.hasSubscription,
    meters: status.meters.map((m) => ({
      name: m.meterSlug,
      consumed: m.consumed,
      credited: m.credited,
      remaining: m.remaining,
      percentUsed: Math.round(m.percentUsed * 10) / 10, // 1 decimal place
      hasLimit: m.hasLimit,
      // Status indicator for UI
      status:
        m.percentUsed >= 100
          ? 'exceeded'
          : m.percentUsed >= 90
            ? 'critical'
            : m.percentUsed >= 75
              ? 'warning'
              : 'ok',
    })),
    subscription: status.subscription
      ? {
          status: status.subscription.status,
          renewsAt: status.subscription.currentPeriodEnd?.toISOString() || null,
        }
      : null,
    portalUrl: status.portalUrl,
  });
});

/**
 * Check quota for a specific service
 * GET /api/billing/quota/:service
 */
billingRoutes.get('/api/billing/quota/:service', async (c) => {
  const userId = c.get('userId')!;
  const usageService = c.get('container').get(UsageService);

  const service = c.req.param('service');
  if (service !== 'claude' && service !== 'nanobanana') {
    return c.json({ error: 'Invalid service. Must be "claude" or "nanobanana"' }, 400);
  }

  const quota = await usageService.checkQuota(userId, service);

  return c.json(quota);
});

/**
 * Get sync status for CLI/admin
 * GET /api/billing/sync-status
 *
 * Returns counts of pending, failed, and synced events
 * Plus count of users without Polar customer ID
 *
 * TODO: Add admin role check when implementing roles
 */
billingRoutes.get('/api/billing/sync-status', async (c) => {
  const userId = c.get('userId')!;
  const container = c.get('container');
  const usageEventDAO = container.get(UsageEventDAO);
  const userDAO = container.get(UserDAO);

  // TODO: Check if user is admin when roles are implemented
  // For now, any authenticated user can view sync status
  void userId; // Acknowledge userId is available but not used for admin check yet

  const eventStats = await usageEventDAO.getSyncStats();
  const usersWithoutPolar = await userDAO.countWithoutPolarCustomer();

  return c.json({
    events: eventStats,
    customers: {
      withoutPolarId: usersWithoutPolar,
    },
  });
});

/**
 * Reset failed events for retry
 * POST /api/billing/retry-failed
 *
 * Resets sync_attempts for all failed events so they'll be
 * picked up by the next cron sync
 *
 * TODO: Add admin role check when implementing roles
 */
billingRoutes.post('/api/billing/retry-failed', async (c) => {
  const userId = c.get('userId')!;
  const usageEventDAO = c.get('container').get(UsageEventDAO);

  // TODO: Check if user is admin when roles are implemented
  void userId; // Acknowledge userId is available but not used for admin check yet

  // Find and reset failed events
  const failedEvents = await usageEventDAO.findFailed(1000);

  if (failedEvents.length === 0) {
    return c.json({
      reset: 0,
      message: 'No failed events to retry.',
    });
  }

  const eventIds = failedEvents.map((e) => e.id);
  await usageEventDAO.resetSyncAttempts(eventIds);

  return c.json({
    reset: eventIds.length,
    message: `Reset ${eventIds.length} failed events. They will be synced on the next cron run.`,
  });
});

/**
 * Cleanup old synced usage events
 * POST /api/internal/billing/cleanup
 *
 * Removes events older than X days that have been synced
 * Uses internal API secret instead of user auth
 */
billingRoutes.post('/api/internal/billing/cleanup', async (c) => {
  // Verify internal API secret (no user auth needed)
  const secret = c.req.header('X-Internal-Secret');
  const expectedSecret = c.env.INTERNAL_API_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const usageService = c.get('container').get(UsageService);

  const olderThanDays = parseInt(c.req.query('days') || '90');
  const deletedCount = await usageService.cleanupOldEvents(olderThanDays);

  return c.json({
    success: true,
    deleted: deletedCount,
    message: `Deleted ${deletedCount} old synced events`,
  });
});

export { billingRoutes };
