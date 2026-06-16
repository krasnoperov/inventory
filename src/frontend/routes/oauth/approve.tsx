import { createFileRoute } from '@tanstack/react-router';
import { lazyPage } from '../-lazyPage';

export const Route = createFileRoute('/oauth/approve')({
  component: lazyPage(() => import('../../pages/AuthorizationApprovalPage')),
});
