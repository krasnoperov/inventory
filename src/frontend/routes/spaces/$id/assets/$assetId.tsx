import { createFileRoute } from '@tanstack/react-router';
import { SPA_ROUTES, spaRouteStaticData } from '../../../../spaRoutes';
import { lazyPage } from '../../../-lazyPage';

export const Route = createFileRoute('/spaces/$id/assets/$assetId')({
  staticData: spaRouteStaticData(SPA_ROUTES.asset),
  component: lazyPage(() => import('../../../../pages/AssetDetailPage')),
});
