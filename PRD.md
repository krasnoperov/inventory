# Product Requirements Document: Inventory Forge

## Overview

A collaborative web application for creating, refining, and combining AI-generated image assets using Gemini. Users maintain an inventory of visual assets, iteratively refine them, and forge new assets by combining existing ones.

**Technical architecture:** See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)

---

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Space** | Collaborative container for assets. One Durable Object per space. |
| **Asset** | A visual entity (character, item, scene) with mutable metadata (name, tags, active variant). |
| **Variant** | An immutable generated image. Assets have multiple variants; one is "active". |
| **Recipe** | Generation instructions stored with each variant: prompt, model, source images. |
| **Lineage** | The ancestry of an asset, computed from recipes (what was used to create it). |

---

## User Stories

### Asset Management
- Create new asset by providing a generation prompt
- View assets in an inventory grid
- See all variants and select which is active
- Delete assets and variants
- Tag and organize assets

### Refinement
- Refine any variant (not just active) with modification instructions
- Compare variants side-by-side
- See prompt history (recipe) for each variant

### Forging (Composition)
- Select multiple assets to combine into a new asset
- Specify combination instructions with structured labels
- View lineage (what assets were used to create this)

### Collaboration
- Share space with other users (owner/editor/viewer roles)
- See real-time changes from collaborators
- See who's viewing what (presence)

### Bot Assistant
- **Advisor mode:** Ask bot to review board state and suggest improvements
  - "Review my character designs for visual consistency"
  - "Suggest prompts to improve this scene"
  - Bot analyzes assets and provides actionable suggestions
- **Actor mode:** Delegate tasks to bot, confirm before execution
  - "Make the knight's armor more battle-worn"
  - "Create variations of this character with different outfits"
  - Bot plans action, user confirms, bot executes via generation jobs
- Chat interface for bot conversations within space
- Bot can reference specific assets and variants in responses

---

## AI Integration

### Image Generation (Gemini)

Uses `@krasnoperov/gemini-images` CLI/library:

| Operation | Primitive | Use Case |
|-----------|-----------|----------|
| Generate | `generate "<prompt>"` | New asset from text |
| Edit | `edit <image> "<prompt>"` | New variant from existing |
| Compose | `compose <img1> <img2> ... "<prompt>"` | New asset from multiple sources |

**Models:**
- `gemini-3-pro-image-preview`: Higher quality, 4K, up to 14 reference images
- `gemini-2.5-flash-image`: Faster, 1K max, 1 reference

**Constraint:** Sources must be from same space (no cross-space references).

### Bot Assistant (Claude)

Uses Claude API for reasoning and planning:

| Mode | Capability | Output |
|------|------------|--------|
| Advisor | Analyze board state, suggest improvements | Chat message with suggestions |
| Actor | Plan and execute generation tasks | Action plan → user confirms → job created |

**LLM:** Claude (claude-sonnet-4-20250514) for reasoning. Gemini for image understanding when needed.

**Rate limit:** 10 bot invocations per user per hour (MVP).

---

## Pages

| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/dashboard` | List spaces, create new |
| Space | `/spaces/:id` | Asset grid, real-time collaboration |
| Asset Detail | `/spaces/:id/assets/:assetId` | Variants, refinement, lineage |
| Forge | `/spaces/:id/forge` | Multi-asset composition |

---

## Implementation Phases

### Phase 1: Foundation
- [x] D1 migrations (users, spaces, members)
- [x] DO SQLite schema (assets, variants, lineage, image_refs)
- [x] R2 integration for images
- [x] Basic REST API (spaces, members)
- [x] Simple space/asset list UI

### Phase 2: Generation
- [x] Cloudflare Workflows for generation (ChatWorkflow, GenerationWorkflow)
- [x] Gemini integration service
- [x] Generate → asset flow
- [x] Edit → variant flow
- [x] Real-time job status via WebSocket

### Phase 3: Real-time
- [x] Durable Object with WebSocket
- [x] Full-state sync on connect
- [x] Broadcast mutations
- [x] WebSocket auth (JWT + membership check)

### Phase 4: Forge & Lineage
- [x] Compose flow (multi-asset → new asset)
- [x] Lineage API (computed from recipes)
- [x] Lineage visualization UI

### Phase 5: Bot Assistant
- [x] Chat messages table in DO SQLite
- [x] Bot invocation API endpoint
- [x] Advisor mode (read-only analysis)
- [x] Actor mode (plan → confirm → execute)
- [x] Chat UI in space view
- [x] Rate limiting per user

### Phase 6: Polish
- [x] Presence indicators
- [ ] Tags and filtering UI

---

## Constraints & Limits

| Constraint | Value | Notes |
|------------|-------|-------|
| Sources | Same-space only | Avoids cross-space ref counting |
| Lineage depth | 5 | Prevent deep recursion |
| Lineage nodes | 50 | Prevent large response |
| API pagination | limit=50, cursor | Future-proofed |
| Bot invocations | 10/user/hour | Prevent abuse |
| Chat history | 100 messages | Per space, oldest pruned |

---

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Thumbnail load | < 200ms |
| Real-time update | < 100ms |
| Generation feedback | < 2s to start |
| Assets per space | Up to 1000 |
| Concurrent users | Up to 50 per space |

---

## Open Questions (Deferred)

1. Offline support?
2. Public galleries?
3. Prompt templates?
4. Billing for shared spaces?
5. Cross-space import (copy, not reference)?

---

## Success Metrics

- Assets created per user per week
- Variants per asset (refinement engagement)
- Forge operations (composition engagement)
- % assets in shared spaces (collaboration)
- Weekly active users
