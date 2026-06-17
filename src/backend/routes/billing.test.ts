import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { AuthService } from '../features/auth/auth-service';
import { UserDAO } from '../../dao/user-dao';
import { PolarService } from '../services/polarService';
import type { AppContext } from './types';
import { billingRoutes } from './billing';

function routeApp(deps: Map<unknown, unknown>) {
  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    c.env = { ENVIRONMENT: 'stage' } as unknown as AppContext['Bindings'];
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
});
