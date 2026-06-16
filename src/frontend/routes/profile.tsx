import { createFileRoute, redirect } from '@tanstack/react-router';
import { lazyPage } from './-lazyPage';
import { userProfileQueryOptions } from '../queries';

export const Route = createFileRoute('/profile')({
  beforeLoad: ({ context }) => {
    if (!context.session.user) {
      throw redirect({ to: '/login' });
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(
    userProfileQueryOptions(context.apiBaseUrl, context.apiHeaders),
  ),
  component: lazyPage(() => import('../pages/ProfilePage')),
});
