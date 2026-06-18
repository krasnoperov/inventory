import { createFileRoute } from '@tanstack/react-router';
import LandingPage from '../pages/LandingPage';
import { ssrFetchArgs } from '../app-context';
import { getCachedSession, spacesQueryOptions } from '../queries';

export const Route = createFileRoute('/')({
  head: () => ({
    links: [
      { rel: 'canonical', href: 'https://makefx.app/' },
    ],
  }),
  loader: (opts) => {
    const { context } = opts;
    if (!getCachedSession(context.queryClient, context.session)?.user) {
      return;
    }
    const { baseUrl, headers, fetchImpl } = ssrFetchArgs(opts);
    return context.queryClient.ensureQueryData(
      spacesQueryOptions(baseUrl, headers, fetchImpl),
    );
  },
  component: LandingPage,
});
