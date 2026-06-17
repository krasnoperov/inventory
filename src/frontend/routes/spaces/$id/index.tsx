import { createFileRoute } from '@tanstack/react-router';
import { lazyPage } from '../../-lazyPage';
import { spacePageQueryOptions } from '../../../queries';

// The space canvas — the index of the /spaces/$id layout. Auth is guarded by
// the parent layout route ($id.tsx).
export const Route = createFileRoute('/spaces/$id/')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(
    spacePageQueryOptions(params.id, context.apiBaseUrl, context.apiHeaders, context.serverFetch),
  ),
  component: lazyPage(() => import('../../../pages/SpacePage')),
});
