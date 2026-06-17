import { createFileRoute, redirect } from '@tanstack/react-router';

// There is no standalone /spaces list — the spaces list lives on /dashboard.
// Redirect bare /spaces there instead of falling through to the 404 catch-all.
export const Route = createFileRoute('/spaces/')({
  beforeLoad: () => {
    throw redirect({ to: '/dashboard' });
  },
});
