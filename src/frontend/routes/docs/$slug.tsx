import { createFileRoute } from '@tanstack/react-router';
import DocsPage from '../../pages/DocsPage';

export const Route = createFileRoute('/docs/$slug')({
  component: DocsRoute,
});

function DocsRoute() {
  const { slug } = Route.useParams();
  return <DocsPage slug={slug} />;
}

