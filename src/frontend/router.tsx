import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import {
  QueryClientProviderWrap,
  createQueryClient,
  dehydrateQueryClient,
  hydrateQueryClient,
  type RouterDehydratedState,
} from './queryClient';
import type { StartRouterContext } from './app-context';

// TanStack Start calls getRouter() per request on the server (one QueryClient
// per request — no cross-request cache leakage) and once on the client. The
// per-request serverContext (session bootstrap + in-process apiFetch) is merged
// into this context by startServer.fetch({ context }); the root route reads it.
export function getRouter() {
  const queryClient = createQueryClient();

  const context: StartRouterContext = {
    queryClient,
  };

  return createRouter({
    routeTree,
    scrollRestoration: true,
    context,
    defaultPreload: 'intent',
    Wrap: ({ children }) => (
      <QueryClientProviderWrap queryClient={queryClient}>
        {children}
      </QueryClientProviderWrap>
    ),
    dehydrate: () => dehydrateQueryClient(queryClient),
    hydrate: (dehydrated: RouterDehydratedState) => hydrateQueryClient(queryClient, dehydrated),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
