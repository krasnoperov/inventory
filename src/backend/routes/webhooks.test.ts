import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { Webhook } from 'standardwebhooks';
import { UserDAO } from '../../dao/user-dao';
import { PolarService } from '../services/polarService';
import type { AppContext } from './types';
import { webhookRoutes } from './webhooks';

const webhookSecret = 'polar-webhook-secret';

function routeApp(deps: Map<unknown, unknown>, envOverrides: Partial<AppContext['Bindings']> = {}) {
  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    c.env = {
      POLAR_WEBHOOK_SECRET: webhookSecret,
      ...envOverrides,
    } as unknown as AppContext['Bindings'];
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
  app.route('/', webhookRoutes);
  return app;
}

function routeDeps(userDAO: unknown, polarService: unknown = {}) {
  const deps = new Map<unknown, unknown>();
  deps.set(UserDAO, userDAO);
  deps.set(PolarService, polarService);
  return deps;
}

function signHeaders(body: string, timestamp = new Date()) {
  const webhookId = 'msg_test';
  const timestampSeconds = Math.floor(timestamp.getTime() / 1000).toString();
  const base64Secret = Buffer.from(webhookSecret, 'utf-8').toString('base64');
  const signature = new Webhook(base64Secret).sign(webhookId, timestamp, body);

  return {
    'content-type': 'application/json',
    'webhook-id': webhookId,
    'webhook-timestamp': timestampSeconds,
    'webhook-signature': signature,
  };
}

function subscriptionCanceledPayload(externalId = '42', status = 'canceled') {
  return {
    type: 'subscription.canceled',
    timestamp: new Date().toISOString(),
    data: {
      id: 'sub_123',
      status,
      current_period_end: '2026-07-01T00:00:00.000Z',
      canceled_at: '2026-06-17T00:00:00.000Z',
      customer: {
        id: 'cus_123',
        email: 'artist@example.test',
        external_id: externalId,
      },
    },
  };
}

describe('Polar webhook route', () => {
  test('rejects requests without Standard Webhooks headers when a secret is configured', async () => {
    const updates: unknown[] = [];
    const app = routeApp(routeDeps({
      update: async (...args: unknown[]) => {
        updates.push(args);
      },
    }));

    const response = await app.request('/api/webhooks/polar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(subscriptionCanceledPayload()),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(updates, []);
  });

  test('rejects a tampered body even when Standard Webhooks headers are present', async () => {
    const updates: unknown[] = [];
    const app = routeApp(routeDeps({
      update: async (...args: unknown[]) => {
        updates.push(args);
      },
    }));

    const signedBody = JSON.stringify(subscriptionCanceledPayload());
    const tamperedBody = JSON.stringify(subscriptionCanceledPayload('43'));
    const response = await app.request('/api/webhooks/polar', {
      method: 'POST',
      headers: signHeaders(signedBody),
      body: tamperedBody,
    });

    assert.equal(response.status, 401);
    assert.deepEqual(updates, []);
  });

  test('accepts a valid subscription cancellation and revokes cached quota limits', async () => {
    const updates: unknown[] = [];
    const app = routeApp(routeDeps({
      update: async (...args: unknown[]) => {
        updates.push(args);
      },
    }));

    const body = JSON.stringify(subscriptionCanceledPayload());
    const response = await app.request('/api/webhooks/polar', {
      method: 'POST',
      headers: signHeaders(body),
      body,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true });
    assert.equal(updates.length, 1);
    assert.equal((updates[0] as unknown[])[0], 42);
    assert.equal(((updates[0] as unknown[])[1] as { paid_generation_entitlement: string }).paid_generation_entitlement, 'none');
    assert.deepEqual(JSON.parse(((updates[0] as unknown[])[1] as { quota_limits: string }).quota_limits), {
      claude_input_tokens: 0,
      claude_output_tokens: 0,
      gemini_images: 0,
      gemini_videos: 0,
      gemini_input_tokens: 0,
      gemini_output_tokens: 0,
      elevenlabs_audio: 0,
    });
  });

  test('keeps quota limits for scheduled subscription cancellation while subscription is active', async () => {
    const updates: unknown[] = [];
    const meterLookups: unknown[] = [];
    const app = routeApp(routeDeps({
      update: async (...args: unknown[]) => {
        updates.push(args);
      },
    }, {
      getCustomerMeters: async (...args: unknown[]) => {
        meterLookups.push(args);
        return [
          { meterSlug: 'gemini_images', hasLimit: true, credited: 25 },
        ];
      },
    }));

    const body = JSON.stringify(subscriptionCanceledPayload('42', 'active'));
    const response = await app.request('/api/webhooks/polar', {
      method: 'POST',
      headers: signHeaders(body),
      body,
    });

    assert.equal(response.status, 200);
    assert.equal(meterLookups.length, 1);
    assert.deepEqual(meterLookups[0], [42]);
    assert.equal(updates.length, 1);
    assert.equal((updates[0] as unknown[])[0], 42);
    assert.equal(((updates[0] as unknown[])[1] as { paid_generation_entitlement: string }).paid_generation_entitlement, 'paid');
    assert.deepEqual(JSON.parse(((updates[0] as unknown[])[1] as { quota_limits: string }).quota_limits), {
      gemini_images: 25,
    });
  });

  test('does not update quota limits for non-numeric external customer IDs', async () => {
    const updates: unknown[] = [];
    const app = routeApp(routeDeps({
      update: async (...args: unknown[]) => {
        updates.push(args);
      },
    }));

    const body = JSON.stringify(subscriptionCanceledPayload('42-other'));
    const response = await app.request('/api/webhooks/polar', {
      method: 'POST',
      headers: signHeaders(body),
      body,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(updates, []);
  });

  test('refreshes limits from customer.state_changed payload with data.subscriptions', async () => {
    const updates: unknown[] = [];
    const meterLookups: unknown[] = [];
    const app = routeApp(routeDeps({
      update: async (...args: unknown[]) => {
        updates.push(args);
      },
    }, {
      getCustomerMeters: async (...args: unknown[]) => {
        meterLookups.push(args);
        return [
          { meterSlug: 'gemini_images', hasLimit: true, credited: 25 },
        ];
      },
    }));

    const body = JSON.stringify({
      type: 'customer.state_changed',
      timestamp: new Date().toISOString(),
      data: {
        customer: {
          id: 'cus_123',
          email: 'artist@example.test',
          external_id: '42',
        },
        subscriptions: [
          { id: 'sub_123', status: 'active' },
        ],
      },
    });
    const response = await app.request('/api/webhooks/polar', {
      method: 'POST',
      headers: signHeaders(body),
      body,
    });

    assert.equal(response.status, 200);
    assert.equal(meterLookups.length, 1);
    assert.deepEqual(meterLookups[0], [42]);
    assert.equal(updates.length, 1);
    assert.equal((updates[0] as unknown[])[0], 42);
    assert.equal(((updates[0] as unknown[])[1] as { paid_generation_entitlement: string }).paid_generation_entitlement, 'paid');
    assert.deepEqual(JSON.parse(((updates[0] as unknown[])[1] as { quota_limits: string }).quota_limits), {
      gemini_images: 25,
    });
  });

  test('refreshes limits from current customer.state_changed payload shape in unsigned dev mode', async () => {
    const updates: unknown[] = [];
    const app = routeApp(routeDeps({
      update: async (...args: unknown[]) => {
        updates.push(args);
      },
    }, {
      getCustomerMeters: async () => [
        { meterSlug: 'gemini_images', hasLimit: true, credited: 25 },
        { meterSlug: 'claude_input_tokens', hasLimit: false, credited: 0 },
      ],
    }), { POLAR_WEBHOOK_SECRET: undefined });

    const response = await app.request('/api/webhooks/polar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'customer.state_changed',
        timestamp: new Date().toISOString(),
        data: {
          id: 'cus_123',
          email: 'artist@example.test',
          external_id: '42',
          active_subscriptions: [{ id: 'sub_123' }],
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(updates.length, 1);
    assert.equal((updates[0] as unknown[])[0], 42);
    assert.equal(((updates[0] as unknown[])[1] as { paid_generation_entitlement: string }).paid_generation_entitlement, 'paid');
    assert.deepEqual(JSON.parse(((updates[0] as unknown[])[1] as { quota_limits: string }).quota_limits), {
      gemini_images: 25,
      claude_input_tokens: null,
    });
  });
});
