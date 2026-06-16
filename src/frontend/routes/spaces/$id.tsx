import { createFileRoute, redirect } from '@tanstack/react-router';
import { lazyPage } from '../-lazyPage';
import { getCachedSession, spacePageQueryOptions } from '../../queries';

export const Route = createFileRoute('/spaces/$id')({
  beforeLoad: ({ context }) => {
    if (!getCachedSession(context.queryClient, context.session)?.user) {
      throw redirect({ to: '/login' });
    }
  },
  loader: ({ context, params }) => context.queryClient.ensureQueryData(
    spacePageQueryOptions(params.id, context.apiBaseUrl, context.apiHeaders),
  ),
  component: lazyPage(() => import('../../pages/SpacePage')),
});
