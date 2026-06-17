import { createFileRoute, redirect } from '@tanstack/react-router';
import ProductionPage from '../../../pages/ProductionPage';
import { ssrFetchArgs } from '../../../app-context';
import { getCachedSession, spacePageQueryOptions } from '../../../queries';

export const Route = createFileRoute('/spaces/$id/production')({
  beforeLoad: ({ context }) => {
    if (!getCachedSession(context.queryClient, context.session)?.user) {
      throw redirect({ to: '/login' });
    }
  },
  loader: (opts) => {
    const { baseUrl, headers, fetchImpl } = ssrFetchArgs(opts);
    return opts.context.queryClient.ensureQueryData(
      spacePageQueryOptions(opts.params.id, baseUrl, headers, fetchImpl),
    );
  },
  component: ProductionPage,
});
