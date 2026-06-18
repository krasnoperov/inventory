import quickstart from '../../shared/content/docs/quickstart.md?raw';
import concepts from '../../shared/content/docs/concepts.md?raw';
import cli from '../../shared/content/docs/cli.md?raw';
import productionHandoff from '../../shared/content/docs/production-handoff.md?raw';
import mediaPlaybooks from '../../shared/content/docs/media-playbooks.md?raw';
import imagePlaybook from '../../shared/content/docs/image-playbook.md?raw';
import videoPlaybook from '../../shared/content/docs/video-playbook.md?raw';
import audioPlaybook from '../../shared/content/docs/audio-playbook.md?raw';
import modelAndParameterSelection from '../../shared/content/docs/model-and-parameter-selection.md?raw';
import { DOC_REGISTRY, type DocSlug } from '../../shared/content/content-registry';

const DOC_CONTENT: Record<DocSlug, string> = {
  quickstart,
  concepts,
  cli,
  'production-handoff': productionHandoff,
  'media-playbooks': mediaPlaybooks,
  'image-playbook': imagePlaybook,
  'video-playbook': videoPlaybook,
  'audio-playbook': audioPlaybook,
  'model-and-parameter-selection': modelAndParameterSelection,
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

export function getDocBySlug(slug: string | undefined): DocEntry | undefined {
  return DOCS.find((doc) => doc.slug === slug);
}

export function getDefaultDoc(): DocEntry {
  return DOCS[0]!;
}

export function docsHead(slug?: string) {
  const doc = slug ? getDocBySlug(slug) : getDefaultDoc();
  const title = doc ? `${doc.title} - Make Effects Docs` : 'Docs Not Found - Make Effects';
  const description = doc?.description ?? 'The requested Make Effects documentation page was not found.';
  const path = doc?.path ?? `/docs/${slug ?? ''}`;
  const url = `https://makefx.app${path}`;

  return {
    meta: [
      { title },
      { name: 'description', content: description },
      { property: 'og:site_name', content: 'Make Effects' },
      { property: 'og:type', content: 'article' },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:url', content: url },
      { name: 'twitter:card', content: 'summary' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
    ],
    links: [
      { rel: 'canonical', href: url },
      { rel: 'alternate', type: 'text/markdown', title: `${doc?.title ?? 'Docs'} markdown`, href: doc ? `${doc.path}.md` : '/docs.md' },
    ],
  };
}
