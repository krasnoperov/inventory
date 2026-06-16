import { createFileRoute } from '@tanstack/react-router';
import { lazyPage } from './-lazyPage';

export const Route = createFileRoute('/')({
  component: lazyPage(() => import('../pages/LandingPage')),
});
