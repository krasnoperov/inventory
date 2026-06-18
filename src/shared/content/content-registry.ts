export const DOC_REGISTRY = [
  {
    slug: 'quickstart',
    title: 'Quickstart',
    description: 'Install makefx, sign in, create a space, and turn CLI generation into tracked project work.',
    path: '/docs/quickstart',
    order: 0,
  },
  {
    slug: 'concepts',
    title: 'Core Concepts',
    description: 'Understand the memory layer: spaces, assets, variants, recipes, lineage, runs, and production records.',
    path: '/docs/concepts',
    order: 1,
  },
  {
    slug: 'cli',
    title: 'CLI Reference',
    description: 'Use the makefx CLI as the fast loop for agents, scripts, images, audio, video, and project state.',
    path: '/docs/cli',
    order: 2,
  },
  {
    slug: 'production-handoff',
    title: 'Production Handoff',
    description: 'Choose what worked, place it into a production, and export media for downstream tools.',
    path: '/docs/production-handoff',
    order: 3,
  },
] as const;

export type DocRegistryEntry = (typeof DOC_REGISTRY)[number];
export type DocSlug = DocRegistryEntry['slug'];
export type DocPath = DocRegistryEntry['path'];
