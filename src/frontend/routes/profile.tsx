import { createFileRoute, redirect } from '@tanstack/react-router';
import ProfilePage from '../pages/ProfilePage';
import { ssrFetchArgs } from '../app-context';
import { getCachedSession, userProfileQueryOptions } from '../queries';

export const Route = createFileRoute('/profile')({
  beforeLoad: ({ context }) => {
    if (!getCachedSession(context.queryClient, context.session)?.user) {
      throw redirect({ to: '/login' });
    }
  },
  loader: (opts) => {
    const { baseUrl, headers, fetchImpl } = ssrFetchArgs(opts);
    return opts.context.queryClient.ensureQueryData(
      userProfileQueryOptions(baseUrl, headers, fetchImpl),
    );
  },
  component: ProfilePage,
});
