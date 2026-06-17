import { createFileRoute } from '@tanstack/react-router';
import SpacePage from '../../../pages/SpacePage';
import { ssrFetchArgs } from '../../../app-context';
import { spacePageQueryOptions } from '../../../queries';

// The space canvas — the index of the /spaces/$id layout. Auth is guarded by
// the parent layout route ($id.tsx).
export const Route = createFileRoute('/spaces/$id/')({
  loader: (opts) => {
    const { baseUrl, headers, fetchImpl } = ssrFetchArgs(opts);
    return opts.context.queryClient.ensureQueryData(
      spacePageQueryOptions(opts.params.id, baseUrl, headers, fetchImpl),
    );
  },
  component: SpacePage,
});
