import { createFileRoute } from '@tanstack/react-router';
import { docsHead } from '../../content/docs-manifest';
import DocsPage from '../../pages/DocsPage';

export const Route = createFileRoute('/docs/')({
  head: () => docsHead(),
  component: DocsIndexRoute,
});

function DocsIndexRoute() {
  return <DocsPage slug="quickstart" />;
}
