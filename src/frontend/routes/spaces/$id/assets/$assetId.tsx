import { createFileRoute, redirect } from '@tanstack/react-router';
import AssetDetailPage from '../../../../pages/AssetDetailPage';
import { ssrFetchArgs } from '../../../../app-context';
import { assetDetailsQueryOptions, getCachedSession } from '../../../../queries';

export const Route = createFileRoute('/spaces/$id/assets/$assetId')({
  beforeLoad: ({ context }) => {
    if (!getCachedSession(context.queryClient, context.session)?.user) {
      throw redirect({ to: '/login' });
    }
  },
  loader: (opts) => {
    const { baseUrl, headers, fetchImpl } = ssrFetchArgs(opts);
    return opts.context.queryClient.ensureQueryData(
      assetDetailsQueryOptions(opts.params.id, opts.params.assetId, baseUrl, headers, fetchImpl),
    );
  },
  component: AssetDetailPage,
});
