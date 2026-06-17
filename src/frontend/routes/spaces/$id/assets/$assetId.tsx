import { createFileRoute, redirect } from '@tanstack/react-router';
import { lazyPage } from '../../../-lazyPage';
import { assetDetailsQueryOptions, getCachedSession } from '../../../../queries';

export const Route = createFileRoute('/spaces/$id/assets/$assetId')({
  beforeLoad: ({ context }) => {
    if (!getCachedSession(context.queryClient, context.session)?.user) {
      throw redirect({ to: '/login' });
    }
  },
  loader: ({ context, params }) => context.queryClient.ensureQueryData(
    assetDetailsQueryOptions(
      params.id,
      params.assetId,
      context.apiBaseUrl,
      context.apiHeaders,
      context.serverFetch,
    ),
  ),
  component: lazyPage(() => import('../../../../pages/AssetDetailPage')),
});
