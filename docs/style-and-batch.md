# Style Anchoring & Batch Generation

Space-level visual identity and multi-variant generation.

---

## Style Anchoring

Each space can have named **style presets** backed by normal Space inventory.
A preset contains a style prompt and points at a `style_refs` collection whose
items resolve to completed image variants. The default enabled preset is
automatically injected into generation requests unless a request selects another
preset, selects ad hoc style variants, or disables style.

### Data Model

Style is modeled with normal Space tables:

- `assets` and `variants` hold style reference media.
- `space_collections` with `kind = 'style_refs'` group reusable reference sets.
- `collection_items` with `role = 'style_ref'` pin assets or exact variants.
- `style_presets` name a style prompt, collection, enabled flag, and default flag.
- `space_relations` records generated usage with `relation_type = 'style_reference_for'`.

The legacy `space_styles` table is migration-only compatibility. On Durable
Object startup, `backfillLegacySpaceStyle()` converts an existing row into
style reference assets, a `style_refs` collection, and a style preset. New
requests do not read `space_styles` for style injection.

### How Injection Works

When `VariantFactory` creates a variant (generate, derive, refine, or batch), it handles style injection:

1. Resolve `stylePresetId` when provided, otherwise the default asset-backed style preset
2. If ad hoc `styleVariantIds` are provided, resolve those completed image variants as style inputs
3. If no asset-backed style applies or `disableStyle = true` → skip style image inputs
4. **Prompt**: Prepend `[Style: <stylePrompt>]\n\n` to the user's prompt when a style prompt exists
5. **Images**: Prepend style image keys before user reference images in `sourceImageKeys`
6. Record exact style preset, collection, style prompt, style reference variant IDs, and image keys in the recipe
7. Create `space_relations` rows from each style reference variant to the generated variant with `relation_type = 'style_reference_for'`
8. If `disableStyle` was set, record `styleOverride: true` instead

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
style images.

---

## Style Preset CRUD

### WebSocket Messages

| Direction | Message | Fields | Description |
|-----------|---------|--------|-------------|
| C → S | `style_preset:create` | `id?`, `name`, `description?`, `stylePrompt?`, `collectionId?`, `enabled?`, `isDefault?` | Create a style preset |
| C → S | `style_preset:update` | `presetId`, `changes` | Update a style preset |
| C → S | `style_preset:delete` | `presetId` | Delete a style preset |
| S → C | `style_preset:created` | `preset` | Preset created |
| S → C | `style_preset:updated` | `preset` | Preset updated |
| S → C | `style_preset:deleted` | `presetId` | Preset deleted |

All mutations require **editor** or **owner** role.

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
- `src/backend/durable-objects/space/controllers/StylePresetController.ts` — Style preset CRUD
- `src/backend/durable-objects/space/repository/SpaceRepository.ts` — Style collection/preset resolution and legacy backfill
- `src/backend/durable-objects/space/generation/VariantFactory.ts` — Style injection, batch creation
- `src/backend/durable-objects/space/types.ts` — Style preset, collection, and relation types

**Frontend:**
- `src/frontend/components/ForgeTray/StylePanel.tsx` — Style management UI
- `src/frontend/stores/forgeTrayStore.ts` — Dynamic `maxSlots`
- `src/frontend/hooks/useSpaceWebSocket.ts` — Style preset + batch WS messages

**Tests:**
- `src/backend/durable-objects/space/controllers/StylePresetController.test.ts`
- `src/backend/durable-objects/space/repository/spaceOrganization.test.ts`
- `src/backend/durable-objects/space/generation/VariantFactory.style.test.ts`
