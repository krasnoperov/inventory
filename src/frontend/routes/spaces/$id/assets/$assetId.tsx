import { createFileRoute } from '@tanstack/react-router';
import { lazyPage } from '../../../-lazyPage';

export const Route = createFileRoute('/spaces/$id/assets/$assetId')({
  component: lazyPage(() => import('../../../../pages/AssetDetailPage')),
});
