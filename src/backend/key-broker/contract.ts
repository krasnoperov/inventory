import type { ProviderKeyProvider } from '../services/providerKeyVault';

export const KEY_BROKER_METHODS = [
  'storeProviderKey',
  'deleteProviderKey',
  'resolveProviderKey',
  'rotateTenantDek',
  'rewrapAllDeks',
] as const;

export type KeyBrokerMethod = typeof KEY_BROKER_METHODS[number];

export type KeyBrokerTenantScope = {
  type: 'user';
  userId: number;
};

export interface StoreProviderKeyRequest {
  tenant: KeyBrokerTenantScope;
  provider: ProviderKeyProvider;
  apiKey: string;
}

export interface StoreProviderKeyResponse {
  tenant: KeyBrokerTenantScope;
  provider: ProviderKeyProvider;
  keyHint: string;
  updatedAt: string;
}

export interface DeleteProviderKeyRequest {
  tenant: KeyBrokerTenantScope;
  provider: ProviderKeyProvider;
}

export interface DeleteProviderKeyResponse {
  tenant: KeyBrokerTenantScope;
  provider: ProviderKeyProvider;
  deletedAt: string;
}

export interface ResolveProviderKeyRequest {
  tenant: KeyBrokerTenantScope;
  provider: ProviderKeyProvider;
  purpose: 'generation';
  generation: {
    jobId: string;
    requestId: string;
    spaceId: string;
  };
}

export interface ResolveProviderKeyResponse {
  tenant: KeyBrokerTenantScope;
  provider: ProviderKeyProvider;
  apiKey: string | null;
  keySource: 'byok' | 'missing';
}

export interface RotateTenantDekRequest {
  tenant: KeyBrokerTenantScope;
  reason?: string;
}

export interface RotateTenantDekResponse {
  tenant: KeyBrokerTenantScope;
  status: 'not_implemented';
}

export interface RewrapAllDeksRequest {
  fromKekVersion: number;
  toKekVersion: number;
  dryRun?: boolean;
}

export interface RewrapAllDeksResponse {
  status: 'not_implemented';
}

export interface KeyBrokerService {
  storeProviderKey(request: StoreProviderKeyRequest): Promise<StoreProviderKeyResponse>;
  deleteProviderKey(request: DeleteProviderKeyRequest): Promise<DeleteProviderKeyResponse>;
  resolveProviderKey(request: ResolveProviderKeyRequest): Promise<ResolveProviderKeyResponse>;
  rotateTenantDek(request: RotateTenantDekRequest): Promise<RotateTenantDekResponse>;
  rewrapAllDeks(request: RewrapAllDeksRequest): Promise<RewrapAllDeksResponse>;
}

export function isKeyBrokerMethod(value: string): value is KeyBrokerMethod {
  return (KEY_BROKER_METHODS as readonly string[]).includes(value);
}
