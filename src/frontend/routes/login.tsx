import { createFileRoute } from '@tanstack/react-router';
import { lazyPage } from './-lazyPage';

export const Route = createFileRoute('/login')({
  component: lazyPage(() => import('../pages/LoginPage')),
});
