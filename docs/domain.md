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

- **Type** describes what it represents: `character`, `item`, `scene`, `sprite-sheet`, `style-sheet`, `reference`
- **Hierarchy** via `parent_asset_id` — assets can nest under other assets
- **Active variant** — one variant represents the asset in catalog view
- Users select Assets (not variants) when composing

### Variant

An image version belonging to an Asset. Variants are internal — visible only in Asset Detail view.

- Multiple variants per asset enable exploration/iteration
- **Starred** variants mark important iterations
- **Recipe** stores generation parameters for reproducibility

### Lineage

Tracks how variants relate to each other.

- `refined` — Single-source refinement
- `combined` — Multi-source composition
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
| 1 | Yes | New | **Create** — Transform into new asset |
| 1 | Yes | Existing | **Refine** — Add variant to existing asset |
| 2+ | Yes | Any | **Combine** — Merge multiple sources |

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
| **Download** | Save image to local device |
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
