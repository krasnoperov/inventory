import quickstart from '../../shared/content/docs/quickstart.md?raw';
import concepts from '../../shared/content/docs/concepts.md?raw';
import cli from '../../shared/content/docs/cli.md?raw';
import productionHandoff from '../../shared/content/docs/production-handoff.md?raw';
import { DOC_REGISTRY, type DocSlug } from '../../shared/content/content-registry';

const DOC_CONTENT: Record<DocSlug, string> = {
  quickstart,
  concepts,
  cli,
  'production-handoff': productionHandoff,
};

export type DocEntry = {
  slug: DocSlug;
  title: string;
  description: string;
  path: string;
  order: number;
  content: string;
};

export const DOCS: DocEntry[] = DOC_REGISTRY
  .map((entry) => ({
    ...entry,
    content: DOC_CONTENT[entry.slug],
  }))
  .sort((a, b) => a.order - b.order);

export function getDocBySlug(slug: string | undefined): DocEntry {
  return DOCS.find((doc) => doc.slug === slug) ?? DOCS[0];
}

