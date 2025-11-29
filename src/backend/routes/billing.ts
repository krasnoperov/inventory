import { Hono } from 'hono';
import type { AppContext } from './types';
import { AuthService } from '../features/auth/auth-service';
import { UsageService } from '../services/usageService';
import { PolarService } from '../services/polarService';
import { UsageEventDAO } from '../../dao/usage-event-dao';
import { UserDAO } from '../../dao/user-dao';
import { getAuthToken } from '../auth';

const billingRoutes = new Hono<AppContext>();

/**
 * Get current usage statistics for the authenticated user
 * GET /api/billing/usage
 */
billingRoutes.get('/api/billing/usage', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const usageService = container.get(UsageService);

    // Check authentication
    const cookieHeader = c.req.header('Cookie');
    const token = getAuthToken(cookieHeader || null);

    if (!token) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const payload = await authService.verifyJWT(token);
    if (!payload) {
      return c.json({ error: 'Invalid authentication' }, 401);
    }

    // Get usage stats
    const stats = await usageService.getUserUsageStats(payload.userId);

    return c.json({
      period: {
        start: stats.period.start.toISOString(),
        end: stats.period.end.toISOString(),
      },
      usage: stats.usage,
      estimatedCost: stats.estimatedCost,
    });
  } catch (error) {
    console.error('Error fetching usage stats:', error);
    return c.json({ error: 'Failed to fetch usage statistics' }, 500);
  }
});

/**
 * Get customer portal URL for billing management
 * GET /api/billing/portal
 */
billingRoutes.get('/api/billing/portal', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const usageService = container.get(UsageService);

    // Check authentication
    const cookieHeader = c.req.header('Cookie');
    const token = getAuthToken(cookieHeader || null);

    if (!token) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const payload = await authService.verifyJWT(token);
    if (!payload) {
      return c.json({ error: 'Invalid authentication' }, 401);
    }

    // Get return URL from query param or use default
    const returnUrl = c.req.query('return_url');

    // Get portal URL
    const portalUrl = await usageService.getCustomerPortalUrl(payload.userId, returnUrl);

    if (!portalUrl) {
      return c.json({
        error: 'Billing portal not available',
        message: 'Billing is not configured for this account',
      }, 503);
    }

    return c.json({ url: portalUrl });
  } catch (error) {
    console.error('Error getting portal URL:', error);
    return c.json({ error: 'Failed to get billing portal URL' }, 500);
  }
});

/**
 * Get billing status for healthbar UI
 * GET /api/billing/status
 *
 * Returns meter usage with percentages for displaying a healthbar:
 * - meters: array of { name, consumed, credited, remaining, percentUsed, hasLimit }
 * - subscription: { status, renewsAt } if subscribed
 * - portalUrl: link to manage billing
 */
billingRoutes.get('/api/billing/status', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const polarService = container.get(PolarService);

    // Check authentication
    const cookieHeader = c.req.header('Cookie');
    const token = getAuthToken(cookieHeader || null);

    if (!token) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const payload = await authService.verifyJWT(token);
    if (!payload) {
      return c.json({ error: 'Invalid authentication' }, 401);
    }

    // Get full billing status
    const status = await polarService.getBillingStatus(payload.userId);

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
  } catch (error) {
    console.error('Error fetching billing status:', error);
    return c.json({ error: 'Failed to fetch billing status' }, 500);
  }
});

/**
 * Check quota for a specific service
 * GET /api/billing/quota/:service
 */
billingRoutes.get('/api/billing/quota/:service', async (c) => {
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const usageService = container.get(UsageService);

    // Check authentication
    const cookieHeader = c.req.header('Cookie');
    const token = getAuthToken(cookieHeader || null);

    if (!token) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const payload = await authService.verifyJWT(token);
    if (!payload) {
      return c.json({ error: 'Invalid authentication' }, 401);
    }

    const service = c.req.param('service');
    if (service !== 'claude' && service !== 'nanobanana') {
      return c.json({ error: 'Invalid service. Must be "claude" or "nanobanana"' }, 400);
    }

    const quota = await usageService.checkQuota(payload.userId, service);

    return c.json(quota);
  } catch (error) {
    console.error('Error checking quota:', error);
    return c.json({ error: 'Failed to check quota' }, 500);
  }
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
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const usageEventDAO = container.get(UsageEventDAO);
    const userDAO = container.get(UserDAO);

    // Check authentication (Bearer token for CLI)
    const authHeader = c.req.header('Authorization');
    const cookieHeader = c.req.header('Cookie');
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : getAuthToken(cookieHeader || null);

    if (!token) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const payload = await authService.verifyJWT(token);
    if (!payload) {
      return c.json({ error: 'Invalid authentication' }, 401);
    }

    // TODO: Check if user is admin when roles are implemented
    // For now, any authenticated user can view sync status

    const eventStats = await usageEventDAO.getSyncStats();
    const usersWithoutPolar = await userDAO.countWithoutPolarCustomer();

    return c.json({
      events: eventStats,
      customers: {
        withoutPolarId: usersWithoutPolar,
      },
    });
  } catch (error) {
    console.error('Error fetching sync status:', error);
    return c.json({ error: 'Failed to fetch sync status' }, 500);
  }
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
  try {
    const container = c.get('container');
    const authService = container.get(AuthService);
    const usageEventDAO = container.get(UsageEventDAO);

    // Check authentication (Bearer token for CLI)
    const authHeader = c.req.header('Authorization');
    const cookieHeader = c.req.header('Cookie');
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : getAuthToken(cookieHeader || null);

    if (!token) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const payload = await authService.verifyJWT(token);
    if (!payload) {
      return c.json({ error: 'Invalid authentication' }, 401);
    }

    // TODO: Check if user is admin when roles are implemented

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
  } catch (error) {
    console.error('Error resetting failed events:', error);
    return c.json({ error: 'Failed to reset events' }, 500);
  }
});

/**
 * Cleanup old synced usage events
 * POST /api/internal/billing/cleanup
 *
 * Removes events older than X days that have been synced
 */
billingRoutes.post('/api/internal/billing/cleanup', async (c) => {
  try {
    // Verify internal API secret
    const secret = c.req.header('X-Internal-Secret');
    const expectedSecret = c.env.INTERNAL_API_SECRET;

    if (!expectedSecret || secret !== expectedSecret) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const container = c.get('container');
    const usageService = container.get(UsageService);

    const olderThanDays = parseInt(c.req.query('days') || '90');
    const deletedCount = await usageService.cleanupOldEvents(olderThanDays);

    return c.json({
      success: true,
      deleted: deletedCount,
      message: `Deleted ${deletedCount} old synced events`,
    });
  } catch (error) {
    console.error('Error cleaning up usage events:', error);
    return c.json({ error: 'Failed to cleanup usage events' }, 500);
  }
});

export { billingRoutes };
