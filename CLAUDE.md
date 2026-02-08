# CLAUDE.md

Guidance for Claude Code when working with this repository.

## Project Overview

**Inventory Forge** is a collaborative graphical asset management system for game development, built on Cloudflare Workers. Users create, refine, and combine AI-generated images using Gemini, with real-time collaboration via WebSocket.

**Key Features:**
- Multi-user spaces with real-time sync (WebSocket + Durable Objects)
- AI image generation and refinement (Gemini)
- AI assistant for creative guidance (Claude)
- Usage-based billing (Polar.sh)
- CLI tool for testing

**Documentation:** See [`docs/`](./docs/) for architecture, domain concepts, and guides.

## Essential Commands

### Development
```bash
npm run dev                  # Start frontend (Vite:3002) + worker (Wrangler:8788)
npm run dev:frontend         # Vite dev server only
npm run dev:worker           # Wrangler worker only
```

Access local dev at: https://localhost:3002/

### Testing & Quality
```bash
npm test                     # Run all tests with Node.js test runner
npm run typecheck            # TypeScript type checking
npm run lint                 # ESLint on src/ and scripts/
```

### Database
```bash
npm run db:migrate                # Apply D1 migrations locally
npm run db:migrate:stage          # Apply to stage
npm run db:migrate:production     # Apply to production
```

### Deployment
```bash
npm run deploy:stage              # Deploy main worker to stage
npm run deploy:production         # Deploy main worker to production

# Processing worker (workflows)
wrangler deploy --config wrangler.processing.toml                    # Stage
wrangler deploy --config wrangler.processing.toml --env production   # Production
```

## Architecture

### Two-Tier Database

| Store | Data | Scope |
|-------|------|-------|
| **D1** | users, spaces, members, usage_events | Global |
| **DO SQLite** | assets, variants, lineage, chat_messages | Per-space |

One Durable Object (SpaceDO) per space with embedded SQLite. Real-time sync via WebSocket.

### Three-Worker Architecture

| Worker | Purpose | Config |
|--------|---------|--------|
| **Main** | HTTP API, frontend, WebSocket | `wrangler.toml` |
| **Processing** | Workflows (generation) | `wrangler.processing.toml` |
| **Polar** | Billing cron sync (every 5 min) | `wrangler.polar.toml` |

### Directory Structure

```
src/
├── backend/
│   ├── durable-objects/space/  # SpaceDO + controllers
│   ├── workflows/              # GenerationWorkflow
│   ├── routes/                 # REST API endpoints
│   └── services/               # Claude, Gemini, Usage services
├── frontend/
│   ├── components/             # React components
│   ├── pages/                  # SpacePage, AssetDetailPage
│   ├── hooks/                  # useSpaceWebSocket, etc.
│   └── stores/                 # Zustand stores
├── dao/                        # D1 data access (Kysely)
├── cli/                        # CLI tool
└── worker/                     # Entry points
```

### Key Technologies

- **Frontend:** React 19, Vite, Zustand, React Flow
- **Backend:** Hono, Cloudflare Workers, Durable Objects, D1, R2
- **AI:** Gemini (images), Claude (assistant)
- **Auth:** Google OAuth + JWT
- **DI:** InversifyJS

## Common Patterns

**Adding a new API endpoint:**
1. Create route handler in `src/backend/routes/`
2. Register in `registerRoutes()` (`src/backend/routes/index.ts`)

**Adding a SpaceDO controller method:**
1. Add handler in appropriate controller (`src/backend/durable-objects/space/controllers/`)
2. Route WebSocket message in `SpaceDO.handleMessage()`
3. Or route HTTP in `InternalApi`

**Adding database migrations:**
1. D1: Create SQL file in `db/migrations/` with incremental prefix
2. DO SQLite: Update `SchemaManager.ts` and add migration method

**Running workflows:**
1. Trigger via SpaceDO controller (e.g., `GenerationController`)
2. Workflow calls back to SpaceDO with results via HTTP

## Environment Variables

**Required:**
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — OAuth
- `GOOGLE_AI_API_KEY` — Gemini
- `ANTHROPIC_API_KEY` — Claude

**Optional:**
- `POLAR_ACCESS_TOKEN` — Billing
- `AI_GATEWAY_URL` — Cloudflare AI Gateway

Set secrets: `wrangler secret put SECRET_NAME`

## References

- **PRD:** [`PRD.md`](./PRD.md) — Product requirements
- **Docs:** [`docs/`](./docs/) — Architecture, domain, design, billing, CLI
