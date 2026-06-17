import { createFileRoute } from '@tanstack/react-router';
import AuthorizationApprovalPage from '../../pages/AuthorizationApprovalPage';

export const Route = createFileRoute('/oauth/approve')({
  component: AuthorizationApprovalPage,
});
