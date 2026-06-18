import { createFileRoute, useRouter } from '@tanstack/react-router';
import { docsHead, getDocBySlug } from '../../content/docs-manifest';
import DocsPage from '../../pages/DocsPage';
import UnknownPage from '../../pages/UnknownPage';

export const Route = createFileRoute('/docs/$slug')({
  head: ({ params }) => docsHead(params.slug),
  component: DocsRoute,
});

function DocsRoute() {
  const router = useRouter();
  const { slug } = Route.useParams();
  if (!getDocBySlug(slug)) {
    if (router.isServer) {
      router.stores.statusCode.set(404);
    }
    return <UnknownPage />;
  }

  return <DocsPage slug={slug} />;
}
