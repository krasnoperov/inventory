# Domain Model

Graphical asset management for game development. Users build a visual
**Space** of **Assets**, compare hidden **Variants** inside each asset, keep
immutable **Lineage** for provenance, and continue promising assets through
AI-powered generation, refinement, import, audio, and video.

---

## Design Principles

1. **Assets are the primary unit** — Users work with Assets, not raw images
2. **Variants are internal** — Multiple versions exist within an Asset, but only the active variant is visible in catalog
3. **Space is the organizing surface** — Users arrange assets visually instead of managing table-like relationship forms
4. **Forge Tray is the workspace** — Always-visible bar for combining and transforming assets
5. **Destination-first workflow** — Users choose whether a result creates a new asset or a new variant before generation

---

## Core Entities

### Asset

A named catalog entry representing a conceptual thing (character, item, scene, style reference).

- **Type** describes what it represents: `character`, `item`, `scene`, `sprite-sheet`, `style-sheet`, `reference`, `animation` (unconstrained string — additional types can be added freely)
- **Media kind** describes the stored output medium: `image`, `audio`, or `video`
- **Space position/grouping** organizes assets without changing generation lineage
- **Active variant** — one variant represents the asset in catalog view
- Users select Assets (not variants) when continuing work from Space

### Variant

A media version belonging to an Asset. Variants are internal — visible only in Asset Detail view.

- Multiple variants per asset enable exploration/iteration
- Each variant has the same **Media kind** as its asset
- **Starred** variants mark important iterations
- **Recipe** stores generation parameters for reproducibility

### Space Organization

Space organization is visual. Users arrange assets into lightweight canvas
areas such as characters, props, backgrounds, concepts, or final candidates.

- Organization helps users scan, compare, and continue assets.
- Organization does not create or modify generation lineage.
- Exact variant comparison happens in Details, scoped to one asset.

### Style References And Presets

Style references are normal image assets in the Space.

- Generation can use a named preset such as `Painterly` or `Low-poly UI`.
- The recipe records the exact preset and reference variants used.
- Style reference media remains visible as ordinary assets and variants; the
  product model has no separate style-only media store or style management page.

### Media Kind Contract

`media_kind` is the stable medium discriminator for assets and variants. It is intentionally separate from asset `type`: `type` is user-editable catalog taxonomy, while `media_kind` controls which generation, preview, upload, and export paths may handle the stored artifact.

| Value | Meaning | Current production path |
|-------|---------|-------------------------|
| `image` | Still image or image-derived visual output | Fully supported by upload, Gemini image generation, thumbnails, CLI inspection, and website display |
| `audio` | Audio output | Supported by authenticated upload/download, CLI inspection, and CLI website-job generation when a configured audio provider supports the asset type |
| `video` | Video output | Supported by authenticated upload/download and CLI inspection, plus website-controlled Google Veo generation |

Contract invariants:

- `image` is the default when a caller omits `mediaKind` or a legacy row is migrated.
- Assets are homogeneous: every variant under an asset must use the asset's `media_kind`.
- Creating a variant for an existing asset inherits the asset media kind unless the request explicitly supplies the same kind; mismatches are rejected.
- Forking copies the source variant's media kind into the new asset and copied variant unless the request explicitly supplies the same kind; mismatches are rejected.
- New asset generation, batch generation, and upload may set `mediaKind` up front; the created asset, placeholder/completed variants, stored recipe, workflow input, WebSocket broadcasts, export payloads, and CLI/API inspection must preserve it.
- Uploads create an `uploading` placeholder before the R2 write and complete the same variant after storage succeeds. Image uploads store canonical media at `images/{spaceId}/{variantId}.{ext}` and populate `image_key` plus `thumb_key`; audio/video uploads store canonical media at `media/{spaceId}/{variantId}.{ext}` and leave legacy image keys empty.
- `media_kind` does not select a provider by itself. Audio generation enters through the website-controlled SpaceDO workflow lifecycle and uses `INVENTORY_AUDIO_PROVIDER` (`fake` or `elevenlabs`) plus server-side provider secrets/configuration. ElevenLabs remains the default music path; `music` requests may explicitly select Lyria, while `sfx` assets use ElevenLabs sound-effect generation and other audio asset types use ElevenLabs speech/dialogue generation. Video generation uses the same lifecycle, sets `mediaKind: "video"` explicitly, and records the capable Google Veo model, `videoTier`, `videoResolution`, `videoDurationSeconds`, plus `generateAudio` metadata for soundtrack intent.
- CLI image generation commands remain image-only controller commands. CLI audio and video generation use explicit `audio` and `video` subcommands backed by the same website API/WebSocket flow instead of creating local-only media records.
- Variants expose `media_key` as the canonical primary artifact key plus basic media metadata. Image flows still populate `image_key` and `thumb_key` for existing artifact and preview consumers.
- Authenticated API clients should retrieve canonical artifacts via `GET /api/spaces/:spaceId/variants/:variantId/media`, not by dereferencing raw R2 keys. That route resolves `media_key` with `image_key` as a legacy fallback, returns private immutable responses, and supports range requests for the media artifact. Direct `/api/images/*` reads are legacy image/style/thumb only; generic `media/...` keys must go through the variant media route. A `poster_key` artifact uses the sibling `/poster` endpoint when present.
- Audio variants may attach sidecar artifacts for transcripts, word timings, and render metadata. Sidecars are stored under `sidecars/{spaceId}/{variantId}/...`, are ref-counted with the variant, and are served after the same auth checks through `/transcript`, `/word-timings`, and `/render-metadata` sibling endpoints.

### Lineage

Immutable provenance that records how variants were generated, refined, forked,
or imported.

- `derived` — Created from reference(s) as inspiration
- `refined` — Refinement of existing asset
- `forked` — Fork/copy to new asset
- Import records can also include prompt, model, provider, provider metadata,
  generation provenance, and related source images at import time.
- Users do not manually rearrange lineage to organize a Space.

---

## Organization And Provenance

```
┌─────────────────────────────────────────────────────────────────┐
│                      SPACE CANVAS                                 │
│                 (Visual Organization)                             │
│                                                                 │
│    Characters                   Backgrounds                      │
│    ├── Hero                     ├── Market                       │
│    └── Merchant                 └── Kitchen                      │
│                                                                 │
│    Concepts                     Final candidates                 │
│    ├── Potion tests             └── Opening shot                 │
│                                                                 │
│  Users organize assets without mutating lineage                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    VARIANT LINEAGE                               │
│                (Generation History, Immutable)                   │
│                                                                 │
│    v1 (original)                                                │
│        │                                                        │
│    ┌───┴───┐                                                    │
│    │       │                                                    │
│   v2      v3 ─────────────┐                                     │
│ (derived)  (derived)       │                                     │
│    │                       │                                     │
│   v4                      v5 (composed from v3 + external)      │
│                                                                 │
│  Users CANNOT rearrange (audit trail for reproducibility)       │
└─────────────────────────────────────────────────────────────────┘
```

### Space Organization

| Property | Value |
|----------|-------|
| Mutable | Yes - users can rearrange assets |
| Granularity | Assets in Space, variants in Details |
| Purpose | Scan, compare, choose, and continue assets |

### Variant Lineage

Immutable generation history for audit trail and reproducibility.

| Property | Value |
|----------|-------|
| Mutable | No - history is immutable |
| Severable | Yes - can hide from display |
| Cross-asset | Yes - forked lineage spans assets |

### How They Interact

Generation, derive, batch, fork, and upload flows record provenance through
variant lineage. They do not infer asset hierarchy from references or source
variants. User organization is represented visually on the Space canvas.

- Moving assets in Space does NOT affect variant lineage
- Creating lineage does NOT move an asset
- Deleting an asset removes its organization data and cascades variant deletion

---

## UI Views

| View | Shows | Purpose |
|------|-------|---------|
| **Space** | Assets with active variant thumbnails on a canvas | Browse, organize, add to tray |
| **Details** | One asset scoped as a focused canvas with its variants and lineage | Compare iterations, choose active variant, continue |

---

## Forge Tray

The central workspace for all generation operations. A persistent floating bar at the bottom.

### Operation Logic

The code source of truth is `src/shared/mediaOperationMatrix.ts`; Forge Tray,
CLI generation commands, docs, and tests should use the same matrix.

| Slots | Has Prompt | Destination | Operation |
|-------|------------|-------------|-----------|
| 0 | Yes | New | **Generate** — Create from scratch |
| 1 | No | New | **Fork** — Copy asset without changes |
| 1+ | Yes | New | **Derive** — Create new asset using references |
| 1+ | Yes | Existing | **Refine** — Add variant to existing asset |

### Media Operation Matrix

| Forge Tray mode | Output `mediaKind` | Default asset type | Allowed slot media | Batch | Style | CLI generation |
|-----------------|--------------------|--------------------|--------------------|-------|-------|----------------|
| Image | `image` | Inherit first reference, else `character` | `image` | Yes | Yes | Top-level `generate`, `refine`, `derive`, `batch`; refs allowed; writes debug media run manifests with image keyframes |
| Video | `video` | Inherit first reference, else `animation` | `image`, `video` | No | Yes | `video generate`, `video refine`, `video derive`; refs allowed for derive; writes debug single-output media run manifests |
| Speech | `audio` | `speech` | `audio` | Yes | No | `audio speech generate`, `audio speech batch`; refs not supported; writes debug media run manifests |
| Dialogue | `audio` | `dialogue` | `audio` | Yes | No | `audio dialogue generate`, `audio dialogue batch`; use `--input` for multiline scripts |
| Music | `audio` | `music` | `audio` | Yes | No | `audio music generate`, `audio music batch` |
| SFX | `audio` | `sfx` | `audio` | Yes | No | `audio sfx generate`, `audio sfx batch` |

### Slot Behavior

- **Capacity:** Maximum 14 slots (Gemini limit)
- From Catalog: adds asset's **active variant**
- From Detail: adds **specific variant**

### Destination

- **Current** — Add variant to first slot's asset
- **New** — Create new asset without inferring hierarchy from references

---

## Actions

### Variant Actions

| Action | Description |
|--------|-------------|
| **Set as Active** | Make this variant represent the asset in catalog |
| **Star / Unstar** | Mark as important iteration |
| **Add to Tray** | Add this specific variant to Forge Tray |
| **Download** | Save media to local device |
| **Delete** | Remove variant (cannot delete last/active) |

### Asset Actions

| Action | Description |
|--------|-------------|
| **Add to Tray** | Add active variant to Forge Tray |
| **Rename** | Change asset name |
| **Change Type** | Update asset type |
| **Delete** | Remove asset and all variants |

---

## References

**Backend:**
- `src/backend/durable-objects/space/controllers/AssetController.ts` — Asset CRUD and fork
- `src/backend/durable-objects/space/controllers/GenerationController.ts` — Derive/compose
- `src/backend/durable-objects/space/controllers/LineageController.ts` — Lineage queries
- `src/backend/durable-objects/space/schema/SchemaManager.ts` — Schema definitions

**Frontend:**
- `src/frontend/components/ForgeTray/` — Tray implementation
- `src/frontend/components/VariantCanvas/` — Lineage visualization
- `src/frontend/pages/SpacePage.tsx` — Catalog view
- `src/frontend/pages/AssetDetailPage.tsx` — Variant management
