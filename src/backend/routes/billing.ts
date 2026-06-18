import { Hono } from 'hono';
import type { AppContext } from './types';
import { authMiddleware } from '../middleware/auth-middleware';
import { adminMiddleware } from '../middleware/admin-middleware';
import { UsageService } from '../services/usageService';
import { PolarService } from '../services/polarService';
import { UsageEventDAO } from '../../dao/usage-event-dao';
import { UserDAO } from '../../dao/user-dao';
import {
  isNonBillablePaidGenerationEntitlement,
  resolveEntitlement,
} from '../billing/paidGenerationEntitlement';
import { EXPECTED_POLAR_METERS, getPolarMeterContract } from '../billing/polarMeteringContract';

const billingRoutes = new Hono<AppContext>();
const BILLING_SYNC_PENDING_WARN_SECONDS = 15 * 60;

type OperationalStatus = 'ok' | 'warning' | 'critical';

// Apply auth middleware to all routes except internal ones
billingRoutes.use('/api/billing/*', authMiddleware);

function ageSeconds(timestamp: string | null, now: Date): number | null {
  if (!timestamp) return null;
  const value = new Date(timestamp).getTime();
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.floor((now.getTime() - value) / 1000));
}

function combineStatus(statuses: OperationalStatus[]): OperationalStatus {
  if (statuses.includes('critical')) return 'critical';
  if (statuses.includes('warning')) return 'warning';
  return 'ok';
}

function meterFilterMentionsEventName(filter: unknown, eventName: string): boolean {
  if (!filter || typeof filter !== 'object') return false;
  const clauses = (filter as { clauses?: unknown }).clauses;
  if (!Array.isArray(clauses)) return false;

  return clauses.some((clause) => {
    if (!clause || typeof clause !== 'object') return false;
    if ('clauses' in clause) {
      return meterFilterMentionsEventName(clause, eventName);
    }
    const record = clause as { property?: unknown; operator?: unknown; value?: unknown };
    return record.property === 'name' && record.value === eventName;
  });
}

function isUsableIsoDate(value: string | null | undefined): value is string {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function sameOriginUrl(requestUrl: string, value: string | undefined, fallbackPath: string): string {
  const origin = new URL(requestUrl).origin;
  if (!value) {
    return new URL(fallbackPath, origin).toString();
  }

  try {
    const url = new URL(value, origin);
    return url.origin === origin ? url.toString() : new URL(fallbackPath, origin).toString();
  } catch {
    return new URL(fallbackPath, origin).toString();
  }
}

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
 * Get checkout URL for first-time paid generation access
 * GET /api/billing/checkout
 */
billingRoutes.get('/api/billing/checkout', async (c) => {
  const userId = c.get('userId')!;
  const container = c.get('container');
  const userDAO = container.get(UserDAO);
  const polarService = container.get(PolarService);
  const user = await userDAO.findById(userId);

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  const checkoutUrl = await polarService.getPaidGenerationCheckoutUrl(
    {
      userId,
      email: user.email,
      name: user.name,
    },
    {
      returnUrl: sameOriginUrl(c.req.url, c.req.query('return_url'), '/profile'),
      successUrl: sameOriginUrl(c.req.url, c.req.query('success_url'), '/profile?billing=checkout_success'),
    }
  );

  if (!checkoutUrl) {
    return c.json({
      error: 'Checkout not available',
      message: 'Paid generation checkout is not configured',
    }, 503);
  }

  return c.json({ url: checkoutUrl });
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
  const user = await userDAO.findById(userId);
  const entitlement = resolveEntitlement(user?.paid_generation_entitlement, userId, c.env.ADMIN_USER_IDS);

  if (isNonBillablePaidGenerationEntitlement(entitlement)) {
    return c.json({
      configured: true,
      hasSubscription: false,
      entitlement,
      meters: [],
      subscription: null,
      portalUrl: null,
    });
  }

  // Get full billing status from Polar
  const status = await polarService.getBillingStatus(userId);

  // Refresh local D1 quota_limits cache. Entitlement changes are awaited so
  // generation pre-checks cannot observe stale paid access after this response.
  const refreshedEntitlement = status.configured && status.available
    ? (status.hasSubscription ? 'paid' : 'none')
    : entitlement;

  if (status.available && status.meters.length > 0) {
    const limits: Record<string, number | null> = {};
    for (const meter of status.meters) {
      limits[meter.meterSlug] = meter.hasLimit ? meter.credited : null;
    }
    await userDAO.update(userId, {
      paid_generation_entitlement: refreshedEntitlement,
      quota_limits: JSON.stringify(limits),
      quota_limits_updated_at: new Date().toISOString(),
      polar_current_period_start: status.subscription?.currentPeriodStart?.toISOString() ?? null,
      polar_current_period_end: status.subscription?.currentPeriodEnd?.toISOString() ?? null,
    });
  } else if (status.available && refreshedEntitlement !== entitlement) {
    await userDAO.update(userId, {
      paid_generation_entitlement: refreshedEntitlement,
      polar_current_period_start: status.subscription?.currentPeriodStart?.toISOString() ?? null,
      polar_current_period_end: status.subscription?.currentPeriodEnd?.toISOString() ?? null,
    });
  }

  // Format response for frontend healthbar
  return c.json({
    configured: status.configured,
    available: status.available,
    hasSubscription: status.hasSubscription,
    entitlement: refreshedEntitlement,
    error: status.error,
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
          periodStart: status.subscription.currentPeriodStart?.toISOString() || null,
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
  if (service !== 'claude' && service !== 'nanobanana' && service !== 'lyria' && service !== 'elevenlabs' && service !== 'veo') {
    return c.json({ error: 'Invalid service. Must be "claude", "nanobanana", "lyria", "elevenlabs", or "veo"' }, 400);
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
 */
billingRoutes.get('/api/billing/sync-status', adminMiddleware, async (c) => {
  const container = c.get('container');
  const usageEventDAO = container.get(UsageEventDAO);
  const userDAO = container.get(UserDAO);

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
 * Get production billing operational checks for CLI/admin use.
 * GET /api/billing/operational-checks
 *
 * Checks Polar meter configuration and local sync lag. Worker health is checked
 * by the CLI because it needs to probe each public worker hostname directly.
 */
billingRoutes.get('/api/billing/operational-checks', adminMiddleware, async (c) => {
  const container = c.get('container');
  const usageEventDAO = container.get(UsageEventDAO);
  const userDAO = container.get(UserDAO);
  const polarService = container.get(PolarService);
  const now = new Date();

  const syncHealth = await usageEventDAO.getSyncHealth();
  const internalBillingHealth = await usageEventDAO.getInternalBillingHealth();
  const usersWithoutPolarId = await userDAO.countWithoutPolarCustomer();

  const polarConfigured = polarService.isConfigured();
  let polarError: string | null = null;
  let activePolarMeters: Awaited<ReturnType<PolarService['listMeters']>> = [];
  let paidGenerationProduct: Awaited<ReturnType<PolarService['getPaidGenerationProductInfo']>> | null = null;
  if (polarConfigured) {
    try {
      activePolarMeters = await polarService.listMeters();
      paidGenerationProduct = await polarService.getPaidGenerationProductInfo();
    } catch (error) {
      polarError = error instanceof Error ? error.message : String(error);
    }
  }
  const activeMeterNames = activePolarMeters.map((meter) => meter.name);
  const activeMeterNameSet = new Set(activeMeterNames);
  const missingMeters = EXPECTED_POLAR_METERS.filter((meter) => !activeMeterNameSet.has(meter));
  const invalidMeters = activePolarMeters
    .filter((meter) => {
      const expected = getPolarMeterContract(meter.name);
      if (!expected) return false;
      return meter.aggregation !== expected.aggregation ||
        meter.aggregationProperty !== expected.aggregationProperty ||
        !meterFilterMentionsEventName(meter.filter, expected.eventName);
    })
    .map((meter) => ({
      name: meter.name,
      expected: getPolarMeterContract(meter.name),
      actual: {
        aggregation: meter.aggregation,
        aggregationProperty: meter.aggregationProperty,
        filter: meter.filter,
      },
    }));
  const polarStatus: OperationalStatus = !polarConfigured || polarError !== null || missingMeters.length > 0 || invalidMeters.length > 0
    ? 'critical'
    : 'ok';
  const productMissingPriceMeters = EXPECTED_POLAR_METERS.filter(
    (meter) => !paidGenerationProduct?.meteredPriceMeters.includes(meter)
  );
  const productStatus: OperationalStatus = !polarConfigured ||
    polarError !== null ||
    !paidGenerationProduct?.configured ||
    !paidGenerationProduct.exists ||
    paidGenerationProduct.isArchived ||
    !paidGenerationProduct.isRecurring ||
    productMissingPriceMeters.length > 0
    ? 'critical'
    : 'ok';

  const oldestPendingAgeSeconds = ageSeconds(syncHealth.oldestPendingCreatedAt, now);
  const oldestFailedAgeSeconds = ageSeconds(syncHealth.oldestFailedCreatedAt, now);
  const syncStatus: OperationalStatus = syncHealth.failed > 0
    ? 'critical'
    : oldestPendingAgeSeconds !== null && oldestPendingAgeSeconds >= BILLING_SYNC_PENDING_WARN_SECONDS
      ? 'warning'
      : usersWithoutPolarId > 0
        ? 'warning'
        : 'ok';
  const internalBillingStatus: OperationalStatus = internalBillingHealth.billableEvents > 0
    ? 'critical'
    : 'ok';

  return c.json({
    generatedAt: now.toISOString(),
    environment: c.env.ENVIRONMENT ?? 'unknown',
    status: combineStatus([polarStatus, productStatus, syncStatus, internalBillingStatus]),
    checks: {
      polarMeters: {
        status: polarStatus,
        configured: polarConfigured,
        error: polarError,
        expected: EXPECTED_POLAR_METERS,
        active: activePolarMeters,
        missing: missingMeters,
        invalid: invalidMeters,
      },
      paidGenerationProduct: {
        status: productStatus,
        expectedMeteredPriceMeters: EXPECTED_POLAR_METERS,
        missingMeteredPriceMeters: productMissingPriceMeters,
        product: paidGenerationProduct,
      },
      syncHealth: {
        status: syncStatus,
        pendingWarnAfterSeconds: BILLING_SYNC_PENDING_WARN_SECONDS,
        events: {
          ...syncHealth,
          oldestPendingAgeSeconds,
          oldestFailedAgeSeconds,
          lastSyncedAgeSeconds: ageSeconds(syncHealth.lastSyncedAt, now),
          lastSyncAttemptAgeSeconds: ageSeconds(syncHealth.lastSyncAttemptAt, now),
        },
        customers: {
          withoutPolarId: usersWithoutPolarId,
        },
      },
      internalUsers: {
        status: internalBillingStatus,
        ...internalBillingHealth,
      },
    },
  });
});

/**
 * Reconcile local billable usage totals with Polar customer meter usage.
 * GET /api/billing/reconcile?user_id=:id
 */
billingRoutes.get('/api/billing/reconcile', adminMiddleware, async (c) => {
  const rawUserId = c.req.query('user_id') ?? c.req.query('userId');
  const targetUserId = rawUserId ? Number.parseInt(rawUserId, 10) : NaN;
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return c.json({ error: 'user_id query parameter is required' }, 400);
  }

  const container = c.get('container');
  const userDAO = container.get(UserDAO);
  const usageEventDAO = container.get(UsageEventDAO);
  const polarService = container.get(PolarService);

  if (!polarService.isConfigured()) {
    return c.json({ error: 'Polar is not configured' }, 503);
  }

  const user = await userDAO.findById(targetUserId);
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  const polarUsage = await polarService.getCustomerUsage(targetUserId);
  if (!polarUsage) {
    return c.json({ error: 'Polar customer usage is not available' }, 503);
  }

  const periodStart = isUsableIsoDate(user.polar_current_period_start)
    ? user.polar_current_period_start
    : polarUsage.period.start.toISOString();
  const periodEnd = isUsableIsoDate(user.polar_current_period_end)
    ? user.polar_current_period_end
    : polarUsage.period.end.toISOString();

  const localTotals = await usageEventDAO.getBillableUsageTotalsForPeriod(
    targetUserId,
    periodStart,
    periodEnd
  );

  const meters = EXPECTED_POLAR_METERS.map((meterName) => {
    const local = localTotals[meterName] ?? 0;
    const polar = polarUsage.meters[meterName]?.used ?? 0;
    const delta = local - polar;
    return {
      name: meterName,
      local,
      polar,
      delta,
      matched: delta === 0,
    };
  });
  const mismatches = meters.filter((meter) => !meter.matched);

  return c.json({
    userId: targetUserId,
    status: mismatches.length > 0 ? 'mismatch' : 'ok',
    period: {
      start: periodStart,
      end: periodEnd,
    },
    meters,
    mismatches,
  });
});

/**
 * Reset failed events for retry
 * POST /api/billing/retry-failed
 *
 * Resets sync_attempts for all failed events so they'll be
 * picked up by the next cron sync
 */
billingRoutes.post('/api/billing/retry-failed', adminMiddleware, async (c) => {
  const usageEventDAO = c.get('container').get(UsageEventDAO);

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
