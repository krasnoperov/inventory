import type { ProviderKeyProvider } from '../services/providerKeyVault';
import {
  ProviderKeyEncryptionError,
  isProviderKeyProvider,
  maskProviderKey,
  resolveStoredProviderApiKey,
  upsertProviderApiKey,
} from '../services/providerKeyVault';
import type {
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

async function getActiveKek(env: KeyBrokerWorkerEnv): Promise<string> {
  const version = getActiveKekVersion(env);
  if (version !== 1) {
    throw new ProviderKeyEncryptionError('Active BYOK KEK version is not supported by this broker contract');
  }
  const value = await readSecretValue(env.BYOK_KEK_V1);
  if (!value) {
    throw new ProviderKeyEncryptionError(`BYOK_KEK_V${version} Secrets Store binding is required`);
  }
  return value;
}

function encryptionEnv(kek: string): { ENCRYPTION_KEY: string } {
  return { ENCRYPTION_KEY: kek };
}

export async function storeProviderKey(
  env: KeyBrokerWorkerEnv,
  request: StoreProviderKeyRequest,
): Promise<StoreProviderKeyResponse> {
  const userId = assertUserTenant(request.tenant);
  const provider = assertProvider(request.provider);
  const kek = await getActiveKek(env);
  const trimmed = request.apiKey.trim();

  await upsertProviderApiKey(env.DB, userId, provider, trimmed, encryptionEnv(kek));

  return {
    tenant: request.tenant,
    provider,
    keyHint: maskProviderKey(trimmed),
    updatedAt: new Date().toISOString(),
  };
}

export async function resolveProviderKey(
  env: KeyBrokerWorkerEnv,
  request: ResolveProviderKeyRequest,
): Promise<ResolveProviderKeyResponse> {
  const userId = assertUserTenant(request.tenant);
  const provider = assertProvider(request.provider);
  const kek = await getActiveKek(env);
  const apiKey = await resolveStoredProviderApiKey(
    env.DB,
    userId,
    provider,
    encryptionEnv(kek),
  );

  return {
    tenant: request.tenant,
    provider,
    apiKey: apiKey ?? null,
    keySource: apiKey ? 'byok' : 'missing',
  };
}

export async function rotateTenantDek(
  _env: KeyBrokerWorkerEnv,
  request: RotateTenantDekRequest,
): Promise<RotateTenantDekResponse> {
  assertUserTenant(request.tenant);
  return {
    tenant: request.tenant,
    status: 'not_implemented',
  };
}

export async function rewrapAllDeks(
  _env: KeyBrokerWorkerEnv,
  _request: RewrapAllDeksRequest,
): Promise<RewrapAllDeksResponse> {
  return { status: 'not_implemented' };
}

export function createKeyBrokerService(env: KeyBrokerWorkerEnv): KeyBrokerService {
  return {
    storeProviderKey: (request) => storeProviderKey(env, request),
    resolveProviderKey: (request) => resolveProviderKey(env, request),
    rotateTenantDek: (request) => rotateTenantDek(env, request),
    rewrapAllDeks: (request) => rewrapAllDeks(env, request),
  };
}
