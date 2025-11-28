import { Hono } from 'hono';
import type { AppContext } from './types';
import { AuthService } from '../features/auth/auth-service';
import { UsageService } from '../services/usageService';
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

export { billingRoutes };
