import { createFileRoute } from '@tanstack/react-router';
import { SPA_ROUTES, spaRouteStaticData } from '../spaRoutes';
import { lazyPage } from './-lazyPage';

export const Route = createFileRoute('/profile')({
  staticData: spaRouteStaticData(SPA_ROUTES.profile),
  component: lazyPage(() => import('../pages/ProfilePage')),
});
