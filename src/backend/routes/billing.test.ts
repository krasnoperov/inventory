import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { AuthService } from '../features/auth/auth-service';
import { UserDAO } from '../../dao/user-dao';
import { PolarService } from '../services/polarService';
import { UsageService } from '../services/usageService';
import { UsageEventDAO } from '../../dao/usage-event-dao';
import { ProviderUsageLedgerDAO } from '../../dao/provider-usage-ledger-dao';
import { CustomerChargeLedgerDAO } from '../../dao/customer-charge-ledger-dao';
import { PlatformUsageEventDAO } from '../../dao/platform-usage-event-dao';
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
    planKey: 'paid_generation',
    productIdEnvVar: 'POLAR_PAID_GENERATION_PRODUCT_ID',
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
  test('usage route forwards period usage and provider cost', async () => {
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
    const body = await response.json() as {
      entitlement: string;
      plan: {
        key: string;
        displayName: string;
        status: string;
        checkoutAvailable: boolean;
        portalAvailable: boolean;
      };
    };
    assert.equal(body.entitlement, 'none');
    assert.deepEqual(body.plan, {
      key: 'paid_generation',
      displayName: 'Paid Generation',
      status: 'inactive',
      checkoutAvailable: true,
      portalAvailable: false,
    });
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
    const body = await response.json() as {
      entitlement: string;
      available: boolean;
      error: string;
      plan: { status: string; checkoutAvailable: boolean };
    };
    assert.equal(body.entitlement, 'paid');
    assert.equal(body.available, false);
    assert.equal(body.error, 'Polar timeout');
    assert.equal(body.plan.status, 'active');
    assert.equal(body.plan.checkoutAvailable, false);
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
    const body = await response.json() as {
      plan: {
        key: string;
        displayName: string;
        status: string;
        checkoutAvailable: boolean;
        portalAvailable: boolean;
      };
    };
    assert.deepEqual(body.plan, {
      key: 'paid_generation',
      displayName: 'Paid Generation',
      status: 'active',
      checkoutAvailable: false,
      portalAvailable: false,
    });
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

  test('spend summary forwards admin filters to provider cost ledger', async () => {
    const calls: unknown[] = [];
    const deps = new Map<unknown, unknown>();
    deps.set(AuthService, {
      verifyJWT: async () => ({ userId: 42 }),
    });
    deps.set(ProviderUsageLedgerDAO, {
      getSpendSummary: async (options: unknown) => {
        calls.push(options);
        return {
          period: { from: '2026-06-01', to: '2026-06-30' },
          filters: {
            userId: 99,
            spaceId: 'space-1',
            provider: 'gemini',
            mediaKind: 'image',
          },
          totals: {
            amountMicroUsd: 250000,
            amountUsd: 0.25,
            quantity: 2,
            entries: 2,
            unpricedEntries: 1,
          },
          byProvider: [
            {
              provider: 'gemini',
              amountMicroUsd: 250000,
              amountUsd: 0.25,
              quantity: 2,
              entries: 2,
              unpricedEntries: 1,
            },
          ],
          byModel: [],
          byMediaKind: [],
          byMeterEventName: [],
          bySpace: [
            {
              spaceId: 'space-1',
              amountMicroUsd: 250000,
              amountUsd: 0.25,
              quantity: 2,
              entries: 2,
              unpricedEntries: 1,
            },
          ],
          byAsset: [
            {
              spaceId: 'space-1',
              assetId: 'asset-1',
              amountMicroUsd: 250000,
              amountUsd: 0.25,
              quantity: 2,
              entries: 2,
              unpricedEntries: 1,
            },
          ],
        };
      },
    });

    const response = await routeApp(deps, { ADMIN_USER_IDS: '42' }).request(
      '/api/billing/spend/summary?from=2026-06-01&to=2026-06-30&user_id=99&space_id=space-1&provider=gemini&media_kind=image',
      { headers: { authorization: 'Bearer test-token' } }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [{
      from: '2026-06-01',
      to: '2026-06-30',
      userId: 99,
      spaceId: 'space-1',
      provider: 'gemini',
      mediaKind: 'image',
    }]);
    assert.deepEqual(await response.json(), {
      success: true,
      period: { from: '2026-06-01', to: '2026-06-30' },
      filters: {
        userId: 99,
        spaceId: 'space-1',
        provider: 'gemini',
        mediaKind: 'image',
      },
      totals: {
        amountMicroUsd: 250000,
        amountUsd: 0.25,
        quantity: 2,
        entries: 2,
        unpricedEntries: 1,
      },
      byProvider: [
        {
          provider: 'gemini',
          amountMicroUsd: 250000,
          amountUsd: 0.25,
          quantity: 2,
          entries: 2,
          unpricedEntries: 1,
        },
      ],
      byModel: [],
      byMediaKind: [],
      byMeterEventName: [],
      bySpace: [
        {
          spaceId: 'space-1',
          amountMicroUsd: 250000,
          amountUsd: 0.25,
          quantity: 2,
          entries: 2,
          unpricedEntries: 1,
        },
      ],
      byAsset: [
        {
          spaceId: 'space-1',
          assetId: 'asset-1',
          amountMicroUsd: 250000,
          amountUsd: 0.25,
          quantity: 2,
          entries: 2,
          unpricedEntries: 1,
        },
      ],
    });
  });

  test('spend summary requires an admin user', async () => {
    const deps = new Map<unknown, unknown>();
    deps.set(AuthService, {
      verifyJWT: async () => ({ userId: 41 }),
    });

    const response = await routeApp(deps, { ADMIN_USER_IDS: '42' }).request('/api/billing/spend/summary', {
      headers: { authorization: 'Bearer test-token' },
    });

    assert.equal(response.status, 403);
  });

  test('spend summary rejects invalid user filters', async () => {
    const deps = new Map<unknown, unknown>();
    deps.set(AuthService, {
      verifyJWT: async () => ({ userId: 42 }),
    });

    const response = await routeApp(deps, { ADMIN_USER_IDS: '42' }).request('/api/billing/spend/summary?user_id=42abc', {
      headers: { authorization: 'Bearer test-token' },
    });

    assert.equal(response.status, 400);
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

  test('operational checks reject product meter-credit benefits for non-canonical meters', async () => {
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
        meterCreditBenefitMeters: ['gemini_images', 'legacy_meter'],
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
          unexpectedMeterCreditBenefitMeters: string[];
        };
      };
    };
    assert.equal(body.status, 'critical');
    assert.equal(body.checks.paidGenerationProduct.status, 'critical');
    assert.deepEqual(body.checks.paidGenerationProduct.unexpectedMeterCreditBenefitMeters, ['legacy_meter']);
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
    deps.set(CustomerChargeLedgerDAO, {
      getReconciliationForPeriod: async (userId: number, start: string, end: string) => {
        assert.equal(userId, 99);
        assert.equal(start, '2026-06-10T00:00:00.000Z');
        assert.equal(end, '2026-07-10T00:00:00.000Z');
        return {
          usageEvents: 2,
          chargeRows: 2,
          missingChargeRows: 0,
          orphanChargeRows: 0,
          billableUsageQuantity: 17,
          billableChargeQuantity: 17,
          billableQuantityDelta: 0,
          meters: [
            { name: 'claude_input_tokens', usageQuantity: 12, chargeQuantity: 12, delta: 0, matched: true },
            { name: 'gemini_images', usageQuantity: 5, chargeQuantity: 5, delta: 0, matched: true },
          ],
        };
      },
    });
    deps.set(ProviderUsageLedgerDAO, {
      getCostReconciliation: async (options: unknown) => {
        assert.deepEqual(options, {
          userId: 99,
          from: '2026-06-10T00:00:00.000Z',
          to: '2026-07-10T00:00:00.000Z',
        });
        return {
          totals: {
            amountMicroUsd: 240000,
            amountUsd: 0.24,
            quantity: 5,
            entries: 5,
            unpricedEntries: 0,
          },
          linkedUsageEvents: 5,
          linkedCustomerCharges: 5,
          missingUsageEventLinks: 0,
          missingCustomerChargeLinks: 0,
          byMeterEventName: [],
        };
      },
    });
    deps.set(PlatformUsageEventDAO, {
      getAccountSummary: async (userId: number, options: unknown) => {
        assert.equal(userId, 99);
        assert.deepEqual(options, {
          from: '2026-06-10T00:00:00.000Z',
          to: '2026-07-10T00:00:00.000Z',
        });
        return {
          userId,
          period: {
            from: '2026-06-10T00:00:00.000Z',
            to: '2026-07-10T00:00:00.000Z',
          },
          totals: {
            storageBytes: 4096,
            workflowRuns: 2,
            deliveryBytes: 1024,
          },
          eventsWithoutSpace: 0,
          byType: [],
          bySpace: [],
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
      providerCost: { totals: { amountMicroUsd: number } };
      platformUsage: { totals: { storageBytes: number } };
      alerts: Array<{ code: string; severity: string }>;
    };
    assert.equal(body.status, 'mismatch');
    assert.deepEqual(body.mismatches, [
      { name: 'gemini_images', local: 5, polar: 4, delta: 1, matched: false },
    ]);
    assert.equal(body.providerCost.totals.amountMicroUsd, 240000);
    assert.equal(body.platformUsage.totals.storageBytes, 4096);
    assert.deepEqual(body.alerts.map((alert) => alert.code), ['polar_meter_delta']);
  });

  test('reconcile alerts on customer, provider, and platform ledger anomalies', async () => {
    const deps = new Map<unknown, unknown>();
    deps.set(AuthService, {
      verifyJWT: async () => ({ userId: 42 }),
    });
    deps.set(UserDAO, {
      findById: async () => ({
        id: 99,
        polar_current_period_start: null,
        polar_current_period_end: null,
      }),
    });
    deps.set(UsageEventDAO, {
      getBillableUsageTotalsForPeriod: async () => ({
        gemini_images: 1,
      }),
    });
    deps.set(CustomerChargeLedgerDAO, {
      getReconciliationForPeriod: async () => ({
        usageEvents: 1,
        chargeRows: 0,
        missingChargeRows: 1,
        orphanChargeRows: 0,
        billableUsageQuantity: 1,
        billableChargeQuantity: 0,
        billableQuantityDelta: 1,
        meters: [
          { name: 'gemini_images', usageQuantity: 1, chargeQuantity: 0, delta: 1, matched: false },
        ],
      }),
    });
    deps.set(ProviderUsageLedgerDAO, {
      getCostReconciliation: async () => ({
        totals: {
          amountMicroUsd: 0,
          amountUsd: 0,
          quantity: 1,
          entries: 1,
          unpricedEntries: 1,
        },
        linkedUsageEvents: 1,
        linkedCustomerCharges: 0,
        missingUsageEventLinks: 0,
        missingCustomerChargeLinks: 1,
        byMeterEventName: [],
      }),
    });
    deps.set(PlatformUsageEventDAO, {
      getAccountSummary: async () => ({
        userId: 99,
        period: {
          from: '2026-06-01T00:00:00.000Z',
          to: '2026-07-01T00:00:00.000Z',
        },
        totals: {
          storageBytes: -512,
          workflowRuns: 0,
          deliveryBytes: 0,
        },
        eventsWithoutSpace: 0,
        byType: [],
        bySpace: [],
      }),
    });
    deps.set(PolarService, {
      isConfigured: () => true,
      getCustomerUsage: async () => ({
        period: {
          start: new Date('2026-06-01T00:00:00.000Z'),
          end: new Date('2026-07-01T00:00:00.000Z'),
        },
        meters: {
          gemini_images: { used: 1, limit: 10 },
        },
      }),
    });

    const response = await routeApp(deps, { ADMIN_USER_IDS: '42' }).request('/api/billing/reconcile?user_id=99', {
      headers: { authorization: 'Bearer test-token' },
    });

    assert.equal(response.status, 200);
    const body = await response.json() as {
      status: string;
      alerts: Array<{ code: string; severity: string }>;
    };
    assert.equal(body.status, 'mismatch');
    assert.deepEqual(body.alerts.map((alert) => [alert.code, alert.severity]), [
      ['missing_customer_charge_rows', 'critical'],
      ['customer_charge_quantity_delta', 'critical'],
      ['unpriced_provider_usage', 'warning'],
      ['provider_usage_missing_customer_charge', 'critical'],
      ['negative_platform_storage', 'warning'],
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
