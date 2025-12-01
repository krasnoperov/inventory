# Inventory Forge: Core Concepts

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

Tracks how variants relate to each other (see `RELATIONSHIPS.md` for details).

- `derived` — Single-source refinement
- `composed` — Multi-source composition
- `spawned` — Fork/copy to new asset

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

The operation is determined by slot count, prompt presence, and destination:

| Slots | Has Prompt | Destination | Operation | Description |
|-------|------------|-------------|-----------|-------------|
| 0 | Yes | New | **Generate** | Create from scratch |
| 1 | No | New | **Fork** | Copy asset without changes |
| 1 | Yes | New | **Create** | Transform into new asset |
| 1 | Yes | Existing | **Refine** | Add variant to existing asset |
| 2+ | Yes | Any | **Combine** | Merge multiple sources |

### Slot Behavior

- **Capacity:** Maximum 14 slots (Gemini limit)
- From Catalog: adds asset's **active variant**
- From Detail: adds **specific variant**

### Destination

- **Current** — Add variant to first slot's asset
- **New** — Create new asset (inherits parent from first reference)

---

## Actions

### Variant Actions (Asset Detail)

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

- `RELATIONSHIPS.md` — Asset hierarchy vs variant lineage details
- `src/frontend/components/ForgeTray/` — Tray implementation
- `src/frontend/pages/SpacePage.tsx` — Catalog view
- `src/frontend/pages/AssetDetailPage.tsx` — Variant management
