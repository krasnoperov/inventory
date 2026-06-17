import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { AuthService } from '../features/auth/auth-service';
import { UserDAO } from '../../dao/user-dao';
import { PolarService } from '../services/polarService';
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
        { id: 'meter_5', name: 'gemini_input_tokens', aggregation: 'sum', archivedAt: null },
        { id: 'meter_6', name: 'gemini_output_tokens', aggregation: 'sum', archivedAt: null },
        { id: 'meter_7', name: 'elevenlabs_audio', aggregation: 'sum', archivedAt: null },
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
