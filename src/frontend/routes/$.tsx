import { createFileRoute, useRouter } from '@tanstack/react-router';
import { lazyPage } from './-lazyPage';

const UnknownPage = lazyPage(() => import('../pages/UnknownPage'));

export const Route = createFileRoute('/$')({
  component: UnknownRoute,
});

function UnknownRoute() {
  const router = useRouter();

  if (router.isServer) {
    router.stores.statusCode.set(404);
  }

  return <UnknownPage />;
}
