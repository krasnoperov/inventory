# WebSocket Message Contract

This document describes the WebSocket message contract between the frontend client and SpaceDO backend.

## Connection

WebSocket connections are established to SpaceDO (one per space):

```
wss://<host>/api/spaces/<spaceId>/ws
```

Authentication is via JWT in cookie (`auth_token`) or Authorization header (`Bearer <token>`).

---

## Message Flow

```
┌─────────────┐                     ┌─────────────┐
│   Client    │                     │   SpaceDO   │
└──────┬──────┘                     └──────┬──────┘
       │                                   │
       │──── sync:request ────────────────▶│
       │◀─── sync:state ──────────────────│
       │                                   │
       │──── chat:send ─────────────────────▶│ (persistent chat)
       │◀─── chat:message ──────────────────│
       │                                   │
       │──── generate:request ────────────▶│ (triggers GenerationWorkflow)
       │◀─── generate:started ────────────│
       │◀─── variant:updated (processing) │
       │◀─── variant:updated (completed) ─│
       │                                   │
       │──── plan:approve ────────────────▶│
       │◀─── plan:updated ────────────────│
       │◀─── plan:step_updated ───────────│
       │                                   │
```

---

## Client → Server Messages

### Sync

| Message | Description |
|---------|-------------|
| `sync:request` | Request full state sync |
| `sync:overview` | Request lightweight overview state: assets plus one display variant per asset |

### Assets

| Message | Fields | Description |
|---------|--------|-------------|
| `asset:create` | `name`, `assetType`, `mediaKind?`, `parentAssetId?` | Create new asset |
| `asset:update` | `assetId`, `changes: { name?, tags?, type?, parentAssetId? }` | Update asset |
| `asset:delete` | `assetId` | Delete asset |
| `asset:setActive` | `assetId`, `variantId` | Set active variant |
| `asset:fork` | `sourceVariantId`, `name`, `assetType`, `mediaKind?`, `parentAssetId?` | Fork asset from variant |

### Variants

| Message | Fields | Description |
|---------|--------|-------------|
| `variant:delete` | `variantId` | Delete variant |
| `variant:star` | `variantId`, `starred: boolean` | Star/unstar variant |
| `variant:rate` | `variantId`, `rating: 'approved'\|'rejected'` | Rate variant quality (training data) |
| `variant:retry` | `variantId` | Retry failed generation |

### Lineage

| Message | Fields | Description |
|---------|--------|-------------|
| `lineage:sever` | `lineageId` | Sever lineage relationship |

### Chat & AI

| Message | Fields | Description |
|---------|--------|-------------|
| `chat:send` | `message`, `mode: 'advisor'\|'actor'`, `forgeContext?`, `viewingContext?` | Send chat message (persistent chat) |
| `chat:history` | `since?` | Request chat history |
| `chat:new_session` | - | Start new chat session |
| `generate:request` | `requestId`, `name`, `assetType`, `mediaKind?`, `prompt?`, `model?`, `imageSize?`, `aspectRatio?`, `referenceAssetIds?`, `referenceVariantIds?`, `parentAssetId?`, `disableStyle?` | Generate new asset (triggers GenerationWorkflow) |
| `refine:request` | `requestId`, `assetId`, `mediaKind?`, `prompt`, `sourceVariantId?`, `sourceVariantIds?`, `model?`, `imageSize?`, `aspectRatio?`, `referenceAssetIds?`, `disableStyle?` | Refine existing asset |
| `batch:request` | `requestId`, `name`, `assetType`, `mediaKind?`, `prompt`, `count`, `mode: 'explore'\|'set'`, `model?`, `imageSize?`, `aspectRatio?`, `referenceAssetIds?`, `referenceVariantIds?`, `parentAssetId?`, `disableStyle?` | Batch generate (see [style-and-batch.md](./style-and-batch.md)) |
| `describe:request` | `requestId`, `variantId`, `assetName`, `focus?`, `question?` | Describe image with Claude Vision |
| `compare:request` | `requestId`, `variantIds`, `aspects?` | Compare images with Claude Vision |
| `auto-describe:request` | `variantId` | Auto-describe variant (cached, for Forge Tray context) |

### Plans

| Message | Fields | Description |
|---------|--------|-------------|
| `plan:approve` | `planId` | Approve plan for execution |
| `plan:reject` | `planId` | Reject plan |
| `plan:cancel` | `planId` | Cancel executing plan |
| `plan:advance` | `planId` | Execute next step |
| `plan:set_auto_advance` | `planId`, `autoAdvance: boolean` | Enable/disable auto-advance |
| `plan:skip_step` | `stepId` | Skip a step |
| `plan:retry_step` | `stepId` | Retry failed step |

### Approvals

| Message | Fields | Description |
|---------|--------|-------------|
| `approval:approve` | `approvalId` | Approve pending tool call |
| `approval:reject` | `approvalId` | Reject pending tool call |
| `approval:list` | - | List pending approvals |

### Style

| Message | Fields | Description |
|---------|--------|-------------|
| `style:get` | — | Request current style |
| `style:set` | `description`, `imageKeys[]`, `name?`, `enabled?` | Create or update style |
| `style:delete` | — | Delete style |
| `style:toggle` | `enabled: boolean` | Enable/disable style |

### Session

| Message | Fields | Description |
|---------|--------|-------------|
| `session:get` | - | Get session state |
| `session:update` | `viewingAssetId?`, `viewingVariantId?`, `forgeContext?` | Update session context |

### Presence

| Message | Fields | Description |
|---------|--------|-------------|
| `presence:update` | `viewing?: string` | Update viewing state |

---

## Media Kind Contract

Assets and variants include `media_kind` in server payloads. Client requests use
the camelCase field `mediaKind` where a caller can choose the medium at creation
time. The allowed values are `image`, `audio`, and `video`; omitted values
default to `image`.

`mediaKind` is a medium discriminator, not an asset taxonomy or provider
selector. Keep using `assetType`/`type` for catalog categories such as
`character`, `tile-set`, or `animation`. Audio and video generation remain
website-controlled SpaceDO workflows: set `mediaKind` explicitly and choose the
capable provider/model through provider/model fields.
When `INVENTORY_AUDIO_PROVIDER=elevenlabs`, website-created `music` assets use
ElevenLabs music generation by default and may request Lyria with
`musicProvider: "lyria"`. `sfx` assets use ElevenLabs sound generation.
Website video generation records the capable Google Veo model and per-request
`generateAudio` boolean in the stored recipe. Omitted `generateAudio` values are
treated as `false` by the workflow, preserving the silent default.

The backend enforces homogeneous assets. Variants inherit their asset's
`media_kind`, and requests that try to create a variant or forked asset with a
different media kind are rejected. Generation, batch generation, upload, fork,
export, CLI inspection, recipes, workflow inputs, and WebSocket broadcasts must
preserve the stored value.

Top-level CLI generation commands are image-only controller commands. CLI audio
generation uses explicit `audio` subcommands that drive this same website
API/WebSocket flow. Future CLI video support should follow the same pattern
rather than creating local-only media records.

Variant payloads expose `media_key` as the canonical primary artifact key plus
basic metadata: `media_mime_type`, `media_size_bytes`, `media_width`,
`media_height`, and `media_duration_ms`. Generated variants also expose
`generation_provenance` and `provider_metadata` as JSON strings in Space state.
Image flows continue to populate legacy `image_key` and `thumb_key` fields for
existing consumers.

Authenticated callers can download or preview the canonical artifact through
`GET /api/spaces/:spaceId/variants/:variantId/media`, which resolves the
variant's stored `media_key` after membership checks, with `image_key` as the
legacy fallback for older image variants. A future `poster_key` field, when
present, is served through
`GET /api/spaces/:spaceId/variants/:variantId/poster`.

---

## Server → Client Messages

### Sync

| Message | Fields | Description |
|---------|--------|-------------|
| `sync:state` | `assets[]`, `variants[]`, `lineage[]`, `presence[]` | Full state snapshot |
| `sync:overview` | `assets[]`, `variants[]`, `presence[]` | Lightweight overview snapshot with active-or-newest variants only |

### Asset Mutations

| Message | Fields | Description |
|---------|--------|-------------|
| `asset:created` | `asset` | Asset created |
| `asset:updated` | `asset` | Asset updated |
| `asset:deleted` | `assetId` | Asset deleted |
| `asset:forked` | `asset`, `variant`, `lineage` | Asset forked |

### Variant Mutations

| Message | Fields | Description |
|---------|--------|-------------|
| `variant:created` | `variant` | Variant created (placeholder or completed) |
| `variant:updated` | `variant` | Variant updated (status change, images added) |
| `variant:deleted` | `variantId` | Variant deleted |

### Lineage Mutations

| Message | Fields | Description |
|---------|--------|-------------|
| `lineage:created` | `lineage` | Lineage created |
| `lineage:severed` | `lineageId` | Lineage severed |

### Job Status

| Message | Fields | Description |
|---------|--------|-------------|
| `job:progress` | `jobId`, `status` | Generation progress |
| `job:completed` | `jobId`, `variant` | Generation completed |
| `job:failed` | `jobId`, `error` | Generation failed |

### Chat

| Message | Fields | Description |
|---------|--------|-------------|
| `chat:message` | `message: ChatMessage` | New chat message |
| `chat:history` | `messages[]`, `sessionId` | Chat history response |
| `chat:session_created` | `session` | New session created |
| `chat:response` | `requestId`, `success`, `response?`, `error?` | Chat workflow result |
| `chat:error` | `requestId`, `error`, `code` | Chat pre-check error |

### Generation

| Message | Fields | Description |
|---------|--------|-------------|
| `generate:started` | `requestId`, `jobId`, `assetId`, `assetName` | Generation started |
| `generate:result` | `requestId`, `jobId`, `success`, `variant?`, `error?` | Generation result |
| `generate:error` | `requestId`, `error`, `code` | Generation pre-check error |
| `refine:started` | `requestId`, `jobId`, `assetId`, `assetName` | Refinement started |
| `refine:result` | `requestId`, `jobId`, `success`, `variant?`, `error?` | Refinement result |
| `refine:error` | `requestId`, `error`, `code` | Refinement pre-check error |
| `batch:started` | `requestId`, `batchId`, `results[]` | Batch generation started |
| `batch:error` | `requestId`, `error`, `code` | Batch pre-check error |

### Style

| Message | Fields | Description |
|---------|--------|-------------|
| `style:state` | `style` (or null) | Current style (unicast to requester) |
| `style:updated` | `style` | Style created/updated (broadcast) |
| `style:deleted` | — | Style deleted (broadcast) |

### Vision

| Message | Fields | Description |
|---------|--------|-------------|
| `describe:response` | `requestId`, `success`, `description?`, `error?`, `usage?` | Describe result |
| `compare:response` | `requestId`, `success`, `comparison?`, `error?`, `usage?` | Compare result |

### Plans

| Message | Fields | Description |
|---------|--------|-------------|
| `plan:created` | `plan`, `steps[]` | Plan created |
| `plan:updated` | `plan` | Plan status updated |
| `plan:step_updated` | `step` | Step status updated |
| `plan:step_created` | `step` | New step added (revision) |
| `plan:deleted` | `planId` | Plan deleted |

### Approvals

| Message | Fields | Description |
|---------|--------|-------------|
| `approval:created` | `approval` | Approval created |
| `approval:updated` | `approval` | Approval status changed |
| `approval:deleted` | `approvalId` | Approval deleted |
| `approval:list` | `approvals[]` | List of pending approvals |
| `auto_executed` | `autoExecuted` | Auto-executed tool result |

### Session

| Message | Fields | Description |
|---------|--------|-------------|
| `session:state` | `session` | Session state |

### Presence

| Message | Fields | Description |
|---------|--------|-------------|
| `presence:update` | `presence[]` | Updated presence list |

### Errors

| Message | Fields | Description |
|---------|--------|-------------|
| `error` | `code`, `message` | Error with error code |

---

## Error Codes

All error messages include an `ErrorCode` for programmatic handling:

| Code | Description |
|------|-------------|
| `RATE_LIMITED` | Too many requests |
| `PAID_GENERATION_REQUIRED` | Paid generation access is not enabled for this account |
| `QUOTA_EXCEEDED` | Usage quota exceeded |
| `NOT_FOUND` | Resource not found |
| `VALIDATION_ERROR` | Invalid input |
| `PERMISSION_DENIED` | Not authorized |
| `ALREADY_EXISTS` | Resource already exists |
| `CONFLICT` | State conflict |
| `GENERATION_FAILED` | Image generation failed |
| `VISION_FAILED` | Vision analysis failed |
| `WORKFLOW_FAILED` | Workflow execution failed |
| `STORAGE_ERROR` | R2 storage error |
| `API_ERROR` | External API error |
| `TIMEOUT` | Operation timed out |
| `SERVICE_UNAVAILABLE` | Service unavailable |
| `INVALID_STATE` | Invalid state transition |
| `DEPENDENCY_FAILED` | Dependent operation failed |
| `CANCELLED` | Operation cancelled |
| `AI_SAFETY_BLOCKED` | AI safety filter blocked |
| `BILLING_ERROR` | Billing operation failed |
| `AUTHENTICATION_ERROR` | Authentication failed |
| `SESSION_EXPIRED` | Session expired |
| `INTERNAL_ERROR` | Internal server error |

---

## Data Types

### Plan Status

```typescript
type PlanStatus = 'planning' | 'executing' | 'paused' | 'completed' | 'failed' | 'cancelled';
```

### Plan Step Status

```typescript
type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'blocked';
```

### Variant Status

```typescript
type VariantStatus = 'pending' | 'processing' | 'completed' | 'failed';
```

### Lineage Relation Type

```typescript
type RelationType = 'derived' | 'refined' | 'forked';
```

### Chat Mode

```typescript
type ChatMode = 'advisor' | 'actor';
```

- **advisor**: Conversational guidance only
- **actor**: Can trigger tool calls (generate, refine, derive, etc.)

---

## Forge Context

When sending `chat:send` or `generate:request`, include forge context:

```typescript
interface ForgeContext {
  type: 'forge';
  operation: 'generate' | 'refine' | 'derive' | 'fork';
  slots: Array<{
    assetId: string;
    assetName: string;
    variantId: string;
    thumbUrl?: string;
  }>;
  prompt?: string;
}
```

---

## Viewing Context

Include viewing context for asset-aware AI responses:

```typescript
interface ViewingContext {
  type: 'viewing';
  assetId?: string;
  assetName?: string;
  variantId?: string;
}
```

---

## Example: Generate Asset Flow

```typescript
// 1. Client sends generate request
ws.send({
  type: 'generate:request',
  requestId: 'req_123',
  name: 'Hero Character',
  assetType: 'character',
  prompt: 'A brave knight in shining armor',
  model: 'pro',
  imageSize: '1K',
  aspectRatio: '1:1',
});

// 2. Server creates placeholder, sends started
// { type: 'asset:created', asset: { id: 'asset_1', ... } }
// { type: 'variant:created', variant: { id: 'var_1', status: 'pending', ... } }
// { type: 'generate:started', requestId: 'req_123', jobId: 'var_1', assetId: 'asset_1', assetName: 'Hero Character' }

// 3. Workflow updates status
// { type: 'variant:updated', variant: { id: 'var_1', status: 'processing', ... } }

// 4. Generation completes
// { type: 'variant:updated', variant: { id: 'var_1', status: 'completed', image_key: '...', ... } }
```

---

## Example: Plan Execution Flow

```typescript
// 1. AI creates a plan
// { type: 'plan:created', plan: { id: 'plan_1', status: 'planning', ... }, steps: [...] }

// 2. User approves
ws.send({ type: 'plan:approve', planId: 'plan_1' });

// 3. Plan starts executing
// { type: 'plan:updated', plan: { id: 'plan_1', status: 'executing', ... } }
// { type: 'plan:step_updated', step: { id: 'step_1', status: 'in_progress', ... } }

// 4. Step completes, next step starts
// { type: 'plan:step_updated', step: { id: 'step_1', status: 'completed', result: 'variant:var_1' } }
// { type: 'plan:step_updated', step: { id: 'step_2', status: 'in_progress', ... } }

// 5. All steps complete
// { type: 'plan:updated', plan: { id: 'plan_1', status: 'completed', ... } }
```
