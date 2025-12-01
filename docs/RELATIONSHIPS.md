# Inventory Forge: Relationship System

This document describes the two distinct relationship systems used in Inventory Forge:
**Asset Hierarchy** (organizational) and **Variant Lineage** (generational history).

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

## 1. Asset Hierarchy

### Purpose
Organizational structure for grouping related assets. Users can arrange assets into
logical trees (e.g., a character with its accessories, a scene with its props).

### Storage

**Column:** `assets.parent_asset_id`

```sql
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  ...
  parent_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,  -- NULL = root asset
  ...
);

CREATE INDEX idx_assets_parent ON assets(parent_asset_id);
```

### Characteristics

| Property | Value |
|----------|-------|
| Mutable | Yes - users can rearrange |
| Cycle prevention | Yes - backend validates |
| Cascade delete | No - orphans children (SET NULL) |
| UI | Drag edges in AssetCanvas |

### Operations

| Operation | Method | Creates |
|-----------|--------|---------|
| Set parent on create | `asset:create { parentAssetId }` | Asset with parent |
| Reparent | `asset:update { parentAssetId }` | Updates parent |
| Unparent | `asset:update { parentAssetId: null }` | Makes root asset |
| Fork to child | `asset:spawn { parentAssetId }` | New child asset |

### Cycle Validation

Backend prevents circular hierarchies:

```typescript
// SpaceDO.ts - handleAssetUpdate()
private async wouldCreateCycle(assetId: string, newParentId: string | null): Promise<boolean> {
  if (!newParentId) return false;
  if (assetId === newParentId) return true;  // Self-reference

  // Walk up the tree from proposed parent
  let currentId: string | null = newParentId;
  const visited = new Set<string>();

  while (currentId) {
    if (visited.has(currentId)) break;  // Already visited (shouldn't happen)
    visited.add(currentId);
    if (currentId === assetId) return true;  // Found the asset - cycle!

    const result = await this.ctx.storage.sql.exec(
      'SELECT parent_asset_id FROM assets WHERE id = ?', currentId
    );
    const row = result.toArray()[0];
    currentId = row?.parent_asset_id ?? null;
  }
  return false;
}
```

### UI Rendering (AssetCanvas)

- **Layout:** Dagre algorithm arranges trees top-to-bottom
- **Edges:** Parent → Child with arrow markers
- **Orphans:** Root assets displayed in grid to the right
- **Reparenting:** Drag from source handle to target handle
- **Unparenting:** Select edge, press Delete

---

## 2. Variant Lineage

### Purpose
Immutable generation history tracking how variants were created. Enables:
- Audit trail for AI-generated content
- Reproducibility (recipe + lineage = full history)
- Visual provenance display

### Storage

**Table:** `lineage`

```sql
CREATE TABLE lineage (
  id TEXT PRIMARY KEY,
  parent_variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  child_variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('derived', 'composed', 'spawned')),
  severed INTEGER NOT NULL DEFAULT 0,  -- Can hide without deleting
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_lineage_parent ON lineage(parent_variant_id);
CREATE INDEX idx_lineage_child ON lineage(child_variant_id);
```

### Relation Types

| Type | Description | Visual | Created By |
|------|-------------|--------|------------|
| `derived` | Single source refined/edited | Solid edge | `refine:request` |
| `composed` | Multiple sources combined | Dashed primary edge | `generate:request` with refs |
| `spawned` | Copied to new asset (fork) | Dashed muted edge | `asset:spawn` |

### Characteristics

| Property | Value |
|----------|-------|
| Mutable | No - history is immutable |
| Severable | Yes - can hide from display |
| Cross-asset | Yes - spawned lineage spans assets |
| Cascade delete | Yes - deleting variant removes lineage |

### Operations

| Operation | Method | Creates Lineage |
|-----------|--------|-----------------|
| Refine existing | `refine:request` | `derived` (1 parent) |
| Generate with refs | `generate:request { referenceAssetIds }` | `composed` (N parents) |
| Fork/Spawn | `asset:spawn` | `spawned` (1 parent) |
| Sever display | `lineage:sever` | Sets `severed=1` |

### Lineage Creation Code Locations

**1. Derived lineage** (refine operations):
```typescript
// SpaceDO.ts - handleRefineRequest()
// Creates lineage when refining an existing variant
if (sourceVariantId) {
  await this.createLineage(sourceVariantId, variant.id, 'derived');
}
```

**2. Composed lineage** (multi-reference generation):
```typescript
// SpaceDO.ts - handleGenerateRequest()
// Creates lineage for each reference used in composition
for (const refVariantId of resolvedReferenceVariantIds) {
  await this.createLineage(refVariantId, variant.id, 'composed');
}
```

**3. Spawned lineage** (fork/spawn operations):
```typescript
// SpaceDO.ts - handleAssetSpawn()
// Creates lineage when forking a variant to a new asset
await this.createLineage(sourceVariantId, newVariant.id, 'spawned');
```

### UI Rendering (VariantCanvas)

- **Layout:** Dagre algorithm arranges lineage trees
- **Edge styles:**
  - Derived: Solid gray, "derived" label
  - Composed: Dashed primary color, "composed" label
  - Spawned: Dashed muted, "spawned" label
- **Ghost nodes:** External parent variants from other assets shown as dashed nodes
- **Click ghost:** Navigates to source asset

### Ghost Nodes (Cross-Asset Lineage)

When viewing an asset's VariantCanvas, variants may have parents from other assets
(via `spawned` or cross-asset `composed` lineage). These appear as "ghost nodes":

```typescript
// VariantCanvas.tsx
// Find lineage where child is in this asset but parent is elsewhere
const crossAssetLineage = lineage.filter(l =>
  variantIds.has(l.child_variant_id) &&
  !variantIds.has(l.parent_variant_id) &&
  !l.severed
);

// Create ghost nodes for external parents
for (const lin of crossAssetLineage) {
  const parentVariant = allVariants.find(v => v.id === lin.parent_variant_id);
  const parentAsset = allAssets.find(a => a.id === parentVariant.asset_id);
  // ... create ghost node with parentAsset info
}
```

Ghost node styling:
- Dashed border, reduced opacity
- Shows source asset name instead of variant ID
- Click to navigate to source asset

---

## 3. How They Interact

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

### Relationship Independence

- Changing asset hierarchy does NOT affect variant lineage
- Deleting an asset orphans children (SET NULL) but cascades variant deletion
- Severing lineage hides visual connection but preserves data
- Recipe stores inputs for reproducibility (independent of lineage table)

---

## 4. Validation & Error Handling

### Asset Operations

| Validation | Location | Error |
|------------|----------|-------|
| Cycle detection | `SpaceDO.handleAssetUpdate()` | "Cannot set parent: would create circular hierarchy" |
| Asset exists | `SpaceDO.handleAssetUpdate()` | "Asset not found" |
| Parent exists | `SpaceDO.handleAssetUpdate()` | "Parent asset not found" |

### Lineage Operations

| Validation | Location | Error |
|------------|----------|-------|
| Variant exists | `SpaceDO.createLineage()` | FK constraint |
| Not already linked | `SpaceDO.createLineage()` | Duplicate check |

### Chat Plan Validation

Asset IDs from Chat/Claude are validated before execution:

```typescript
// useToolExecution.ts
case 'generate_asset': {
  // Validate parentAssetId exists
  if (parentAssetId && !allAssets.find(a => a.id === parentAssetId)) {
    return `Parent asset not found: ${parentAssetId}`;
  }

  // Validate all referenceAssetIds exist
  if (referenceAssetIds) {
    const invalidIds = referenceAssetIds.filter(id => !allAssets.find(a => a.id === id));
    if (invalidIds.length > 0) {
      return `Reference asset(s) not found: ${invalidIds.join(', ')}`;
    }
  }
  // ...
}
```

---

## 5. Data Flow Summary

```
User Action                    WebSocket Message              DB Changes
─────────────────────────────────────────────────────────────────────────
Create asset                   asset:create                   INSERT assets
                               { parentAssetId? }

Reparent asset                 asset:update                   UPDATE assets
                               { parentAssetId }              SET parent_asset_id

Generate (no refs)             generate:request               INSERT assets
                               { prompt }                     INSERT variants
                                                              (no lineage)

Generate (with refs)           generate:request               INSERT assets
                               { referenceAssetIds }          INSERT variants
                                                              INSERT lineage (composed) ×N

Refine existing                refine:request                 INSERT variants
                               { assetId, sourceVariantId? }  INSERT lineage (derived)

Fork/Spawn                     asset:spawn                    INSERT assets
                               { sourceVariantId }            INSERT variants
                                                              INSERT lineage (spawned)

Sever lineage                  lineage:sever                  UPDATE lineage
                               { lineageId }                  SET severed = 1
```

---

## 6. Related Files

### Backend
- `src/backend/durable-objects/SpaceDO.ts` - All relationship CRUD operations
- `src/backend/workflows/types.ts` - Message type definitions

### Frontend
- `src/frontend/hooks/useSpaceWebSocket.ts` - Asset/Lineage types, update handlers
- `src/frontend/hooks/useForgeOperations.ts` - Fork/generate/refine operations
- `src/frontend/components/AssetCanvas/AssetCanvas.tsx` - Asset hierarchy visualization
- `src/frontend/components/VariantCanvas/VariantCanvas.tsx` - Lineage visualization
- `src/frontend/components/ChatSidebar/hooks/useToolExecution.ts` - Chat plan asset validation

### Documentation
- `docs/ARCHITECTURE.md` - Schema definitions, API contracts
- `docs/RELATIONSHIPS.md` - This file
