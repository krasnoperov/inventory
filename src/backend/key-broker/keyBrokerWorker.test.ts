import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { keyBrokerClient } from './client';
import { KEY_BROKER_METHODS, isKeyBrokerMethod } from './contract';
import { createLocalKeyBrokerServiceBinding } from './testHarness';
import { decryptProviderApiKeyV2, encryptLegacyProviderApiKey } from '../services/providerKeyVault';

function encryptionKey(): string {
  return Buffer.from(new Uint8Array(32).fill(11)).toString('base64');
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
  updated_at: string;
};

type PlatformUsageRow = {
  user_id: number | null;
  usage_type: string;
  space_id: string;
  workflow_id: string | null;
  variant_id: string | null;
  request_id: string | null;
};

class FakeSecretsStoreSecret {
  getCalls = 0;

  constructor(private readonly value: string) {}

  async get(): Promise<string> {
    this.getCalls += 1;
    return this.value;
  }
}

class FakeD1 {
  rows = new Map<string, ProviderKeyRow>();
  envelopes = new Map<string, KeyEnvelopeRow>();
  platformUsage: PlatformUsageRow[] = [];

  prepare(sql: string) {
    const { rows, envelopes, platformUsage } = this;
    return {
      bindings: [] as unknown[],
      bind(...bindings: unknown[]) {
        this.bindings = bindings;
        return this;
      },
      async first<T>() {
        if (sql.includes('FROM platform_usage_events')) {
          const [userId, jobId, variantId, requestId, spaceId] = this.bindings;
          const row = platformUsage.find((candidate) => (
            candidate.user_id === userId &&
            candidate.usage_type === 'workflow' &&
            candidate.workflow_id === jobId &&
            candidate.variant_id === variantId &&
            candidate.request_id === requestId &&
            candidate.space_id === spaceId
          ));
          return (row ? { authorized: 1 } : null) as T | null;
        }

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
        if (sql.includes('SELECT 1 AS present')) {
          return (row ? { present: 1 } : null) as T | null;
        }
        if (sql.includes('SELECT encrypted_api_key')) {
          return (row ? { encrypted_api_key: row.encrypted_api_key } : null) as T | null;
        }
        return null;
      },
      async run() {
        if (sql.includes('INSERT OR IGNORE INTO key_envelopes')) {
          const [scopeId, wrappedDek, dekVersion, kekVersion, createdAt, updatedAt] = this.bindings as [
            string,
            string,
            number,
            number,
            string,
            string,
          ];
          if (!envelopes.has(scopeId)) {
            envelopes.set(scopeId, {
              scope_id: scopeId,
              wrapped_dek: wrappedDek,
              dek_version: dekVersion,
              kek_version: kekVersion,
              updated_at: updatedAt,
            });
          }
          assert.ok(createdAt);
          return { success: true };
        }

        if (sql.includes('UPDATE user_provider_keys')) {
          const [encrypted, hint, updatedAt, userId, provider, previousEncrypted] = this.bindings as [
            string,
            string,
            string,
            number,
            string,
            string,
          ];
          const key = `${userId}:${provider}`;
          const previous = rows.get(key);
          if (previous?.encrypted_api_key === previousEncrypted) {
            rows.set(key, {
              ...previous,
              encrypted_api_key: encrypted,
              key_hint: hint,
              updated_at: updatedAt,
            });
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        }

        if (sql.includes('INSERT INTO user_provider_keys')) {
          const [userId, provider, encrypted, hint, createdAt, updatedAt] = this.bindings as [
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
          assert.ok(createdAt);
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

describe('key broker service binding contract', () => {
  test('exposes only scoped custody methods', () => {
    assert.deepEqual([...KEY_BROKER_METHODS], [
      'storeProviderKey',
      'deleteProviderKey',
      'resolveProviderKey',
      'rotateTenantDek',
      'rewrapAllDeks',
    ]);

    for (const forbidden of ['decrypt', 'encrypt', 'unwrapDek', 'decryptProviderKey', 'encryptArbitraryValue']) {
      assert.equal(isKeyBrokerMethod(forbidden), false);
    }

    const service = createLocalKeyBrokerServiceBinding({
      DB: new FakeD1() as never,
      BYOK_KEK_V1: encryptionKey(),
    }) as unknown as Record<string, unknown>;

    assert.equal(service.decrypt, undefined);
    assert.equal(service.encrypt, undefined);
    assert.equal(service.unwrapDek, undefined);
  });

  test('stores and resolves provider keys through the service binding client path', async () => {
    const db = new FakeD1();
    const secret = new FakeSecretsStoreSecret(encryptionKey());
    const broker = keyBrokerClient(
      createLocalKeyBrokerServiceBinding({
        DB: db as never,
        BYOK_ACTIVE_KEK_VERSION: '1',
        BYOK_KEK_V1: secret,
      })
    );

    const tenant = { type: 'user' as const, userId: 7 };
    const stored = await broker.storeProviderKey({
      tenant,
      provider: 'google_ai',
      apiKey: 'tiny',
    });

    assert.equal(stored.provider, 'google_ai');
    assert.equal(stored.keyHint, '****');
    assert.equal(secret.getCalls, 1);

    const row = db.rows.get('7:google_ai');
    assert.ok(row);
    assert.notEqual(row.encrypted_api_key, 'tiny');
    assert.match(row.encrypted_api_key, /^enc:v2:1:1:/);
    assert.equal(db.envelopes.has('user:7'), true);
    db.platformUsage.push({
      user_id: 7,
      usage_type: 'workflow',
      space_id: 'space-1',
      workflow_id: 'variant-1',
      variant_id: 'variant-1',
      request_id: 'request-1',
    });

    const resolved = await broker.resolveProviderKey({
      tenant,
      provider: 'google_ai',
      purpose: 'generation',
      generation: {
        jobId: 'variant-1',
        requestId: 'request-1',
        spaceId: 'space-1',
      },
    });

    assert.deepEqual(resolved, {
      tenant,
      provider: 'google_ai',
      apiKey: 'tiny',
      keySource: 'byok',
    });
    assert.equal(secret.getCalls, 2);

    const deleted = await broker.deleteProviderKey({
      tenant,
      provider: 'google_ai',
    });

    assert.equal(deleted.provider, 'google_ai');
    assert.match(deleted.deletedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(db.rows.has('7:google_ai'), false);
  });

  test('resolves legacy provider keys by upgrading them through the broker read path', async () => {
    const db = new FakeD1();
    const kek = encryptionKey();
    const legacy = await encryptLegacyProviderApiKey('legacy-broker-key', kek, 7, 'google_ai');
    db.rows.set('7:google_ai', {
      user_id: 7,
      provider: 'google_ai',
      encrypted_api_key: legacy,
      key_hint: 'legacy-hint',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    db.platformUsage.push({
      user_id: 7,
      usage_type: 'workflow',
      space_id: 'space-1',
      workflow_id: 'variant-1',
      variant_id: 'variant-1',
      request_id: 'request-1',
    });
    const tenant = { type: 'user' as const, userId: 7 };
    const broker = keyBrokerClient(
      createLocalKeyBrokerServiceBinding({
        DB: db as never,
        BYOK_ACTIVE_KEK_VERSION: '1',
        BYOK_KEK_V1: kek,
      })
    );

    const resolved = await broker.resolveProviderKey({
      tenant,
      provider: 'google_ai',
      purpose: 'generation',
      generation: {
        jobId: 'variant-1',
        requestId: 'request-1',
        spaceId: 'space-1',
      },
    });

    assert.deepEqual(resolved, {
      tenant,
      provider: 'google_ai',
      apiKey: 'legacy-broker-key',
      keySource: 'byok',
    });
    const upgraded = db.rows.get('7:google_ai');
    assert.ok(upgraded);
    assert.match(upgraded.encrypted_api_key, /^enc:v2:1:1:/);
    assert.notEqual(upgraded.encrypted_api_key, legacy);
    assert.equal(upgraded.key_hint, '****-key');
    assert.equal(
      await decryptProviderApiKeyV2(db as never, upgraded.encrypted_api_key, kek, 7, 'google_ai'),
      'legacy-broker-key',
    );
  });

  test('denies cross-tenant and job-substituted generation key resolution before unwrapping key material', async () => {
    const db = new FakeD1();
    const secret = new FakeSecretsStoreSecret(encryptionKey());
    const broker = keyBrokerClient(
      createLocalKeyBrokerServiceBinding({
        DB: db as never,
        BYOK_ACTIVE_KEK_VERSION: '1',
        BYOK_KEK_V1: secret,
      })
    );

    await broker.storeProviderKey({
      tenant: { type: 'user', userId: 7 },
      provider: 'google_ai',
      apiKey: 'tenant-7-key',
    });
    assert.equal(secret.getCalls, 1);

    db.platformUsage.push({
      user_id: 8,
      usage_type: 'workflow',
      space_id: 'space-1',
      workflow_id: 'variant-1',
      variant_id: 'variant-1',
      request_id: 'request-1',
    });
    db.platformUsage.push({
      user_id: 7,
      usage_type: 'workflow',
      space_id: 'space-1',
      workflow_id: 'variant-2',
      variant_id: 'variant-2',
      request_id: 'request-2',
    });

    await assert.rejects(
      broker.resolveProviderKey({
        tenant: { type: 'user', userId: 7 },
        provider: 'google_ai',
        purpose: 'generation',
        generation: {
          jobId: 'variant-1',
          requestId: 'request-1',
          spaceId: 'space-1',
        },
      }),
      /authorization denied/i
    );
    assert.equal(secret.getCalls, 1);

    await assert.rejects(
      broker.resolveProviderKey({
        tenant: { type: 'user', userId: 7 },
        provider: 'google_ai',
        purpose: 'generation',
        generation: {
          jobId: 'variant-2',
          requestId: 'request-1',
          spaceId: 'space-1',
        },
      }),
      /authorization denied/i
    );
    assert.equal(secret.getCalls, 1);
  });

  test('returns missing for an authorized generation with no stored BYOK key', async () => {
    const db = new FakeD1();
    const broker = keyBrokerClient(
      createLocalKeyBrokerServiceBinding({
        DB: db as never,
      })
    );
    const tenant = { type: 'user' as const, userId: 7 };
    db.platformUsage.push({
      user_id: 7,
      usage_type: 'workflow',
      space_id: 'space-1',
      workflow_id: 'variant-1',
      variant_id: 'variant-1',
      request_id: 'request-1',
    });

    const resolved = await broker.resolveProviderKey({
      tenant,
      provider: 'google_ai',
      purpose: 'generation',
      generation: {
        jobId: 'variant-1',
        requestId: 'request-1',
        spaceId: 'space-1',
      },
    });

    assert.deepEqual(resolved, {
      tenant,
      provider: 'google_ai',
      apiKey: null,
      keySource: 'missing',
    });
    assert.equal('dek' in resolved, false);
    assert.equal('wrappedDek' in resolved, false);
  });

  test('requires KEK material for an authorized generation with a stored BYOK key', async () => {
    const db = new FakeD1();
    const broker = keyBrokerClient(
      createLocalKeyBrokerServiceBinding({
        DB: db as never,
      })
    );
    db.rows.set('7:google_ai', {
      user_id: 7,
      provider: 'google_ai',
      encrypted_api_key: 'enc:v2:1:1:not-decrypted-in-this-test',
      key_hint: '****',
      updated_at: new Date().toISOString(),
    });
    db.platformUsage.push({
      user_id: 7,
      usage_type: 'workflow',
      space_id: 'space-1',
      workflow_id: 'variant-1',
      variant_id: 'variant-1',
      request_id: 'request-1',
    });

    await assert.rejects(
      broker.resolveProviderKey({
        tenant: { type: 'user', userId: 7 },
        provider: 'google_ai',
        purpose: 'generation',
        generation: {
          jobId: 'variant-1',
          requestId: 'request-1',
          spaceId: 'space-1',
        },
      }),
      /Secrets Store binding is required/i
    );
  });

  test('does not return DEK material from rotation scaffold methods', async () => {
    const broker = keyBrokerClient(
      createLocalKeyBrokerServiceBinding({
        DB: new FakeD1() as never,
        BYOK_KEK_V1: encryptionKey(),
      })
    );
    const tenant = { type: 'user' as const, userId: 7 };

    const rotation = await broker.rotateTenantDek({ tenant, reason: 'unit-test' });
    assert.deepEqual(rotation, { tenant, status: 'not_implemented' });
    assert.equal('dek' in rotation, false);
    assert.equal('wrappedDek' in rotation, false);

    const rewrap = await broker.rewrapAllDeks({ fromKekVersion: 1, toKekVersion: 2, dryRun: true });
    assert.deepEqual(rewrap, { status: 'not_implemented' });
    assert.equal('dek' in rewrap, false);
    assert.equal('wrappedDek' in rewrap, false);
  });
});
