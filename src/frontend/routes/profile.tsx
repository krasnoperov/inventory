import { createFileRoute, redirect } from '@tanstack/react-router';
import { lazyPage } from './-lazyPage';
import { getCachedSession, userProfileQueryOptions } from '../queries';

export const Route = createFileRoute('/profile')({
  beforeLoad: ({ context }) => {
    if (!getCachedSession(context.queryClient, context.session)?.user) {
      throw redirect({ to: '/login' });
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(
    userProfileQueryOptions(context.apiBaseUrl, context.apiHeaders, context.serverFetch),
  ),
  component: lazyPage(() => import('../pages/ProfilePage')),
});
