import { createFileRoute } from '@tanstack/react-router';
import { SPA_ROUTES, spaRouteStaticData } from '../../spaRoutes';
import { lazyPage } from '../-lazyPage';

export const Route = createFileRoute('/oauth/approve')({
  staticData: spaRouteStaticData(SPA_ROUTES.oauthApprove),
  component: lazyPage(() => import('../../pages/AuthorizationApprovalPage')),
});
