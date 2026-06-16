import { createFileRoute } from '@tanstack/react-router';
import { lazyPage } from './-lazyPage';
import { spacesQueryOptions } from '../queries';

export const Route = createFileRoute('/')({
  loader: ({ context }) => {
    if (!context.session.user) {
      return;
    }
    return context.queryClient.ensureQueryData(
      spacesQueryOptions(context.apiBaseUrl, context.apiHeaders),
    );
  },
  component: lazyPage(() => import('../pages/LandingPage')),
});
