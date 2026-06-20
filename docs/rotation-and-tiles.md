# Rotation Views & Tile Sets

Sequential generation pipelines that produce multi-view character sheets and seamless tile maps from a single source image.

---

## Overview

Both pipelines follow the same pattern: create a parent asset, seed it with an initial variant, then generate remaining views/tiles one at a time. Each step feeds completed images back as references for the next, building visual consistency across the set.

Rotation generation is experimental and hidden by default. The web creation UI,
CLI command surface, and backend WebSocket request handler are all gated by
`MAKEFX_ROTATION_ENABLED`.

The pipelines are driven by a completion hook in `GenerationController` — when a variant finishes, the hook checks if it belongs to a rotation set or tile set and calls `advanceRotation()` or `advanceTileSet()` to trigger the next step.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  User sends  │────▶│ Create asset │────▶│  Seed with   │
│   request    │     │  + records   │     │ first variant │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                 │
                    ┌────────────────────────────┘
                    ▼
              ┌───────────┐     ┌────────────────┐     ┌───────────┐
              │  Trigger  │────▶│  Generation    │────▶│ Completion │
              │ workflow  │     │  Workflow runs │     │  callback  │
              └───────────┘     └────────────────┘     └─────┬─────┘
                    ▲                                        │
                    │          ┌──────────────┐              │
                    └──────────│ advanceXxx() │◀─────────────┘
                               │ (next step)  │
                               └──────────────┘
```

---

## Rotation Views

Generate the same subject from multiple angles using a consistent reference sheet approach.

### Configurations

| Config | Directions | Count |
|--------|-----------|-------|
| `4-directional` | S, E, N, W | 4 |
| `8-directional` | S, SE, E, NE, N, NW, W, SW | 8 |
| `turnaround` | front, 3/4-front, side, 3/4-back, back | 5 |

The first direction is always the seed — it uses the source variant's existing image. Generation starts from the second direction onward.

### Pipeline Flow

1. **Validate** — Source variant must be `completed` with an `image_key`
2. **Create child asset** — Named `"{sourceName} -- Rotation"` with `parent = sourceAsset.id`
3. **Fork source variant** — Direct SQL copy of image/thumb keys, media metadata, and recipe; increment R2 refs
4. **Create forked lineage** — `relation_type: 'forked'`
5. **Set as active** — Forked variant becomes the new asset's active variant
6. **Create rotation_set record** — Status `pending`, config JSON: `{ type, subjectDescription, aspectRatio, disableStyle }`
7. **Register seed view** — `rotation_views[0]` with `direction = directions[0]`, `step_index = 0`
8. **Broadcast `rotation:started`**
9. **Call `advanceRotation()`** — Begins the sequential loop

### advanceRotation() Loop

Each call to `advanceRotation()`:

1. Check status — return if `cancelled` or `failed`
2. Count completed views — if all done, mark `completed` and broadcast `rotation:completed`
3. Get next direction from `ROTATION_DIRECTIONS[config.type][currentStep]`
4. Collect image keys from all completed views as references
5. Apply style injection and cap total refs (max 14, source key always preserved)
6. Build prompt with reference sheet instructions
7. Create placeholder variant with recipe
8. Register as `rotation_view` with direction and step index
9. Trigger `GENERATION_WORKFLOW` with `operation: 'derive'`
10. Update step counter and broadcast `rotation:step_completed`

### Prompt Structure

```
[Style: {styleDescription}]

You are creating a consistent multi-view character reference sheet.
The reference images show the same subject from previously generated angles.
Image 1: {subject} {direction} view
Image 2: {subject} {direction} view
...

Generate: Show the EXACT SAME {subject} from the {DIRECTION} view.
- Maintain identical design, proportions, colors, clothing, and style
- Keep the same level of detail and artistic rendering
- Neutral standing/display pose
- Plain background
- Match the exact art style of all reference images
```

Subject description resolves as: `config.subjectDescription || sourceVariant.description || asset.name || 'the subject'`.

---

## Tile Sets

Generate seamless isometric tile maps by expanding outward from a center tile using adjacency-aware prompting.

### Tile Types

| Type | Description |
|------|-------------|
| `terrain` | Ground/landscape tiles |
| `building` | Structure tiles |
| `decoration` | Decorative element tiles |
| `custom` | User-defined tile type |

### Grid Constraints

- **Minimum:** 2x2 (4 tiles)
- **Maximum:** 5x5 (25 tiles)
- **Default aspect ratio:** `1:1`

### Spiral Order

Tiles generate from the center outward using BFS (breadth-first search) in cardinal directions:

```typescript
function getSpiralOrder(w: number, h: number): [number, number][] {
  // Start at center: (floor(w/2), floor(h/2))
  // BFS expand: [+1,0], [-1,0], [0,+1], [0,-1]
}
```

For a 3x3 grid, the generation order is:

```
Step:  5 │ 2 │ 6        Coords: (0,0)│(1,0)│(2,0)
─────────┼───┼─────              ─────┼─────┼─────
     3 │ 1 │ 4              (0,1)│(1,1)│(2,1)
─────────┼───┼─────              ─────┼─────┼─────
     7 │ 8 │ 9              (0,2)│(1,2)│(2,2)
```

Center `(1,1)` first, then cardinal neighbors, then corners.

### Pipeline Flow

1. **Validate** — Grid dimensions 2-5, valid tile type
2. **Compute spiral order** — BFS from center
3. **Create parent asset** — Named `"{prompt (40 chars)} -- Tile Set"` with `type: 'tile-set'`
4. **Create tile_set record** — Config JSON: `{ prompt, aspectRatio, disableStyle, spiralOrder }`
5. **Broadcast `tileset:started`**
6. **Seed tile:**
   - If `seedVariantId` provided: fork it to center position, then call `advanceTileSet()`
   - Otherwise: generate center tile from prompt (no adjacents, `operation: 'generate'`)

### advanceTileSet() Loop

Each call to `advanceTileSet()`:

1. Check status — return if `cancelled` or `failed`
2. Count completed positions — if all done, mark `completed` and broadcast `tileset:completed`
3. Find next unoccupied position in spiral order
4. Call `generateTileAtPosition()` for that position

### Adjacency-Aware Generation

For each tile, the system queries adjacent completed tiles (N, E, S, W) and includes their images as references:

| Direction | Offset |
|-----------|--------|
| N | (x, y-1) |
| E | (x+1, y) |
| S | (x, y+1) |
| W | (x-1, y) |

- **With adjacents:** `operation: 'derive'` — reference images enforce edge matching
- **Without adjacents (seed):** `operation: 'generate'` — prompt instructs extensible edges

### Prompt Structure

With adjacent tiles:

```
[Style: {styleDescription}]

Create an isometric {tileType} game tile for a seamless tile map.
Theme: {userPrompt}

The following reference images are adjacent tiles that this new tile
must connect to seamlessly:
Image 1: tile to the {direction}
Image 2: tile to the {direction}

CRITICAL: The edges facing these adjacent tiles must match perfectly
-- same ground level, same terrain features, same color palette at
the boundary. The transition should be invisible.

- Consistent isometric perspective (standard 2:1 ratio)
- Clean edges suitable for seamless tiling
- {tileType}-appropriate content
```

Seed tile (no adjacents):

```
This is the seed tile. It should have edges that are designed to be
extended in all four cardinal directions.
```

---

## Domain Types

### RotationSet

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier |
| `asset_id` | `string` | Asset created for this set |
| `source_variant_id` | `string` | Original variant used as seed |
| `config` | `string` | JSON: `{ type, subjectDescription?, aspectRatio?, disableStyle? }` |
| `status` | `RotationSetStatus` | `pending \| generating \| completed \| failed \| cancelled` |
| `current_step` | `number` | Current generation step |
| `total_steps` | `number` | Total directions in config |
| `error_message` | `string \| null` | Error details on failure |
| `created_by` | `string` | User ID |
| `created_at` | `number` | Unix timestamp |
| `updated_at` | `number` | Unix timestamp |

### RotationView

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier |
| `rotation_set_id` | `string` | Parent rotation set |
| `variant_id` | `string` | Generated variant |
| `direction` | `string` | Direction label (e.g., `'N'`, `'front'`) |
| `step_index` | `number` | Order in generation sequence |
| `created_at` | `number` | Unix timestamp |

### TileSet

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier |
| `asset_id` | `string` | Asset created for this set |
| `tile_type` | `TileType` | `terrain \| building \| decoration \| custom` |
| `grid_width` | `number` | Grid columns (2-5) |
| `grid_height` | `number` | Grid rows (2-5) |
| `status` | `TileSetStatus` | `pending \| generating \| completed \| failed \| cancelled` |
| `seed_variant_id` | `string \| null` | Optional seed variant |
| `config` | `string` | JSON: `{ prompt, aspectRatio?, disableStyle?, spiralOrder }` |
| `current_step` | `number` | Current generation step |
| `total_steps` | `number` | Total tiles (`gridWidth * gridHeight`) |
| `error_message` | `string \| null` | Error details on failure |
| `created_by` | `string` | User ID |
| `created_at` | `number` | Unix timestamp |
| `updated_at` | `number` | Unix timestamp |

### TilePosition

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier |
| `tile_set_id` | `string` | Parent tile set |
| `variant_id` | `string` | Generated variant |
| `grid_x` | `number` | Column position |
| `grid_y` | `number` | Row position |
| `created_at` | `number` | Unix timestamp |

---

## WebSocket Messages

### Client → Server

#### Rotation

| Message | Fields | Description |
|---------|--------|-------------|
| `rotation:request` | `requestId`, `sourceVariantId`, `config`, `subjectDescription?`, `aspectRatio?`, `disableStyle?` | Start rotation generation |
| `rotation:cancel` | `rotationSetId` | Cancel in-progress rotation |

#### Tile Sets

| Message | Fields | Description |
|---------|--------|-------------|
| `tileset:request` | `requestId`, `tileType`, `gridWidth`, `gridHeight`, `prompt`, `seedVariantId?`, `aspectRatio?`, `disableStyle?` | Start tile set generation |
| `tileset:cancel` | `tileSetId` | Cancel in-progress tile set |
| `tileset:retry_tile` | `tileSetId`, `gridX`, `gridY` | Retry a single failed tile position |
| `tileset:refine_edges` | `tileSetId` | Refine all tile edges for seamless blending |
| `tileset:refine_tile` | `tileSetId`, `gridX`, `gridY` | Refine edges of a single tile |

### Server → Client

#### Rotation

| Message | Fields | Description |
|---------|--------|-------------|
| `rotation:started` | `requestId`, `rotationSetId`, `assetId`, `totalSteps`, `directions[]` | Rotation pipeline started |
| `rotation:step_completed` | `rotationSetId`, `direction`, `variantId`, `step`, `total` | One direction finished |
| `rotation:completed` | `rotationSetId`, `views[]` | All directions finished |
| `rotation:failed` | `rotationSetId`, `error`, `failedStep` | Generation failed at step |
| `rotation:cancelled` | `rotationSetId` | Rotation cancelled |

#### Tile Sets

| Message | Fields | Description |
|---------|--------|-------------|
| `tileset:started` | `requestId`, `tileSetId`, `assetId`, `gridWidth`, `gridHeight`, `totalTiles` | Tile set pipeline started |
| `tileset:tile_completed` | `tileSetId`, `variantId`, `gridX`, `gridY`, `step`, `total` | One tile finished |
| `tileset:completed` | `tileSetId`, `positions[]` | All tiles finished |
| `tileset:failed` | `tileSetId`, `error`, `failedStep` | Generation failed at step |
| `tileset:cancelled` | `tileSetId` | Tile set cancelled |

#### Sync State

Rotation and tile set data is included in `sync:state`:

```typescript
{
  type: 'sync:state',
  assets: Asset[],
  variants: Variant[],
  lineage: Lineage[],
  presence: UserPresence[],
  rotationSets?: RotationSet[],
  rotationViews?: RotationView[],
  tileSets?: TileSet[],
  tilePositions?: TilePosition[],
}
```

---

## Pipeline Lifecycle

### Completion Hook

`GenerationController.httpCompleteVariant()` drives both pipelines:

```typescript
// After variant completes successfully:
const rotView = await this.repo.getRotationViewByVariant(data.variantId);
if (rotView && this.rotationCtrl) {
  await this.rotationCtrl.advanceRotation(rotView.rotation_set_id);
}

const tilePos = await this.repo.getTilePositionByVariant(data.variantId);
if (tilePos && this.tileCtrl) {
  await this.tileCtrl.advanceTileSet(tilePos.tile_set_id);
}
```

### Failure Hook

`GenerationController.httpFailVariant()` marks the pipeline as failed and broadcasts:

```typescript
// After variant fails:
const rotView = await this.repo.getRotationViewByVariant(data.variantId);
if (rotView) {
  await this.repo.failRotationSet(rotView.rotation_set_id, data.error);
  this.broadcast({ type: 'rotation:failed', ... });
}

const tilePos = await this.repo.getTilePositionByVariant(data.variantId);
if (tilePos) {
  await this.repo.failTileSet(tilePos.tile_set_id, data.error);
  this.broadcast({ type: 'tileset:failed', ... });
}
```

Hook errors are caught and logged but do not fail the variant completion itself.

### Reference Limits

Both pipelines share the `capRefs()` utility to stay within Gemini's image limit:

- **Max total references:** 14
- Style images consume part of the budget
- Source/seed key is always preserved
- Most recent views/tiles fill the remaining budget

---

## Error Handling & Cancellation

### Workflow Failure

If a `GenerationWorkflow` fails for any step:
1. The variant is marked `failed`
2. The failure hook marks the entire set as `failed`
3. `rotation:failed` or `tileset:failed` is broadcast with `error` and `failedStep`
4. No further steps are triggered

### Cancellation

When a user sends `rotation:cancel` or `tileset:cancel`:
1. The set status is updated to `cancelled`
2. `rotation:cancelled` or `tileset:cancelled` is broadcast
3. `advanceRotation()` / `advanceTileSet()` checks status at the top and returns early
4. Any in-flight workflow will complete but the hook will not advance further

Both cancel operations require **editor** role.

---

## References

**Backend:**
- `src/backend/durable-objects/space/controllers/RotationController.ts` — Rotation pipeline
- `src/backend/durable-objects/space/controllers/TileController.ts` — Tile set pipeline
- `src/backend/durable-objects/space/controllers/GenerationController.ts` — Completion hooks
- `src/backend/durable-objects/space/generation/spiralOrder.ts` — BFS spiral algorithm
- `src/backend/durable-objects/space/generation/refLimits.ts` — Reference capping
- `src/backend/durable-objects/space/types.ts` — Type definitions
- `src/backend/durable-objects/space/queries.ts` — SQL queries

**Frontend:**
- `src/frontend/components/RotationPanel/RotationPanel.tsx` — Rotation setup and progress UI
- `src/frontend/components/TileSetPanel/TileSetPanel.tsx` — Tile set setup and progress UI
- `src/frontend/components/TileGrid/TileGrid.tsx` — Assembled tile grid view
- `src/frontend/hooks/useSpaceWebSocket.ts` — WebSocket types and handlers
