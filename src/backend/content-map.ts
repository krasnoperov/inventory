import home from '../shared/content/pages/home.md?raw';
import quickstart from '../shared/content/docs/quickstart.md?raw';
import concepts from '../shared/content/docs/concepts.md?raw';
import cli from '../shared/content/docs/cli.md?raw';
import mediaPlaybooks from '../shared/content/docs/media-playbooks.md?raw';
import imagePlaybook from '../shared/content/docs/image-playbook.md?raw';
import videoPlaybook from '../shared/content/docs/video-playbook.md?raw';
import audioPlaybook from '../shared/content/docs/audio-playbook.md?raw';
import modelAndParameterSelection from '../shared/content/docs/model-and-parameter-selection.md?raw';
import { DOC_REGISTRY, type DocPath } from '../shared/content/content-registry';

const FULL_DOC_REGISTRY = [
  {
    title: 'Home',
    description: 'Product overview and agent quick start.',
    path: '/',
    order: -1,
  },
  ...DOC_REGISTRY,
] as const;

const DOC_CONTENT: Record<DocPath, string> = {
  '/docs/quickstart': quickstart,
  '/docs/concepts': concepts,
  '/docs/cli': cli,
  '/docs/media-playbooks': mediaPlaybooks,
  '/docs/image-playbook': imagePlaybook,
  '/docs/video-playbook': videoPlaybook,
  '/docs/audio-playbook': audioPlaybook,
  '/docs/model-and-parameter-selection': modelAndParameterSelection,
};

function markdownVariantPath(path: string): string {
  return path === '/' ? '/index.md' : `${path}.md`;
}

export const CONTENT_MAP: Record<string, string> = {
  '/': home,
  '/docs': quickstart,
  ...DOC_CONTENT,
};

export const LLMS_TXT = `# Make Effects

> Make Effects is the project layer for CLI-first media generation. Use a fast CLI loop to generate images, video, and audio, then keep variants, prompts, collaborators, and lineage organized.

## Product Promise

Direct generator CLIs are great for making media quickly. Make Effects is for the moment a project gets big enough that you need to remember what worked, compare variants, refine prompts, follow lineage, explore broader ideas, and keep chosen results moving. Humans and agents can create spaces, generate or upload media, inspect assets, refine variants, derive new media from references, and monitor jobs.

## Documentation

- [Home](https://makefx.app/index.md) - Product overview and agent quick start
${DOC_REGISTRY.map((entry) => `- [${entry.title}](https://makefx.app${markdownVariantPath(entry.path)}) - ${entry.description}`).join('\n')}

## Agent Quick Start

\`\`\`sh
npm install -g makefx
makefx login
makefx spaces create "My Game Assets" --init
makefx generate "A market background" --name "Market" --type scene -o art/market.png
makefx audio sfx generate "Magic pickup" --name "Pickup" -o audio/pickup.wav
makefx video generate "Looping idle animation" --name "Idle" --type animation -o video/idle.mp4
makefx assets --json
\`\`\`

## Discovery

- Rendered docs: https://makefx.app/docs
- Full LLM context: https://makefx.app/llms-full.txt
- CLI JSON outputs: prefer \`--json\` where available and \`makefx listen --json\` for live orchestration.
`;

export const LLMS_FULL_TXT =
  `# Make Effects - Full Documentation\n\n` +
  [...FULL_DOC_REGISTRY]
    .sort((a, b) => a.order - b.order)
    .map((entry) => {
      const content = CONTENT_MAP[entry.path];
      return `---\n\nURL: https://makefx.app${entry.path}\nMarkdown: https://makefx.app${markdownVariantPath(entry.path)}\n\n${content}`;
    })
    .join('\n\n');
