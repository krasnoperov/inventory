import { createFileRoute } from '@tanstack/react-router';
import { SPA_ROUTES, spaRouteStaticData } from '../spaRoutes';
import { lazyPage } from './-lazyPage';

export const Route = createFileRoute('/$')({
  staticData: spaRouteStaticData(SPA_ROUTES.unknown),
  component: lazyPage(() => import('../pages/UnknownPage')),
});
