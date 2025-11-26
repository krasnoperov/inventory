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
│  │   Worker    │    │    Queue    │    │  Durable Object     │  │
│  │  (HTTP +    │───▶│ (generation │───▶│  (per Space)        │  │
│  │   REST)     │    │   jobs)     │    │                     │  │
│  └─────────────┘    └─────────────┘    │  ┌───────────────┐  │  │
│         │                              │  │    SQLite     │  │  │
│         │                              │  │ (authoritative│  │  │
│         ▼                              │  │    state)     │  │  │
│  ┌─────────────┐                       │  └───────────────┘  │  │
│  │     D1      │                       │  ┌───────────────┐  │  │
│  │  (users,    │◀──── sync (5min) ─────│  │  WebSocket    │  │  │
│  │   spaces,   │                       │  │    Hub        │  │  │
│  │   index)    │                       │  └───────────────┘  │  │
│  └─────────────┘                       └─────────────────────┘  │
│         │                                        │              │
│         │                                        │              │
│         ▼                                        ▼              │
│  ┌─────────────┐                       ┌─────────────────────┐  │
│  │     R2      │◀──────────────────────│      Gemini         │  │
│  │  (images)   │                       │       API           │  │
│  └─────────────┘                       └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Source of Truth

| Data | Store | Notes |
|------|-------|-------|
| Assets, Variants | DO SQLite | Authoritative. Real-time sync via WebSocket. |
| Users, Spaces, Members | D1 | Global. Auth and access control. |
| Asset Index | D1 | Best-effort shadow for cross-space search. |
| Jobs | D1 | Generation job tracking. |
| Images | R2 | Key format: `images/{spaceId}/{variantId}.{ext}` |
| Chat Messages | DO SQLite | Per-space chat with bot and users. |

### DO SQLite Schema (Per Space)

```sql
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('character', 'item', 'scene', 'composite')),
  tags TEXT DEFAULT '[]',  -- JSON array
  active_variant_id TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE variants (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  job_id TEXT UNIQUE,  -- Idempotency key, NULL for imports
  image_key TEXT NOT NULL,
  thumb_key TEXT NOT NULL,
  recipe TEXT NOT NULL,  -- JSON, see below
  created_by TEXT NOT NULL,
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
CREATE INDEX idx_chat_created ON chat_messages(created_at DESC);
```

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

-- Shadow index for cross-space search (best-effort, may lag)
CREATE TABLE asset_index (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  tags TEXT,
  thumb_key TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'generate', 'edit', 'compose'
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'processing', 'completed', 'failed', 'stuck'
  input TEXT NOT NULL,  -- JSON
  result_variant_id TEXT,
  error TEXT,
  attempts INTEGER DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_asset_index_space ON asset_index(space_id);
CREATE INDEX idx_jobs_space_status ON jobs(space_id, status);
```

### Recipe Schema

```typescript
interface Recipe {
  type: 'generate' | 'edit' | 'compose';
  prompt: string;
  model: 'gemini-3-pro-image-preview' | 'gemini-2.5-flash-image';
  aspectRatio: '1:1' | '16:9' | '9:16' | '2:3' | '3:2' | '3:4' | '4:3';
  imageSize?: '1K' | '2K' | '4K';

  // For edit/compose: what was used (same-space only)
  inputs: Array<{
    imageKey: string;        // R2 key (always valid, survives deletion)
    sourceVariantId: string; // For lineage (may become invalid)
    sourceAssetId: string;   // For lineage (may become invalid)
    sourceAssetName: string; // Snapshot for display
    label: string;           // "Image 1:", "Character:", etc.
  }>;
}
```

**Constraint:** `inputs[].imageKey` must be in same space (`images/{thisSpaceId}/...`). Enforced at compose/edit time.

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
  | { type: 'asset:create'; name: string; assetType: AssetType }
  | { type: 'asset:update'; assetId: string; changes: { name?: string; tags?: string[] } }
  | { type: 'asset:delete'; assetId: string }
  | { type: 'asset:setActive'; assetId: string; variantId: string }

  // Variants
  | { type: 'variant:delete'; variantId: string }

  // Presence (optional)
  | { type: 'presence:update'; viewing?: string }

  // Chat
  | { type: 'chat:send'; content: string }
  | { type: 'bot:invoke'; mode: 'advisor' | 'actor'; prompt: string; selectedAssets?: string[] }
  | { type: 'bot:confirm'; messageId: string }
  | { type: 'bot:cancel'; messageId: string }
```

**Server → Client:**

```typescript
type ServerMessage =
  // Sync (full state, fine for dozens of assets)
  | { type: 'sync:state'; assets: Asset[]; variants: Variant[] }

  // Mutations
  | { type: 'asset:created'; asset: Asset }
  | { type: 'asset:updated'; asset: Asset }
  | { type: 'asset:deleted'; assetId: string }
  | { type: 'variant:created'; variant: Variant }
  | { type: 'variant:deleted'; variantId: string }

  // Jobs (relayed from worker)
  | { type: 'job:progress'; jobId: string; status: string }
  | { type: 'job:completed'; jobId: string; variant: Variant }
  | { type: 'job:failed'; jobId: string; error: string }

  // Presence
  | { type: 'presence:state'; users: Array<{ userId: string; viewing?: string }> }

  // Chat
  | { type: 'chat:message'; message: ChatMessage }
  | { type: 'bot:thinking'; botId: string }
  | { type: 'bot:streaming'; botId: string; chunk: string }
  | { type: 'bot:done'; botId: string; messageId: string }
  | { type: 'bot:action_updated'; messageId: string; status: string; jobId?: string }

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

### Generation Job (Idempotent)

```
1. Client: POST /api/spaces/:id/generate { prompt, params }
2. Worker:
   - Generate jobId = uuid()
   - INSERT INTO jobs (id, space_id, status='pending', ...)
   - Enqueue { jobId, spaceId, prompt, params }
   - Return { jobId }

3. Queue Worker:
   - Dequeue job
   - Check D1: if status != 'pending', skip (idempotent)
   - UPDATE jobs SET status='processing', attempts=attempts+1
   - Call Gemini API
   - Upload to R2
   - Call DO: POST /internal/apply-variant { jobId, variantId, imageKey, ... }
   - If DO returns { created: true }:
       UPDATE jobs SET status='completed', result_variant_id=...
   - If DO returns { created: false } (already exists):
       UPDATE jobs SET status='completed' (idempotent, no dup)
   - On error:
       If attempts >= 3: UPDATE jobs SET status='stuck'
       Else: throw (queue will retry with backoff)

4. DO /internal/apply-variant:
   - Check: SELECT * FROM variants WHERE job_id = ?
   - If exists: return { created: false, variant }  (idempotent)
   - Else: INSERT variant, update refs, return { created: true, variant }
   - Broadcast to WebSocket clients

5. Client: sees job:completed via WebSocket, or polls GET /api/jobs/:id
```

**Stuck jobs:** User sees "Generation failed" with "Retry" button → POST /api/jobs/:id/retry resets status to 'pending' and re-enqueues.

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

### D1 Shadow Sync

```typescript
// DO: sync to D1 on timer and startup
class InventorySpaceDO {
  async alarm() {
    await this.syncToD1();
    // Re-schedule for 5 minutes
    await this.ctx.storage.setAlarm(Date.now() + 5 * 60 * 1000);
  }

  async syncToD1() {
    const assets = await this.sql.exec(`SELECT * FROM assets`).all();

    try {
      // Batch upsert to D1
      await this.env.D1.batch([
        // Clear stale entries for this space
        this.env.D1.prepare(`DELETE FROM asset_index WHERE space_id = ?`).bind(this.spaceId),
        // Insert current state
        ...assets.map(a =>
          this.env.D1.prepare(`
            INSERT INTO asset_index (id, space_id, name, type, tags, thumb_key, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).bind(a.id, this.spaceId, a.name, a.type, a.tags, a.thumb_key, a.updated_at)
        )
      ]);
    } catch (err) {
      // Best-effort: log and continue, will retry in 5 min
      console.error('D1 sync failed:', err);
    }
  }
}

// Manual resync: POST /api/admin/spaces/:id/resync
// Just calls DO.syncToD1() immediately
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

```typescript
// GET /api/assets/:id/lineage?max_depth=5&max_nodes=50
async getLineage(assetId: string, maxDepth = 5, maxNodes = 50): Promise<LineageTree> {
  let nodeCount = 0;

  const build = async (id: string, depth: number): Promise<LineageNode | null> => {
    if (depth > maxDepth || nodeCount >= maxNodes) {
      return { assetId: id, truncated: true };
    }
    nodeCount++;

    const asset = await this.getAsset(id);
    if (!asset) return { assetId: id, deleted: true };

    // Get all source asset IDs from this asset's variants' recipes
    const variants = await this.getVariants(id);
    const sourceAssetIds = new Set<string>();

    for (const v of variants) {
      const recipe = JSON.parse(v.recipe);
      for (const input of recipe.inputs || []) {
        if (input.sourceAssetId) {
          sourceAssetIds.add(input.sourceAssetId);
        }
      }
    }

    return {
      asset,
      sources: await Promise.all(
        [...sourceAssetIds].slice(0, 10).map(sid => build(sid, depth + 1))
      )
    };
  };

  return build(assetId, 0);
}

// GET /api/assets/:id/derived?limit=50&cursor=
async getDerived(assetId: string, limit = 50, cursor?: string): Promise<{ assets: Asset[]; nextCursor?: string }> {
  // Get this asset's image keys
  const variants = await this.getVariants(assetId);
  const imageKeys = variants.map(v => v.image_key);

  if (imageKeys.length === 0) return { assets: [] };

  // Find variants whose recipes reference these images
  // This is O(all variants) but fine for dozens/hundreds
  const allVariants = await this.sql.exec(`SELECT * FROM variants`).all();

  const derivedAssetIds = new Set<string>();
  for (const v of allVariants) {
    if (v.asset_id === assetId) continue;
    const recipe = JSON.parse(v.recipe);
    for (const input of recipe.inputs || []) {
      if (imageKeys.includes(input.imageKey)) {
        derivedAssetIds.add(v.asset_id);
      }
    }
  }

  const sorted = [...derivedAssetIds].sort();
  const startIdx = cursor ? sorted.indexOf(cursor) + 1 : 0;
  const slice = sorted.slice(startIdx, startIdx + limit);

  return {
    assets: await Promise.all(slice.map(id => this.getAsset(id))),
    nextCursor: slice.length === limit ? slice[slice.length - 1] : undefined
  };
}
```

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

## Future Hooks (Not Implemented Yet)

| Feature | Hook |
|---------|------|
| Cross-space import | Copy image to target space, recipe type: 'import' |
| Faster lineage | Add `lineage_edges` table, populate on variant create |
| Event sourcing | Add `events` table, replay for undo/audit |
| Incremental sync | Track `lastSyncedAt`, send deltas instead of full state |
| Token refresh | WebSocket ping/pong with new token |
| Real-time presence | Cursor positions, who's viewing what |
| Bot as WebSocket client | Persistent connection for real-time observation |
| Multi-action actor | Bot plans multiple steps, executes sequentially |
| Image understanding | Send thumbnails to Gemini for visual analysis |
| Prompt templates | Reusable prompts suggested by bot |

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
