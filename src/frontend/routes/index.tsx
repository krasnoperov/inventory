import { createFileRoute } from '@tanstack/react-router';
import { lazyPage } from './-lazyPage';
import { getCachedSession, spacesQueryOptions } from '../queries';

export const Route = createFileRoute('/')({
  loader: ({ context }) => {
    if (!getCachedSession(context.queryClient, context.session)?.user) {
      return;
    }
    return context.queryClient.ensureQueryData(
      spacesQueryOptions(context.apiBaseUrl, context.apiHeaders, context.serverFetch),
    );
  },
  component: lazyPage(() => import('../pages/LandingPage')),
});
