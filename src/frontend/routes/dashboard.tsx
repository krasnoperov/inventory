import { createFileRoute, redirect } from '@tanstack/react-router';
import { lazyPage } from './-lazyPage';
import { spacesQueryOptions } from '../queries';

export const Route = createFileRoute('/dashboard')({
  beforeLoad: ({ context }) => {
    if (!context.session.user) {
      throw redirect({ to: '/login' });
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(
    spacesQueryOptions(context.apiBaseUrl, context.apiHeaders),
  ),
  component: lazyPage(() => import('../pages/LandingPage')),
});
