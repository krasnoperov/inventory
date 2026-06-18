# Make Effects

Make Effects is an AI media production workspace at
[makefx.app](https://makefx.app) where people and agents can generate, refine,
track, and hand off production assets across images, audio, and video.

The hosted app is the source of truth for spaces, assets, variants, prompts,
recipes, lineage, collaboration state, and stored media. The `makefx` CLI lets
local agents, scripts, and developers drive that same production graph from the
command line: start generation jobs, watch progress, download outputs, inspect
results, curate variants, and export production handoff data.

## What You Can Build With It

- Generate images, audio, and video through website-backed jobs.
- Track every result as an asset variant with prompt, provider metadata, and
  lineage.
- Refine an existing variant or derive new assets from references.
- Upload local media into a collaborative space so generated and hand-made
  assets live together.
- Let automation agents use the CLI as a stable control surface instead of
  touching database or storage internals.
- Export production records for downstream render, game, or editorial tools.

## Features

- **Authentication**: Google OAuth with JWT tokens, OIDC-compliant
- **Dual-Worker Architecture**: Separate workers for HTTP/frontend and media generation
- **React 19 Frontend**: Vite, TanStack Router, Zustand, CSS Modules
- **D1 Database**: SQLite with migrations and Kysely query builder
- **R2 Media Storage**: Durable media artifacts for generated and uploaded files
- **Dependency Injection**: InversifyJS for clean architecture
- **Make Effects CLI**: Command-line access through the `makefx` package and command
- **TypeScript**: End-to-end type safety

## CLI Quick Start

Install the CLI from npm:

```bash
npm install -g makefx
```

Authenticate with the hosted app:

```bash
makefx login
```

Create a space or bind an existing website space to the current directory:

```bash
makefx spaces create "My Game Assets" --init
makefx init --space YOUR_SPACE_ID
```

Generate media and download completed outputs:

```bash
makefx generate "A cozy pixel-art market background" \
  --name "Market Background" \
  --type scene \
  -o art/market.png

makefx audio sfx generate "A crisp magical item pickup" \
  --name "Item Pickup" \
  -o audio/item-pickup.wav

makefx video generate "A looping idle animation for a tiny robot" \
  --name "Robot Idle" \
  --type animation \
  -o video/robot-idle.mp4
```

Inspect and reuse tracked results:

```bash
makefx assets
makefx assets show ASSET_ID --json
makefx assets download VARIANT_ID -o references/variant.png
makefx listen --space YOUR_SPACE_ID
```

Use run manifests for debugging agent workflows:

```bash
makefx runs --debug
makefx runs show --latest --debug --json
```

The CLI defaults to production at `https://makefx.app`. Use `--env stage` for
staging or `--local` for a local development server.

## CLI Commands

| Command | Description |
|---------|-------------|
| `makefx login` | Authenticate with makefx.app |
| `makefx spaces` | List, view, or create collaborative spaces |
| `makefx init` | Bind the current directory to a website space |
| `makefx generate` | Generate a new image asset |
| `makefx refine` | Refine an existing image variant |
| `makefx derive` | Create a new image asset from variant IDs or local refs |
| `makefx batch` | Generate multiple images and write a debug run manifest |
| `makefx audio` | Generate speech, dialogue, music, or sound effects |
| `makefx video` | Generate, refine, or derive video assets |
| `makefx upload` | Upload local image, audio, or video files |
| `makefx assets` | List, show, download, rename, delete, and set active assets |
| `makefx variants` | Retry, star, rate, or delete variants |
| `makefx listen` | Stream real-time space events |
| `makefx productions` | Place, list, and export production records |
| `makefx runs` | Inspect debug-only local generation manifests |

See [docs/cli.md](./docs/cli.md) and
[docs/cli-generation.md](./docs/cli-generation.md) for the full command guide.

## Local Development

```bash
# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Edit .env with your Google OAuth credentials

# Initialize local database
pnpm run db:migrate

# Start development
pnpm run dev
```

Access at http://localhost:3001/

## Developer Commands

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Start local development (frontend + worker) |
| `pnpm run build:cli` | Build `dist/cli/makefx.mjs` |
| `pnpm run cli:dev -- --help` | Run the CLI from TypeScript sources |
| `pnpm run db:migrate` | Apply database migrations locally |
| `pnpm test` | Run tests |
| `pnpm run typecheck` | TypeScript type checking |
| `pnpm run lint` | ESLint |
| `pnpm run deploy:stage` | Deploy to stage environment |
| `pnpm run deploy:production` | Deploy to production |

## Project Structure

```
src/
├── backend/       # API routes, services, middleware
├── frontend/      # React application
├── dao/           # Data access layer
├── db/migrations/ # SQL migrations
├── cli/           # CLI tool
└── worker/        # Cloudflare Worker entry points
```

## Documentation

- [docs/cli.md](./docs/cli.md) - complete CLI reference
- [docs/cli-generation.md](./docs/cli-generation.md) - agent-oriented media generation flows
- [docs/architecture.md](./docs/architecture.md) - system architecture
- [PRD.md](./PRD.md) - product requirements and core concepts

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Frontend**: React 19, Vite, Zustand
- **Backend**: Hono, InversifyJS, Kysely
- **Auth**: Google OAuth, JWT (jose)
- **Testing**: Node.js test runner

## License

MIT
