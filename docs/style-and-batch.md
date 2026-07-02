# Style Selection & Batch Generation

Style and batch are part of the asset creation loop. They should help a user
make, compare, choose, and continue assets without exposing a separate
style-management surface.

---

## Style Selection

Generation can select a simple style preset when a Space exposes one:

```bash
makefx generate "A market background" --style-preset Painterly --name "Market" --type scene -o market.png
makefx generate "A neutral prop sheet" --no-style --name "Props" --type prop -o props.png
```

`--style-preset` is mutually exclusive with `--no-style`. Recipes record the
selected preset, style prompt, and exact style reference variants used by the
request so retries can reproduce the same inputs.

Style reference media remains normal Space media. The product should not expose
a separate style library editor in the main app or CLI; style is a generation
option, not a second organizational model.

### How Injection Works

When `VariantFactory` creates a variant, it handles style injection:

1. Resolve `stylePresetId` when provided, otherwise the default enabled style
   preset when available.
2. If no style preset applies or `disableStyle = true`, skip style image inputs.
3. Prepend the style prompt to the user's prompt when a style prompt exists.
4. Add resolved style image keys before user reference image keys when the
   selected provider has enough reference-image budget.
5. Record exact style inputs in the recipe.

Image generation uses the selected model's exact reference limit. If style
images plus user references would exceed that limit, style images are skipped
while the style prompt remains in the request.

Video generation uses Veo's tighter image-reference budget. User references stay
first; style images are included only when there is room.

---

## Batch Generation

Batch generation creates multiple variants or assets in one request. References
are resolved once, style is injected once, then placeholders are created and
workflows are triggered in parallel.

### Modes

| Mode | Assets Created | Variants per Asset | Use Case |
|------|----------------|--------------------|----------|
| **explore** | 1 | N | Try N variations of the same concept |
| **set** | N | 1 each | Generate a small related set |

### Flow

```text
Client                          SpaceDO                         Workflows
  |                                |                                |
  |-- batch:request -------------->|                                |
  |                                |-- resolve refs once            |
  |                                |-- inject style once            |
  |                                |-- create placeholders          |
  |<-- batch:started --------------|                                |
  |                                |-- trigger workflows ---------->|
  |<-- variant:updated ------------|<-- callbacks ------------------|
```

### WebSocket Messages

| Direction | Message | Fields |
|-----------|---------|--------|
| C -> S | `batch:request` | `requestId`, `name`, `assetType`, `mediaKind?`, `prompt`, `count`, `mode`, `aspectRatio?`, `referenceVariantIds?`, `referenceAssetIds?`, `disableStyle?` |
| S -> C | `batch:started` | `requestId`, `batchId`, `results[]` |
| S -> C | `batch:error` | `requestId`, `error`, `code` |

Each variant completes independently through normal `variant:updated`
broadcasts.

### Lineage

Each generated variant gets lineage records for the source variants used in that
request. Batch lineage is provenance only; it does not arrange the Space.

---

## Recipe

Every generated variant stores a recipe JSON blob for reproducibility and retry:

```typescript
interface GenerationRecipe {
  prompt: string;
  assetType: string;
  mediaKind?: 'image' | 'audio' | 'video';
  aspectRatio?: string;
  sourceImageKeys?: string[];
  parentVariantIds?: string[];
  operation: 'generate' | 'derive' | 'refine';
  stylePresetId?: string;
  styleReferenceVariantIds?: string[];
  styleReferenceImageKeys?: string[];
  stylePrompt?: string;
  styleOverride?: boolean;
  model?: string;
  imageSize?: string;
  modelProvider?: string;
}
```

---

## References

**Backend:**

- `src/backend/durable-objects/space/generation/VariantFactory.ts` — style injection and batch creation
- `src/backend/durable-objects/space/controllers/GenerationController.ts` — generation and batch requests
- `src/backend/durable-objects/space/repository/SpaceRepository.ts` — preset resolution and recipe persistence

**Frontend:**

- `src/frontend/components/ForgeTray/ForgeTray.tsx` — mode, option, prompt, and batch controls
- `src/frontend/stores/forgeTrayStore.ts` — tray state and slot budget
