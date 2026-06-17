import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { getCachedSession } from '../../queries';

// Layout route for everything under /spaces/$id. It only guards auth and
// renders <Outlet/> so the canvas (index), production and asset-detail pages
// are siblings that each render as a full page — previously this route
// rendered the canvas itself with no <Outlet/>, so child routes (production,
// asset detail) silently never appeared.
export const Route = createFileRoute('/spaces/$id')({
  beforeLoad: ({ context }) => {
    if (!getCachedSession(context.queryClient, context.session)?.user) {
      throw redirect({ to: '/login' });
    }
  },
  component: Outlet,
});
