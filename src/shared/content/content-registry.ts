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
    description: 'Understand the memory layer: spaces, assets, variants, recipes, lineage, and runs.',
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
    slug: 'media-playbooks',
    title: 'Media Playbooks',
    description: 'Use reference-first workflows for images, video, and audio instead of prompt roulette.',
    path: '/docs/media-playbooks',
    order: 3,
  },
  {
    slug: 'image-playbook',
    title: 'Image Playbook',
    description: 'Build reusable references, style anchors, scenes, and edits that stay consistent.',
    path: '/docs/image-playbook',
    order: 4,
  },
  {
    slug: 'video-playbook',
    title: 'Video Playbook',
    description: 'Make keyframes first, then direct motion, sound, and selected variants.',
    path: '/docs/video-playbook',
    order: 5,
  },
  {
    slug: 'audio-playbook',
    title: 'Audio Playbook',
    description: 'Pick speech, dialogue, music, or SFX modes and brief each sound deliberately.',
    path: '/docs/audio-playbook',
    order: 6,
  },
  {
    slug: 'model-and-parameter-selection',
    title: 'Model & Parameter Selection',
    description: 'Choose image, video, and audio modes, defaults, and CLI-exposed parameters.',
    path: '/docs/model-and-parameter-selection',
    order: 7,
  },
] as const;

export type DocRegistryEntry = (typeof DOC_REGISTRY)[number];
export type DocSlug = DocRegistryEntry['slug'];
export type DocPath = DocRegistryEntry['path'];
