# Inventory

A graphical assets forging inventory with nano-banana pro, built on Cloudflare Workers.

## Features

- **Authentication**: Google OAuth with JWT tokens, OIDC-compliant
- **Dual-Worker Architecture**: Separate workers for HTTP/frontend and background processing
- **React 19 Frontend**: Vite, Zustand, CSS Modules, custom SPA router
- **D1 Database**: SQLite with migrations and Kysely query builder
- **Dependency Injection**: InversifyJS for clean architecture
- **CLI Tool**: Foundation for command-line access to your platform
- **TypeScript**: End-to-end type safety

## Quick Start

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

Access at https://localhost:3002/

## Commands

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Start local development (frontend + worker) |
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

See [CLAUDE.md](./CLAUDE.md) for detailed architecture and development guide.

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Frontend**: React 19, Vite, Zustand
- **Backend**: Hono, InversifyJS, Kysely
- **Auth**: Google OAuth, JWT (jose)
- **Testing**: Node.js test runner

## License

MIT
