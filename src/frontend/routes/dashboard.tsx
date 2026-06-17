import { createFileRoute, redirect } from '@tanstack/react-router';
import LandingPage from '../pages/LandingPage';
import { ssrFetchArgs } from '../app-context';
import { getCachedSession, spacesQueryOptions } from '../queries';

export const Route = createFileRoute('/dashboard')({
  beforeLoad: ({ context }) => {
    if (!getCachedSession(context.queryClient, context.session)?.user) {
      throw redirect({ to: '/login' });
    }
  },
  loader: (opts) => {
    const { baseUrl, headers, fetchImpl } = ssrFetchArgs(opts);
    return opts.context.queryClient.ensureQueryData(
      spacesQueryOptions(baseUrl, headers, fetchImpl),
    );
  },
  component: LandingPage,
});
