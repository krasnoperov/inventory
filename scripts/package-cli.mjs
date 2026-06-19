#!/usr/bin/env node
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = resolve(root, 'package.json');
const cliSource = resolve(root, 'dist/cli/makefx.mjs');
const packageDir = resolve(root, 'dist/npm');
const cliTarget = resolve(packageDir, 'makefx.mjs');

const rootPackage = JSON.parse(await readFile(packageJsonPath, 'utf8'));

await readFile(cliSource);
await rm(packageDir, { recursive: true, force: true });
await mkdir(packageDir, { recursive: true });
await copyFile(cliSource, cliTarget);
await chmod(cliTarget, 0o755);

const cliPackage = {
  name: rootPackage.name,
  version: rootPackage.version,
  description: 'Command-line interface for AI-assisted game asset production with Make Effects.',
  license: rootPackage.license,
  type: 'module',
  repository: {
    type: 'git',
    url: 'git+https://github.com/krasnoperov/inventory.git',
  },
  bin: {
    makefx: 'makefx.mjs',
  },
  files: [
    'makefx.mjs',
    'README.md',
  ],
  engines: {
    node: '>=20',
  },
  dependencies: {},
  publishConfig: {
    access: 'public',
  },
};

await writeFile(resolve(packageDir, 'package.json'), `${JSON.stringify(cliPackage, null, 2)}\n`);
await writeFile(resolve(packageDir, 'README.md'), getCliReadme(rootPackage.version), 'utf8');

function getCliReadme(version) {
  return `# makefx

Command-line interface for [Make Effects](https://makefx.app), an AI media
production workspace for game assets, production references, and handoff files.

\`makefx\` lets local developers, scripts, and coding agents create and manage
website-backed assets from the terminal: generate images, audio, and video;
upload local media; inspect variants; download outputs; watch real-time space
events; and export production records.

## Install

\`\`\`bash
npm install -g makefx
makefx --version
\`\`\`

Requirements:

- Node.js 20 or newer
- A Make Effects account at https://makefx.app

The npm package installs a bundled executable and does not declare runtime
dependencies.

## Quick Start

\`\`\`bash
makefx login
makefx spaces create "My Game Assets" --init

makefx generate "A cozy pixel-art market background" \\
  --name "Market Background" \\
  --type scene \\
  -o art/market.png

makefx audio sfx generate "A crisp magical item pickup" \\
  --name "Item Pickup" \\
  -o audio/item-pickup.wav

makefx video generate "A looping idle animation for a tiny robot" \\
  --name "Robot Idle" \\
  --type animation \\
  --no-audio \\
  -o video/robot-idle.mp4
\`\`\`

## Authentication

\`\`\`bash
makefx login
makefx logout
\`\`\`

\`login\` opens a browser-based sign-in flow and stores CLI credentials in the
user config directory. Credentials are separate from project bindings and are
not written into your repository.

## Project Binding

Bind the current directory to a Make Effects space:

\`\`\`bash
makefx init --space YOUR_SPACE_ID
\`\`\`

This writes \`.inventory/config.json\` with the target environment and space ID.
It does not store assets, prompts, media files, provider keys, or auth tokens.
Inside an initialized project, commands can omit \`--space\` and \`--env\`.

The CLI defaults to production at \`https://makefx.app\`. Use \`--env stage\` for
staging, or \`--local\` for a local development server.

## Common Workflows

Inspect and download tracked assets:

\`\`\`bash
makefx assets
makefx assets show ASSET_ID --json
makefx assets download VARIANT_ID -o references/variant.png
\`\`\`

Upload local media:

\`\`\`bash
makefx upload hero.png --name "Hero Character" --type character
makefx upload theme.mp3 --name "Theme Music" --type audio
makefx upload cutscene.mp4 --name "Cutscene" --type video
\`\`\`

Refine or derive from references:

\`\`\`bash
makefx refine --variant VARIANT_ID "make it evening, with warmer lights" \\
  -o art/market-evening.png

makefx derive \\
  --refs CHARACTER_VARIANT_ID,BACKGROUND_VARIANT_ID \\
  --name "Hero In Market" \\
  --type scene \\
  "Place the hero naturally in the market" \\
  -o art/hero-market.png
\`\`\`

Create production helpers:

\`\`\`bash
makefx rotation --variant VARIANT_ID --config 8-directional
makefx tileset "grass and stone path tiles" --type terrain --grid 3x3
makefx productions export --production-id trailer-01 -o handoff/scenes.args
\`\`\`

Watch real-time space activity:

\`\`\`bash
makefx listen --space YOUR_SPACE_ID
makefx listen --space YOUR_SPACE_ID --json
\`\`\`

## Agent And Script Usage

Many commands support \`--json\` for stable machine-readable output. Use JSON
outputs for automation instead of parsing human-readable tables.

\`\`\`bash
makefx spaces create "Agent Test Space" --init --json
makefx assets --json
makefx runs show --latest --debug --json
\`\`\`

Debug run manifests are local troubleshooting traces for generation commands:

\`\`\`bash
makefx runs --debug
makefx runs show --latest --debug
\`\`\`

The website remains the source of truth for spaces, assets, variants, recipes,
lineage, and stored media.

## Command Groups

| Command | Purpose |
|---------|---------|
| \`login\`, \`logout\` | Manage CLI authentication |
| \`spaces\`, \`init\` | Create spaces and bind local projects |
| \`generate\`, \`refine\`, \`derive\`, \`batch\` | Generate image assets |
| \`audio\` | Generate speech, dialogue, music, and sound effects |
| \`video\` | Generate, refine, and derive video assets |
| \`upload\` | Upload local image, audio, or video files |
| \`assets\`, \`variants\` | Inspect, download, curate, retry, or delete outputs |
| \`rotation\`, \`tileset\` | Generate game-ready reference sets |
| \`productions\` | Place and export production handoff records |
| \`listen\` | Stream real-time space events |
| \`runs\` | Inspect local debug manifests |
| \`billing\` | Inspect billing sync and operational status |

Run \`makefx --help\` or \`makefx help <command>\` for command-specific options.

## Troubleshooting

- If a command says you are not authenticated, run \`makefx login\`.
- If a command cannot find a space, run \`makefx init --space YOUR_SPACE_ID\` or
  pass \`--space YOUR_SPACE_ID\`.
- If a generation command times out after creating a variant, resume with
  \`--follow VARIANT_ID\` and the same output path.
- If automation needs stable output, add \`--json\` where supported.

## Links

- App: https://makefx.app
- CLI docs: https://makefx.app/docs/cli
- Media generation guide: https://makefx.app/docs/media-playbooks
- Source: https://github.com/krasnoperov/inventory

Version: ${version}
`;
}
