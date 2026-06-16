import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { hydrate, dehydrate, type DehydratedState } from '@tanstack/react-query';
import type { ReactNode } from 'react';

export interface RouterDehydratedState {
  // React Query's dehydrated cache is runtime-serializable, but its public type
  // contains unknown query keys that TanStack Router's serializability checker
  // cannot prove.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryClient: any;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  });
}

export function dehydrateQueryClient(queryClient: QueryClient): RouterDehydratedState {
  return {
    queryClient: dehydrate(queryClient),
  };
}

export function hydrateQueryClient(
  queryClient: QueryClient,
  dehydrated: RouterDehydratedState,
) {
  hydrate(queryClient, dehydrated.queryClient as DehydratedState);
}

export function QueryClientProviderWrap({
  children,
  queryClient,
}: {
  children: ReactNode;
  queryClient: QueryClient;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
