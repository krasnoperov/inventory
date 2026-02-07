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
       │──── chat:request ────────────────▶│ (triggers ChatWorkflow)
       │◀─── chat:response ───────────────│
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

### Assets

| Message | Fields | Description |
|---------|--------|-------------|
| `asset:create` | `name`, `assetType`, `parentAssetId?` | Create new asset |
| `asset:update` | `assetId`, `changes: { name?, tags?, type?, parentAssetId? }` | Update asset |
| `asset:delete` | `assetId` | Delete asset |
| `asset:setActive` | `assetId`, `variantId` | Set active variant |
| `asset:fork` | `sourceVariantId`, `name`, `assetType`, `parentAssetId?` | Fork asset from variant |

### Variants

| Message | Fields | Description |
|---------|--------|-------------|
| `variant:delete` | `variantId` | Delete variant |
| `variant:star` | `variantId`, `starred: boolean` | Star/unstar variant |
| `variant:retry` | `variantId` | Retry failed generation |

### Lineage

| Message | Fields | Description |
|---------|--------|-------------|
| `lineage:sever` | `lineageId` | Sever lineage relationship |

### Chat & AI

| Message | Fields | Description |
|---------|--------|-------------|
| `chat:request` | `requestId`, `message`, `mode: 'advisor'|'actor'`, `forgeContext?`, `viewingContext?` | Send chat message (triggers ChatWorkflow) |
| `chat:history` | `since?` | Request chat history |
| `chat:new_session` | - | Start new chat session |
| `generate:request` | `requestId`, `name`, `assetType`, `prompt?`, `aspectRatio?`, `referenceAssetIds?`, `referenceVariantIds?`, `parentAssetId?`, `disableStyle?` | Generate new asset (triggers GenerationWorkflow) |
| `refine:request` | `requestId`, `assetId`, `prompt`, `sourceVariantId?`, `sourceVariantIds?`, `aspectRatio?`, `referenceAssetIds?`, `disableStyle?` | Refine existing asset |
| `batch:request` | `requestId`, `name`, `assetType`, `prompt`, `count`, `mode: 'explore'\|'set'`, `aspectRatio?`, `referenceAssetIds?`, `referenceVariantIds?`, `parentAssetId?`, `disableStyle?` | Batch generate (see [style-and-batch.md](./style-and-batch.md)) |
| `describe:request` | `requestId`, `variantId`, `assetName`, `focus?`, `question?` | Describe image with Claude Vision |
| `compare:request` | `requestId`, `variantIds`, `aspects?` | Compare images with Claude Vision |

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

## Server → Client Messages

### Sync

| Message | Fields | Description |
|---------|--------|-------------|
| `sync:state` | `assets[]`, `variants[]`, `lineage[]`, `presence[]` | Full state snapshot |

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

When sending `chat:request` or `generate:request`, include forge context:

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
