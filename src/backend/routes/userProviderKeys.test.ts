import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenApiRouter } from './openapi';
import type { AppContext } from './types';
import { userRoutes } from './user';
import { AuthService } from '../features/auth/auth-service';
import { apiFetch } from '../../api/client';
import { createLocalKeyBrokerServiceBinding } from '../key-broker/testHarness';

const baseUrl = 'https://inventory.test';
const authHeaders = { Authorization: 'Bearer test-token' };

function encryptionKey(): string {
  return Buffer.from(new Uint8Array(32).fill(13)).toString('base64');
}

type ProviderKeyRow = {
  user_id: number;
  provider: string;
  encrypted_api_key: string;
  key_hint: string;
  updated_at: string;
};

type KeyEnvelopeRow = {
  scope_id: string;
  wrapped_dek: string;
  dek_version: number;
  kek_version: number;
};

class FakeD1 {
  rows = new Map<string, ProviderKeyRow>();
  envelopes = new Map<string, KeyEnvelopeRow>();

  prepare(sql: string) {
    const { rows, envelopes } = this;
    return {
      bindings: [] as unknown[],
      bind(...bindings: unknown[]) {
        this.bindings = bindings;
        return this;
      },
      async all<T>() {
        if (sql.includes('SELECT provider, key_hint, updated_at')) {
          const [userId] = this.bindings;
          return {
            results: [...rows.values()]
              .filter((row) => row.user_id === userId)
              .map((row) => ({
                provider: row.provider,
                key_hint: row.key_hint,
                updated_at: row.updated_at,
              })),
          } as { results: T[] };
        }
        return { results: [] as T[] };
      },
      async first<T>() {
        if (sql.includes('FROM key_envelopes')) {
          const [scopeId] = this.bindings;
          const row = envelopes.get(String(scopeId));
          return (row
            ? {
              wrapped_dek: row.wrapped_dek,
              dek_version: row.dek_version,
              kek_version: row.kek_version,
            }
            : null) as T | null;
        }

        const [userId, provider] = this.bindings;
        const row = rows.get(`${userId}:${provider}`);
        if (sql.includes('SELECT encrypted_api_key')) {
          return (row ? { encrypted_api_key: row.encrypted_api_key } : null) as T | null;
        }
        return null;
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
              scope_id: scopeId,
              wrapped_dek: wrappedDek,
              dek_version: dekVersion,
              kek_version: kekVersion,
            });
          }
          return { success: true };
        }

        if (sql.includes('INSERT INTO user_provider_keys')) {
          const [userId, provider, encrypted, hint, _createdAt, updatedAt] = this.bindings as [
            number,
            string,
            string,
            string,
            string,
            string,
          ];
          rows.set(`${userId}:${provider}`, {
            user_id: userId,
            provider,
            encrypted_api_key: encrypted,
            key_hint: hint,
            updated_at: updatedAt,
          });
          return { success: true };
        }

        if (sql.includes('DELETE FROM user_provider_keys')) {
          const [userId, provider] = this.bindings;
          rows.delete(`${userId}:${provider}`);
          return { success: true };
        }

        return { success: true };
      },
    };
  }
}

function routeApp(db: FakeD1, envOverrides: Partial<AppContext['Bindings']> = {}) {
  const app = createOpenApiRouter();
  app.use('*', async (c, next) => {
    c.env = {
      DB: db,
      ENVIRONMENT: 'test',
      KEY_BROKER: createLocalKeyBrokerServiceBinding({
        DB: db as never,
        BYOK_ACTIVE_KEK_VERSION: '1',
        BYOK_KEK_V1: encryptionKey(),
      }),
      ...envOverrides,
    } as unknown as AppContext['Bindings'];
    c.set('container', {
      get: (token: unknown) => {
        if (token === AuthService) {
          return { verifyJWT: async () => ({ userId: 7 }) };
        }
        throw new Error('Missing fake dependency');
      },
    } as never);
    await next();
  });
  app.route('/', userRoutes);
  return app;
}

function bindFetch(app: ReturnType<typeof routeApp>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    return app.request(url, init);
  }) as typeof fetch;
}

function assertNoKeyMaterial(value: unknown, forbidden: string[]) {
  const json = JSON.stringify(value);
  assert.doesNotMatch(json, /encrypted_api_key|wrapped_dek|apiKey|enc:v2/);
  for (const secret of forbidden) {
    assert.equal(json.includes(secret), false, `response leaked ${secret}`);
  }
}

describe('user provider key routes', () => {
  test('stores, replaces, lists, and deletes provider keys through the broker without leaking key material', async () => {
    const db = new FakeD1();
    const fetch = bindFetch(routeApp(db));
    const firstKey = 'not-anthropic key with spaces 1234';
    const secondKey = 'replacement-value-9876';

    const saved = await apiFetch('PUT /api/user/provider-keys/:provider', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { provider: 'anthropic' },
      json: { apiKey: firstKey },
    });

    assert.equal(saved.provider.configured, true);
    assert.equal(saved.provider.keyHint, '****1234');
    assertNoKeyMaterial(saved, [firstKey]);

    const firstRow = db.rows.get('7:anthropic');
    assert.ok(firstRow);
    assert.match(firstRow.encrypted_api_key, /^enc:v2:1:1:/);
    assert.equal(firstRow.key_hint, '****1234');
    assert.equal(firstRow.encrypted_api_key.includes(firstKey), false);
    assert.equal(db.envelopes.has('user:7'), true);

    const replaced = await apiFetch('PUT /api/user/provider-keys/:provider', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { provider: 'anthropic' },
      json: { apiKey: secondKey },
    });

    assert.equal(replaced.provider.keyHint, '****9876');
    assertNoKeyMaterial(replaced, [firstKey, secondKey]);

    const replacedRow = db.rows.get('7:anthropic');
    assert.ok(replacedRow);
    assert.match(replacedRow.encrypted_api_key, /^enc:v2:1:1:/);
    assert.notEqual(replacedRow.encrypted_api_key, firstRow.encrypted_api_key);
    assert.equal(replacedRow.encrypted_api_key.includes(secondKey), false);

    const listed = await apiFetch('GET /api/user/provider-keys', {
      fetch,
      baseUrl,
      headers: authHeaders,
    });

    const anthropic = listed.providers.find((item) => item.provider === 'anthropic');
    assert.equal(anthropic?.configured, true);
    assert.equal(anthropic?.keyHint, '****9876');
    assertNoKeyMaterial(listed, [firstKey, secondKey]);

    const deleted = await apiFetch('DELETE /api/user/provider-keys/:provider', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { provider: 'anthropic' },
    });

    assert.equal(deleted.provider.configured, false);
    assert.equal(deleted.provider.keyHint, null);
    assert.equal(db.rows.has('7:anthropic'), false);
    assertNoKeyMaterial(deleted, [firstKey, secondKey]);
  });

  test('rejects empty provider keys before calling the broker', async () => {
    const db = new FakeD1();
    const fetch = bindFetch(routeApp(db));

    const response = await fetch(`${baseUrl}/api/user/provider-keys/google_ai`, {
      method: 'PUT',
      headers: {
        ...authHeaders,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ apiKey: '   ' }),
    });

    assert.equal(response.status, 400);
    assert.equal(db.rows.size, 0);
  });

  test('local development fallback stores and deletes keys in the local app database', async () => {
    const db = new FakeD1();
    const fetch = bindFetch(routeApp(db, {
      ENVIRONMENT: 'local',
      ENCRYPTION_KEY: encryptionKey(),
      KEY_BROKER: undefined,
    }));
    const apiKey = 'local-provider-key-2468';

    const saved = await apiFetch('PUT /api/user/provider-keys/:provider', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { provider: 'google_ai' },
      json: { apiKey },
    });

    assert.equal(saved.provider.configured, true);
    assert.equal(saved.provider.keyHint, '****2468');

    const localRow = db.rows.get('7:google_ai');
    assert.ok(localRow);
    assert.match(localRow.encrypted_api_key, /^enc:v2:1:1:/);
    assert.equal(localRow.key_hint, '****2468');

    const listed = await apiFetch('GET /api/user/provider-keys', {
      fetch,
      baseUrl,
      headers: authHeaders,
    });
    assert.equal(listed.providers.find((item) => item.provider === 'google_ai')?.configured, true);

    await apiFetch('DELETE /api/user/provider-keys/:provider', {
      fetch,
      baseUrl,
      headers: authHeaders,
      params: { provider: 'google_ai' },
    });

    assert.equal(db.rows.has('7:google_ai'), false);
  });
});
