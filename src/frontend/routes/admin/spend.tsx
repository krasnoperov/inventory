import { createFileRoute, redirect } from '@tanstack/react-router';
import AdminSpendPage from '../../pages/AdminSpendPage';
import { getCachedSession } from '../../queries';

export const Route = createFileRoute('/admin/spend')({
  beforeLoad: ({ context }) => {
    if (!getCachedSession(context.queryClient, context.session)?.user) {
      throw redirect({ to: '/login' });
    }
  },
  component: AdminSpendPage,
});
