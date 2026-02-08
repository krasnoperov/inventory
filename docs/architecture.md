# Inventory Forge: Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                          Client                                 │
│                     (React + WebSocket)                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────────────┐
│                     Cloudflare Edge                             │
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │   Worker    │    │  Workflows  │    │  Durable Object     │  │
│  │  (HTTP +    │───▶│ (Chat +     │───▶│  (per Space)        │  │
│  │   REST)     │    │ Generation) │    │                     │  │
│  └─────────────┘    └─────────────┘    │  ┌───────────────┐  │  │
│         │                              │  │    SQLite     │  │  │
│         │                              │  │ (authoritative│  │  │
│         ▼                              │  │    state)     │  │  │
│  ┌─────────────┐                       │  └───────────────┘  │  │
│  │     D1      │                       │  ┌───────────────┐  │  │
│  │  (users,    │                       │  │  WebSocket    │  │  │
│  │   spaces,   │                       │  │    Hub        │  │  │
│  │   members)  │                       │  └───────────────┘  │  │
│  └─────────────┘                       └─────────────────────┘  │
│         │                                        │              │
│         │                                        │              │
│         ▼                                        ▼              │
│  ┌─────────────┐                       ┌─────────────────────┐  │
│  │     R2      │◀──────────────────────│   Gemini / Claude   │  │
│  │  (images)   │                       │       APIs          │  │
│  └─────────────┘                       └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Storage

| Data | Store | Notes |
|------|-------|-------|
| Assets, Variants, Lineage | DO SQLite | Per-space. Authoritative. Real-time via WebSocket. |
| Users, Spaces, Members | D1 | Global. Auth and access control. |
| Chat Messages | DO SQLite | Per-space conversation history. |
| Images | R2 | Format: `images/{spaceId}/{variantId}.{ext}` |
| Usage Events | D1 | Billing tracking for Polar.sh. |

### Variant Schema

Variants track generation status via placeholder lifecycle:

```sql
CREATE TABLE variants (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  workflow_id TEXT UNIQUE,              -- Cloudflare workflow ID
  status TEXT NOT NULL DEFAULT 'pending' -- pending, processing, completed, failed
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,                   -- Error details when failed
  image_key TEXT,                       -- NULL until completed
  thumb_key TEXT,                       -- NULL until completed
  recipe TEXT NOT NULL,                 -- Full params for retry
  starred INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

---

## Workers

| Worker | Config | Purpose |
|--------|--------|---------|
| **Main** | `wrangler.toml` | HTTP API, frontend, WebSocket connections |
| **Processing** | `wrangler.processing.toml` | Cloudflare Workflows (GenerationWorkflow) |
| **Polar** | `wrangler.polar.toml` | Billing cron sync (every 5 minutes) |

---

## Key Concepts

### Two-Tier Database Architecture

- **D1 (Global)**: Users, spaces, membership. Used for auth and space discovery.
- **DO SQLite (Per-Space)**: All space content (assets, variants, lineage, chat). One Durable Object per space with embedded SQLite.

### Relationships

- **Asset Hierarchy**: `parent_asset_id` enables tree structures. User can drag-to-reparent.
- **Variant Lineage**: `lineage` table tracks generation history. Immutable for audit.
  - `derived`: Created from references as inspiration (derive operation)
  - `refined`: Refinement of existing asset (refine operation)
  - `forked`: Variant forked to new asset (fork operation)

### Real-Time Sync

- WebSocket connection per client to SpaceDO
- Full state sync on connect (`sync:request` → `sync:state`)
- All mutations broadcast to connected clients
- JWT auth with membership check on WebSocket upgrade

---

## Key Flows

### Generation Flow (Placeholder Variants)

Generation uses "placeholder variants" - variants created before generation completes, with status tracking:

1. Client sends `generate:request` via WebSocket
2. SpaceDO creates asset and **placeholder variant** (`status='pending'`)
3. SpaceDO creates lineage records immediately
4. SpaceDO broadcasts `asset:created`, `variant:created`, `lineage:created`
5. SpaceDO triggers `GenerationWorkflow`, updates variant to `status='processing'`
6. Workflow calls Gemini API, uploads to R2
7. Workflow calls `POST /internal/complete-variant` with image keys
8. SpaceDO updates variant (`status='completed'`), broadcasts `variant:updated`

#### Variant Status Lifecycle

```
pending → processing → completed
              ↓
           failed → (retry) → pending
```

- **pending**: Placeholder created, waiting for workflow
- **processing**: Workflow running
- **completed**: Generation successful, images available
- **failed**: Generation failed, error stored, can be retried

#### Failed Variant Retry

1. Client sends `variant:retry` via WebSocket
2. SpaceDO validates variant is `failed`, parses stored recipe
3. SpaceDO resets variant to `pending`, triggers new workflow
4. Same flow continues from step 5

### Bot Chat Flow

1. Client sends `chat:send` via WebSocket
2. SpaceDO routes to `ChatController`
3. ChatController calls Claude API synchronously with space context
4. ChatController stores message in DO SQLite, broadcasts response
5. Actor mode: returns tool calls for user approval via approval system

---

## Directory Structure

```
src/
├── backend/
│   ├── durable-objects/space/   # SpaceDO + controllers
│   ├── workflows/               # GenerationWorkflow
│   ├── routes/                  # REST API endpoints
│   └── services/                # Claude, Gemini, Usage services
├── frontend/
│   ├── components/              # React components
│   ├── pages/                   # SpacePage, AssetDetailPage
│   ├── hooks/                   # useSpaceWebSocket, etc.
│   └── stores/                  # Zustand stores
├── dao/                         # D1 data access
└── db/migrations/               # D1 schema migrations
```

---

## References

- **PRD**: `PRD.md` - Product requirements and feature checklist
- **DO Schema**: `src/backend/durable-objects/space/schema/SchemaManager.ts`
- **D1 Schema**: `db/migrations/`
- **WebSocket Types**: `src/backend/durable-objects/space/types.ts`
