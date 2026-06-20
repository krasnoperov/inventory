import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { keyBrokerClient } from './client';
import { KEY_BROKER_METHODS, isKeyBrokerMethod } from './contract';
import { createLocalKeyBrokerServiceBinding } from './testHarness';
import {
  decryptProviderApiKeyV2,
  decryptProviderApiKeyWithVersionedKek,
  encryptProviderApiKeyV2,
  encryptProviderApiKeyWithVersionedKek,
  unwrapProviderKeyDek,
  wrapProviderKeyDek,
} from '../services/providerKeyVault';

function encryptionKey(): string {
  return Buffer.from(new Uint8Array(32).fill(11)).toString('base64');
}

function rotatedEncryptionKey(): string {
  return Buffer.from(new Uint8Array(32).fill(12)).toString('base64');
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
  providerSecretSelects = 0;

  prepare(sql: string) {
    const incrementProviderSecretSelects = () => {
      this.providerSecretSelects += 1;
    };
    const { rows, envelopes, platformUsage } = this;
    return {
      bindings: [] as unknown[],
      bind(...bindings: unknown[]) {
        this.bindings = bindings;
        return this;
      },
      async all<T>() {
        if (sql.includes('FROM key_envelopes')) {
          const [fromKekVersion, toKekVersion] = this.bindings;
          return {
            results: [...envelopes.values()]
              .filter((row) => row.kek_version === fromKekVersion || row.kek_version === toKekVersion)
              .sort((a, b) => a.scope_id.localeCompare(b.scope_id))
              .map((row) => ({
                scope_id: row.scope_id,
                wrapped_dek: row.wrapped_dek,
                dek_version: row.dek_version,
                kek_version: row.kek_version,
              })),
          } as { results: T[] };
        }

        if (sql.includes('FROM user_provider_keys')) {
          incrementProviderSecretSelects();
          const [userId] = this.bindings;
          return {
            results: [...rows.values()]
              .filter((row) => row.user_id === userId)
              .sort((a, b) => a.provider.localeCompare(b.provider))
              .map((row) => ({
                provider: row.provider,
                encrypted_api_key: row.encrypted_api_key,
              })),
          } as { results: T[] };
        }

        return { results: [] as T[] };
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
              scope_id: row.scope_id,
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
        if (sql.includes('UPDATE key_envelopes')) {
          if (this.bindings.length === 6) {
            const [wrappedDek, kekVersion, updatedAt, scopeId, previousWrappedDek, previousKekVersion] = this.bindings as [
              string,
              number,
              string,
              string,
              string,
              number,
            ];
            const previous = envelopes.get(scopeId);
            if (previous?.wrapped_dek === previousWrappedDek && previous.kek_version === previousKekVersion) {
              envelopes.set(scopeId, {
                ...previous,
                wrapped_dek: wrappedDek,
                kek_version: kekVersion,
                updated_at: updatedAt,
              });
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }

          const [
            wrappedDek,
            dekVersion,
            kekVersion,
            updatedAt,
            scopeId,
            previousWrappedDek,
            previousDekVersion,
            previousKekVersion,
          ] = this.bindings as [string, number, number, string, string, string, number, number];
          const previous = envelopes.get(scopeId);
          if (
            previous?.wrapped_dek === previousWrappedDek &&
            previous.dek_version === previousDekVersion &&
            previous.kek_version === previousKekVersion
          ) {
            envelopes.set(scopeId, {
              ...previous,
              wrapped_dek: wrappedDek,
              dek_version: dekVersion,
              kek_version: kekVersion,
              updated_at: updatedAt,
            });
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        }

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
          if (this.bindings.length === 5) {
            const [encrypted, updatedAt, userId, provider, previousEncrypted] = this.bindings as [
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
                updated_at: updatedAt,
              });
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }

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
          if (sql.includes('envelope_snapshot_guard')) {
            const [
              _userId,
              _provider,
              _createdAt,
              _updatedAt,
              scopeId,
              wrappedDek,
              dekVersion,
              kekVersion,
            ] = this.bindings as [number, string, string, string, string, string, number, number];
            const current = envelopes.get(scopeId);
            const changed = (
              !current ||
              current.wrapped_dek !== wrappedDek ||
              current.dek_version !== dekVersion ||
              current.kek_version !== kekVersion
            );
            if (changed) {
              throw new Error('NOT NULL constraint failed: user_provider_keys.encrypted_api_key');
            }
            return { success: true, meta: { changes: 0 } };
          }

          if (sql.includes('provider_snapshot_guard')) {
            const checkUserId = this.bindings[4] as number;
            const snapshotBindings = this.bindings.slice(5, -2) as string[];
            const expectedCount = this.bindings[this.bindings.length - 1] as number;
            const expectedRows: { provider: string; encrypted_api_key: string }[] = [];
            for (let index = 0; index < snapshotBindings.length; index += 2) {
              expectedRows.push({
                provider: snapshotBindings[index],
                encrypted_api_key: snapshotBindings[index + 1],
              });
            }
            const currentRows = [...rows.values()].filter((row) => row.user_id === checkUserId);
            const changed = currentRows.length !== expectedCount || currentRows.some((row) => (
              !expectedRows.some((expected) => (
                expected.provider === row.provider &&
                expected.encrypted_api_key === row.encrypted_api_key
              ))
            ));
            if (changed) {
              throw new Error('NOT NULL constraint failed: user_provider_keys.encrypted_api_key');
            }
            return { success: true, meta: { changes: 0 } };
          }

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

  async batch(statements: { run(): Promise<unknown> }[]) {
    const results = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
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
    assert.equal(secret.getCalls, 2);

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
    assert.equal(secret.getCalls, 3);

    const deleted = await broker.deleteProviderKey({
      tenant,
      provider: 'google_ai',
    });

    assert.equal(deleted.provider, 'google_ai');
    assert.match(deleted.deletedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(db.rows.has('7:google_ai'), false);
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
    assert.equal(secret.getCalls, 2);

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
    assert.equal(secret.getCalls, 2);

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
    assert.equal(secret.getCalls, 2);
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

  test('resolves runtime provider keys through the broker without exposing DEK material', async () => {
    const db = new FakeD1();
    const broker = keyBrokerClient(
      createLocalKeyBrokerServiceBinding({
        DB: db as never,
        BYOK_ACTIVE_KEK_VERSION: '2',
        BYOK_KEK_V1: encryptionKey(),
        BYOK_KEK_V2: rotatedEncryptionKey(),
      })
    );
    const tenant = { type: 'user' as const, userId: 7 };
    await broker.storeProviderKey({ tenant, provider: 'elevenlabs', apiKey: 'runtime-elevenlabs-key' });

    const resolved = await broker.resolveProviderKey({
      tenant,
      provider: 'elevenlabs',
      purpose: 'runtime',
    });

    assert.deepEqual(resolved, {
      tenant,
      provider: 'elevenlabs',
      apiKey: 'runtime-elevenlabs-key',
      keySource: 'byok',
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
      /envelope is missing/i
    );
  });

  test('rewraps tenant DEKs without rewriting provider ciphertext or reading provider secrets', async () => {
    const db = new FakeD1();
    const broker = keyBrokerClient(
      createLocalKeyBrokerServiceBinding({
        DB: db as never,
        BYOK_ACTIVE_KEK_VERSION: '1',
        BYOK_KEK_V1: encryptionKey(),
        BYOK_KEK_V2: rotatedEncryptionKey(),
      })
    );
    const tenant = { type: 'user' as const, userId: 7 };

    await broker.storeProviderKey({
      tenant,
      provider: 'google_ai',
      apiKey: 'provider-secret-1234',
    });
    const beforeRow = db.rows.get('7:google_ai');
    const beforeEnvelope = db.envelopes.get('user:7');
    assert.ok(beforeRow);
    assert.ok(beforeEnvelope);
    assert.match(beforeRow.encrypted_api_key, /^enc:v2:1:1:/);

    const result = await broker.rewrapAllDeks({ fromKekVersion: 1, toKekVersion: 2 });

    assert.deepEqual(result, {
      status: 'completed',
      fromKekVersion: 1,
      toKekVersion: 2,
      scanned: 1,
      rewrapped: 1,
      alreadyRewrapped: 0,
      skipped: 0,
    });
    assert.equal(db.providerSecretSelects, 0);
    assert.equal(db.rows.get('7:google_ai')?.encrypted_api_key, beforeRow.encrypted_api_key);
    const afterEnvelope = db.envelopes.get('user:7');
    assert.ok(afterEnvelope);
    assert.equal(afterEnvelope.kek_version, 2);
    assert.equal(afterEnvelope.dek_version, beforeEnvelope.dek_version);
    assert.notEqual(afterEnvelope.wrapped_dek, beforeEnvelope.wrapped_dek);

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
    assert.equal(resolved.apiKey, 'provider-secret-1234');
    assert.equal('dek' in resolved, false);
    assert.equal('wrappedDek' in resolved, false);
  });

  test('rewrap retry skips already rewrapped scopes and completes remaining scopes', async () => {
    const db = new FakeD1();
    const brokerV2 = keyBrokerClient(
      createLocalKeyBrokerServiceBinding({
        DB: db as never,
        BYOK_ACTIVE_KEK_VERSION: '2',
        BYOK_KEK_V1: encryptionKey(),
        BYOK_KEK_V2: rotatedEncryptionKey(),
      })
    );
    await brokerV2.storeProviderKey({
      tenant: { type: 'user', userId: 7 },
      provider: 'google_ai',
      apiKey: 'first-provider-secret',
    });
    const broker = keyBrokerClient(
      createLocalKeyBrokerServiceBinding({
        DB: db as never,
        BYOK_ACTIVE_KEK_VERSION: '1',
        BYOK_KEK_V1: encryptionKey(),
        BYOK_KEK_V2: rotatedEncryptionKey(),
      })
    );
    await broker.storeProviderKey({
      tenant: { type: 'user', userId: 8 },
      provider: 'google_ai',
      apiKey: 'second-provider-secret',
    });
    assert.equal(db.envelopes.get('user:7')?.kek_version, 2);
    assert.equal(db.envelopes.get('user:8')?.kek_version, 1);

    const retry = await broker.rewrapAllDeks({ fromKekVersion: 1, toKekVersion: 2 });

    assert.equal(retry.status, 'completed');
    assert.equal(retry.rewrapped, 1);
    assert.equal(retry.alreadyRewrapped, 1);
    assert.equal(db.envelopes.get('user:7')?.kek_version, 2);
    assert.equal(db.envelopes.get('user:8')?.kek_version, 2);
  });

  test('rewrap fails with the wrong source KEK before changing the envelope', async () => {
    const db = new FakeD1();
    const broker = keyBrokerClient(
      createLocalKeyBrokerServiceBinding({
        DB: db as never,
        BYOK_KEK_V1: encryptionKey(),
        BYOK_KEK_V2: rotatedEncryptionKey(),
      })
    );
    const tenant = { type: 'user' as const, userId: 7 };

    await broker.storeProviderKey({ tenant, provider: 'google_ai', apiKey: 'provider-secret-1234' });
    const beforeEnvelope = db.envelopes.get('user:7');
    assert.ok(beforeEnvelope);
    const wrongBroker = keyBrokerClient(
      createLocalKeyBrokerServiceBinding({
        DB: db as never,
        BYOK_KEK_V1: Buffer.from(new Uint8Array(32).fill(99)).toString('base64'),
        BYOK_KEK_V2: rotatedEncryptionKey(),
      })
    );

    await assert.rejects(
      wrongBroker.rewrapAllDeks({ fromKekVersion: 1, toKekVersion: 2 }),
      /operation-specific reason|unwrap|decrypt/i,
    );
    assert.deepEqual(db.envelopes.get('user:7'), beforeEnvelope);
    assert.match(db.rows.get('7:google_ai')?.encrypted_api_key ?? '', /^enc:v2:1:1:/);
  });

  test('rotates only the target tenant DEK and provider ciphertexts', async () => {
    const db = new FakeD1();
    const broker = keyBrokerClient(
      createLocalKeyBrokerServiceBinding({
        DB: db as never,
        BYOK_ACTIVE_KEK_VERSION: '2',
        BYOK_KEK_V1: encryptionKey(),
        BYOK_KEK_V2: rotatedEncryptionKey(),
      })
    );
    const targetTenant = { type: 'user' as const, userId: 7 };

    await broker.storeProviderKey({ tenant: targetTenant, provider: 'google_ai', apiKey: 'target-google-secret' });
    await broker.storeProviderKey({ tenant: targetTenant, provider: 'anthropic', apiKey: 'sk-ant-target-secret' });
    await broker.storeProviderKey({
      tenant: { type: 'user', userId: 8 },
      provider: 'google_ai',
      apiKey: 'other-google-secret',
    });
    const otherRowBefore = db.rows.get('8:google_ai')?.encrypted_api_key;
    const otherEnvelopeBefore = db.envelopes.get('user:8');
    assert.ok(otherEnvelopeBefore);

    const rotation = await broker.rotateTenantDek({ tenant: targetTenant, reason: 'unit-test' });

    assert.deepEqual(rotation, {
      tenant: targetTenant,
      status: 'rotated',
      rotatedProviders: 2,
      dekVersion: 2,
      kekVersion: 2,
    });
    assert.match(db.rows.get('7:google_ai')?.encrypted_api_key ?? '', /^enc:v2:2:2:/);
    assert.match(db.rows.get('7:anthropic')?.encrypted_api_key ?? '', /^enc:v2:2:2:/);
    assert.notEqual(db.rows.get('7:google_ai')?.encrypted_api_key, 'target-google-secret');
    assert.equal(db.rows.get('8:google_ai')?.encrypted_api_key, otherRowBefore);
    assert.deepEqual(db.envelopes.get('user:8'), otherEnvelopeBefore);

    db.platformUsage.push({
      user_id: 7,
      usage_type: 'workflow',
      space_id: 'space-1',
      workflow_id: 'variant-1',
      variant_id: 'variant-1',
      request_id: 'request-1',
    });
    const resolved = await broker.resolveProviderKey({
      tenant: targetTenant,
      provider: 'google_ai',
      purpose: 'generation',
      generation: {
        jobId: 'variant-1',
        requestId: 'request-1',
        spaceId: 'space-1',
      },
    });
    assert.equal(resolved.apiKey, 'target-google-secret');

    assert.equal(
      await decryptProviderApiKeyWithVersionedKek(
        db as never,
        db.rows.get('7:anthropic')?.encrypted_api_key ?? '',
        {
          activeKekVersion: 2,
          getKekByVersion: async (version) => version === 1 ? encryptionKey() : rotatedEncryptionKey(),
        },
        7,
        'anthropic',
      ),
      'sk-ant-target-secret',
    );
  });

  test('tenant rotation aborts before envelope advance when a provider row changes after snapshot', async () => {
    const db = new FakeD1();
    const broker = keyBrokerClient(
      createLocalKeyBrokerServiceBinding({
        DB: db as never,
        BYOK_ACTIVE_KEK_VERSION: '2',
        BYOK_KEK_V1: encryptionKey(),
        BYOK_KEK_V2: rotatedEncryptionKey(),
      })
    );
    const tenant = { type: 'user' as const, userId: 7 };

    await broker.storeProviderKey({ tenant, provider: 'google_ai', apiKey: 'original-google-secret' });
    const beforeEnvelopeRow = db.envelopes.get('user:7');
    assert.ok(beforeEnvelopeRow);
    const beforeEnvelope = { ...beforeEnvelopeRow };
    const concurrentEncrypted = await encryptProviderApiKeyWithVersionedKek(
      db as never,
      'concurrent-google-secret',
      {
        activeKekVersion: 2,
        getKekByVersion: async (version) => version === 1 ? encryptionKey() : rotatedEncryptionKey(),
      },
      7,
      'google_ai',
    );
    const originalBatch = db.batch.bind(db);
    db.batch = async (statements) => {
      const row = db.rows.get('7:google_ai');
      assert.ok(row);
      db.rows.set('7:google_ai', {
        ...row,
        encrypted_api_key: concurrentEncrypted,
      });
      return originalBatch(statements);
    };

    await assert.rejects(
      broker.rotateTenantDek({ tenant, reason: 'concurrent-settings-update' }),
      /concurrent update/,
    );
    assert.deepEqual(db.envelopes.get('user:7'), beforeEnvelope);
    assert.equal(db.rows.get('7:google_ai')?.encrypted_api_key, concurrentEncrypted);
    assert.equal(
      await decryptProviderApiKeyWithVersionedKek(
        db as never,
        concurrentEncrypted,
        {
          activeKekVersion: 2,
          getKekByVersion: async (version) => version === 1 ? encryptionKey() : rotatedEncryptionKey(),
        },
        7,
        'google_ai',
      ),
      'concurrent-google-secret',
    );
  });

  test('tenant rotation aborts before provider updates when the envelope changes after snapshot', async () => {
    const db = new FakeD1();
    const brokerV1 = keyBrokerClient(
      createLocalKeyBrokerServiceBinding({
        DB: db as never,
        BYOK_ACTIVE_KEK_VERSION: '1',
        BYOK_KEK_V1: encryptionKey(),
        BYOK_KEK_V2: rotatedEncryptionKey(),
      })
    );
    const broker = keyBrokerClient(
      createLocalKeyBrokerServiceBinding({
        DB: db as never,
        BYOK_ACTIVE_KEK_VERSION: '2',
        BYOK_KEK_V1: encryptionKey(),
        BYOK_KEK_V2: rotatedEncryptionKey(),
      })
    );
    const tenant = { type: 'user' as const, userId: 7 };

    await brokerV1.storeProviderKey({ tenant, provider: 'google_ai', apiKey: 'rewrap-race-secret' });
    const beforeRow = db.rows.get('7:google_ai')?.encrypted_api_key;
    const beforeEnvelope = db.envelopes.get('user:7');
    assert.ok(beforeRow);
    assert.ok(beforeEnvelope);
    const oldDek = await unwrapProviderKeyDek(beforeEnvelope.wrapped_dek, encryptionKey());
    const concurrentEnvelope = {
      ...beforeEnvelope,
      wrapped_dek: await wrapProviderKeyDek(oldDek, rotatedEncryptionKey()),
      kek_version: 2,
    };
    const originalBatch = db.batch.bind(db);
    db.batch = async (statements) => {
      db.envelopes.set('user:7', concurrentEnvelope);
      return originalBatch(statements);
    };

    await assert.rejects(
      broker.rotateTenantDek({ tenant, reason: 'concurrent-kek-rewrap' }),
      /concurrent update/,
    );
    assert.equal(db.rows.get('7:google_ai')?.encrypted_api_key, beforeRow);
    assert.deepEqual(db.envelopes.get('user:7'), concurrentEnvelope);
    assert.equal(
      await decryptProviderApiKeyWithVersionedKek(
        db as never,
        beforeRow,
        {
          activeKekVersion: 2,
          getKekByVersion: async (version) => version === 1 ? encryptionKey() : rotatedEncryptionKey(),
        },
        7,
        'google_ai',
      ),
      'rewrap-race-secret',
    );
  });

  test('tenant rotation can be retried after a failed batch without leaking DEK material', async () => {
    const db = new FakeD1();
    let failNextBatch = true;
    const originalBatch = db.batch.bind(db);
    db.batch = async (statements) => {
      if (failNextBatch) {
        failNextBatch = false;
        throw new Error('simulated batch failure');
      }
      return originalBatch(statements);
    };
    const broker = keyBrokerClient(
      createLocalKeyBrokerServiceBinding({
        DB: db as never,
        BYOK_ACTIVE_KEK_VERSION: '2',
        BYOK_KEK_V1: encryptionKey(),
        BYOK_KEK_V2: rotatedEncryptionKey(),
      })
    );
    const tenant = { type: 'user' as const, userId: 7 };
    await broker.storeProviderKey({ tenant, provider: 'google_ai', apiKey: 'retry-provider-secret' });
    const beforeRow = db.rows.get('7:google_ai')?.encrypted_api_key;
    const beforeEnvelope = db.envelopes.get('user:7');

    await assert.rejects(
      broker.rotateTenantDek({ tenant, reason: 'first-attempt' }),
      /simulated batch failure/,
    );
    assert.equal(db.rows.get('7:google_ai')?.encrypted_api_key, beforeRow);
    assert.deepEqual(db.envelopes.get('user:7'), beforeEnvelope);

    const retried = await broker.rotateTenantDek({ tenant, reason: 'first-attempt' });
    assert.equal(retried.status, 'rotated');
    assert.equal(retried.rotatedProviders, 1);
    assert.match(db.rows.get('7:google_ai')?.encrypted_api_key ?? '', /^enc:v2:2:2:/);
    assert.equal('dek' in retried, false);
    assert.equal('wrappedDek' in retried, false);
  });
});
