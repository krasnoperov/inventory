import { createFileRoute } from '@tanstack/react-router';
import { SPA_ROUTES, spaRouteStaticData } from '../spaRoutes';
import { lazyPage } from './-lazyPage';

export const Route = createFileRoute('/dashboard')({
  staticData: spaRouteStaticData(SPA_ROUTES.dashboard),
  component: lazyPage(() => import('../pages/LandingPage')),
});
