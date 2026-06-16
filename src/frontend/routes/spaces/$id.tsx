import { createFileRoute } from '@tanstack/react-router';
import { SPA_ROUTES, spaRouteStaticData } from '../../spaRoutes';
import { lazyPage } from '../-lazyPage';

export const Route = createFileRoute('/spaces/$id')({
  staticData: spaRouteStaticData(SPA_ROUTES.space),
  component: lazyPage(() => import('../../pages/SpacePage')),
});
