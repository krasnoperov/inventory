# Forge UI Specification

Visual specifications and component hierarchy for the Forge UI.

> For concepts and workflow examples, see [FORGE-CONCEPTS.md](./FORGE-CONCEPTS.md).
> For assistant integration, see [ASSISTANT-PLAN.md](./ASSISTANT-PLAN.md).

---

## Component Hierarchy

```
SpacePage (Catalog View)
├── AppHeader
├── AssetGrid
│   └── AssetCard (repeating)
│       ├── ThumbnailArea (with hover overlay)
│       │   ├── Thumbnail (primary variant)
│       │   └── HoverOverlay ([View] [Add] buttons)
│       ├── InfoRow (name, type, [+] button)
│       └── AssetMenu (right-click context menu)
├── ForgeTray (persistent bottom bar)
│   ├── InputArea (unified container)
│   │   ├── PromptTextarea (auto-expanding)
│   │   ├── ThumbsRow (slot thumbnails + [+] button)
│   │   └── ControlsRow
│   │       ├── DestinationToggle ([Current] [New])
│   │       ├── AssetNameInput (when New selected)
│   │       └── ForgeButton (mode-aware label)
│   └── AssetPickerModal (opens on [+] click)
├── NewAssetModal
└── JobsSection (pending/processing indicators)

AssetDetailPage
├── AppHeader
├── Breadcrumb
├── Header (title, type select, delete button)
├── JobsSection (asset-specific jobs)
├── Content (two-column grid)
│   ├── PreviewSection (left)
│   │   ├── Preview (selected variant large image)
│   │   ├── VariantDetails (actions, metadata, prompt)
│   │   └── LineageTree (parent/child relationships)
│   └── VariantsSection (right sidebar, sticky)
│       └── VariantsList
│           └── VariantThumb (repeating)
│               ├── Thumbnail
│               ├── StarIndicator
│               ├── ActiveIndicator
│               └── AddToTrayButton (hover)
├── SubAssetsSection (child assets grid)
└── ForgeTray (same component, persistent)
```

---

## ForgeTray Component

A minimal, always-visible floating bar at the bottom of the screen with glossy glass aesthetic.

**Location:** `src/frontend/components/ForgeTray/ForgeTray.tsx`

### Visual Layout

The tray uses a unified input area design with all controls inline:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │                                                                         │ │
│ │  Describe what to generate...                    (auto-expanding)       │ │
│ │                                                                         │ │
│ │  ┌─────┐ ┌─────┐ [+]                              ← thumbs row          │ │
│ │  │ ref │ │ ref │     75px thumbnails                                   │ │
│ │  │  ×  │ │  ×  │     hover shows remove                                │ │
│ │  └─────┘ └─────┘                                                       │ │
│ │                                                                         │ │
│ │  [Current] [New]  [Asset name___]              ⚡ [Create]              │ │
│ │      ^        ^         ^                           ^                   │ │
│ │  dest toggle       name input              submit button                │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Sub-components

| Component | Purpose |
|-----------|---------|
| `InputArea` | Unified container with inner border, focus glow |
| `PromptTextarea` | Auto-expanding textarea, min 44px, max 200px |
| `ThumbsRow` | Horizontal flex row of slot thumbnails |
| `ControlsRow` | Destination toggle, name input, submit button |

### Slot Behavior

- **Capacity:** Maximum 14 slots (Gemini image input limit)
- **Thumbnail size:** 75px (`--forge-slot-size`)
- Hover reveals:
  - Remove button (× in top-right)
  - Tooltip with asset name
- [+] button opens AssetPickerModal

### Operation Logic

The operation is determined by slot count, prompt presence, and destination:

```typescript
function getOperation(slotCount, hasPrompt, destinationType): ForgeOperation {
  if (slotCount === 0) return 'generate';
  if (slotCount === 1) {
    if (!hasPrompt && destinationType === 'new_asset') return 'fork';
    if (destinationType === 'existing_asset') return 'refine';
    return 'create';
  }
  return 'combine';
}
```

| Slots | Has Prompt | Destination | Button Label |
|-------|------------|-------------|--------------|
| 0 | Yes | New | Generate |
| 1 | No | New | Fork |
| 1 | Yes | New | Create |
| 1 | Yes | Existing | Refine |
| 2+ | Yes | Any | Combine |

### Destination Toggle

- **Current** — Add variant to current asset (Asset Detail) or first slot's asset (Catalog)
- **New** — Create new asset, shows name input field

When "New" is selected:
- Parent is set to first reference's asset (auto-hierarchy)
- Type is inherited from source asset

---

## AssetPickerModal Component

Modal for selecting assets to add to Forge Tray.

**Location:** `src/frontend/components/ForgeTray/AssetPickerModal.tsx`

### Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Add to Forge Tray                                                    [×]   │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────┐  ┌─────────────────────────────┐    │
│  │ 🔍 Search assets...               │  │ All Types              ▼   │    │
│  └───────────────────────────────────┘  └─────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  In Tray:                                                                   │
│  ┌───────┐ ┌───────┐                                                       │
│  │[thumb]│ │[thumb]│                                                       │
│  │  [✓]  │ │  [✓]  │   ← checkmark badge on selected                       │
│  │Space /│ │Space /│   ← parent path breadcrumb                            │
│  │Hero   │ │Style  │   ← asset name                                        │
│  │char   │ │ref    │   ← asset type                                        │
│  └───────┘ └───────┘                                                       │
│                                                                             │
│  Characters:                                                                │
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐                                   │
│  │[thumb]│ │[thumb]│ │[thumb]│ │[thumb]│                                   │
│  │Hero   │ │Villn  │ │Guard  │ │Merch  │                                   │
│  │char   │ │char   │ │char   │ │char   │                                   │
│  └───────┘ └───────┘ └───────┘ └───────┘                                   │
│                                                                             │
│  Items:                                                                     │
│  ┌───────┐ ┌───────┐ ┌───────┐                                             │
│  │[thumb]│ │[thumb]│ │[thumb]│                                             │
│  │Sword  │ │Armor  │ │Potion │                                             │
│  │item   │ │item   │ │item   │                                             │
│  └───────┘ └───────┘ └───────┘                                             │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                              [Done]         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Features

- **Search** — Filter by asset name
- **Type filter** — Dropdown to show specific type
- **Grouped by type** — "In Tray" shown first, then by asset type
- **Selection toggle** — Click to add/remove from tray
- **Checkmark badge** — Shows on thumbnails already in tray
- **Parent path** — Shows breadcrumb of asset hierarchy
- **Thumbnail grid** — 75px thumbnails (`--thumb-size-sm`)

### Styling

```css
.modal {
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  animation: slideUp 0.2s ease;
}

.checkmark {
  width: var(--thumb-badge-size);  /* 20px */
  background: var(--thumb-badge-bg);
  box-shadow: var(--thumb-badge-shadow);
}
```

---

## AssetCard Component

**Location:** `src/frontend/components/AssetCard.tsx`

### Layout

```
┌─────────────────────────────────┐
│  ┌───────────────────────────┐  │
│  │                           │  │
│  │     [Primary Variant]     │  │  ← 1:1 aspect ratio
│  │        Thumbnail          │  │  ← grid-sized
│  │                           │  │
│  └───────────────────────────┘  │
│  Space / Game / Hero         [+]│  ← parent path + name + add button
│  character                      │  ← type (smaller, muted)
└─────────────────────────────────┘
```

### Hover State

On hover, show overlay with quick actions:

```
┌─────────────────────────────────┐
│  ┌───────────────────────────┐  │
│  │     ┌───────────────┐     │  │
│  │     │ [View] [Add]  │     │  │  ← overlay buttons
│  │     └───────────────┘     │  │     use --thumb-action-* vars
│  │     [Primary Variant]     │  │
│  └───────────────────────────┘  │
│  Hero                        [+]│
│  character                      │
└─────────────────────────────────┘
```

### Context Menu (Right-click)

Opens `AssetMenu` component:

```
┌─────────────────────────┐
│ Add Child Asset         │
├─────────────────────────┤
│ Rename                  │
│ Move to...              │
├─────────────────────────┤
│ Delete                  │
└─────────────────────────┘
```

### Styling

```css
.overlayButton {
  background: var(--thumb-action-bg);
  border: var(--thumb-action-border);
  box-shadow: var(--thumb-action-shadow);
}

.addButton {
  width: var(--thumb-action-size);  /* 24px */
  height: var(--thumb-action-size);
}
```

---

## Variant Thumbnail (Asset Detail View)

Variant thumbnails appear in the right sidebar of Asset Detail page.

### Layout

```
┌─────────────┐
│ [★]  [Act]  │  ← star indicator (top-left), active badge (top-right)
│             │
│   [thumb]   │  ← 150px thumbnail (--thumb-size-lg)
│             │
│       [+]   │  ← add to tray button (hover reveals)
└─────────────┘
```

### States

```
Normal:           Active:           Starred:          Selected:
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│             │   │      [Act]  │   │  ★          │   │  ╔═════════╗│
│   [thumb]   │   │   [thumb]   │   │   [thumb]   │   │  ║ [thumb] ║│
│       [+]   │   │       [+]   │   │       [+]   │   │  ╚═════════╝│
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
 default border    green border      amber border      primary border
```

### Click Behavior

- Click thumbnail → Select variant, show in main preview
- Click [+] → Add to Forge Tray (button appears on hover)

### Variant Details Panel

Below the main preview, shows details for selected variant:

```
┌──────────────────────────────────────────────────────────────┐
│  Variant Details                                              │
│  [☆] [Download] [+ Add to Tray] [Set Active] [Delete]        │
├──────────────────────────────────────────────────────────────┤
│  Created: 2024-01-15 14:32                                   │
│  Type: derived    Model: gemini-2.0-flash                    │
├──────────────────────────────────────────────────────────────┤
│  Prompt:                                                      │
│  "female archer with bow, dynamic pose"                      │
└──────────────────────────────────────────────────────────────┘
```

### Styling

```css
.variantThumb {
  width: var(--thumb-size-lg);     /* 150px */
  height: var(--thumb-size-lg);
  border-radius: var(--thumb-radius);
  border: 2px solid var(--color-border);
}

.variantThumb.selected {
  border-color: var(--color-primary);
}

.variantThumb.active {
  border-color: #22c55e;
}

.addToTrayButton {
  width: var(--thumb-action-size);  /* 24px */
  background: var(--thumb-action-bg);
  box-shadow: var(--thumb-action-shadow);
}
```

---

## API Integration

All operations map to two API endpoints based on destination:

| Destination | API Endpoint | Method |
|-------------|--------------|--------|
| New Asset | `POST /api/spaces/:spaceId/assets` | Create asset + variant |
| Existing Asset | `POST /api/spaces/:spaceId/assets/:assetId/variants` | Add variant |

### Request Bodies

**New Asset:**
```typescript
{
  name: string;
  type: string;
  parentAssetId?: string;       // Auto-set from first reference
  prompt: string;
  referenceVariantIds?: string[];
}
```

**New Variant:**
```typescript
{
  sourceVariantId?: string;     // Primary reference
  prompt: string;
  referenceVariantIds?: string[]; // Additional references
}
```

### Job Tracking

Jobs are tracked via WebSocket with status updates:
- `pending` → `processing` → `completed` or `failed`

Job types: `generate`, `derive`, `compose`

---

## Responsive Behavior

### Desktop (> 1024px)
- Floating bar at bottom center
- Min width: 420px, Max width: 640px

### Tablet (768px - 1024px)
- Bar takes more width, still centered
- Controls row wraps if needed

### Mobile (< 768px)
- Full-width bar (left/right: 0.5rem)
- Destination buttons show icons only
- Button label hidden

### Mobile Small (< 480px)
- Bar docks to bottom edge (no rounded corners at bottom)
- Full-screen Asset Picker Modal

---

## Accessibility

- All interactive elements keyboard accessible
- Focus visible states with `--forge-input-focus-glow`
- ARIA labels for icon-only buttons
- Escape closes modals
- Tab order: prompt → thumbnails → controls → submit
- **Cmd+Enter** shortcut to submit from prompt/name input

---

## File Structure

```
src/frontend/
├── components/
│   ├── ForgeTray/
│   │   ├── index.ts              # Barrel exports
│   │   ├── ForgeTray.tsx         # Main component
│   │   ├── ForgeTray.module.css
│   │   ├── AssetPickerModal.tsx  # Asset selection modal
│   │   ├── AssetPickerModal.module.css
│   │   ├── ForgeSlots.tsx        # (unused, slots inline)
│   │   └── ForgeSlots.module.css
│   ├── AssetCard.tsx             # Catalog grid card
│   ├── AssetCard.module.css
│   ├── AssetMenu.tsx             # Context menu
│   ├── AssetMenu.module.css
│   ├── AssetPicker.tsx           # Dropdown picker (different from modal)
│   └── AssetPicker.module.css
├── stores/
│   └── forgeTrayStore.ts         # Zustand store for tray state
├── pages/
│   ├── SpacePage.tsx             # Catalog view
│   ├── SpacePage.module.css
│   ├── AssetDetailPage.tsx       # Asset detail view
│   └── AssetDetailPage.module.css
└── styles/
    └── theme.css                 # CSS variables
```
