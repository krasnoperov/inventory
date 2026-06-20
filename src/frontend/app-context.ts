import type { QueryClient } from '@tanstack/react-query';
import type { FetchLike } from '../api/client';
import type { User } from './contexts/AuthContextProvider';

// Session shape injected at SSR time (server bootstrap) and re-fetched on the
// client. Was previously serialised into `window.__INVENTORY_START_SESSION__`;
// under TanStack Start it travels via the per-request `serverContext`.
export interface StartSession {
  config: {
    googleClientId: string;
    environment?: string;
    features: {
      rotation: boolean;
    };
  };
  user: User | null;
}

export interface AppBootstrap {
  session: StartSession;
}

export const DEFAULT_BOOTSTRAP: AppBootstrap = {
  session: {
    config: { googleClientId: '', features: { rotation: false } },
    user: null,
  },
};

export interface StartRequestMeta {
  cookieHeader?: string;
  origin: string;
  pathname?: string;
  search?: string;
}

// Per-request context the worker passes into `startServer.fetch({ context })`.
// TanStack Start merges it into the router context, where the root route reads
// it back. `apiFetch` is the in-process worker dispatcher — SSR loaders use it
// instead of self-fetching the worker origin (which 500s under
// run_worker_first).
export interface StartServerContext {
  apiFetch?: FetchLike;
  bootstrap?: AppBootstrap;
  requestMeta?: StartRequestMeta;
}

export interface StartRouterContext {
  queryClient: QueryClient;
}

// Server-only fetch arguments derived from the per-request serverContext, which
// TanStack Start injects as a top-level loader/beforeLoad param. Kept out of the
// router context so the cookie/auth token and the apiFetch function never enter
// the dehydrated state serialised into the HTML. On the client serverContext is
// undefined, so loaders fall back to a relative, credentialed fetch.
export function ssrFetchArgs(opts: unknown): {
  baseUrl?: string;
  headers?: HeadersInit;
  fetchImpl?: FetchLike;
} {
  const serverContext = (opts as { serverContext?: StartServerContext }).serverContext;
  if (!serverContext) {
    return {};
  }
  const cookie = serverContext.requestMeta?.cookieHeader;
  return {
    baseUrl: serverContext.requestMeta?.origin,
    headers: cookie ? { cookie } : undefined,
    fetchImpl: serverContext.apiFetch,
  };
}
