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
      [42, { paid_generation_entitlement: 'none' }],
    ]);
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
      listMeters: async () => [
        { id: 'meter_1', name: 'gemini_images', aggregation: 'count', archivedAt: null },
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
      listMeters: async () => [
        { id: 'meter_1', name: 'claude_input_tokens', aggregation: 'sum', archivedAt: null },
        { id: 'meter_2', name: 'claude_output_tokens', aggregation: 'sum', archivedAt: null },
        { id: 'meter_3', name: 'gemini_images', aggregation: 'count', archivedAt: null },
        { id: 'meter_4', name: 'gemini_videos', aggregation: 'count', archivedAt: null },
        { id: 'meter_5', name: 'gemini_audio', aggregation: 'count', archivedAt: null },
        { id: 'meter_6', name: 'gemini_input_tokens', aggregation: 'sum', archivedAt: null },
        { id: 'meter_7', name: 'gemini_output_tokens', aggregation: 'sum', archivedAt: null },
        { id: 'meter_8', name: 'elevenlabs_audio', aggregation: 'sum', archivedAt: null },
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
});
