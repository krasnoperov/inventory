export const DOC_REGISTRY = [
  {
    slug: 'quickstart',
    title: 'Quickstart',
    description: 'Install makefx, sign in, create a space, and generate your first tracked media asset.',
    path: '/docs/quickstart',
    order: 0,
  },
  {
    slug: 'concepts',
    title: 'Core Concepts',
    description: 'Understand spaces, assets, variants, recipes, lineage, runs, and production records.',
    path: '/docs/concepts',
    order: 1,
  },
  {
    slug: 'cli',
    title: 'CLI Reference',
    description: 'Use the makefx CLI as an agent-friendly control surface for image, audio, and video production.',
    path: '/docs/cli',
    order: 2,
  },
  {
    slug: 'production-handoff',
    title: 'Production Handoff',
    description: 'Track completed media, place production records, and export files for downstream tools.',
    path: '/docs/production-handoff',
    order: 3,
  },
] as const;

export type DocRegistryEntry = (typeof DOC_REGISTRY)[number];
export type DocSlug = DocRegistryEntry['slug'];
export type DocPath = DocRegistryEntry['path'];

