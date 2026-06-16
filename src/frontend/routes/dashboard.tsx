import { createFileRoute, redirect } from '@tanstack/react-router';
import { lazyPage } from './-lazyPage';
import { getCachedSession, spacesQueryOptions } from '../queries';

export const Route = createFileRoute('/dashboard')({
  beforeLoad: ({ context }) => {
    if (!getCachedSession(context.queryClient, context.session)?.user) {
      throw redirect({ to: '/login' });
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(
    spacesQueryOptions(context.apiBaseUrl, context.apiHeaders),
  ),
  component: lazyPage(() => import('../pages/LandingPage')),
});
