import { createFileRoute } from '@tanstack/react-router';
import { SPA_ROUTES, spaRouteStaticData } from '../spaRoutes';
import { lazyPage } from './-lazyPage';

export const Route = createFileRoute('/login')({
  staticData: spaRouteStaticData(SPA_ROUTES.login),
  component: lazyPage(() => import('../pages/LoginPage')),
});
