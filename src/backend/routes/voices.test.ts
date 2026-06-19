import { describe, test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { AuthService } from '../features/auth/auth-service';
import type { AppContext } from './types';
import { voicesRoutes } from './voices';

function routeApp(env: Partial<AppContext['Bindings']> = {}) {
  const deps = new Map<unknown, unknown>();
  deps.set(AuthService, { verifyJWT: async () => ({ userId: 7 }) });

  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    c.env = { ENVIRONMENT: 'stage', ...env } as unknown as AppContext['Bindings'];
    c.set('container', {
      get: (token: unknown) => {
        const dependency = deps.get(token);
        if (!dependency) throw new Error('Missing fake dependency');
        return dependency;
      },
    } as never);
    await next();
  });
  app.route('/', voicesRoutes);
  return app;
}

const authedRequest = (app: Hono<AppContext>) =>
  app.request('/api/voices', { headers: { authorization: 'Bearer test-token' } });

describe('voicesRoutes', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  test('requires authentication', async () => {
    const response = await routeApp().request('/api/voices');
    assert.equal(response.status, 401);
  });

  test('returns available:false when ElevenLabs is not the active provider', async () => {
    const response = await authedRequest(routeApp({ INVENTORY_AUDIO_PROVIDER: 'fake', ELEVENLABS_API_KEY: 'k' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { available: false, voices: [] });
  });

  test('returns available:false when no API key is configured', async () => {
    const response = await authedRequest(routeApp({ INVENTORY_AUDIO_PROVIDER: 'elevenlabs' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { available: false, voices: [] });
  });

  test('proxies the ElevenLabs voice library when configured', async () => {
    mock.method(globalThis, 'fetch', async () =>
      new Response(JSON.stringify({ voices: [{ voice_id: 'v1', name: 'Rachel' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const response = await authedRequest(
      routeApp({ INVENTORY_AUDIO_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'secret' })
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as { available: boolean; voices: Array<{ voiceId: string; name: string }> };
    assert.equal(body.available, true);
    assert.equal(body.voices.length, 1);
    assert.equal(body.voices[0].voiceId, 'v1');
    assert.equal(body.voices[0].name, 'Rachel');
  });

  test('treats ElevenLabs as the provider in production without an explicit override', async () => {
    mock.method(globalThis, 'fetch', async () =>
      new Response(JSON.stringify({ voices: [{ voice_id: 'v1', name: 'Rachel' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    // No INVENTORY_AUDIO_PROVIDER set — prod resolves to ElevenLabs automatically.
    const response = await authedRequest(
      routeApp({ ENVIRONMENT: 'production', ELEVENLABS_API_KEY: 'secret' })
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as { available: boolean; voices: unknown[] };
    assert.equal(body.available, true);
    assert.equal(body.voices.length, 1);
  });

  test('returns 502 when the ElevenLabs request fails', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 500 }));

    const response = await authedRequest(
      routeApp({ INVENTORY_AUDIO_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'secret' })
    );

    assert.equal(response.status, 502);
    const body = (await response.json()) as { available: boolean; voices: unknown[] };
    assert.deepEqual(body.voices, []);
  });
});
