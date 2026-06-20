# Style Anchoring & Batch Generation

Space-level visual identity and multi-variant generation.

---

## Style Anchoring

Each space can have one **style** — a description and up to 5 reference images that are automatically injected into every generation request. This keeps all assets in a space visually consistent without users repeating style instructions.

### Data Model

```
┌───────────────────────────────────────┐
│              SpaceStyle               │
├───────────────────────────────────────┤
│ id            TEXT PRIMARY KEY        │
│ name          TEXT                    │
│ description   TEXT                    │  ← "Pixel art, 16-bit, vibrant colors"
│ image_keys    TEXT (JSON array)       │  ← R2 keys for reference images
│ enabled       INTEGER (0/1)          │
│ created_by    TEXT                    │
│ created_at    INTEGER                │
│ updated_at    INTEGER                │
└───────────────────────────────────────┘
```

Stored in per-space DO SQLite (same as assets, variants, lineage).

### How Injection Works

When `VariantFactory` creates a variant (generate, derive, refine, or batch), it handles style injection:

1. Resolve `stylePresetId` when provided, otherwise the default asset-backed style preset
2. If ad hoc `styleVariantIds` are provided, resolve those completed image variants as style inputs
3. If no asset-backed style applies, fall back to the legacy active `space_styles` row
4. If no style exists, `enabled = 0`, or `disableStyle = true` → skip style image inputs
5. **Prompt**: Prepend `[Style: <stylePrompt or description>]\n\n` to the user's prompt
6. **Images**: Prepend style image keys before user reference images in `sourceImageKeys`
7. Record exact style preset, collection, style prompt, style reference variant IDs, and image keys in the recipe
8. Create `space_relations` rows from each style reference variant to the generated variant with `relation_type = 'style_reference_for'`
9. If `disableStyle` was set, record `styleOverride: true` instead

```
User prompt:    "A brave knight"
Style:          "Pixel art, 16-bit, vibrant colors"
─────────────────────────────────────────
Injected prompt: "[Style: Pixel art, 16-bit, vibrant colors]\n\nA brave knight"
```

Image ordering in `sourceImageKeys`:
```
[ style_ref_1, style_ref_2, user_ref_1, user_ref_2, ... ]
  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^^^^^^^^^^^^^^
  Style images (first)          User references (after)
```

### Reference Count Limits

Image generation uses the selected model's exact reference limit: Pro
(`gemini-3-pro-image-preview`) accepts up to 14 reference images, while Flash
(`gemini-2.5-flash-image`) accepts 1. If `styleImages + userImages` would
exceed the selected image model's limit, style images are **skipped**
(description is still prepended). This prevents style from breaking generation
when users provide many references.

Video generation uses Veo's 3-image limit. User references are kept first and
capped to 3; style images are prepended only if budget remains. Any prepended
style image switches the Veo request from image-to-video or first/last-frame
mode into `reference-images` mode with style images typed as provider `STYLE`
references. See [model-and-parameter-selection.md](./model-and-parameter-selection.md)
for the exact provider-reference semantics.

### Frontend

The Forge Tray slot limit mirrors the active provider budget: selected image
model limit minus active style images for images, and Veo's 3-image limit minus
active style images for video. This is enforced both in the UI and in
`forgeTrayStore.maxSlots`.

### disableStyle

Users can opt out of style for a specific generation by setting `disableStyle: true` in the request. The recipe records `styleOverride: true` so retries preserve the override.

---

## CLI Style Libraries

The CLI manages the asset-backed style model through the same authenticated REST
routes used by the web UI:

```bash
makefx styles references
makefx styles collections create "Painterly refs" --refs asset_123,variant_456
makefx styles presets create "Painterly" --collection collection_123 --prompt "Painterly adventure game"
makefx generate "A market background" --style-preset Painterly --name "Market" --type scene -o market.png
```

`styles collections` creates normal Space collections and `style_ref` collection
items. Asset IDs are pinned to their current active variants; variant IDs are
stored directly. `styles presets` creates, updates, enables, disables, and
deletes named style presets that point to those collections. Generation commands
resolve `--style-preset <id-or-name>` to a preset ID before sending the
WebSocket generation request, and `--style-preset` is mutually exclusive with
`--no-style`.

The CLI does not call the legacy `space_styles` singleton or upload raw hidden
style images for these asset-backed workflows.

---

## Style CRUD

### WebSocket Messages

| Direction | Message | Fields | Description |
|-----------|---------|--------|-------------|
| C → S | `style:get` | — | Request current style |
| C → S | `style:set` | `description`, `imageKeys[]`, `name?`, `enabled?` | Create or update style |
| C → S | `style:delete` | — | Delete style |
| C → S | `style:toggle` | `enabled: boolean` | Enable/disable |
| S → C | `style:state` | `style` (or null) | Current style (unicast to requester) |
| S → C | `style:updated` | `style` | Style created/updated (broadcast) |
| S → C | `style:deleted` | — | Style deleted (broadcast) |

All mutations require **editor** or **owner** role.

### Style Image Upload

```
POST /api/spaces/:id/style-images
Content-Type: multipart/form-data
Body: file=<image>

Response: { success: true, imageKey: "styles/<spaceId>/<uuid>.png" }
```

Images are stored in R2 under `styles/<spaceId>/`. A thumbnail is also generated at `styles/<spaceId>/<uuid>_thumb.webp`. The returned `imageKey` is then sent to the DO via `style:set` to associate it with the style.

---

## Batch Generation

Create multiple variants or assets in a single request. References are resolved once, style is injected once, then N placeholders are created and N workflows triggered in parallel.

### Modes

| Mode | Assets Created | Variants per Asset | Use Case |
|------|---------------|--------------------|----------|
| **explore** | 1 | N | Try N variations of the same concept |
| **set** | N | 1 each | Generate a collection (e.g., 4 different potions) |

### Flow

```
Client                          SpaceDO                         Workflows
  │                                │                                │
  │── batch:request ──────────────▶│                                │
  │   (count=4, mode=explore)      │                                │
  │                                │─ resolve refs (once)           │
  │                                │─ inject style (once)           │
  │                                │─ create 1 asset                │
  │                                │─ create 4 placeholder variants │
  │◀── batch:started ─────────────│                                │
  │◀── asset:created ─────────────│                                │
  │◀── variant:created (×4) ──────│                                │
  │                                │── trigger 4 workflows ────────▶│
  │                                │        (parallel)              │
  │◀── variant:updated (×4) ──────│◀── callback (×4) ─────────────│
```

### WebSocket Messages

| Direction | Message | Fields |
|-----------|---------|--------|
| C → S | `batch:request` | `requestId`, `name`, `assetType`, `mediaKind?`, `prompt`, `count`, `mode`, `aspectRatio?`, `referenceVariantIds?`, `referenceAssetIds?`, `disableStyle?` |
| S → C | `batch:started` | `requestId`, `batchId`, `results[]` (assetId, variantId pairs) |
| S → C | `batch:error` | `requestId`, `error`, `code` |

Each variant completes independently via `variant:updated` broadcasts.

### Naming

- **Explore mode**: Single asset keeps the provided name
- **Set mode**: Assets are named `<name> #1`, `<name> #2`, etc.

### Lineage

Each variant in a batch gets its own lineage records to reference sources. All variants in a batch share the same `batchId` stored on the variant record.

---

## Recipe

Every variant stores a `recipe` JSON blob for reproducibility and retry:

```typescript
interface GenerationRecipe {
  prompt: string;              // Final prompt (with style prefix if applied)
  assetType: string;
  mediaKind?: 'image' | 'audio' | 'video';
  aspectRatio?: string;
  sourceImageKeys?: string[];  // Style images + user references (combined)
  parentVariantIds?: string[]; // For retry support
  operation: 'generate' | 'derive' | 'refine';
  styleId?: string;            // Legacy singleton style that was active at generation time
  stylePresetId?: string;      // Asset-backed style preset selected at generation time
  styleCollectionId?: string;  // Collection backing the selected style preset
  styleReferenceVariantIds?: string[]; // Exact style variants used as provider inputs
  styleReferenceImageKeys?: string[];  // Exact style image keys sent to the provider
  stylePrompt?: string;        // Style prompt from the selected asset-backed preset
  styleOverride?: boolean;     // True if style was explicitly disabled
  model?: string;              // Gemini model name
  imageSize?: string;          // Output resolution (1K, 2K, 4K)
  modelProvider?: string;      // Model provider identifier
}
```

---

## References

**Backend:**
- `src/backend/durable-objects/space/controllers/StyleController.ts` — Style CRUD
- `src/backend/durable-objects/space/generation/VariantFactory.ts` — Style injection, batch creation
- `src/backend/routes/upload.ts` — Style image upload endpoint
- `src/backend/durable-objects/space/types.ts` — `SpaceStyle` type

**Frontend:**
- `src/frontend/components/ForgeTray/StylePanel.tsx` — Style management UI
- `src/frontend/stores/styleStore.ts` — Style Zustand store
- `src/frontend/stores/forgeTrayStore.ts` — Dynamic `maxSlots`
- `src/frontend/hooks/useSpaceWebSocket.ts` — Style + batch WS messages

**Tests:**
- `src/backend/durable-objects/space/controllers/StyleController.test.ts`
- `src/backend/durable-objects/space/generation/VariantFactory.style.test.ts`
