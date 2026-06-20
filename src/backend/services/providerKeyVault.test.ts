import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteProviderApiKey,
  decryptProviderApiKey,
  encryptProviderApiKey,
  listProviderKeySummaries,
  ProviderKeyEncryptionError,
  resolveStoredProviderApiKey,
  upsertProviderApiKey,
  validateProviderApiKey,
} from './providerKeyVault';
import type { Env } from '../../core/types';

function encryptionKey(): string {
  return Buffer.from(new Uint8Array(32).fill(7)).toString('base64');
}

type Row = {
  user_id: number;
  provider: string;
  encrypted_api_key: string;
  key_hint: string;
  updated_at: string;
};

class FakeD1 {
  rows = new Map<string, Row>();

  prepare(sql: string) {
    const { rows } = this;
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
        if (sql.includes('INSERT INTO user_provider_keys')) {
          const [userId, provider, encrypted, hint, createdAt, updatedAt] = this.bindings as [
            number,
            string,
            string,
            string,
            string,
            string,
          ];
          const key = `${userId}:${provider}`;
          const previous = rows.get(key);
          rows.set(key, {
            user_id: userId,
            provider,
            encrypted_api_key: encrypted,
            key_hint: hint,
            updated_at: previous?.updated_at && previous.updated_at > updatedAt ? previous.updated_at : updatedAt,
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

describe('providerKeyVault', () => {
  test('encrypts and decrypts provider keys with user/provider binding', async () => {
    const secret = encryptionKey();
    const encrypted = await encryptProviderApiKey('sk-ant-test-secret', secret, 7, 'anthropic');

    assert.notEqual(encrypted, 'sk-ant-test-secret');
    assert.match(encrypted, /^enc:v1:/);
    assert.equal(await decryptProviderApiKey(encrypted, secret, 7, 'anthropic'), 'sk-ant-test-secret');
    await assert.rejects(
      decryptProviderApiKey(encrypted, secret, 8, 'anthropic'),
      /operation-specific reason|decrypt/i
    );
  });

  test('refuses provider key writes without an encryption key', async () => {
    await assert.rejects(
      encryptProviderApiKey('secret', undefined, 7, 'google_ai'),
      ProviderKeyEncryptionError
    );
  });

  test('validates obvious malformed keys', () => {
    assert.equal(validateProviderApiKey('google_ai', 'short'), 'API key is too short');
    assert.equal(validateProviderApiKey('google_ai', 'abc def ghi'), 'API key cannot contain whitespace');
    assert.equal(validateProviderApiKey('anthropic', 'sk-not-anthropic'), 'Anthropic keys must start with sk-ant-');
    assert.equal(validateProviderApiKey('anthropic', 'sk-ant-valid-key'), null);
  });

  test('stores masked summaries and resolves decrypted account keys', async () => {
    const db = new FakeD1();
    const env = {
      DB: db,
      ENCRYPTION_KEY: encryptionKey(),
      GOOGLE_AI_API_KEY: 'platform-google',
    } as unknown as Env;

    await upsertProviderApiKey(db as never, 7, 'google_ai', 'user-google-secret', env);

    const stored = db.rows.get('7:google_ai');
    assert.ok(stored);
    assert.notEqual(stored.encrypted_api_key, 'user-google-secret');

    const summaries = await listProviderKeySummaries(db as never, 7, env);
    const google = summaries.find((item) => item.provider === 'google_ai');
    assert.deepEqual(
      {
        configured: google?.configured,
        keyHint: google?.keyHint,
        platformConfigured: google?.platformConfigured,
      },
      {
        configured: true,
        keyHint: 'user...cret',
        platformConfigured: true,
      }
    );

    assert.equal(
      await resolveStoredProviderApiKey(db as never, 7, 'google_ai', env),
      'user-google-secret'
    );

    await deleteProviderApiKey(db as never, 7, 'google_ai');
    assert.equal(await resolveStoredProviderApiKey(db as never, 7, 'google_ai', env), undefined);
  });
});
