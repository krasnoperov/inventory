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

---

## Key Concepts

### Two-Tier Database Architecture

- **D1 (Global)**: Users, spaces, membership. Used for auth and space discovery.
- **DO SQLite (Per-Space)**: All space content (assets, variants, lineage, chat). One Durable Object per space with embedded SQLite.

### Relationships

- **Asset Hierarchy**: `parent_asset_id` enables tree structures. User can drag-to-reparent.
- **Variant Lineage**: `lineage` table tracks generation history. Immutable for audit.
  - `derived`: Single source refined
  - `composed`: Multiple sources combined
  - `spawned`: Variant forked to new asset

### Real-Time Sync

- WebSocket connection per client to SpaceDO
- Full state sync on connect (`sync:request` → `sync:state`)
- All mutations broadcast to connected clients
- JWT auth with membership check on WebSocket upgrade

---

## Key Flows

### Generation Flow

1. Client sends `generate:request` via WebSocket
2. SpaceDO creates asset, triggers `GenerationWorkflow`
3. Workflow calls Gemini API, uploads to R2
4. Workflow calls back to SpaceDO with result
5. SpaceDO creates variant, broadcasts to all clients

### Bot Chat Flow

1. Client sends `chat:request` via WebSocket
2. SpaceDO triggers `ChatWorkflow`
3. Workflow calls Claude API with space context
4. Workflow stores message, broadcasts response
5. Actor mode: returns tool calls for user approval

---

## Directory Structure

```
src/
├── backend/
│   ├── durable-objects/space/   # SpaceDO + controllers
│   ├── workflows/               # ChatWorkflow, GenerationWorkflow
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
