import type { ProviderKeyProvider } from '../services/providerKeyVault';
import {
  ProviderKeyEncryptionError,
  createWrappedProviderKeyDek,
  deleteProviderApiKey,
  decryptProviderApiKeyWithDek,
  encryptProviderApiKeyWithDek,
  hasStoredProviderApiKey,
  isProviderKeyProvider,
  maskProviderKey,
  parseProviderApiKeyV2Envelope,
  resolveStoredProviderApiKey,
  upsertProviderApiKey,
  unwrapProviderKeyDek,
  wrapProviderKeyDek,
  type VersionedKekProvider,
} from '../services/providerKeyVault';
import type {
  DeleteProviderKeyRequest,
  DeleteProviderKeyResponse,
  KeyBrokerService,
  KeyBrokerTenantScope,
  ResolveProviderKeyRequest,
  ResolveProviderKeyResponse,
  RewrapAllDeksRequest,
  RewrapAllDeksResponse,
  RotateTenantDekRequest,
  RotateTenantDekResponse,
  StoreProviderKeyRequest,
  StoreProviderKeyResponse,
} from './contract';

type SecretValueBinding = string | SecretsStoreSecret | undefined;

export interface KeyBrokerWorkerEnv {
  DB: D1Database;
  BYOK_ACTIVE_KEK_VERSION?: string;
  BYOK_KEK_V1?: SecretValueBinding;
  BYOK_KEK_V2?: SecretValueBinding;
  [binding: `BYOK_KEK_V${number}`]: SecretValueBinding;
}

function assertUserTenant(tenant: KeyBrokerTenantScope): number {
  if (tenant.type !== 'user' || !Number.isSafeInteger(tenant.userId) || tenant.userId <= 0) {
    throw new ProviderKeyEncryptionError('Key broker tenant scope is invalid');
  }
  return tenant.userId;
}

function assertProvider(provider: ProviderKeyProvider): ProviderKeyProvider {
  if (!isProviderKeyProvider(provider)) {
    throw new ProviderKeyEncryptionError('Key broker provider is invalid');
  }
  return provider;
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ProviderKeyEncryptionError(`Key broker ${label} is invalid`);
  }
  return value;
}

async function assertGenerationAuthorized(
  env: KeyBrokerWorkerEnv,
  userId: number,
  request: ResolveProviderKeyRequest,
): Promise<void> {
  if (request.purpose !== 'generation') {
    throw new ProviderKeyEncryptionError('Key broker resolve purpose is invalid');
  }

  const jobId = assertNonEmptyString(request.generation?.jobId, 'generation job');
  const requestId = assertNonEmptyString(request.generation?.requestId, 'generation request');
  const spaceId = assertNonEmptyString(request.generation?.spaceId, 'generation space');

  const row = await env.DB.prepare(`
    SELECT 1 AS authorized
    FROM platform_usage_events
    WHERE user_id = ?
      AND usage_type = 'workflow'
      AND workflow_id = ?
      AND variant_id = ?
      AND request_id = ?
      AND space_id = ?
    LIMIT 1
  `).bind(userId, jobId, jobId, requestId, spaceId).first<{ authorized: number }>();

  if (row?.authorized !== 1) {
    throw new ProviderKeyEncryptionError('Key broker generation authorization denied');
  }
}

function getActiveKekVersion(env: KeyBrokerWorkerEnv): number {
  const rawVersion = env.BYOK_ACTIVE_KEK_VERSION ?? '1';
  if (!/^[1-9]\d*$/.test(rawVersion)) {
    throw new ProviderKeyEncryptionError('BYOK_ACTIVE_KEK_VERSION must be a positive integer');
  }
  return Number.parseInt(rawVersion, 10);
}

async function readSecretValue(binding: SecretValueBinding): Promise<string | undefined> {
  if (typeof binding === 'string') return binding;
  if (binding && typeof binding.get === 'function') return binding.get();
  return undefined;
}

async function getKekByVersion(env: KeyBrokerWorkerEnv, version: number): Promise<string> {
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new ProviderKeyEncryptionError('BYOK KEK version must be a positive integer');
  }
  const bindingName = `BYOK_KEK_V${version}` as const;
  const value = await readSecretValue(env[bindingName]);
  if (!value) {
    throw new ProviderKeyEncryptionError(`BYOK_KEK_V${version} Secrets Store binding is required`);
  }
  return value;
}

function encryptionEnv(env: KeyBrokerWorkerEnv): VersionedKekProvider {
  return {
    activeKekVersion: getActiveKekVersion(env),
    getKekByVersion: (version) => readSecretValue(env[`BYOK_KEK_V${version}` as const]),
  };
}

type EnvelopeRow = {
  scope_id: string;
  wrapped_dek: string;
  dek_version: number;
  kek_version: number;
};

type TenantProviderKeyRow = {
  provider: string;
  encrypted_api_key: string;
};

function assertRotationVersion(version: number, label: string): number {
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new ProviderKeyEncryptionError(`Key broker ${label} KEK version is invalid`);
  }
  return version;
}

function scopeIdForUser(userId: number): string {
  return `user:${userId}`;
}

function resultChanges(result: unknown): number {
  const meta = (result as { meta?: { changes?: number } }).meta;
  return typeof meta?.changes === 'number' ? meta.changes : 0;
}

function buildProviderKeySnapshotGuard(
  env: KeyBrokerWorkerEnv,
  userId: number,
  rows: readonly TenantProviderKeyRow[],
  now: string,
): D1PreparedStatement {
  const predicates = rows.map(() => '(provider = ? AND encrypted_api_key = ?)').join(' OR ');
  const snapshotBindings = rows.flatMap((row) => [
    assertProvider(row.provider as ProviderKeyProvider),
    row.encrypted_api_key,
  ]);

  return env.DB.prepare(`
    INSERT INTO user_provider_keys (user_id, provider, encrypted_api_key, key_hint, created_at, updated_at)
    SELECT ?, ?, NULL, '', ?, ?
    WHERE EXISTS (
      SELECT 1
      FROM user_provider_keys
      WHERE user_id = ?
        AND NOT (${predicates})
    )
    OR (
      SELECT COUNT(*)
      FROM user_provider_keys
      WHERE user_id = ?
    ) <> ?
  `).bind(
    userId,
    assertProvider(rows[0]?.provider as ProviderKeyProvider),
    now,
    now,
    userId,
    ...snapshotBindings,
    userId,
    rows.length,
  );
}

function isProviderSnapshotGuardFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('NOT NULL constraint failed') &&
    message.includes('user_provider_keys.encrypted_api_key')
  );
}

export async function storeProviderKey(
  env: KeyBrokerWorkerEnv,
  request: StoreProviderKeyRequest,
): Promise<StoreProviderKeyResponse> {
  const userId = assertUserTenant(request.tenant);
  const provider = assertProvider(request.provider);
  const trimmed = request.apiKey.trim();

  await upsertProviderApiKey(env.DB, userId, provider, trimmed, encryptionEnv(env));

  return {
    tenant: request.tenant,
    provider,
    keyHint: maskProviderKey(trimmed),
    updatedAt: new Date().toISOString(),
  };
}

export async function deleteProviderKey(
  env: KeyBrokerWorkerEnv,
  request: DeleteProviderKeyRequest,
): Promise<DeleteProviderKeyResponse> {
  const userId = assertUserTenant(request.tenant);
  const provider = assertProvider(request.provider);

  await deleteProviderApiKey(env.DB, userId, provider);

  return {
    tenant: request.tenant,
    provider,
    deletedAt: new Date().toISOString(),
  };
}

export async function resolveProviderKey(
  env: KeyBrokerWorkerEnv,
  request: ResolveProviderKeyRequest,
): Promise<ResolveProviderKeyResponse> {
  const userId = assertUserTenant(request.tenant);
  const provider = assertProvider(request.provider);
  await assertGenerationAuthorized(env, userId, request);
  const hasStoredKey = await hasStoredProviderApiKey(env.DB, userId, provider);
  if (!hasStoredKey) {
    return {
      tenant: request.tenant,
      provider,
      apiKey: null,
      keySource: 'missing',
    };
  }
  const apiKey = await resolveStoredProviderApiKey(
    env.DB,
    userId,
    provider,
    encryptionEnv(env),
  );

  return {
    tenant: request.tenant,
    provider,
    apiKey: apiKey ?? null,
    keySource: apiKey ? 'byok' : 'missing',
  };
}

export async function rotateTenantDek(
  env: KeyBrokerWorkerEnv,
  request: RotateTenantDekRequest,
): Promise<RotateTenantDekResponse> {
  const userId = assertUserTenant(request.tenant);
  const scopeId = scopeIdForUser(userId);
  const envelope = await env.DB.prepare(`
    SELECT scope_id, wrapped_dek, dek_version, kek_version
    FROM key_envelopes
    WHERE scope_id = ?
  `).bind(scopeId).first<EnvelopeRow>();

  if (!envelope) {
    return {
      tenant: request.tenant,
      status: 'noop',
      rotatedProviders: 0,
      dekVersion: null,
      kekVersion: null,
    };
  }

  const providerRows = await env.DB.prepare(`
    SELECT provider, encrypted_api_key
    FROM user_provider_keys
    WHERE user_id = ?
    ORDER BY provider
  `).bind(userId).all<TenantProviderKeyRow>();
  const rows = providerRows.results ?? [];

  if (rows.length === 0) {
    return {
      tenant: request.tenant,
      status: 'noop',
      rotatedProviders: 0,
      dekVersion: envelope.dek_version,
      kekVersion: envelope.kek_version,
    };
  }

  for (const row of rows) {
    const provider = assertProvider(row.provider as ProviderKeyProvider);
    const parsed = parseProviderApiKeyV2Envelope(row.encrypted_api_key);
    if (parsed.dekVersion !== envelope.dek_version) {
      throw new ProviderKeyEncryptionError(`Provider key ${provider} DEK version does not match tenant envelope`);
    }
  }

  const activeKekVersion = getActiveKekVersion(env);
  const newDekVersion = envelope.dek_version + 1;
  const oldDek = await unwrapProviderKeyDek(
    envelope.wrapped_dek,
    await getKekByVersion(env, envelope.kek_version),
  );
  const { dek: newDek, wrappedDek: newWrappedDek } = await createWrappedProviderKeyDek(
    await getKekByVersion(env, activeKekVersion),
  );
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    buildProviderKeySnapshotGuard(env, userId, rows, now),
  ];

  for (const row of rows) {
    const provider = assertProvider(row.provider as ProviderKeyProvider);
    const plaintext = await decryptProviderApiKeyWithDek(
      row.encrypted_api_key,
      oldDek,
      userId,
      provider,
    );
    const encrypted = await encryptProviderApiKeyWithDek(
      plaintext,
      newDek,
      userId,
      provider,
      activeKekVersion,
      newDekVersion,
    );
    statements.push(env.DB.prepare(`
      UPDATE user_provider_keys
      SET encrypted_api_key = ?, updated_at = ?
      WHERE user_id = ? AND provider = ? AND encrypted_api_key = ?
    `).bind(encrypted, now, userId, provider, row.encrypted_api_key));
  }

  statements.push(env.DB.prepare(`
    UPDATE key_envelopes
    SET wrapped_dek = ?, dek_version = ?, kek_version = ?, updated_at = ?
    WHERE scope_id = ? AND wrapped_dek = ? AND dek_version = ? AND kek_version = ?
  `).bind(
    newWrappedDek,
    newDekVersion,
    activeKekVersion,
    now,
    scopeId,
    envelope.wrapped_dek,
    envelope.dek_version,
    envelope.kek_version,
  ));

  const results = await (async () => {
    try {
      return await env.DB.batch(statements);
    } catch (error) {
      if (isProviderSnapshotGuardFailure(error)) {
        throw new ProviderKeyEncryptionError('Tenant DEK rotation was interrupted by a concurrent update; retry the operation');
      }
      throw error;
    }
  })();
  const expectedChanges = rows.length + 1;
  const actualChanges = results.reduce((sum, result) => sum + resultChanges(result), 0);
  if (actualChanges !== expectedChanges) {
    throw new ProviderKeyEncryptionError('Tenant DEK rotation was interrupted by a concurrent update; retry the operation');
  }

  return {
    tenant: request.tenant,
    status: 'rotated',
    rotatedProviders: rows.length,
    dekVersion: newDekVersion,
    kekVersion: activeKekVersion,
  };
}

export async function rewrapAllDeks(
  env: KeyBrokerWorkerEnv,
  request: RewrapAllDeksRequest,
): Promise<RewrapAllDeksResponse> {
  const fromKekVersion = assertRotationVersion(request.fromKekVersion, 'source');
  const toKekVersion = assertRotationVersion(request.toKekVersion, 'target');
  if (fromKekVersion === toKekVersion) {
    throw new ProviderKeyEncryptionError('Key broker source and target KEK versions must differ');
  }

  const rowsResult = await env.DB.prepare(`
    SELECT scope_id, wrapped_dek, dek_version, kek_version
    FROM key_envelopes
    WHERE kek_version IN (?, ?)
    ORDER BY scope_id
  `).bind(fromKekVersion, toKekVersion).all<EnvelopeRow>();
  const rows = rowsResult.results ?? [];
  const fromKek = await getKekByVersion(env, fromKekVersion);
  const toKek = await getKekByVersion(env, toKekVersion);

  let rewrapped = 0;
  let alreadyRewrapped = 0;
  let skipped = 0;

  for (const row of rows) {
    if (row.kek_version === toKekVersion) {
      alreadyRewrapped += 1;
      continue;
    }
    if (row.kek_version !== fromKekVersion) {
      skipped += 1;
      continue;
    }
    if (request.dryRun) {
      rewrapped += 1;
      continue;
    }

    const dek = await unwrapProviderKeyDek(row.wrapped_dek, fromKek);
    const wrappedDek = await wrapProviderKeyDek(dek, toKek);
    const now = new Date().toISOString();
    const result = await env.DB.prepare(`
      UPDATE key_envelopes
      SET wrapped_dek = ?, kek_version = ?, updated_at = ?
      WHERE scope_id = ? AND wrapped_dek = ? AND kek_version = ?
    `).bind(wrappedDek, toKekVersion, now, row.scope_id, row.wrapped_dek, fromKekVersion).run();

    if (resultChanges(result) === 1) {
      rewrapped += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    status: request.dryRun ? 'dry_run' : 'completed',
    fromKekVersion,
    toKekVersion,
    scanned: rows.length,
    rewrapped,
    alreadyRewrapped,
    skipped,
  };
}

export function createKeyBrokerService(env: KeyBrokerWorkerEnv): KeyBrokerService {
  return {
    storeProviderKey: (request) => storeProviderKey(env, request),
    deleteProviderKey: (request) => deleteProviderKey(env, request),
    resolveProviderKey: (request) => resolveProviderKey(env, request),
    rotateTenantDek: (request) => rotateTenantDek(env, request),
    rewrapAllDeks: (request) => rewrapAllDeks(env, request),
  };
}
