# AGENTS.md — Inventory Forge

Canonical entrypoint for coding agents in this repository.

## What This Repo Is

Inventory Forge is a collaborative graphical asset management app for game development.

This repo contains:

- a React frontend
- backend API routes and workers
- real-time multi-user sync
- AI image generation and refinement flows
- billing and account surfaces

## Source Of Truth

- Linear owns issue scope, acceptance criteria, priorities, and status.
- PatchRelay owns delegated issue worktrees and execution continuity when the repo is delegated there.
- This repo owns stable implementation policy, architecture, commands, and checks.
- Do not commit issue-specific plans or backlog notes into the repo.

## Read In This Order

1. `README.md`
2. `PRD.md`
3. `docs/`
4. `IMPLEMENTATION_WORKFLOW.md`
5. `REVIEW_WORKFLOW.md`

## Core Commands

```bash
pnpm run dev
pnpm run build
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run db:migrate
```

Deploy helpers:

- `pnpm run deploy:stage`
- `pnpm run deploy:production`

## Commit And PR Convention

Use Conventional Commits style for commits and PR titles:

```text
type(scope): summary
```

Examples:

- `docs(agents): document commit convention`
- `fix(sync): preserve asset updates across reconnect`
- `feat(forge): add batch composition controls`

Keep this lightweight:

- Use a lowercase type such as `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, or `ci`.
- Use a short lowercase scope that names the touched area.
- Keep the summary imperative, concise, and under sentence case.
- Do not add commitlint, husky hooks, or CI validation for this convention.

## Hard Rules

- Start non-trivial work from a Linear issue.
- Keep multi-user sync and asset state transitions coherent.
- Treat auth, billing, DB migrations, Wrangler config, and dependency changes as approval-needed unless the issue clearly calls for them.
- Add or update tests when behavior changes.
- Keep repo docs durable and issue scope in Linear.
