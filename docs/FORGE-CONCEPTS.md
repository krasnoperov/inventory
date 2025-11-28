# Inventory Forge: Core Concepts

## Overview

Inventory Forge is a graphical asset management system for game development. Users build collections of **Assets** (characters, items, scenes, style references) and iterate on them through AI-powered generation and refinement.

### Design Principles

1. **Assets are the primary unit** — Users work with Assets, not raw images
2. **Variants are internal** — Multiple versions exist within an Asset, but only the primary variant is visible in catalog
3. **Forge Tray is the workspace** — Minecraft-inspired crafting interface for combining and transforming assets
4. **Destination-first workflow** — Users define where results go BEFORE generation (no review step)

---

## Core Entities

### Asset

A named catalog entry representing a conceptual thing.

```typescript
Asset {
  id: string
  name: string                // User-editable name
  type: string                // character, item, scene, environment, sprite-sheet,
                              // animation, style-sheet, reference, composite
  tags: string                // JSON array of freeform tags
  parent_asset_id: string?    // NULL = root asset, else nested under parent
  active_variant_id: string   // The "primary" variant shown in catalog
  created_by: string
  created_at: number
  updated_at: number
}
```

**Key points:**
- Asset type describes what it represents conceptually
- Assets form a tree hierarchy via `parent_asset_id`
- Only the **primary variant** (`active_variant_id`) is shown in catalog view
- Users select Assets (not variants) when composing/referencing

### Variant

An image version belonging to an Asset. Variants are internal — visible only in Asset Detail view.

```typescript
Variant {
  id: string
  asset_id: string            // Parent asset
  image_key: string           // R2 storage reference
  thumb_key: string           // Thumbnail in R2
  recipe: string              // JSON: generation parameters, source references
  starred: boolean            // User marks important iterations
  created_by: string
  created_at: number
}
```

**Key points:**
- Multiple variants per asset (exploration/iteration)
- One variant is **primary** (represents asset publicly)
- **Starred** variants are important iterations (not primary, but notable)
- Recipe stores how the variant was created (for potential regeneration)

### Lineage

Tracks how variants relate to each other. This is internal/hidden from users.

```typescript
Lineage {
  id: string
  parent_variant_id: string
  child_variant_id: string
  relation_type: 'derived' | 'composed' | 'spawned'
  severed: boolean            // User can cut historical links
  created_at: number
}
```

**Relation types:**
- `derived`: Single-source refinement (same asset)
- `composed`: Multi-source composition (may cross assets)
- `spawned`: Fork/copy to new asset

---

## Two Relationship Systems

### 1. Asset Hierarchy (Tree)

Organizational containment via `parent_asset_id`:

```
Hero (character)
├── Hero Style Sheet (style-sheet)
├── Hero Sprites (sprite-sheet)
└── Hero Armored (character)
    └── Armored Sprites (sprite-sheet)
```

Used for: organizing related assets, logical grouping

### 2. Variant Lineage (Graph)

Evolution tracking via `lineage` table:

```
Hero v1 ──derived──► Hero v2 ──derived──► Hero v3
                         │
                         └──spawned──► Hero Armored v1
```

Used for: understanding how images evolved (internal, mostly hidden)

---

## UI Structure

### Level 1: Catalog View (Space Page)

Shows assets as cards. **Only primary variant thumbnail visible.**

```
┌─────────────────────────────────────────────────────────────────────┐
│  Space: "Fantasy RPG"                                               │
├─────────────────────────────────────────────────────────────────────┤
│  🔍 Search...                              [Filter ▼] [View ▼]      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐               │
│   │ [thumb] │  │ [thumb] │  │ [thumb] │  │ [thumb] │               │
│   │ Hero    │  │ Villain │  │ Tavern  │  │ Style   │               │
│   │ char    │  │ char    │  │ scene   │  │ ref     │               │
│   │ [+tray] │  │ [+tray] │  │ [+tray] │  │ [+tray] │               │
│   ├─────────┤  └─────────┘  └─────────┘  └─────────┘               │
│   │ └ Armor │  ← nested child                                      │
│   └─────────┘                                                       │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  ⚒️ FORGE TRAY                                                      │
│  [Hero] [Style] [+]     Prompt: [____________]  [⚡ Compose]        │
└─────────────────────────────────────────────────────────────────────┘
```

**Interactions:**
- Click asset card → Open Asset Detail View
- Click [+tray] → Add asset's primary variant to Forge Tray
- Drag asset → Re-parent (nest under another)
- Right-click → Context menu (Fork, Delete, etc.)

### Level 2: Asset Detail View

Shows all variants of a single asset. This is where variant management happens.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back to Catalog                                                  │
│                                                                     │
│  Hero                                                               │
│  character • 8 variants                                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────┐                              │
│  │                                   │  PRIMARY VARIANT             │
│  │         [LARGE IMAGE]             │  (represents asset)          │
│  │                                   │                              │
│  └───────────────────────────────────┘                              │
│                                                                     │
│  All Variants:                                                      │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐  │
│  │[✓]  │ │[★]  │ │     │ │     │ │[★]  │ │     │ │     │ │     │  │
│  │ v1  │ │ v2  │ │ v3  │ │ v4  │ │ v5  │ │ v6  │ │ v7  │ │ v8  │  │
│  │[+]  │ │[+]  │ │[+]  │ │[+]  │ │[+]  │ │[+]  │ │[+]  │ │[+]  │  │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘  │
│                                                                     │
│  [✓] = Primary    [★] = Starred    [+] = Add to Tray               │
│                                                                     │
│  Children Assets:                                      [+ Add Child]│
│  ┌─────────┐                                                        │
│  │ Armor   │                                                        │
│  └─────────┘                                                        │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  ⚒️ FORGE TRAY (persistent)                                         │
│  [Hero v2] [Style] [+]   Prompt: [________]  [⚡ Remix]             │
└─────────────────────────────────────────────────────────────────────┘
```

**Interactions:**
- Click variant → View large, show actions
- Click [+] on variant → Add specific variant to Forge Tray
- Set Primary → This variant represents the asset in catalog
- Star → Mark as important iteration

---

## Forge Tray

The central workspace for all generation operations. A minimal, always-visible floating bar at the bottom of the screen.

> For implementation details, see [PLAN.md](./PLAN.md)

### Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [ref] [ref] [+]  │  "describe what you want..."              [Forge ▸] │
└─────────────────────────────────────────────────────────────────────────┘
     ^                              ^                              ^
  slot pills                   prompt input                  action button
  (0-14 items)               (always visible)              (mode-aware label)
```

**Empty state:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│  [+]  │  "describe what you want..."                       [Generate ▸] │
└─────────────────────────────────────────────────────────────────────────┘
```

### Slot Behavior

- **Capacity:** Maximum 14 slots (Gemini image input limit)
- Show only filled slots + one [+] button
- From Catalog: adds asset's **primary variant**
- From Detail: adds **specific variant**

### Adding to Tray

| Location | Action | Result |
|----------|--------|--------|
| Catalog View | Click [+tray] on asset | Add asset's primary variant |
| Asset Detail | Click [+] on variant thumbnail | Add that specific variant |
| Asset Picker | Select asset | Add asset's primary variant |

### Destination Selection

Destination (new asset vs existing asset variant) is selected in the **ForgeModal** that opens when clicking the Forge button. This keeps the tray minimal while providing full control in the modal.

---

## Operations

The Forge button label changes based on slot count:

| Slots | Operation | Description |
|-------|-----------|-------------|
| 0 | **Generate** | Create from scratch with prompt |
| 1 | **Transform** | Modify single reference |
| 2+ | **Combine** | Merge multiple sources |

The destination (new asset vs existing asset variant) is determined by user selection in the **ForgeModal**, not by operation name. This simplifies the UI while preserving all capabilities.

---

## Workflow Examples

### Example 1: Transform with Style Reference

**Goal:** Create "Archer" character using style from "Style Guide" asset.

1. In Catalog, click [+tray] on "Style Guide" → slot 1
2. Enter prompt: "female archer with bow, dynamic pose"
3. Click **[Transform ▸]** → ForgeModal opens
4. Select destination: New Asset, name "Archer", type "character"
5. Click submit

```
Tray: [Style Guide]  "female archer..."  [Transform ▸]
→ Creates "Archer" asset with generated variant
```

### Example 2: Combine Multiple References

**Goal:** Create new variant of "Archer" wearing armor from "Plate Armor" asset.

1. Open "Archer" asset detail, click [+] on variant v2 → slot 1
2. Go to catalog, click [+tray] on "Plate Armor" → slot 2
3. Enter prompt: "wearing the plate armor"
4. Click **[Combine ▸]** → ForgeModal opens
5. Select destination: New Variant in "Archer"
6. Click submit

```
Tray: [Archer v2] [Plate Armor]  "wearing..."  [Combine ▸]
→ Creates new variant v3 in Archer asset
```

### Example 3: Extract Element from Image

**Goal:** Variant v5 has a cool sword, extract it to separate asset.

1. Open "Hero" asset detail, click [+] on variant v5 → slot 1
2. Enter prompt: "isolate the sword only, white background"
3. Click **[Transform ▸]** → ForgeModal opens
4. Select destination: New Asset, name "Magic Sword", type "item"
5. Click submit

```
Tray: [Hero v5]  "isolate the sword..."  [Transform ▸]
→ Creates "Magic Sword" asset with extracted sword
```

### Example 4: Generate from Scratch

**Goal:** Create a new character with no references.

1. Enter prompt: "medieval knight in shining armor"
2. Click **[Generate ▸]** → ForgeModal opens
3. Select destination: New Asset, name "Knight", type "character"
4. Click submit

```
Tray: [+]  "medieval knight..."  [Generate ▸]
→ Creates "Knight" asset with generated variant
```

### Example 5: Combine Multiple Characters into Scene

**Goal:** Create battle scene combining Hero and Villain.

1. In Catalog, click [+tray] on "Hero" → slot 1
2. Click [+tray] on "Villain" → slot 2
3. Click [+tray] on "Style Guide" → slot 3
4. Enter prompt: "epic battle scene, dramatic lighting"
5. Click **[Combine ▸]** → ForgeModal opens
6. Select destination: New Asset, name "Battle Scene", type "scene"
7. Click submit

```
Tray: [Hero] [Villain] [Style Guide]  "epic battle..."  [Combine ▸]
→ Creates composed scene from all references
```

---

## Asset Picker

Modal for selecting assets to add to Forge Tray.

```
┌─────────────────────────────────────────────────────────────┐
│  Add to Forge Tray                                   [×]    │
├─────────────────────────────────────────────────────────────┤
│  🔍 Search assets...              Type: [All ▼]            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  In Tray:                                                   │
│  ┌─────┐ ┌─────┐                                           │
│  │Hero │ │Style│  (already selected)                       │
│  │ [✓] │ │ [✓] │                                           │
│  └─────┘ └─────┘                                           │
│                                                             │
│  Recent:                                                    │
│  ┌─────┐ ┌─────┐ ┌─────┐                                   │
│  │Sword│ │Armor│ │Tavrn│                                   │
│  └─────┘ └─────┘ └─────┘                                   │
│                                                             │
│  Characters:                                                │
│  ┌─────┐ ┌─────┐ ┌─────┐                                   │
│  │Hero │ │Villn│ │Guard│                                   │
│  │ [✓] │ │     │ │     │                                   │
│  └─────┘ └─────┘ └─────┘                                   │
│                                                             │
│  Items:                                                     │
│  ┌─────┐ ┌─────┐                                           │
│  │Sword│ │Armor│                                           │
│  └─────┘ └─────┘                                           │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                              [Done]         │
└─────────────────────────────────────────────────────────────┘
```

**Features:**
- Search by name
- Filter by type
- Grouped by type
- Shows which assets already in tray
- Click to toggle selection
- Each asset shows primary variant thumbnail

---

## Variant Actions (Asset Detail View)

When viewing a variant in detail, available actions:

| Action | Description |
|--------|-------------|
| **Set as Primary** | Make this variant represent the asset in catalog |
| **Star / Unstar** | Mark as important iteration |
| **Add to Tray** | Add this specific variant to Forge Tray |
| **Download** | Save image to local device |
| **Delete** | Remove variant (cannot delete last/primary) |

Note: All transformations are done through the Forge Tray — select variant, add to tray, configure, forge.

---

## Asset Actions (Catalog & Detail)

| Action | Description |
|--------|-------------|
| **Add to Tray** | Add primary variant to Forge Tray |
| **Rename** | Change asset name |
| **Change Type** | Update asset type |
| **Re-parent** | Move to different parent or root |
| **Add Child** | Create new child asset |
| **Delete** | Remove asset and all variants |

---

## Summary

| Concept | Visibility | Purpose |
|---------|------------|---------|
| **Asset** | Catalog | Named entity users work with |
| **Primary Variant** | Asset thumbnail | Represents asset in catalog |
| **Variants** | Asset Detail only | Internal iterations |
| **Forge Tray** | Persistent bottom | Crafting workspace |
| **Asset Picker** | Modal | Find and select assets |
| **Lineage** | Hidden | Internal evolution tracking |

| View | Shows | Primary Actions |
|------|-------|-----------------|
| **Catalog** | Assets (primary only) | Browse, Add to Tray, Navigate |
| **Asset Detail** | All variants | Manage variants, Add to Tray |
| **Forge Tray** | Selected items | Generate, Transform, Combine |
