import { createFileRoute } from '@tanstack/react-router';
import { lazyPage } from '../-lazyPage';

export const Route = createFileRoute('/spaces/$id')({
  component: lazyPage(() => import('../../pages/SpacePage')),
});
