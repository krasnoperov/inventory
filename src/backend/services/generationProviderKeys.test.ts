import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Env } from '../../core/types';
import { encryptProviderApiKey } from './providerKeyVault';
import { resolveGenerationProviderApiKey } from './generationProviderKeys';

function encryptionKey(): string {
  return Buffer.from(new Uint8Array(32).fill(11)).toString('base64');
}

type ProviderKeyRow = {
  user_id: number;
  provider: string;
  encrypted_api_key: string;
};

function providerKeyDb(rows: ProviderKeyRow[] = [], calls?: unknown[][]) {
  return {
    prepare: () => ({
      bind: (...bindings: unknown[]) => ({
        first: async () => {
          calls?.push(bindings);
          const [userId, provider] = bindings;
          const row = rows.find((candidate) => (
            candidate.user_id === userId && candidate.provider === provider
          ));
          return row ? { encrypted_api_key: row.encrypted_api_key } : null;
        },
      }),
    }),
  };
}

describe('resolveGenerationProviderApiKey', () => {
  test('prefers the customer BYOK key over the managed platform key', async () => {
    const secret = encryptionKey();
    const encrypted = await encryptProviderApiKey('user-google-key', secret, 7, 'google_ai');
    const env = {
      DB: providerKeyDb([{ user_id: 7, provider: 'google_ai', encrypted_api_key: encrypted }]),
      ENCRYPTION_KEY: secret,
    } as unknown as Env;

    assert.deepEqual(
      await resolveGenerationProviderApiKey(env, '7', 'google_ai', 'platform-google-key'),
      { apiKey: 'user-google-key', keySource: 'byok' }
    );
  });

  test('falls back to the managed platform key when no customer key is stored', async () => {
    const env = {
      DB: providerKeyDb(),
      ENCRYPTION_KEY: encryptionKey(),
    } as unknown as Env;

    assert.deepEqual(
      await resolveGenerationProviderApiKey(env, '7', 'elevenlabs', 'platform-elevenlabs-key'),
      { apiKey: 'platform-elevenlabs-key', keySource: 'platform' }
    );
  });

  test('returns no key when neither BYOK nor managed credentials are available', async () => {
    const env = {
      DB: providerKeyDb(),
      ENCRYPTION_KEY: encryptionKey(),
    } as unknown as Env;

    assert.deepEqual(
      await resolveGenerationProviderApiKey(env, '7', 'lyria'),
      {}
    );
  });

  test('does not query BYOK storage for non-numeric workflow user ids', async () => {
    const calls: unknown[][] = [];
    const env = {
      DB: providerKeyDb([], calls),
      ENCRYPTION_KEY: encryptionKey(),
    } as unknown as Env;

    assert.deepEqual(
      await resolveGenerationProviderApiKey(env, 'user-7', 'google_ai', 'platform-google-key'),
      { apiKey: 'platform-google-key', keySource: 'platform' }
    );
    assert.deepEqual(
      await resolveGenerationProviderApiKey(env, '7abc', 'google_ai', 'platform-google-key'),
      { apiKey: 'platform-google-key', keySource: 'platform' }
    );
    assert.equal(calls.length, 0);
  });

  test('does not silently fall back to managed credentials when a stored key cannot decrypt', async () => {
    const secret = encryptionKey();
    const encrypted = await encryptProviderApiKey('user-google-key', secret, 7, 'google_ai');
    const env = {
      DB: providerKeyDb([{ user_id: 8, provider: 'google_ai', encrypted_api_key: encrypted }]),
      ENCRYPTION_KEY: secret,
    } as unknown as Env;

    await assert.rejects(
      resolveGenerationProviderApiKey(env, '8', 'google_ai', 'platform-google-key'),
      /operation-specific reason|decrypt/i
    );
  });
});
