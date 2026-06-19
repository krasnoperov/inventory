import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { AuthService } from '../features/auth/auth-service';
import { UserDAO } from '../../dao/user-dao';
import { PolarService } from '../services/polarService';
import { UsageService } from '../services/usageService';
import { UsageEventDAO } from '../../dao/usage-event-dao';
import type { AppContext } from './types';
import { billingRoutes } from './billing';

function routeApp(deps: Map<unknown, unknown>, env: Partial<AppContext['Bindings']> = {}) {
  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    c.env = { ENVIRONMENT: 'stage', ...env } as unknown as AppContext['Bindings'];
    c.set('container', {
      get: (token: unknown) => {
        const dependency = deps.get(token);
        if (!dependency) {
          throw new Error('Missing fake dependency');
        }
        return dependency;
      },
    } as never);
    await next();
  });
  app.route('/', billingRoutes);
  return app;
}

function polarMeter(name: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `meter_${name}`,
    name,
    aggregation: 'sum',
    aggregationProperty: 'quantity',
    filter: {
      conjunction: 'and',
      clauses: [
        { property: 'name', operator: 'eq', value: name },
      ],
    },
    archivedAt: null,
    ...overrides,
  };
}

function paidGenerationProduct(overrides: Record<string, unknown> = {}) {
  return {
    configured: true,
    productId: 'prod_paid_generation',
    exists: true,
    name: 'Paid Generation',
    isRecurring: true,
    isArchived: false,
    meteredPriceMeters: [
      'claude_input_tokens',
      'claude_output_tokens',
      'gemini_images',
      'gemini_videos',
      'gemini_audio',
      'gemini_input_tokens',
      'gemini_output_tokens',
      'elevenlabs_audio',
    ],
    meterCreditBenefitMeters: [],
    ...overrides,
  };
}

describe('billingRoutes', () => {
  test('usage route forwards period usage and provider spend', async () => {
    const deps = new Map<unknown, unknown>();
    deps.set(AuthService, {
      verifyJWT: async () => ({ userId: 42 }),
    });
    deps.set(UsageService, {
      getUserUsageStats: async (userId: number) => {
        assert.equal(userId, 42);
        return {
          period: {
            start: new Date('2026-06-01T00:00:00.000Z'),
            end: new Date('2026-06-30T23:59:59.000Z'),
          },
          usage: {
            gemini_images: {
              used: 2,
              limit: 50,
              remaining: 48,
              costUsd: 0.48,
            },
            elevenlabs_audio: {
              used: 1,
              limit: null,
              remaining: null,
              costUsd: 0.12,
            },
          },
          estimatedCost: {
            amount: 0.6,
            currency: 'USD',
          },
        };
      },
    });

    const response = await routeApp(deps).request('/api/billing/usage', {
      headers: { authorization: 'Bearer test-token' },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      period: {
        start: '2026-06-01T00:00:00.000Z',
        end: '2026-06-30T23:59:59.000Z',
      },
      usage: {
        gemini_images: {
          used: 2,
          limit: 50,
          remaining: 48,
          costUsd: 0.48,
        },
        elevenlabs_audio: {
          used: 1,
          limit: null,
          remaining: null,
          costUsd: 0.12,
        },
      },
      estimatedCost: {
        amount: 0.6,
        currency: 'USD',
      },
    });
  });

  test('billing status revokes stale paid entitlement when Polar has no active subscription', async () => {
    const updates: unknown[] = [];
    let updateCompleted = false;
    const deps = new Map<unknown, unknown>();
    deps.set(AuthService, {
      verifyJWT: async () => ({ userId: 42 }),
    });
    deps.set(UserDAO, {
      findById: async () => ({
        id: 42,
        email: 'customer@example.com',
        name: 'Customer Name',
        paid_generation_entitlement: 'paid',
      }),
      update: async (...args: unknown[]) => {
        await Promise.resolve();
        updates.push(args);
        updateCompleted = true;
      },
    });
    deps.set(PolarService, {
      getBillingStatus: async () => ({
        configured: true,
        available: true,
        hasSubscription: false,
        meters: [],
        portalUrl: null,
      }),
    });

    const response = await routeApp(deps).request('/api/billing/status', {
      headers: { authorization: 'Bearer test-token' },
    });

    assert.equal(response.status, 200);
    const body = await response.json() as { entitlement: string };
    assert.equal(body.entitlement, 'none');
    assert.equal(updateCompleted, true);
    assert.deepEqual(updates, [
      [
        42,
        {
          paid_generation_entitlement: 'none',
          polar_current_period_start: null,
          polar_current_period_end: null,
          polar_paid_access_expires_at: null,
        },
      ],
    ]);
  });

  test('billing status preserves paid entitlement when Polar status is unavailable', async () => {
    const updates: unknown[] = [];
    const deps = new Map<unknown, unknown>();
    deps.set(AuthService, {
      verifyJWT: async () => ({ userId: 42 }),
    });
    deps.set(UserDAO, {
      findById: async () => ({
        id: 42,
        email: 'customer@example.com',
        name: 'Customer Name',
        paid_generation_entitlement: 'paid',
      }),
      update: async (...args: unknown[]) => {
        updates.push(args);
      },
    });
    deps.set(PolarService, {
      getBillingStatus: async () => ({
        configured: true,
        available: false,
        hasSubscription: false,
        meters: [],
        portalUrl: null,
        error: 'Polar timeout',
      }),
    });

    const response = await routeApp(deps).request('/api/billing/status', {
      headers: { authorization: 'Bearer test-token' },
    });

    assert.equal(response.status, 200);
    const body = await response.json() as { entitlement: string; available: boolean; error: string };
    assert.equal(body.entitlement, 'paid');
    assert.equal(body.available, false);
    assert.equal(body.error, 'Polar timeout');
    assert.deepEqual(updates, []);
  });

  test('billing status preserves scheduled-cancellation access expiry during grace', async () => {
    const updates: unknown[] = [];
    const deps = new Map<unknown, unknown>();
    deps.set(AuthService, {
      verifyJWT: async () => ({ userId: 42 }),
    });
    deps.set(UserDAO, {
      findById: async () => ({
        id: 42,
        email: 'customer@example.com',
        name: 'Customer Name',
        paid_generation_entitlement: 'paid',
        polar_paid_access_expires_at: '2999-07-01T00:00:00.000Z',
      }),
      update: async (...args: unknown[]) => {
        updates.push(args);
      },
    });
    deps.set(PolarService, {
      getBillingStatus: async () => ({
        configured: true,
        available: true,
        hasSubscription: true,
        meters: [
          {
            meterSlug: 'gemini_images',
            consumed: 1,
            credited: 25,
            remaining: 24,
            percentUsed: 4,
            hasLimit: true,
          },
        ],
        portalUrl: null,
        subscription: {
          status: 'active',
          currentPeriodStart: new Date('2026-06-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
        },
      }),
    });

    const response = await routeApp(deps).request('/api/billing/status', {
      headers: { authorization: 'Bearer test-token' },
    });

    assert.equal(response.status, 200);
    assert.equal(updates.length, 1);
    const update = (updates[0] as unknown[])[1] as {
      paid_generation_entitlement: string;
      polar_paid_access_expires_at: string | null;
    };
    assert.equal(update.paid_generation_entitlement, 'paid');
    assert.equal(update.polar_paid_access_expires_at, '2999-07-01T00:00:00.000Z');
  });

  test('checkout route creates Polar checkout for the authenticated user', async () => {
    const calls: unknown[] = [];
    const deps = new Map<unknown, unknown>();
    deps.set(AuthService, {
      verifyJWT: async () => ({ userId: 42 }),
    });
    deps.set(UserDAO, {
      findById: async () => ({
        id: 42,
        email: 'customer@example.com',
        name: 'Customer Name',
        paid_generation_entitlement: 'none',
      }),
    });
    deps.set(PolarService, {
      getPaidGenerationCheckoutUrl: async (...args: unknown[]) => {
        calls.push(args);
        return 'https://checkout.polar.sh/session';
      },
    });

    const response = await routeApp(deps).request('/api/billing/checkout?return_url=/spaces/space-1', {
      headers: { authorization: 'Bearer test-token' },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { url: 'https://checkout.polar.sh/session' });
    assert.deepEqual(calls, [
      [
        { userId: 42, email: 'customer@example.com', name: 'Customer Name' },
        {
          returnUrl: 'http://localhost/spaces/space-1',
          successUrl: 'http://localhost/profile?billing=checkout_success',
        },
      ],
    ]);
  });

  test('checkout route rejects unavailable checkout configuration', async () => {
    const deps = new Map<unknown, unknown>();
    deps.set(AuthService, {
      verifyJWT: async () => ({ userId: 42 }),
    });
    deps.set(UserDAO, {
      findById: async () => ({
        id: 42,
        email: 'customer@example.com',
        name: 'Customer Name',
        paid_generation_entitlement: 'none',
      }),
    });
    deps.set(PolarService, {
      getPaidGenerationCheckoutUrl: async () => null,
    });

    const response = await routeApp(deps).request('/api/billing/checkout', {
      headers: { authorization: 'Bearer test-token' },
    });

    assert.equal(response.status, 503);
    const body = await response.json() as { error: string };
    assert.equal(body.error, 'Checkout not available');
  });

  test('checkout route falls back when return URL is cross-origin', async () => {
    const calls: unknown[] = [];
    const deps = new Map<unknown, unknown>();
    deps.set(AuthService, {
      verifyJWT: async () => ({ userId: 42 }),
    });
    deps.set(UserDAO, {
      findById: async () => ({
        id: 42,
        email: 'customer@example.com',
        name: 'Customer Name',
        paid_generation_entitlement: 'none',
      }),
    });
    deps.set(PolarService, {
      getPaidGenerationCheckoutUrl: async (...args: unknown[]) => {
        calls.push(args);
        return 'https://checkout.polar.sh/session';
      },
    });

    const response = await routeApp(deps).request('/api/billing/checkout?return_url=https://example.com/phish', {
      headers: { authorization: 'Bearer test-token' },
    });

    assert.equal(response.status, 200);
    assert.deepEqual((calls[0] as unknown[])[1], {
      returnUrl: 'http://localhost/profile',
      successUrl: 'http://localhost/profile?billing=checkout_success',
    });
  });

  test('operational checks report missing Polar meters as critical', async () => {
    const deps = new Map<unknown, unknown>();
    deps.set(AuthService, {
      verifyJWT: async () => ({ userId: 42 }),
    });
    deps.set(UsageEventDAO, {
      getSyncHealth: async () => ({
        pending: 0,
        failed: 0,
        synced: 12,
        oldestPendingCreatedAt: null,
        oldestFailedCreatedAt: null,
        lastSyncedAt: '2026-06-17T10:00:00.000Z',
        lastSyncAttemptAt: '2026-06-17T10:00:00.000Z',
      }),
      getInternalBillingHealth: async () => ({
        internalUsers: 1,
        billableEvents: 0,
        nonBillableEvents: 3,
      }),
    });
    deps.set(UserDAO, {
      countWithoutPolarCustomer: async () => 0,
    });
    deps.set(PolarService, {
      isConfigured: () => true,
      getPaidGenerationProductInfo: async () => paidGenerationProduct(),
      listMeters: async () => [
        polarMeter('gemini_images', { aggregation: 'count', aggregationProperty: null }),
      ],
    });

    const response = await routeApp(deps, { ADMIN_USER_IDS: '42' }).request('/api/billing/operational-checks', {
      headers: { authorization: 'Bearer test-token' },
    });

    assert.equal(response.status, 200);
    const body = await response.json() as {
      status: string;
      checks: { polarMeters: { status: string; missing: string[] } };
    };
    assert.equal(body.status, 'critical');
    assert.equal(body.checks.polarMeters.status, 'critical');
    assert.ok(body.checks.polarMeters.missing.includes('claude_input_tokens'));
  });

  test('operational checks report internal billable usage as critical', async () => {
    const deps = new Map<unknown, unknown>();
    deps.set(AuthService, {
      verifyJWT: async () => ({ userId: 42 }),
    });
    deps.set(UsageEventDAO, {
      getSyncHealth: async () => ({
        pending: 0,
        failed: 0,
        synced: 12,
        oldestPendingCreatedAt: null,
        oldestFailedCreatedAt: null,
        lastSyncedAt: '2026-06-17T10:00:00.000Z',
        lastSyncAttemptAt: '2026-06-17T10:00:00.000Z',
      }),
      getInternalBillingHealth: async () => ({
        internalUsers: 1,
        billableEvents: 1,
        nonBillableEvents: 2,
      }),
    });
    deps.set(UserDAO, {
      countWithoutPolarCustomer: async () => 0,
    });
    deps.set(PolarService, {
      isConfigured: () => true,
      getPaidGenerationProductInfo: async () => paidGenerationProduct(),
      listMeters: async () => [
        polarMeter('claude_input_tokens'),
        polarMeter('claude_output_tokens'),
        polarMeter('gemini_images'),
        polarMeter('gemini_videos'),
        polarMeter('gemini_audio'),
        polarMeter('gemini_input_tokens'),
        polarMeter('gemini_output_tokens'),
        polarMeter('elevenlabs_audio'),
      ],
    });

    const response = await routeApp(deps, { ADMIN_USER_IDS: '42' }).request('/api/billing/operational-checks', {
      headers: { authorization: 'Bearer test-token' },
    });

    assert.equal(response.status, 200);
    const body = await response.json() as {
      status: string;
      checks: { internalUsers: { status: string; billableEvents: number; nonBillableEvents: number } };
    };
    assert.equal(body.status, 'critical');
    assert.equal(body.checks.internalUsers.status, 'critical');
    assert.equal(body.checks.internalUsers.billableEvents, 1);
    assert.equal(body.checks.internalUsers.nonBillableEvents, 2);
  });

  test('operational checks reject meters with non-equality event filters', async () => {
    const deps = new Map<unknown, unknown>();
    deps.set(AuthService, {
      verifyJWT: async () => ({ userId: 42 }),
    });
    deps.set(UsageEventDAO, {
      getSyncHealth: async () => ({
        pending: 0,
        failed: 0,
        synced: 12,
        oldestPendingCreatedAt: null,
        oldestFailedCreatedAt: null,
        lastSyncedAt: '2026-06-17T10:00:00.000Z',
        lastSyncAttemptAt: '2026-06-17T10:00:00.000Z',
      }),
      getInternalBillingHealth: async () => ({
        internalUsers: 1,
        billableEvents: 0,
        nonBillableEvents: 2,
      }),
    });
    deps.set(UserDAO, {
      countWithoutPolarCustomer: async () => 0,
    });
    deps.set(PolarService, {
      isConfigured: () => true,
      getPaidGenerationProductInfo: async () => paidGenerationProduct(),
      listMeters: async () => [
        polarMeter('claude_input_tokens'),
        polarMeter('claude_output_tokens'),
        polarMeter('gemini_images', {
          filter: {
            conjunction: 'and',
            clauses: [
              { property: 'name', operator: 'ne', value: 'gemini_images' },
            ],
          },
        }),
        polarMeter('gemini_videos'),
        polarMeter('gemini_audio'),
        polarMeter('gemini_input_tokens'),
        polarMeter('gemini_output_tokens'),
        polarMeter('elevenlabs_audio'),
      ],
    });

    const response = await routeApp(deps, { ADMIN_USER_IDS: '42' }).request('/api/billing/operational-checks', {
      headers: { authorization: 'Bearer test-token' },
    });

    assert.equal(response.status, 200);
    const body = await response.json() as {
      status: string;
      checks: { polarMeters: { status: string; invalid: Array<{ name: string }> } };
    };
    assert.equal(body.status, 'critical');
    assert.equal(body.checks.polarMeters.status, 'critical');
    assert.deepEqual(body.checks.polarMeters.invalid.map((meter) => meter.name), ['gemini_images']);
  });

  test('operational checks report missing product metered prices as critical', async () => {
    const deps = new Map<unknown, unknown>();
    deps.set(AuthService, {
      verifyJWT: async () => ({ userId: 42 }),
    });
    deps.set(UsageEventDAO, {
      getSyncHealth: async () => ({
        pending: 0,
        failed: 0,
        synced: 12,
        oldestPendingCreatedAt: null,
        oldestFailedCreatedAt: null,
        lastSyncedAt: '2026-06-17T10:00:00.000Z',
        lastSyncAttemptAt: '2026-06-17T10:00:00.000Z',
      }),
      getInternalBillingHealth: async () => ({
        internalUsers: 1,
        billableEvents: 0,
        nonBillableEvents: 2,
      }),
    });
    deps.set(UserDAO, {
      countWithoutPolarCustomer: async () => 0,
    });
    deps.set(PolarService, {
      isConfigured: () => true,
      getPaidGenerationProductInfo: async () => paidGenerationProduct({
        meteredPriceMeters: [
          'claude_input_tokens',
          'claude_output_tokens',
          'gemini_videos',
          'gemini_audio',
          'gemini_input_tokens',
          'gemini_output_tokens',
          'elevenlabs_audio',
        ],
      }),
      listMeters: async () => [
        polarMeter('claude_input_tokens'),
        polarMeter('claude_output_tokens'),
        polarMeter('gemini_images'),
        polarMeter('gemini_videos'),
        polarMeter('gemini_audio'),
        polarMeter('gemini_input_tokens'),
        polarMeter('gemini_output_tokens'),
        polarMeter('elevenlabs_audio'),
      ],
    });

    const response = await routeApp(deps, { ADMIN_USER_IDS: '42' }).request('/api/billing/operational-checks', {
      headers: { authorization: 'Bearer test-token' },
    });

    assert.equal(response.status, 200);
    const body = await response.json() as {
      status: string;
      checks: {
        paidGenerationProduct: {
          status: string;
          missingMeteredPriceMeters: string[];
        };
      };
    };
    assert.equal(body.status, 'critical');
    assert.equal(body.checks.paidGenerationProduct.status, 'critical');
    assert.deepEqual(body.checks.paidGenerationProduct.missingMeteredPriceMeters, ['gemini_images']);
  });

  test('reconcile compares local billable usage to Polar meters for cached billing period', async () => {
    const localUsageCalls: unknown[] = [];
    const deps = new Map<unknown, unknown>();
    deps.set(AuthService, {
      verifyJWT: async () => ({ userId: 42 }),
    });
    deps.set(UserDAO, {
      findById: async (userId: number) => {
        assert.equal(userId, 99);
        return {
          id: 99,
          polar_current_period_start: '2026-06-10T00:00:00.000Z',
          polar_current_period_end: '2026-07-10T00:00:00.000Z',
        };
      },
    });
    deps.set(UsageEventDAO, {
      getBillableUsageTotalsForPeriod: async (...args: unknown[]) => {
        localUsageCalls.push(args);
        return {
          gemini_images: 5,
          claude_input_tokens: 12,
        };
      },
    });
    deps.set(PolarService, {
      isConfigured: () => true,
      getCustomerUsage: async (userId: number) => {
        assert.equal(userId, 99);
        return {
          period: {
            start: new Date('2026-06-01T00:00:00.000Z'),
            end: new Date('2026-07-01T00:00:00.000Z'),
          },
          meters: {
            gemini_images: { used: 4, limit: 10 },
            claude_input_tokens: { used: 12, limit: null },
          },
        };
      },
    });

    const response = await routeApp(deps, { ADMIN_USER_IDS: '42' }).request('/api/billing/reconcile?user_id=99', {
      headers: { authorization: 'Bearer test-token' },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(localUsageCalls, [[
      99,
      '2026-06-10T00:00:00.000Z',
      '2026-07-10T00:00:00.000Z',
    ]]);
    const body = await response.json() as {
      status: string;
      mismatches: Array<{ name: string; local: number; polar: number; delta: number }>;
    };
    assert.equal(body.status, 'mismatch');
    assert.deepEqual(body.mismatches, [
      { name: 'gemini_images', local: 5, polar: 4, delta: 1, matched: false },
    ]);
  });

  test('reconcile requires a target user id', async () => {
    const deps = new Map<unknown, unknown>();
    deps.set(AuthService, {
      verifyJWT: async () => ({ userId: 42 }),
    });

    const response = await routeApp(deps, { ADMIN_USER_IDS: '42' }).request('/api/billing/reconcile', {
      headers: { authorization: 'Bearer test-token' },
    });

    assert.equal(response.status, 400);
  });
});
