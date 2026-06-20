import { describe, test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { AuthService } from '../features/auth/auth-service';
import type { AppContext } from './types';
import { voicesRoutes } from './voices';
import { decryptProviderApiKeyV2, encryptProviderApiKeyV2 } from '../services/providerKeyVault';

function encryptionKey(): string {
  return Buffer.from(new Uint8Array(32).fill(9)).toString('base64');
}

function providerKeyDb(encryptedKey: string) {
  const row = {
    encrypted_api_key: encryptedKey,
    key_hint: '****-key',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  const envelopes = new Map<string, { wrapped_dek: string; dek_version: number; kek_version: number }>();
  return {
    row,
    prepare: (sql: string) => ({
      bindings: [] as unknown[],
      bind(...bindings: unknown[]) {
        this.bindings = bindings;
        return this;
      },
      async first<T>() {
        if (sql.includes('FROM key_envelopes')) {
          const [scopeId] = this.bindings;
          return (envelopes.get(String(scopeId)) ?? null) as T | null;
        }
        return ({ encrypted_api_key: row.encrypted_api_key } as T);
      },
      async run() {
        if (sql.includes('INSERT OR IGNORE INTO key_envelopes')) {
          const [scopeId, wrappedDek, dekVersion, kekVersion] = this.bindings as [
            string,
            string,
            number,
            number,
          ];
          if (!envelopes.has(scopeId)) {
            envelopes.set(scopeId, {
              wrapped_dek: wrappedDek,
              dek_version: dekVersion,
              kek_version: kekVersion,
            });
          }
        }
        if (sql.includes('UPDATE user_provider_keys')) {
          const [encrypted, hint, updatedAt, _userId, _provider, previousEncrypted] = this.bindings as [
            string,
            string,
            string,
            number,
            string,
            string,
          ];
          if (row.encrypted_api_key === previousEncrypted) {
            row.encrypted_api_key = encrypted;
            row.key_hint = hint;
            row.updated_at = updatedAt;
          }
        }
        return { success: true };
      },
    }),
  };
}

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

  test('uses a stored ElevenLabs BYOK key for voice listing', async () => {
    const secret = encryptionKey();
    const db = providerKeyDb('');
    db.row.encrypted_api_key = await encryptProviderApiKeyV2(
      db as never,
      'user-elevenlabs-key',
      secret,
      7,
      'elevenlabs',
    );
    let observedKey: string | null = null;
    mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedKey = new Headers(init?.headers).get('xi-api-key');
      return new Response(JSON.stringify({ voices: [{ voice_id: 'v1', name: 'Rachel' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const response = await authedRequest(
      routeApp({
        INVENTORY_AUDIO_PROVIDER: 'elevenlabs',
        ELEVENLABS_API_KEY: 'platform-key',
        ENCRYPTION_KEY: secret,
        DB: db as never,
      })
    );

    assert.equal(response.status, 200);
    assert.equal(observedKey, 'user-elevenlabs-key');
    assert.match(db.row.encrypted_api_key, /^enc:v2:1:1:/);
    assert.equal(
      await decryptProviderApiKeyV2(db as never, db.row.encrypted_api_key, secret, 7, 'elevenlabs'),
      'user-elevenlabs-key',
    );
  });

  test('uses the key broker for stored BYOK keys when app KEK bindings are absent', async () => {
    let brokerCall: unknown = null;
    let observedKey: string | null = null;
    mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedKey = new Headers(init?.headers).get('xi-api-key');
      return new Response(JSON.stringify({ voices: [{ voice_id: 'v1', name: 'Rachel' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const response = await authedRequest(
      routeApp({
        INVENTORY_AUDIO_PROVIDER: 'elevenlabs',
        ELEVENLABS_API_KEY: 'platform-key',
        KEY_BROKER: {
          async resolveProviderKey(request: unknown) {
            brokerCall = request;
            return {
              tenant: { type: 'user', userId: 7 },
              provider: 'elevenlabs',
              apiKey: 'broker-elevenlabs-key',
              keySource: 'byok',
            };
          },
        } as never,
      })
    );

    assert.equal(response.status, 200);
    assert.equal(observedKey, 'broker-elevenlabs-key');
    assert.deepEqual(brokerCall, {
      tenant: { type: 'user', userId: 7 },
      provider: 'elevenlabs',
      purpose: 'runtime',
    });
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
