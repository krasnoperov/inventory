# Inventory Forge: Architecture

Lean MVP architecture with hooks for future scale.

---

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

## Data Model

### Source of Truth

| Data | Store | Notes |
|------|-------|-------|
| Assets, Variants, Lineage | DO SQLite | Authoritative. Real-time sync via WebSocket. |
| Users, Spaces, Members | D1 | Global. Auth and access control. |
| Images | R2 | Key format: `images/{spaceId}/{variantId}.{ext}` |
| Chat Messages | DO SQLite | Per-space chat with bot and users. |
| Usage Events | D1 | Billing/usage tracking for Polar.sh integration. |

### DO SQLite Schema (Per Space)

```sql
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'character', 'item', 'scene', 'sprite-sheet', 'animation', 'style-sheet', 'reference', etc.
  tags TEXT DEFAULT '[]',  -- JSON array
  parent_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,  -- Asset hierarchy (NULL = root)
  active_variant_id TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE variants (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  job_id TEXT UNIQUE,  -- Idempotency key, NULL for imports/spawns
  image_key TEXT NOT NULL,
  thumb_key TEXT NOT NULL,
  recipe TEXT NOT NULL,  -- JSON, see below
  starred INTEGER NOT NULL DEFAULT 0,  -- User can mark important variants
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Variant lineage: tracks generation history between variants
CREATE TABLE lineage (
  id TEXT PRIMARY KEY,
  parent_variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  child_variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('derived', 'composed', 'spawned')),
  severed INTEGER NOT NULL DEFAULT 0,  -- User can cut lineage display without deleting
  created_at INTEGER NOT NULL
);

CREATE TABLE image_refs (
  image_key TEXT PRIMARY KEY,
  ref_count INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'bot')),
  sender_id TEXT NOT NULL,     -- user.id or 'bot:advisor' / 'bot:actor'
  content TEXT NOT NULL,       -- markdown
  metadata TEXT,               -- JSON: referenced assets, action plan, etc.
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_variants_asset ON variants(asset_id);
CREATE INDEX idx_assets_updated ON assets(updated_at DESC);
CREATE INDEX idx_assets_parent ON assets(parent_asset_id);
CREATE INDEX idx_lineage_parent ON lineage(parent_variant_id);
CREATE INDEX idx_lineage_child ON lineage(child_variant_id);
CREATE INDEX idx_chat_created ON chat_messages(created_at DESC);
```

**Relationship Model:**
- **Asset Hierarchy**: `parent_asset_id` enables tree structures (e.g., "Head" child of "Character"). User CAN rearrange via drag-to-reparent.
- **Variant Lineage**: `lineage` table tracks generation history. User CANNOT rearrange (immutable for audit/reproducibility).
- **Lineage Types**:
  - `derived`: Single source image edited/refined
  - `composed`: Multiple source images combined
  - `spawned`: Variant copied to create new asset
- **Severed Flag**: Reserved for admin/future use. No user-facing UI. Keeps record but hides from visualization.

### D1 Schema (Global)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  picture TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE space_members (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, user_id)
);

-- Usage events for billing (Polar.sh integration)
CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  event_name TEXT NOT NULL,  -- 'claude_tokens', 'gemini_images'
  quantity INTEGER NOT NULL,
  metadata TEXT,  -- JSON
  created_at TEXT NOT NULL,
  synced_at TEXT  -- NULL until synced to Polar
);
```

### Recipe Schema

```typescript
interface Recipe {
  type: 'generate' | 'derive' | 'compose';  // Note: 'derive' not 'edit'
  prompt: string;
  model: 'gemini-3-pro-image-preview' | 'gemini-2.5-flash-image';
  aspectRatio: '1:1' | '16:9' | '9:16' | '2:3' | '3:2' | '3:4' | '4:3';

  // For derive/compose: source images used in generation
  inputs: Array<{
    variantId: string;   // Source variant ID (for reference)
    imageKey: string;    // R2 key (always valid, survives deletion)
  }>;
}
```

**Notes:**
- Recipe stores generation parameters for reproducibility
- Lineage table is authoritative for relationships (Recipe is for metadata)
- `inputs[].imageKey` must be in same space (`images/{thisSpaceId}/...`)

### Chat Message Metadata Schema

```typescript
// For bot advisor responses
interface AdvisorMetadata {
  mode: 'advisor';
  referencedAssets?: string[];  // asset IDs mentioned
  suggestions?: Array<{
    type: 'prompt' | 'edit' | 'compose';
    target?: string;  // asset ID
    prompt: string;
  }>;
}

// For bot actor responses (action plan)
interface ActorMetadata {
  mode: 'actor';
  status: 'proposed' | 'confirmed' | 'executing' | 'completed' | 'cancelled';
  action: {
    type: 'generate' | 'edit' | 'compose';
    assetId?: string;       // for edit
    variantId?: string;     // for edit
    sourceAssets?: string[]; // for compose
    prompt: string;
    params?: Record<string, unknown>;
  };
  jobId?: string;  // set after confirmation and job creation
}
```

---

## API

### REST (Worker)

```
# Auth
POST   /api/auth/google              OAuth callback → JWT

# Users
GET    /api/users/me                 Current user

# Spaces
POST   /api/spaces                   Create space
GET    /api/spaces                   List user's spaces
GET    /api/spaces/:id               Get space (D1 metadata)
DELETE /api/spaces/:id               Delete space (owner only)

# Members
GET    /api/spaces/:id/members       List members
POST   /api/spaces/:id/members       Invite (email → lookup user)
DELETE /api/spaces/:id/members/:uid  Remove member
PATCH  /api/spaces/:id/members/:uid  Update role

# Generation Jobs
POST   /api/spaces/:id/generate      New asset from prompt
POST   /api/assets/:assetId/edit     New variant from edit
POST   /api/spaces/:id/compose       New asset from composition
GET    /api/jobs/:id                 Job status
POST   /api/jobs/:id/retry           Retry stuck job

# Lineage (computed from recipes)
GET    /api/assets/:id/lineage       Upstream lineage (max_depth=5, max_nodes=50)
GET    /api/assets/:id/derived       Downstream (limit=50, cursor=)

# Images
POST   /api/upload                   Get presigned upload URL
GET    /api/images/*                 Serve image (or redirect to signed URL)

# Bot Assistant
POST   /api/spaces/:id/bot/invoke    Invoke bot (advisor or actor mode)
POST   /api/spaces/:id/bot/confirm   Confirm actor action plan
POST   /api/spaces/:id/bot/cancel    Cancel proposed action
GET    /api/spaces/:id/chat          Get chat history (limit=50, cursor=)

# Admin (internal/manual)
POST   /api/admin/spaces/:id/resync  Force D1 shadow resync
POST   /api/admin/spaces/:id/cleanup Force R2 ref cleanup
```

### WebSocket (Durable Object)

```
GET /api/spaces/:id/ws?token=<JWT>
```

**Client → Server:**

```typescript
type ClientMessage =
  // Sync
  | { type: 'sync:request' }

  // Assets
  | { type: 'asset:create'; name: string; assetType: AssetType; parentAssetId?: string }
  | { type: 'asset:update'; assetId: string; changes: { name?: string; type?: string; tags?: string[]; parent_asset_id?: string | null } }
  | { type: 'asset:delete'; assetId: string }
  | { type: 'asset:setActive'; assetId: string; variantId: string }
  | { type: 'asset:spawn'; sourceVariantId: string; name: string; assetType: string; parentAssetId?: string }

  // Variants
  | { type: 'variant:delete'; variantId: string }
  | { type: 'variant:star'; variantId: string; starred: boolean }

  // Generation (via WebSocket instead of REST)
  | { type: 'generate:request'; requestId: string; name: string; assetType: string; prompt?: string; referenceAssetIds?: string[]; aspectRatio?: string; parentAssetId?: string }
  | { type: 'refine:request'; requestId: string; assetId: string; sourceVariantId?: string; prompt: string; referenceAssetIds?: string[]; aspectRatio?: string }

  // Presence (optional)
  | { type: 'presence:update'; viewing?: string }

  // Chat
  | { type: 'chat:send'; content: string }
  | { type: 'chat:request'; requestId: string; message: string; context?: object }
```

**Server → Client:**

```typescript
type ServerMessage =
  // Sync (full state including lineage)
  | { type: 'sync:state'; assets: Asset[]; variants: Variant[]; lineage: Lineage[]; presence: Presence[] }

  // Asset Mutations
  | { type: 'asset:created'; asset: Asset }
  | { type: 'asset:updated'; asset: Asset }
  | { type: 'asset:deleted'; assetId: string }
  | { type: 'asset:spawned'; asset: Asset; variant: Variant; lineage: Lineage }

  // Variant Mutations
  | { type: 'variant:created'; variant: Variant }
  | { type: 'variant:updated'; variant: Variant }
  | { type: 'variant:deleted'; variantId: string }

  // Lineage Mutations
  | { type: 'lineage:created'; lineage: Lineage }
  | { type: 'lineage:severed'; lineageId: string }

  // Generation Jobs
  | { type: 'generate:started'; requestId: string; jobId: string; assetId: string; assetName: string }
  | { type: 'generate:progress'; requestId: string; jobId: string; status: string }
  | { type: 'job:completed'; jobId: string; variant: Variant; assetId: string; assetName: string; prompt?: string }
  | { type: 'job:failed'; jobId: string; error: string }

  // Presence
  | { type: 'presence:state'; users: Array<{ oderId: string; viewing?: string }> }

  // Chat
  | { type: 'chat:response'; requestId: string; message: string; done: boolean }
  | { type: 'chat:history'; messages: ChatMessage[] }

  // Errors
  | { type: 'error'; code: string; message: string }
```

---

## Key Flows

### WebSocket Auth

```typescript
// DO: on WebSocket connect
async handleWebSocketUpgrade(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  // 1. Verify JWT
  const user = await verifyJWT(token);
  if (!user) return new Response('Invalid token', { status: 401 });

  // 2. Check membership (D1)
  const member = await this.env.D1.prepare(
    `SELECT role FROM space_members WHERE space_id = ? AND user_id = ?`
  ).bind(this.spaceId, user.id).first();

  if (!member) return new Response('Not a member', { status: 403 });

  // 3. Accept WebSocket
  const pair = new WebSocketPair();
  this.ctx.acceptWebSocket(pair[1], { userId: user.id, role: member.role });
  return new Response(null, { status: 101, webSocket: pair[0] });
}
```

On token expiry: client reconnects with new token. No refresh protocol.

### Generation Flow (via Cloudflare Workflows)

```
1. Client: WebSocket generate:request { name, assetType, prompt, ... }
2. SpaceDO (GenerationController):
   - Create asset in DO SQLite
   - Broadcast asset:created to WebSocket clients
   - Trigger GenerationWorkflow with jobId = uuid()
   - Broadcast generate:started { jobId, assetId }

3. GenerationWorkflow:
   - Call Gemini API
   - Upload to R2 (image + thumbnail)
   - Call DO: POST /internal/apply-variant { jobId, variantId, imageKey, ... }
   - DO creates variant, broadcasts to WebSocket clients
   - Workflow completes and sends result to DO

4. DO /internal/apply-variant:
   - Check: SELECT * FROM variants WHERE job_id = ?
   - If exists: return { created: false, variant }  (idempotent)
   - Else: INSERT variant, update refs, return { created: true, variant }
   - Broadcast to WebSocket clients

5. Client: sees generate:result via WebSocket
```

**Job tracking:** Jobs are ephemeral client-side state. Workflows are durable and will complete even if client disconnects. Results persist in DO SQLite.

### Bot Invocation Flow

```
1. Client: bot:invoke { mode: 'advisor', prompt: 'Review my characters', selectedAssets: [...] }
   (or POST /api/spaces/:id/bot/invoke)

2. Worker:
   - Check rate limit (10/user/hour in D1 or KV)
   - Fetch space state from DO (assets, variants with recipes)
   - Build context for LLM

3. Context Building:
   {
     space: { id, name, assetCount },
     assets: [
       {
         id, name, type, tags,
         activeVariant: { id, thumbnailUrl, recipe },
         variantCount
       },
       ...
     ],
     selectedAssets: [...],  // if specified
     recentChat: [...],      // last 10 messages for continuity
     userPrompt: "Review my characters"
   }

4. LLM Call (Claude):
   - System prompt defines advisor vs actor behavior
   - For advisor: analyze and suggest, no actions
   - For actor: plan specific action, output structured JSON

5a. Advisor Response:
   - Stream chunks via WebSocket: bot:streaming
   - Save message to DO: chat_messages
   - Broadcast: chat:message with AdvisorMetadata
   - Done: bot:done

5b. Actor Response:
   - LLM returns action plan JSON
   - Save message with ActorMetadata { status: 'proposed', action: {...} }
   - Broadcast: chat:message (UI shows "Confirm / Cancel" buttons)
   - Wait for user confirmation

6. Actor Confirmation (bot:confirm):
   - Update message metadata: status → 'executing'
   - Create generation job (same as manual generate/edit/compose)
   - Update metadata: jobId set
   - Broadcast: bot:action_updated

7. Job Completion:
   - Normal job:completed flow
   - Update actor message metadata: status → 'completed'
   - Broadcast: bot:action_updated
```

### Bot System Prompts

```typescript
const ADVISOR_SYSTEM = `You are an art director assistant reviewing a visual asset inventory.
Analyze the assets and provide constructive feedback on:
- Visual consistency across characters/items
- Composition and style coherence
- Specific improvement suggestions with actionable prompts

Reference assets by name. Be concise and specific.`;

const ACTOR_SYSTEM = `You are an assistant that helps create and modify visual assets.
Based on the user's request, output a JSON action plan:

{
  "explanation": "Brief description of what you'll do",
  "action": {
    "type": "generate" | "edit" | "compose",
    "assetId": "...",      // for edit
    "variantId": "...",    // for edit (which variant to modify)
    "sourceAssets": [...], // for compose
    "prompt": "Detailed generation prompt",
    "assetName": "Name for new asset"  // for generate/compose
  }
}

Only output the JSON. The user will confirm before execution.`;
```

### R2 Image Cleanup

```typescript
// DO: ref counting
async incrementRef(imageKey: string) {
  await this.sql.exec(`
    INSERT INTO image_refs (image_key, ref_count) VALUES (?, 1)
    ON CONFLICT(image_key) DO UPDATE SET ref_count = ref_count + 1
  `, [imageKey]);
}

async decrementRef(imageKey: string) {
  const result = await this.sql.exec(`
    UPDATE image_refs SET ref_count = ref_count - 1
    WHERE image_key = ?
    RETURNING ref_count
  `, [imageKey]).first();

  if (result && result.ref_count <= 0) {
    await this.env.R2.delete(imageKey);
    await this.sql.exec(`DELETE FROM image_refs WHERE image_key = ?`, [imageKey]);
  }
}

// Called on variant create: incrementRef(imageKey), incrementRef(thumbKey), incrementRef for each recipe input
// Called on variant delete: decrementRef for all

// Manual cleanup: POST /api/admin/spaces/:id/cleanup
// Rebuilds ref counts from variants table, deletes orphans
```

### Lineage Query

Lineage is now stored in a dedicated `lineage` table, making queries efficient:

```typescript
// Get all lineage for an asset's variants (for VariantCanvas display)
async getAssetLineage(assetId: string): Promise<Lineage[]> {
  // Get all variant IDs for this asset
  const variants = await this.ctx.storage.sql.exec(
    'SELECT id FROM variants WHERE asset_id = ?',
    assetId
  );
  const variantIds = variants.toArray().map(v => v.id);

  if (variantIds.length === 0) return [];

  // Get lineage where either parent or child is in this asset
  const lineage = await this.ctx.storage.sql.exec(`
    SELECT * FROM lineage
    WHERE parent_variant_id IN (${variantIds.map(() => '?').join(',')})
       OR child_variant_id IN (${variantIds.map(() => '?').join(',')})
  `, [...variantIds, ...variantIds]);

  return lineage.toArray() as Lineage[];
}

// Get upstream lineage (parents of parents)
async getUpstreamLineage(variantId: string, maxDepth = 5): Promise<Lineage[]> {
  const result: Lineage[] = [];
  const visited = new Set<string>();

  const traverse = async (vId: string, depth: number) => {
    if (depth > maxDepth || visited.has(vId)) return;
    visited.add(vId);

    const parents = await this.ctx.storage.sql.exec(
      'SELECT * FROM lineage WHERE child_variant_id = ? AND severed = 0',
      vId
    );

    for (const l of parents.toArray()) {
      result.push(l as Lineage);
      await traverse(l.parent_variant_id, depth + 1);
    }
  };

  await traverse(variantId, 0);
  return result;
}
```

**Performance:** O(1) lookup per relationship via indexed `parent_variant_id` and `child_variant_id` columns.

### Nightly Backup

```typescript
// DO alarm: also check if it's backup time
async alarm() {
  const now = new Date();

  // Backup at 3am UTC
  if (now.getUTCHours() === 3 && !this.didBackupToday) {
    await this.backup();
    this.didBackupToday = true;
  }
  if (now.getUTCHours() !== 3) {
    this.didBackupToday = false;
  }

  await this.syncToD1();
  await this.ctx.storage.setAlarm(Date.now() + 5 * 60 * 1000);
}

async backup() {
  const snapshot = {
    version: 1,
    spaceId: this.spaceId,
    timestamp: Date.now(),
    assets: await this.sql.exec(`SELECT * FROM assets`).all(),
    variants: await this.sql.exec(`SELECT * FROM variants`).all(),
    imageRefs: await this.sql.exec(`SELECT * FROM image_refs`).all(),
  };

  const date = new Date().toISOString().split('T')[0];
  const key = `backups/${this.spaceId}/${date}.json`;
  await this.env.R2.put(key, JSON.stringify(snapshot));

  // Keep last 30 days
  const list = await this.env.R2.list({ prefix: `backups/${this.spaceId}/` });
  const sorted = list.objects.sort((a, b) => b.key.localeCompare(a.key));
  for (const obj of sorted.slice(30)) {
    await this.env.R2.delete(obj.key);
  }
}
```

**Restore (manual runbook):**
1. Find backup: `r2 ls backups/{spaceId}/`
2. Download: `r2 get backups/{spaceId}/{date}.json`
3. Call internal restore endpoint or script that recreates DO state from JSON

---

## Constraints & Limits

| Constraint | Value | Reason |
|------------|-------|--------|
| Same-space sources only | Enforced | Avoids cross-space ref counting |
| Lineage max_depth | 5 | Prevent deep recursion |
| Lineage max_nodes | 50 | Prevent large response |
| Derived assets limit | 50 | Pagination |
| D1 sync interval | 5 min | Best-effort, not critical |
| Job max attempts | 3 | Then marked 'stuck' |
| Backup retention | 30 days | R2 storage budget |
| Bot rate limit | 10/user/hour | Prevent LLM cost abuse |
| Chat history | 100 messages | Per space, prune oldest |
| Bot context assets | 50 | Max assets sent to LLM |

---

## Implemented Features

| Feature | Description |
|---------|-------------|
| Cross-asset lineage display | Ghost nodes in VariantCanvas show parent variants from other assets |
| Asset reparenting UI | Drag-to-reparent on AssetCanvas with backend cycle prevention |
| Asset ID validation | Chat Plan validates all asset references before execution |

See `docs/RELATIONSHIPS.md` for detailed documentation of the relationship system.

## Future Hooks (Not Implemented Yet)

| Feature | Hook |
|---------|------|
| Cross-space import | Copy image to target space, recipe type: 'import' |
| Event sourcing | Add `events` table, replay for undo/audit |
| Incremental sync | Track `lastSyncedAt`, send deltas instead of full state |
| Token refresh | WebSocket ping/pong with new token |
| Multi-action actor | Bot plans multiple steps, executes sequentially |
| Prompt templates | Reusable prompts suggested by bot |
| Lineage severing UI | UI to sever/restore lineage links (backend ready) |

---

## File Cleanup

After approval, delete these superseded docs:
- `docs/COLLABORATIVE_ARCHITECTURE.md`
- `docs/ARCHITECTURE_CRITIQUE.md`
- `docs/COLLABORATIVE_DESIGN_FINAL.md`
- `docs/ARCHITECTURE_RECONCILED.md`
- `docs/ARCHITECTURE_PRODUCTION.md`

Keep only:
- `PRD.md` (update to reference this doc)
- `docs/ARCHITECTURE.md` (this file)
