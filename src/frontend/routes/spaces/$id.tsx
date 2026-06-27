import { useEffect } from 'react';
import { createFileRoute, Outlet, useRouter } from '@tanstack/react-router';
import { ApiFetchError } from '../../../api/client';
import SpaceAccessRequestPage from '../../pages/SpaceAccessRequestPage';
import UnknownPage from '../../pages/UnknownPage';
import { openSpaceSession } from '../../space/spaceSessionRuntime';
import { requireSpaceRouteAccess } from './-spaceAccessGuard';

// Layout route for everything under /spaces/$id. It only guards auth and
// renders <Outlet/> so the canvas (index), production and asset-detail pages
// are siblings that each render as a full page — previously this route
// rendered the canvas itself with no <Outlet/>, so child routes (production,
// asset detail) silently never appeared.
export const Route = createFileRoute('/spaces/$id')({
  beforeLoad: requireSpaceRouteAccess,
  component: SpaceSessionRoute,
  errorComponent: SpaceRouteError,
  notFoundComponent: SpaceNotFound,
});

function SpaceSessionRoute() {
  const { id } = Route.useParams();

  useEffect(() => openSpaceSession(id), [id]);

  return <Outlet />;
}

function SpaceRouteError({ error }: { error: Error }) {
  const { id } = Route.useParams();
  const router = useRouter();

  if (error.name === 'SpaceAccessRequiredError') {
    return <SpaceAccessRequestPage spaceId={id} />;
  }

  if (error instanceof ApiFetchError && error.status === 404) {
    if (router.isServer) {
      router.stores.statusCode.set(404);
    }
    return <UnknownPage />;
  }

  return <SpaceAccessRequestPage spaceId={id} />;
}

function SpaceNotFound() {
  const router = useRouter();
  if (router.isServer) {
    router.stores.statusCode.set(404);
  }
  return <UnknownPage />;
}
