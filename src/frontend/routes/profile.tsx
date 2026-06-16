import { createFileRoute } from '@tanstack/react-router';
import { lazyPage } from './-lazyPage';

export const Route = createFileRoute('/profile')({
  component: lazyPage(() => import('../pages/ProfilePage')),
});
