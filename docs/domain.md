# Domain Model

Graphical asset management for game development. Users build collections of **Assets** and iterate through AI-powered generation and refinement.

---

## Design Principles

1. **Assets are the primary unit** — Users work with Assets, not raw images
2. **Variants are internal** — Multiple versions exist within an Asset, but only the active variant is visible in catalog
3. **Forge Tray is the workspace** — Always-visible bar for combining and transforming assets
4. **Destination-first workflow** — Users define where results go BEFORE generation

---

## Core Entities

### Asset

A named catalog entry representing a conceptual thing (character, item, scene, style reference).

- **Type** describes what it represents: `character`, `item`, `scene`, `sprite-sheet`, `style-sheet`, `reference`, `tile-set`, `animation` (unconstrained string — additional types can be added freely)
- **Media kind** describes the stored output medium: `image`, `audio`, or `video`
- **Hierarchy** via `parent_asset_id` — assets can nest under other assets
- **Active variant** — one variant represents the asset in catalog view
- Users select Assets (not variants) when composing

### Variant

A media version belonging to an Asset. Variants are internal — visible only in Asset Detail view.

- Multiple variants per asset enable exploration/iteration
- Each variant has the same **Media kind** as its asset
- **Starred** variants mark important iterations
- **Recipe** stores generation parameters for reproducibility

### Media Kind Contract

`media_kind` is the stable medium discriminator for assets and variants. It is intentionally separate from asset `type`: `type` is user-editable catalog taxonomy, while `media_kind` controls which generation, preview, upload, and export paths may handle the stored artifact.

| Value | Meaning | Current production path |
|-------|---------|-------------------------|
| `image` | Still image or image-derived visual output | Fully supported by upload, Gemini image generation, thumbnails, CLI inspection, and website display |
| `audio` | Audio output | Supported by authenticated upload/download and CLI inspection; website-controlled generation is available when the fake audio provider is enabled |
| `video` | Video output | Supported by authenticated upload/download and CLI inspection; generation is reserved for future video providers, including Google video work |

Contract invariants:

- `image` is the default when a caller omits `mediaKind` or a legacy row is migrated.
- Assets are homogeneous: every variant under an asset must use the asset's `media_kind`.
- Creating a variant for an existing asset inherits the asset media kind unless the request explicitly supplies the same kind; mismatches are rejected.
- Forking copies the source variant's media kind into the new asset and copied variant unless the request explicitly supplies the same kind; mismatches are rejected.
- New asset generation, batch generation, and upload may set `mediaKind` up front; the created asset, placeholder/completed variants, stored recipe, workflow input, WebSocket broadcasts, export payloads, and CLI/API inspection must preserve it.
- Uploads create an `uploading` placeholder before the R2 write and complete the same variant after storage succeeds. Image uploads store canonical media at `images/{spaceId}/{variantId}.{ext}` and populate `image_key` plus `thumb_key`; audio/video uploads store canonical media at `media/{spaceId}/{variantId}.{ext}` and leave legacy image keys empty.
- `media_kind` does not select a provider by itself. Audio generation enters through the website-controlled SpaceDO workflow lifecycle and currently requires the fake audio provider; future production audio and Google video providers should use the same lifecycle, set `mediaKind` explicitly, and choose the capable provider/model through generation provider/model fields.
- CLI generation commands are currently image-only controller commands. Future CLI audio/video support should call the website API/WebSocket flow instead of creating local-only media records.
- Variants expose `media_key` as the canonical primary artifact key plus basic media metadata. Image flows still populate `image_key` and `thumb_key` for existing artifact and preview consumers.
- Authenticated API clients should retrieve canonical artifacts via `GET /api/spaces/:spaceId/variants/:variantId/media`, not by dereferencing raw R2 keys. That route resolves `media_key` with `image_key` as a legacy fallback, returns private immutable responses, and supports range requests for the media artifact. Direct `/api/images/*` reads are legacy image/style/thumb only; generic `media/...` keys must go through the variant media route. A `poster_key` artifact uses the sibling `/poster` endpoint when present.
- Audio variants may attach sidecar artifacts for transcripts, word timings, and render metadata. Sidecars are stored under `sidecars/{spaceId}/{variantId}/...`, are ref-counted with the variant, and are served after the same auth checks through `/transcript`, `/word-timings`, and `/render-metadata` sibling endpoints.

### Lineage

Tracks how variants relate to each other.

- `derived` — Created from reference(s) as inspiration
- `refined` — Refinement of existing asset
- `forked` — Fork/copy to new asset

---

## Two Relationship Systems

```
┌─────────────────────────────────────────────────────────────────┐
│                    ASSET HIERARCHY                               │
│                 (Organizational, Mutable)                        │
│                                                                 │
│    Character A                    Scene B                        │
│        │                             │                           │
│    ┌───┴───┐                     ┌───┴───┐                       │
│   Head   Body                 Props    Background                │
│                                                                 │
│  Users CAN rearrange via drag-to-reparent                       │
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

### Asset Hierarchy

Organizational structure for grouping related assets into logical trees.

| Property | Value |
|----------|-------|
| Mutable | Yes - users can rearrange |
| Cycle prevention | Yes - backend validates |
| Cascade delete | No - orphans children (SET NULL) |

### Variant Lineage

Immutable generation history for audit trail and reproducibility.

| Property | Value |
|----------|-------|
| Mutable | No - history is immutable |
| Severable | Yes - can hide from display |
| Cross-asset | Yes - forked lineage spans assets |

### How They Interact

Fork/Spawn creates BOTH relationships:

```
Source Asset                    New Asset (forked)
┌──────────────┐               ┌──────────────┐
│   Asset A    │──(parent)────▶│   Asset B    │  Asset Hierarchy
│  ┌────────┐  │               │  ┌────────┐  │
│  │ Var v1 │──┼──(forked)────▶│  │ Var v2 │  │  Variant Lineage
│  └────────┘  │               │  └────────┘  │
└──────────────┘               └──────────────┘
```

- Changing asset hierarchy does NOT affect variant lineage
- Deleting an asset orphans children but cascades variant deletion

---

## UI Views

| View | Shows | Purpose |
|------|-------|---------|
| **Space (Catalog)** | Assets with active variant thumbnails | Browse, organize, add to tray |
| **Asset Detail** | All variants of one asset | Manage variants, compare iterations |
| **Asset Canvas** | Asset hierarchy as DAG | Visualize parent-child relationships |
| **Variant Canvas** | Variant lineage graph | Visualize generation history |

---

## Forge Tray

The central workspace for all generation operations. A persistent floating bar at the bottom.

### Operation Logic

| Slots | Has Prompt | Destination | Operation |
|-------|------------|-------------|-----------|
| 0 | Yes | New | **Generate** — Create from scratch |
| 1 | No | New | **Fork** — Copy asset without changes |
| 1+ | Yes | New | **Derive** — Create new asset using references |
| 1+ | Yes | Existing | **Refine** — Add variant to existing asset |

### Slot Behavior

- **Capacity:** Maximum 14 slots (Gemini limit)
- From Catalog: adds asset's **active variant**
- From Detail: adds **specific variant**

### Destination

- **Current** — Add variant to first slot's asset
- **New** — Create new asset (inherits parent from first reference)

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
| **Re-parent** | Move to different parent or root |
| **Delete** | Remove asset and all variants |

---

## References

**Backend:**
- `src/backend/durable-objects/space/controllers/AssetController.ts` — Hierarchy, spawn
- `src/backend/durable-objects/space/controllers/GenerationController.ts` — Derive/compose
- `src/backend/durable-objects/space/controllers/LineageController.ts` — Lineage queries
- `src/backend/durable-objects/space/schema/SchemaManager.ts` — Schema definitions

**Frontend:**
- `src/frontend/components/ForgeTray/` — Tray implementation
- `src/frontend/components/AssetCanvas/` — Asset hierarchy visualization
- `src/frontend/components/VariantCanvas/` — Lineage visualization
- `src/frontend/pages/SpacePage.tsx` — Catalog view
- `src/frontend/pages/AssetDetailPage.tsx` — Variant management
