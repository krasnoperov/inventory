import { WorkerEntrypoint } from 'cloudflare:workers';
import type {
  DeleteProviderKeyRequest,
  ResolveProviderKeyRequest,
  RewrapAllDeksRequest,
  RotateTenantDekRequest,
  StoreProviderKeyRequest,
} from '../backend/key-broker/contract';
import {
  deleteProviderKey,
  resolveProviderKey,
  rewrapAllDeks,
  rotateTenantDek,
  storeProviderKey,
  type KeyBrokerWorkerEnv,
} from '../backend/key-broker/service';

export default class KeyBrokerWorker extends WorkerEntrypoint<KeyBrokerWorkerEnv> {
  async fetch(): Promise<Response> {
    return new Response(null, { status: 404 });
  }

  async storeProviderKey(request: StoreProviderKeyRequest) {
    return storeProviderKey(this.env, request);
  }

  async deleteProviderKey(request: DeleteProviderKeyRequest) {
    return deleteProviderKey(this.env, request);
  }

  async resolveProviderKey(request: ResolveProviderKeyRequest) {
    return resolveProviderKey(this.env, request);
  }

  async rotateTenantDek(request: RotateTenantDekRequest) {
    return rotateTenantDek(this.env, request);
  }

  async rewrapAllDeks(request: RewrapAllDeksRequest) {
    return rewrapAllDeks(this.env, request);
  }
}
