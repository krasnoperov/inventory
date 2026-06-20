import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../../core/types';

const ENC_V2_PREFIX = 'enc:v2:';
const CURRENT_KEK_VERSION = 1;
const CURRENT_DEK_VERSION = 1;
const PROVIDER_KEY_PURPOSE = 'provider_api_key';

export const providerKeyProviders = ['google_ai', 'anthropic', 'elevenlabs', 'lyria'] as const;
export type ProviderKeyProvider = typeof providerKeyProviders[number];

export interface ProviderKeyDefinition {
  provider: ProviderKeyProvider;
  label: string;
  envKeys: readonly (keyof Env)[];
}

export interface ProviderKeySummary {
  provider: ProviderKeyProvider;
  label: string;
  configured: boolean;
  keyHint: string | null;
  updatedAt: string | null;
  platformConfigured: boolean;
}

export interface StoredProviderKeyRow {
  provider: ProviderKeyProvider;
  encrypted_api_key: string;
  key_hint: string;
  updated_at: string;
}

interface KeyEnvelopeRow {
  wrapped_dek: string;
  dek_version: number;
  kek_version: number;
}

export interface VersionedKekProvider {
  activeKekVersion: number;
  getKekByVersion(version: number): Promise<string | undefined>;
}

type ProviderKeyEncryptionEnv = Pick<Env, 'ENCRYPTION_KEY'> | VersionedKekProvider;

export class ProviderKeyEncryptionError extends Error {
  constructor(message = 'ENCRYPTION_KEY is required for provider key storage') {
    super(message);
    this.name = 'ProviderKeyEncryptionError';
  }
}

export const PROVIDER_KEY_DEFINITIONS: Record<ProviderKeyProvider, ProviderKeyDefinition> = {
  google_ai: {
    provider: 'google_ai',
    label: 'Google AI',
    envKeys: ['GOOGLE_AI_API_KEY'],
  },
  anthropic: {
    provider: 'anthropic',
    label: 'Anthropic',
    envKeys: ['ANTHROPIC_API_KEY'],
  },
  elevenlabs: {
    provider: 'elevenlabs',
    label: 'ElevenLabs',
    envKeys: ['ELEVENLABS_API_KEY'],
  },
  lyria: {
    provider: 'lyria',
    label: 'Lyria',
    envKeys: ['LYRIA_API_KEY', 'LYRIA_ACCESS_TOKEN'],
  },
};

export function isProviderKeyProvider(value: string): value is ProviderKeyProvider {
  return (providerKeyProviders as readonly string[]).includes(value);
}

export function getProviderKeyDefinition(provider: ProviderKeyProvider): ProviderKeyDefinition {
  return PROVIDER_KEY_DEFINITIONS[provider];
}

export function maskProviderKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return '****';
  return `****${trimmed.slice(-4)}`;
}

export function validateProviderApiKey(provider: ProviderKeyProvider, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'API key is required';
  if (trimmed.length < 8) return 'API key is too short';
  if (/\s/.test(trimmed)) return 'API key cannot contain whitespace';
  if (provider === 'anthropic' && !trimmed.startsWith('sk-ant-')) {
    return 'Anthropic keys must start with sk-ant-';
  }
  return null;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function importKeyEncryptionKey(secret: string): Promise<CryptoKey> {
  const keyBytes = base64ToUint8(secret);
  if (keyBytes.length !== 32) {
    throw new ProviderKeyEncryptionError('ENCRYPTION_KEY must be exactly 32 bytes, base64-encoded');
  }
  return crypto.subtle.importKey('raw', keyBytes.buffer as ArrayBuffer, { name: 'AES-KW' }, false, [
    'wrapKey',
    'unwrapKey',
  ]);
}

function isVersionedKekProvider(env: ProviderKeyEncryptionEnv): env is VersionedKekProvider {
  return typeof (env as VersionedKekProvider).getKekByVersion === 'function';
}

async function requireKekForVersion(
  env: ProviderKeyEncryptionEnv,
  version: number,
): Promise<string> {
  const value = isVersionedKekProvider(env)
    ? await env.getKekByVersion(version)
    : env.ENCRYPTION_KEY;
  if (!value) {
    throw new ProviderKeyEncryptionError(`BYOK_KEK_V${version} Secrets Store binding is required`);
  }
  return value;
}

function activeKekVersionForEnv(env: ProviderKeyEncryptionEnv): number {
  return isVersionedKekProvider(env) ? env.activeKekVersion : CURRENT_KEK_VERSION;
}

function aadForV2(
  userId: number,
  provider: ProviderKeyProvider,
  purpose: string,
  kekVersion: number,
  dekVersion: number,
): Uint8Array {
  return new TextEncoder().encode(
    `user_provider_key:v2:user:${userId}:provider:${provider}:purpose:${purpose}:kek:${kekVersion}:dek:${dekVersion}`
  );
}

function scopeIdForUser(userId: number): string {
  return `user:${userId}`;
}

async function readKeyEnvelope(db: D1Database, scopeId: string): Promise<KeyEnvelopeRow | null> {
  return db.prepare(`
    SELECT wrapped_dek, dek_version, kek_version
    FROM key_envelopes
    WHERE scope_id = ?
  `).bind(scopeId).first<KeyEnvelopeRow>();
}

function assertSupportedEnvelope(row: KeyEnvelopeRow): void {
  if (
    !Number.isSafeInteger(row.kek_version) ||
    row.kek_version <= 0 ||
    !Number.isSafeInteger(row.dek_version) ||
    row.dek_version <= 0
  ) {
    throw new ProviderKeyEncryptionError('Stored provider key envelope version is not supported');
  }
}

export async function unwrapProviderKeyDek(
  wrappedDek: string,
  encryptionKey: string,
): Promise<CryptoKey> {
  const kek = await importKeyEncryptionKey(encryptionKey);
  return crypto.subtle.unwrapKey(
    'raw',
    base64ToUint8(wrappedDek).buffer as ArrayBuffer,
    kek,
    { name: 'AES-KW' },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function wrapProviderKeyDek(
  dek: CryptoKey,
  encryptionKey: string,
): Promise<string> {
  const kek = await importKeyEncryptionKey(encryptionKey);
  const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-KW' });
  return uint8ToBase64(new Uint8Array(wrapped));
}

export async function createWrappedProviderKeyDek(
  encryptionKey: string,
): Promise<{ dek: CryptoKey; wrappedDek: string }> {
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  return { dek, wrappedDek: await wrapProviderKeyDek(dek, encryptionKey) };
}

async function getOrCreateUserDek(
  db: D1Database,
  userId: number,
  env: ProviderKeyEncryptionEnv,
): Promise<{ dek: CryptoKey; dekVersion: number; kekVersion: number }> {
  const scopeId = scopeIdForUser(userId);
  const existing = await readKeyEnvelope(db, scopeId);
  if (existing) {
    assertSupportedEnvelope(existing);
    return {
      dek: await unwrapProviderKeyDek(
        existing.wrapped_dek,
        await requireKekForVersion(env, existing.kek_version),
      ),
      dekVersion: existing.dek_version,
      kekVersion: existing.kek_version,
    };
  }

  const kekVersion = activeKekVersionForEnv(env);
  const { wrappedDek } = await createWrappedProviderKeyDek(await requireKekForVersion(env, kekVersion));
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT OR IGNORE INTO key_envelopes (scope_id, wrapped_dek, dek_version, kek_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(scopeId, wrappedDek, CURRENT_DEK_VERSION, kekVersion, now, now).run();

  const persisted = await readKeyEnvelope(db, scopeId);
  if (!persisted) {
    throw new ProviderKeyEncryptionError('Provider key envelope could not be created');
  }
  assertSupportedEnvelope(persisted);
  return {
    dek: await unwrapProviderKeyDek(
      persisted.wrapped_dek,
      await requireKekForVersion(env, persisted.kek_version),
    ),
    dekVersion: persisted.dek_version,
    kekVersion: persisted.kek_version,
  };
}

async function readUserDekForCiphertext(
  db: D1Database,
  userId: number,
  env: ProviderKeyEncryptionEnv,
  kekVersion: number,
  dekVersion: number,
): Promise<CryptoKey> {
  const row = await readKeyEnvelope(db, scopeIdForUser(userId));
  if (!row) {
    throw new ProviderKeyEncryptionError('Provider key envelope is missing');
  }
  if (row.dek_version !== dekVersion) {
    throw new ProviderKeyEncryptionError('Provider key envelope version does not match ciphertext');
  }
  assertSupportedEnvelope(row);
  return unwrapProviderKeyDek(
    row.wrapped_dek,
    await requireKekForVersion(env, row.kek_version),
  );
}

function parseVersion(value: string, label: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new ProviderKeyEncryptionError(`Invalid provider key ${label} version`);
  }
  return Number.parseInt(value, 10);
}

export async function encryptProviderApiKeyV2(
  db: D1Database,
  plaintext: string,
  encryptionKey: string | undefined,
  userId: number,
  provider: ProviderKeyProvider,
  purpose = PROVIDER_KEY_PURPOSE,
): Promise<string> {
  if (!encryptionKey) throw new ProviderKeyEncryptionError();
  return encryptProviderApiKeyWithVersionedKek(
    db,
    plaintext,
    { ENCRYPTION_KEY: encryptionKey },
    userId,
    provider,
    purpose,
  );
}

export async function encryptProviderApiKeyWithVersionedKek(
  db: D1Database,
  plaintext: string,
  env: ProviderKeyEncryptionEnv,
  userId: number,
  provider: ProviderKeyProvider,
  purpose = PROVIDER_KEY_PURPOSE,
): Promise<string> {
  const { dek, dekVersion, kekVersion } = await getOrCreateUserDek(db, userId, env);
  return encryptProviderApiKeyWithDek(plaintext, dek, userId, provider, kekVersion, dekVersion, purpose);
}

export async function encryptProviderApiKeyWithDek(
  plaintext: string,
  dek: CryptoKey,
  userId: number,
  provider: ProviderKeyProvider,
  kekVersion: number,
  dekVersion: number,
  purpose = PROVIDER_KEY_PURPOSE,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: aadForV2(userId, provider, purpose, kekVersion, dekVersion).buffer as ArrayBuffer,
    },
    dek,
    encoded,
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return `${ENC_V2_PREFIX}${kekVersion}:${dekVersion}:${uint8ToBase64(combined)}`;
}

export function parseProviderApiKeyV2Envelope(encrypted: string): { kekVersion: number; dekVersion: number } {
  if (!encrypted.startsWith(ENC_V2_PREFIX)) {
    throw new ProviderKeyEncryptionError('Stored provider key is not enc:v2');
  }
  const parts = encrypted.split(':');
  if (parts.length !== 5) {
    throw new ProviderKeyEncryptionError('Stored provider key has an invalid enc:v2 envelope');
  }
  return {
    kekVersion: parseVersion(parts[2], 'KEK'),
    dekVersion: parseVersion(parts[3], 'DEK'),
  };
}

export async function decryptProviderApiKeyV2(
  db: D1Database,
  encrypted: string,
  encryptionKey: string | undefined,
  userId: number,
  provider: ProviderKeyProvider,
  purpose = PROVIDER_KEY_PURPOSE,
): Promise<string> {
  if (!encryptionKey) throw new ProviderKeyEncryptionError();
  return decryptProviderApiKeyWithVersionedKek(
    db,
    encrypted,
    { ENCRYPTION_KEY: encryptionKey },
    userId,
    provider,
    purpose,
  );
}

export async function decryptProviderApiKeyWithVersionedKek(
  db: D1Database,
  encrypted: string,
  env: ProviderKeyEncryptionEnv,
  userId: number,
  provider: ProviderKeyProvider,
  purpose = PROVIDER_KEY_PURPOSE,
): Promise<string> {
  const { kekVersion, dekVersion } = parseProviderApiKeyV2Envelope(encrypted);
  const dek = await readUserDekForCiphertext(db, userId, env, kekVersion, dekVersion);
  return decryptProviderApiKeyWithDek(encrypted, dek, userId, provider, purpose);
}

export async function decryptProviderApiKeyWithDek(
  encrypted: string,
  dek: CryptoKey,
  userId: number,
  provider: ProviderKeyProvider,
  purpose = PROVIDER_KEY_PURPOSE,
): Promise<string> {
  const { kekVersion, dekVersion } = parseProviderApiKeyV2Envelope(encrypted);
  const parts = encrypted.split(':');
  const combined = base64ToUint8(parts[4]);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: aadForV2(userId, provider, purpose, kekVersion, dekVersion).buffer as ArrayBuffer,
    },
    dek,
    ciphertext,
  );
  return new TextDecoder().decode(decrypted);
}

export async function resolveStoredProviderApiKey(
  db: D1Database | undefined,
  userId: number,
  provider: ProviderKeyProvider,
  env: ProviderKeyEncryptionEnv,
): Promise<string | undefined> {
  if (!db) return undefined;
  const row = await db.prepare(`
    SELECT encrypted_api_key
    FROM user_provider_keys
    WHERE user_id = ? AND provider = ?
  `).bind(userId, provider).first<{ encrypted_api_key: string }>();
  if (!row) return undefined;
  return decryptProviderApiKeyWithVersionedKek(db, row.encrypted_api_key, env, userId, provider);
}

function platformConfigured(env: Env, provider: ProviderKeyProvider): boolean {
  return PROVIDER_KEY_DEFINITIONS[provider].envKeys.some((key) => {
    const value = env[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

export async function listProviderKeySummaries(
  db: D1Database,
  userId: number,
  env: Env,
): Promise<ProviderKeySummary[]> {
  const result = await db.prepare(`
    SELECT provider, key_hint, updated_at
    FROM user_provider_keys
    WHERE user_id = ?
  `).bind(userId).all<{ provider: string; key_hint: string; updated_at: string }>();
  const rows = new Map(
    (result.results ?? [])
      .filter((row): row is { provider: ProviderKeyProvider; key_hint: string; updated_at: string } =>
        isProviderKeyProvider(row.provider))
      .map((row) => [row.provider, row])
  );

  return providerKeyProviders.map((provider) => {
    const definition = getProviderKeyDefinition(provider);
    const row = rows.get(provider);
    return {
      provider,
      label: definition.label,
      configured: Boolean(row),
      keyHint: row?.key_hint ?? null,
      updatedAt: row?.updated_at ?? null,
      platformConfigured: platformConfigured(env, provider),
    };
  });
}

export async function upsertProviderApiKey(
  db: D1Database,
  userId: number,
  provider: ProviderKeyProvider,
  apiKey: string,
  env: ProviderKeyEncryptionEnv,
): Promise<void> {
  const trimmed = apiKey.trim();
  const encrypted = await encryptProviderApiKeyWithVersionedKek(db, trimmed, env, userId, provider);
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO user_provider_keys (user_id, provider, encrypted_api_key, key_hint, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, provider) DO UPDATE SET
      encrypted_api_key = excluded.encrypted_api_key,
      key_hint = excluded.key_hint,
      updated_at = excluded.updated_at
  `).bind(userId, provider, encrypted, maskProviderKey(trimmed), now, now).run();
}

export async function deleteProviderApiKey(
  db: D1Database,
  userId: number,
  provider: ProviderKeyProvider,
): Promise<void> {
  await db.prepare(`
    DELETE FROM user_provider_keys
    WHERE user_id = ? AND provider = ?
  `).bind(userId, provider).run();
}

export async function hasStoredProviderApiKey(
  db: D1Database | undefined,
  userId: number,
  provider: ProviderKeyProvider,
): Promise<boolean> {
  if (!db) return false;
  const row = await db.prepare(`
    SELECT 1 AS present
    FROM user_provider_keys
    WHERE user_id = ? AND provider = ?
  `).bind(userId, provider).first<{ present: number }>();
  return row?.present === 1;
}
