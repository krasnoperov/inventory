import type {
  KeyBrokerService,
  ResolveProviderKeyRequest,
  ResolveProviderKeyResponse,
  RewrapAllDeksRequest,
  RewrapAllDeksResponse,
  RotateTenantDekRequest,
  RotateTenantDekResponse,
  StoreProviderKeyRequest,
  StoreProviderKeyResponse,
} from './contract';

export type KeyBrokerServiceBinding = KeyBrokerService;

export function keyBrokerClient(binding: KeyBrokerServiceBinding): KeyBrokerService {
  return {
    storeProviderKey(request: StoreProviderKeyRequest): Promise<StoreProviderKeyResponse> {
      return binding.storeProviderKey(request);
    },
    resolveProviderKey(request: ResolveProviderKeyRequest): Promise<ResolveProviderKeyResponse> {
      return binding.resolveProviderKey(request);
    },
    rotateTenantDek(request: RotateTenantDekRequest): Promise<RotateTenantDekResponse> {
      return binding.rotateTenantDek(request);
    },
    rewrapAllDeks(request: RewrapAllDeksRequest): Promise<RewrapAllDeksResponse> {
      return binding.rewrapAllDeks(request);
    },
  };
}
