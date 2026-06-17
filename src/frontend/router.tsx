import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import {
  QueryClientProviderWrap,
  createQueryClient,
  dehydrateQueryClient,
  hydrateQueryClient,
  type RouterDehydratedState,
} from './queryClient';
import type { StartSession } from './startSession';
import type { FetchLike } from '../api/client';

interface GetRouterOptions {
  initialSession?: StartSession;
  request?: Request;
  // Provided during SSR: dispatches API calls to the worker in-process so
  // loaders don't self-fetch the worker origin (which fails under
  // run_worker_first and 500s authenticated document renders).
  serverFetch?: FetchLike;
}

export const getRouter = (options: GetRouterOptions = {}) => {
  const queryClient = createQueryClient();
  const apiBaseUrl = options.request ? new URL(options.request.url).origin : undefined;
  const cookie = options.request?.headers.get('cookie');
  const apiHeaders = cookie ? { cookie } : undefined;

  return createRouter({
    routeTree,
    scrollRestoration: true,
    context: {
      queryClient,
      initialSession: options.initialSession,
      apiBaseUrl,
      apiHeaders,
      serverFetch: options.serverFetch,
    },
    Wrap: ({ children }) => (
      <QueryClientProviderWrap queryClient={queryClient}>
        {children}
      </QueryClientProviderWrap>
    ),
    dehydrate: () => dehydrateQueryClient(queryClient),
    hydrate: (dehydrated: RouterDehydratedState) => hydrateQueryClient(queryClient, dehydrated),
  });
};

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
