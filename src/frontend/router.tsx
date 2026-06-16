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

interface GetRouterOptions {
  initialSession?: StartSession;
  request?: Request;
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
