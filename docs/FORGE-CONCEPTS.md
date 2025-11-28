# Inventory Forge: Core Concepts

## Overview

Inventory Forge is a graphical asset management system for game development. Users build collections of **Assets** (characters, items, scenes, style references) and iterate on them through AI-powered generation and refinement.

### Design Principles

1. **Assets are the primary unit** — Users work with Assets, not raw images
2. **Variants are internal** — Multiple versions exist within an Asset, but only the primary variant is visible in catalog
3. **Forge Tray is the workspace** — Always-visible floating bar with inline controls for combining and transforming assets
4. **Destination-first workflow** — Users define where results go BEFORE generation (no review step)
5. **Glossy glass aesthetic** — Consistent visual style with backdrop blur, soft shadows, and unified action buttons

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

Shows all variants of a single asset. Two-column layout with main preview and variant sidebar.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Dashboard / Space / [Parent] / Hero                                │
│                                                                     │
│  Hero                                    [character ▼]    [Delete]  │
│  8 variants                                                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────┐  ┌─────────────────────┐  │
│  │                                     │  │  ┌─────┐ ← variants  │  │
│  │                                     │  │  │[Act]│   sidebar   │  │
│  │         [SELECTED VARIANT]          │  │  │ ★   │   150px     │  │
│  │           LARGE PREVIEW             │  │  │[+]  │             │  │
│  │                                     │  │  └─────┘             │  │
│  │                                     │  │  ┌─────┐             │  │
│  └─────────────────────────────────────┘  │  │     │             │  │
│                                           │  │[+]  │             │  │
│  Variant Details:                         │  └─────┘             │  │
│  ┌─────────────────────────────────────┐  │  ┌─────┐             │  │
│  │ [☆] [Download] [+ Tray] [Active]    │  │  │     │             │  │
│  │ Created: 2024-01-15 14:32           │  │  │[+]  │             │  │
│  │ Prompt: "battle-ready pose..."      │  │  └─────┘             │  │
│  └─────────────────────────────────────┘  └─────────────────────┘  │
│                                                                     │
│  Sub-Assets (3):                                                    │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                               │
│  │[thumb]  │ │[thumb]  │ │[thumb]  │                               │
│  │Armor    │ │Weapon   │ │Sprite   │                               │
│  └─────────┘ └─────────┘ └─────────┘                               │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  ⚒️ FORGE TRAY (persistent at bottom)                               │
└─────────────────────────────────────────────────────────────────────┘
```

**Layout:**
- Two-column grid: preview section (left) + variants sidebar (right)
- `align-items: start` ensures top alignment
- Variants sidebar is sticky (scrolls with content)

**Interactions:**
- Click variant thumbnail → Select and show in main preview
- Click [+] on variant → Add to Forge Tray (hover reveals button)
- ★ Star/Unstar → Mark as important iteration
- [Active] badge shows which variant represents asset in catalog
- Click asset name → Inline edit
- Type dropdown → Change asset type

---

## Forge Tray

The central workspace for all generation operations. A minimal, always-visible floating bar at the bottom of the screen with a glossy glass aesthetic.

### Layout

The tray uses a unified input area design with all controls inline (no separate modal):

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │  Describe what to generate...                                           │ │
│ │                                                                         │ │
│ │  ┌─────┐ ┌─────┐ [+]                                                   │ │
│ │  │ ref │ │ ref │      ← thumbnail slots inside input area              │ │
│ │  └─────┘ └─────┘                                                       │ │
│ │                                                                         │ │
│ │  [Current ▸] [New ▸]  [Asset name___]          ⚡ [Create]             │ │
│ │       ^          ^           ^                       ^                  │ │
│ │  dest toggle  new asset   name input          submit button             │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Slot Behavior

- **Capacity:** Maximum 14 slots (Gemini image input limit)
- **Thumbnail size:** 75px (`--forge-slot-size`)
- Show only filled slots + one [+] button
- From Catalog: adds asset's **primary variant**
- From Detail: adds **specific variant**
- Hover reveals remove button (×)

### Adding to Tray

| Location | Action | Result |
|----------|--------|--------|
| Catalog View | Click [+] on asset card | Add asset's primary variant |
| Catalog View | Hover → "Add" overlay button | Add asset's primary variant |
| Asset Detail | Click [+] on variant thumbnail | Add that specific variant |
| Asset Picker Modal | Click asset thumbnail | Toggle in/out of tray |

### Destination Selection

Destination is selected **inline** in the tray via toggle buttons:
- **Current** — Add variant to current/first slot's asset
- **New** — Create new asset (shows name input field)

When creating a new asset from references, it automatically:
- Sets parent to the first reference's asset
- Inherits type from the source asset

---

## Operations

The operation is determined by slot count, prompt presence, and destination:

| Slots | Has Prompt | Destination | Operation | Description |
|-------|------------|-------------|-----------|-------------|
| 0 | Yes | New | **Generate** | Create from scratch |
| 1 | No | New | **Fork** | Copy asset without changes |
| 1 | Yes | New | **Create** | Transform into new asset |
| 1 | Yes | Existing | **Refine** | Add variant to existing asset |
| 2+ | Yes | Any | **Combine** | Merge multiple sources |

The button label updates dynamically: Generate, Fork, Create, Refine, or Combine.

---

## Workflow Examples

### Example 1: Create with Style Reference

**Goal:** Create "Archer" character using style from "Style Guide" asset.

1. In Catalog, click [+] on "Style Guide" card → added to tray
2. Enter prompt: "female archer with bow, dynamic pose"
3. Click **[New]** destination toggle
4. Enter name: "Archer"
5. Click **[Create]**

```
Tray: [Style Guide]  "female archer..."  [New] "Archer"  [Create]
→ Creates "Archer" asset as child of Style Guide
```

### Example 2: Refine Existing Asset

**Goal:** Create new variant of "Hero" with armor.

1. Open "Hero" asset detail
2. Click [+] on any variant → added to tray
3. Enter prompt: "add plate armor, battle-worn"
4. Keep destination as **[Current]** (defaults to Hero)
5. Click **[Refine]**

```
Tray: [Hero v2]  "add plate armor..."  [Current]  [Refine]
→ Creates new variant in Hero asset
```

### Example 3: Fork Asset

**Goal:** Create a copy of "Hero" to modify separately.

1. In Catalog, click [+] on "Hero" → added to tray
2. Leave prompt **empty**
3. Click **[New]** destination
4. Enter name: "Hero Alternate"
5. Click **[Fork]**

```
Tray: [Hero]  (no prompt)  [New] "Hero Alternate"  [Fork]
→ Creates "Hero Alternate" asset with same image
```

### Example 4: Generate from Scratch

**Goal:** Create a new character with no references.

1. Open tray on Space page (no refs)
2. Enter prompt: "medieval knight in shining armor"
3. Enter name: "Knight"
4. Click **[Generate]**

```
Tray: [+]  "medieval knight..."  "Knight"  [Generate]
→ Creates "Knight" asset with generated variant
```

### Example 5: Combine Multiple References

**Goal:** Create battle scene combining Hero and Villain.

1. In Catalog, click [+] on "Hero" → slot 1
2. Click [+] on "Villain" → slot 2
3. Click [+] on "Style Guide" → slot 3
4. Enter prompt: "epic battle scene, dramatic lighting"
5. Click **[New]**, enter name: "Battle Scene"
6. Click **[Combine]**

```
Tray: [Hero] [Villain] [Style]  "epic battle..."  [Combine]
→ Creates composed scene from all references
```

---

## Asset Picker Modal

Modal for selecting assets to add to Forge Tray. Opens when clicking [+] button in tray.

```
┌─────────────────────────────────────────────────────────────┐
│  Add to Forge Tray                                   [×]    │
├─────────────────────────────────────────────────────────────┤
│  🔍 Search assets...              Type: [All ▼]            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  In Tray:                                                   │
│  ┌───────┐ ┌───────┐                                       │
│  │[thumb]│ │[thumb]│                                       │
│  │ [✓]   │ │ [✓]   │                                       │
│  │Hero   │ │Style  │  (checkmark badge on selected)        │
│  │char   │ │ref    │                                       │
│  └───────┘ └───────┘                                       │
│                                                             │
│  Characters:                                                │
│  ┌───────┐ ┌───────┐ ┌───────┐                             │
│  │[thumb]│ │[thumb]│ │[thumb]│                             │
│  │Hero   │ │Villn  │ │Guard  │                             │
│  │char   │ │char   │ │char   │                             │
│  └───────┘ └───────┘ └───────┘                             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                              [Done]         │
└─────────────────────────────────────────────────────────────┘
```

**Features:**
- Search by name
- Filter by type dropdown
- Grouped by type (In Tray shown first)
- Assets already in tray show checkmark badge
- Click thumbnail to toggle in/out of tray
- Shows asset hierarchy breadcrumb (parent path)
- Thumbnail grid uses 75px thumbnails (`--thumb-size-sm`)

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
| **Forge Tray** | Persistent bottom | Unified generation workspace |
| **Asset Picker Modal** | Modal | Find and select assets for tray |
| **Lineage** | Hidden | Internal evolution tracking |

| View | Shows | Primary Actions |
|------|-------|-----------------|
| **Catalog** | Assets (primary only) | Browse, Add to Tray, Navigate |
| **Asset Detail** | All variants + sub-assets | Manage variants, Add to Tray |
| **Forge Tray** | Selected slots + prompt | Generate, Fork, Create, Refine, Combine |

## CSS Design System

Consistent styling via CSS variables in `theme.css`:

| Category | Variables |
|----------|-----------|
| **Thumbnail Sizing** | `--thumb-size-lg` (150px), `--thumb-size-sm` (75px), `--thumb-size-xs` (48px) |
| **Thumbnail Radius** | `--thumb-radius` (10px), `--thumb-radius-sm` (6px) |
| **Forge Tray** | `--forge-slot-size`, `--forge-bar-bg`, `--forge-button-bg` |
| **Action Buttons** | `--thumb-action-size`, `--thumb-action-bg`, `--thumb-action-shadow` |
| **Selection Badges** | `--thumb-badge-size`, `--thumb-badge-bg`, `--thumb-badge-shadow` |
