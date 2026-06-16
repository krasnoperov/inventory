import { createFileRoute } from '@tanstack/react-router';
import { lazyPage } from './-lazyPage';

export const Route = createFileRoute('/dashboard')({
  component: lazyPage(() => import('../pages/LandingPage')),
});
