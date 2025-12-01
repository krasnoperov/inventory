# Inventory Forge: Relationship System

Two distinct relationship systems: **Asset Hierarchy** (organizational) and **Variant Lineage** (generational history).

---

## Overview

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

---

## Asset Hierarchy

Organizational structure for grouping related assets into logical trees.

**Storage:** `assets.parent_asset_id` column

| Property | Value |
|----------|-------|
| Mutable | Yes - users can rearrange |
| Cycle prevention | Yes - backend validates |
| Cascade delete | No - orphans children (SET NULL) |
| UI | Drag edges in AssetCanvas |

**Operations:**
- `asset:create { parentAssetId }` - Create with parent
- `asset:update { parentAssetId }` - Reparent
- `asset:spawn { parentAssetId }` - Fork to child

---

## Variant Lineage

Immutable generation history for audit trail and reproducibility.

**Storage:** `lineage` table

| Type | Description | Created By |
|------|-------------|------------|
| `derived` | Single source refined/edited | `refine:request` |
| `composed` | Multiple sources combined | `generate:request` with refs |
| `spawned` | Copied to new asset (fork) | `asset:spawn` |

| Property | Value |
|----------|-------|
| Mutable | No - history is immutable |
| Severable | Yes - can hide from display |
| Cross-asset | Yes - spawned lineage spans assets |
| Cascade delete | Yes - deleting variant removes lineage |

**Operations:**
- `refine:request` - Creates `derived` lineage (1 parent)
- `generate:request { referenceAssetIds }` - Creates `composed` lineage (N parents)
- `asset:spawn` - Creates `spawned` lineage (1 parent)
- `lineage:sever` - Sets `severed=1` (hides without deleting)

---

## How They Interact

### Fork/Spawn Operation

Creates BOTH relationships:

1. **Asset hierarchy:** New asset optionally placed as child of source asset
2. **Variant lineage:** `spawned` relation from source variant to new variant

```
Source Asset                    New Asset (spawned)
┌──────────────┐               ┌──────────────┐
│   Asset A    │──(parent)────▶│   Asset B    │  Asset Hierarchy
│              │               │              │
│  ┌────────┐  │               │  ┌────────┐  │
│  │ Var v1 │──┼──(spawned)───▶│  │ Var v2 │  │  Variant Lineage
│  └────────┘  │               │  └────────┘  │
└──────────────┘               └──────────────┘
```

### Independence

- Changing asset hierarchy does NOT affect variant lineage
- Deleting an asset orphans children but cascades variant deletion
- Severing lineage hides visual connection but preserves data

---

## References

**Backend:**
- `src/backend/durable-objects/space/controllers/AssetController.ts` - Hierarchy ops, spawn
- `src/backend/durable-objects/space/controllers/GenerationController.ts` - Derive/compose lineage
- `src/backend/durable-objects/space/controllers/LineageController.ts` - Lineage queries, sever
- `src/backend/durable-objects/space/asset/hierarchy.ts` - Cycle detection

**Frontend:**
- `src/frontend/components/AssetCanvas/` - Asset hierarchy visualization
- `src/frontend/components/VariantCanvas/` - Lineage visualization with ghost nodes
- `src/frontend/hooks/useForgeOperations.ts` - Fork/generate/refine operations

**Schema:**
- `src/backend/durable-objects/space/schema/SchemaManager.ts` - DDL definitions
