# Forge UI Specification

Technical specification for implementing the Forge UI components.

---

## Component Hierarchy

```
SpacePage (Catalog View)
├── AssetGrid
│   └── AssetCard (repeating)
│       ├── Thumbnail (primary variant)
│       ├── AssetInfo (name, type)
│       ├── AddToTrayButton
│       └── NestedAssets (recursive)
├── ForgeTray (persistent bottom bar)
│   ├── SlotList
│   │   └── TraySlot (repeating, max 14)
│   ├── AddSlotButton
│   ├── PromptInput
│   ├── DestinationSelector
│   └── ForgeButton
└── AssetPicker (modal)

AssetDetailPage
├── AssetHeader (name, type, variant count)
├── PrimaryVariantDisplay (large image)
├── VariantGrid
│   └── VariantThumbnail (repeating)
│       ├── Thumbnail
│       ├── PrimaryBadge (if primary)
│       ├── StarBadge (if starred)
│       └── AddToTrayButton
├── ChildAssets
│   └── AssetCard (repeating)
└── ForgeTray (same component, persistent)
```

---

## ForgeTray Component

### State

```typescript
interface TraySlot {
  id: string;                    // Unique slot ID
  assetId: string;               // Source asset
  assetName: string;             // For display
  variantId: string;             // Specific variant (or primary)
  variantNumber?: number;        // If specific variant, show "vN"
  thumbnailUrl: string;          // Thumbnail to display
}

interface ForgeTrayState {
  slots: TraySlot[];             // Max 14
  prompt: string;
  destination: DestinationType;
  destinationAssetName?: string; // For "New Asset"
  destinationAssetType?: string; // For "New Asset"
  destinationParentId?: string;  // Optional parent for new asset
}

type DestinationType =
  | { type: 'new-asset' }
  | { type: 'existing-asset'; assetId: string; assetName: string };
```

### Slot Display Logic

```typescript
function getSlotDisplay(slot: TraySlot): { label: string; sublabel?: string } {
  if (slot.variantNumber) {
    // Specific variant selected
    return {
      label: slot.assetName,
      sublabel: `v${slot.variantNumber}`
    };
  } else {
    // Primary variant (default)
    return {
      label: slot.assetName
    };
  }
}
```

### Visual Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⚒️ FORGE                                                           [Clear]  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────┐ ┌──────┐ ┌──────┐                                                │
│  │[img] │ │[img] │ │      │                                                │
│  │Hero  │ │Style │ │  +   │  ← Add button (opens Asset Picker)             │
│  │ v2   │ │      │ │      │                                                │
│  │  ×   │ │  ×   │ └──────┘                                                │
│  └──────┘ └──────┘                                                         │
│                                                                             │
│  Prompt:                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Destination:                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ○ New Asset: [name______] Type: [character ▼] Parent: [None ▼]      │   │
│  │ ○ New Variant in "Hero"                                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ⚡ Remix                                                            │   │
│  │  Transform into new asset using AI                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Slot Sizing

```css
.traySlot {
  width: 64px;
  height: 80px;  /* 64px image + 16px label */
}

.traySlot .thumbnail {
  width: 64px;
  height: 64px;
  border-radius: 4px;
  object-fit: cover;
}

.traySlot .label {
  font-size: 10px;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traySlot .sublabel {
  font-size: 9px;
  color: var(--text-secondary);
}

.traySlot .removeButton {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
}
```

### Collapsed/Expanded States

When tray is empty or minimized:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⚒️ FORGE  [+]                                                      [Expand] │
└─────────────────────────────────────────────────────────────────────────────┘
```

When expanded with items:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⚒️ FORGE                                                         [Collapse] │
│ ... (full tray content) ...                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## ForgeButton Component

### Operation Detection Logic

```typescript
interface ForgeOperation {
  id: 'generate' | 'fork' | 'remix' | 'refine' | 'compose' | 'mix';
  label: string;
  icon: string;
  description: string;
  enabled: boolean;
  disabledReason?: string;
}

function detectOperation(state: ForgeTrayState): ForgeOperation {
  const slotCount = state.slots.length;
  const hasPrompt = state.prompt.trim().length > 0;
  const isNewAsset = state.destination.type === 'new-asset';

  // 0 slots
  if (slotCount === 0) {
    return {
      id: 'generate',
      label: 'Generate',
      icon: '⚡',
      description: 'Create new asset from scratch using AI',
      enabled: hasPrompt && isNewAsset,
      disabledReason: !hasPrompt ? 'Add a prompt to generate' :
                      !isNewAsset ? 'Select "New Asset" as destination' : undefined
    };
  }

  // 1 slot
  if (slotCount === 1) {
    if (!hasPrompt) {
      return {
        id: 'fork',
        label: 'Fork',
        icon: '📋',
        description: 'Copy to new asset (no AI generation)',
        enabled: isNewAsset,
        disabledReason: !isNewAsset ? 'Select "New Asset" to fork' : undefined
      };
    }

    if (isNewAsset) {
      return {
        id: 'remix',
        label: 'Remix',
        icon: '✨',
        description: 'Transform into new asset using AI',
        enabled: true
      };
    }

    return {
      id: 'refine',
      label: 'Refine',
      icon: '🔄',
      description: 'Create new variant in this asset',
      enabled: true
    };
  }

  // 2+ slots
  if (!hasPrompt) {
    return {
      id: 'compose',
      label: 'Compose',
      icon: '🎨',
      description: 'Combine references into new asset',
      enabled: false,
      disabledReason: 'Add a prompt to combine references'
    };
  }

  if (isNewAsset) {
    return {
      id: 'compose',
      label: 'Compose',
      icon: '🎨',
      description: 'Combine references into new asset',
      enabled: true
    };
  }

  return {
    id: 'mix',
    label: 'Mix',
    icon: '🔀',
    description: 'Blend references into new variant',
    enabled: true
  };
}
```

### Button Visual States

```tsx
function ForgeButton({ operation }: { operation: ForgeOperation }) {
  return (
    <button
      className={`forgeButton ${operation.enabled ? 'enabled' : 'disabled'}`}
      disabled={!operation.enabled}
    >
      <div className="buttonMain">
        <span className="icon">{operation.icon}</span>
        <span className="label">{operation.label}</span>
      </div>
      <div className="buttonDescription">
        {operation.enabled
          ? operation.description
          : operation.disabledReason}
      </div>
    </button>
  );
}
```

```css
.forgeButton {
  width: 100%;
  padding: 12px 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  text-align: left;
}

.forgeButton.enabled {
  background: var(--accent-color);
  color: white;
}

.forgeButton.disabled {
  background: var(--bg-secondary);
  color: var(--text-tertiary);
  cursor: not-allowed;
}

.forgeButton .buttonMain {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
}

.forgeButton .buttonDescription {
  font-size: 12px;
  margin-top: 4px;
  opacity: 0.8;
}
```

---

## DestinationSelector Component

### Logic

```typescript
interface DestinationOption {
  type: 'new-asset' | 'existing-asset';
  assetId?: string;
  assetName?: string;
  label: string;
}

function getDestinationOptions(slots: TraySlot[]): DestinationOption[] {
  const options: DestinationOption[] = [
    { type: 'new-asset', label: 'New Asset' }
  ];

  // Add "New Variant in X" for each unique asset in slots
  const uniqueAssets = new Map<string, string>();
  for (const slot of slots) {
    if (!uniqueAssets.has(slot.assetId)) {
      uniqueAssets.set(slot.assetId, slot.assetName);
    }
  }

  for (const [assetId, assetName] of uniqueAssets) {
    options.push({
      type: 'existing-asset',
      assetId,
      assetName,
      label: `New Variant in "${assetName}"`
    });
  }

  return options;
}
```

### Visual Layout

```
Destination:
┌─────────────────────────────────────────────────────────────────────────────┐
│ ● New Asset                                                                 │
│   Name: [________________]  Type: [character ▼]  Parent: [None ▼]          │
├─────────────────────────────────────────────────────────────────────────────┤
│ ○ New Variant in "Hero"                                                     │
│ ○ New Variant in "Style Guide"                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

When "New Asset" selected, show additional fields:
- **Name** (required): Text input
- **Type** (required): Dropdown with predefined types
- **Parent** (optional): Dropdown with all assets + "None"

---

## AssetPicker Component

### State

```typescript
interface AssetPickerState {
  searchQuery: string;
  typeFilter: string | null;  // null = all types
  selectedAssetIds: Set<string>;  // For multi-select
}
```

### Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Add to Forge Tray                                                    [×]   │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────┐  Type: ┌─────────────────────┐    │
│  │ 🔍 Search assets...                 │        │ All               ▼│    │
│  └─────────────────────────────────────┘        └─────────────────────┘    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  In Tray (2):                                                               │
│  ┌──────┐ ┌──────┐                                                         │
│  │[img] │ │[img] │                                                         │
│  │Hero  │ │Style │                                                         │
│  │  ✓   │ │  ✓   │  ← checkmark indicates in tray                          │
│  └──────┘ └──────┘                                                         │
│                                                                             │
│  Recent:                                                                    │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                                       │
│  │[img] │ │[img] │ │[img] │ │[img] │                                       │
│  │Sword │ │Armor │ │Tavrn │ │Enemy │                                       │
│  └──────┘ └──────┘ └──────┘ └──────┘                                       │
│                                                                             │
│  Characters (4):                                                            │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                                       │
│  │[img] │ │[img] │ │[img] │ │[img] │                                       │
│  │Hero  │ │Villn │ │Guard │ │Merch │                                       │
│  │  ✓   │ │      │ │      │ │      │                                       │
│  └──────┘ └──────┘ └──────┘ └──────┘                                       │
│                                                                             │
│  Items (6):                                                                 │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                     │
│  │[img] │ │[img] │ │[img] │ │[img] │ │[img] │ │[img] │                     │
│  │Sword │ │Armor │ │Potion│ │Chest │ │Key   │ │Ring  │                     │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘                     │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                              [Done]         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Behavior

- Click asset → Toggle in/out of tray
- Already-in-tray assets show checkmark
- Clicking asset already in tray removes it
- "Done" closes picker
- Scrollable content area
- Groups collapsed by default if many assets

---

## Catalog Asset Card

### Layout

```
┌─────────────────────────────────┐
│  ┌───────────────────────────┐  │
│  │                           │  │
│  │     [Primary Variant]     │  │  ← 1:1 aspect ratio
│  │        Thumbnail          │  │
│  │                           │  │
│  └───────────────────────────┘  │
│  Hero                        [+]│  ← name + add to tray button
│  character                      │  ← type (smaller, muted)
├─────────────────────────────────┤
│  └─ Hero Armored           [+]  │  ← nested child (indented)
│  └─ Hero Sprites           [+]  │
└─────────────────────────────────┘
```

### Hover State

On hover, show overlay with quick actions:

```
┌─────────────────────────────────┐
│  ┌───────────────────────────┐  │
│  │  ┌─────────────────────┐  │  │
│  │  │  [View] [Add to Tray]│  │  │  ← overlay actions
│  │  └─────────────────────┘  │  │
│  │     [Primary Variant]     │  │
│  └───────────────────────────┘  │
│  Hero                        [+]│
│  character                      │
└─────────────────────────────────┘
```

### Context Menu (Right-click)

```
┌─────────────────────────┐
│ View Details            │
│ Add to Tray             │
├─────────────────────────┤
│ Rename                  │
│ Change Type        ►    │
│ Move to...         ►    │
├─────────────────────────┤
│ Add Child Asset         │
├─────────────────────────┤
│ Delete                  │
└─────────────────────────┘
```

---

## Variant Thumbnail (Asset Detail View)

### Layout

```
┌─────────┐
│ [✓] [★] │  ← badges (primary, starred)
│         │
│  [img]  │  ← thumbnail
│         │
│   [+]   │  ← add to tray button
└─────────┘
```

### States

```
Normal:           Primary:          Starred:          Primary+Starred:
┌─────────┐       ┌─────────┐       ┌─────────┐       ┌─────────┐
│         │       │ [✓]     │       │     [★] │       │ [✓] [★] │
│  [img]  │       │  [img]  │       │  [img]  │       │  [img]  │
│   [+]   │       │   [+]   │       │   [+]   │       │   [+]   │
└─────────┘       └─────────┘       └─────────┘       └─────────┘
```

### Click Behavior

- Click thumbnail → Expand to large view with actions
- Click [+] → Add to Forge Tray

### Expanded Variant View (Modal/Lightbox)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                       [×]   │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                                                                       │  │
│  │                                                                       │  │
│  │                         [LARGE IMAGE]                                 │  │
│  │                                                                       │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Variant 3 of 8                                      [← Prev] [Next →]      │
│                                                                             │
│  Actions:                                                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │ Set Primary  │ │    Star      │ │ Add to Tray  │ │   Download   │       │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘       │
│                                                                             │
│  ┌──────────────┐                                                          │
│  │    Delete    │                                                          │
│  └──────────────┘                                                          │
│                                                                             │
│  Recipe:                                                                    │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Prompt: "female archer with bow, dynamic pose"                        │  │
│  │ Sources: Style Guide, Knight                                          │  │
│  │ Created: 2024-01-15 14:32                                             │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## API Integration

### Forge Operations → API Calls

| Operation | API Endpoint | Method | Body |
|-----------|--------------|--------|------|
| Generate | `/api/spaces/:spaceId/assets` | POST | `{ name, type, parentAssetId?, prompt }` |
| Fork | `/api/spaces/:spaceId/assets` | POST | `{ name, type, parentAssetId?, referenceVariantIds: [id] }` |
| Remix | `/api/spaces/:spaceId/assets` | POST | `{ name, type, parentAssetId?, prompt, referenceVariantIds: [id] }` |
| Refine | `/api/spaces/:spaceId/assets/:assetId/variants` | POST | `{ sourceVariantId, prompt }` |
| Compose | `/api/spaces/:spaceId/assets` | POST | `{ name, type, parentAssetId?, prompt, referenceVariantIds: [...] }` |
| Mix | `/api/spaces/:spaceId/assets/:assetId/variants` | POST | `{ sourceVariantId, prompt, referenceVariantIds: [...] }` |

### Request Body Structure

```typescript
// For new asset creation (Generate, Fork, Remix, Compose)
interface CreateAssetRequest {
  name: string;
  type: string;
  parentAssetId?: string;
  prompt?: string;                    // Required for Generate, Remix, Compose
  referenceVariantIds?: string[];     // Required for Fork, Remix, Compose
}

// For new variant in existing asset (Refine, Mix)
interface CreateVariantRequest {
  sourceVariantId: string;            // The variant being refined
  prompt: string;
  referenceVariantIds?: string[];     // Additional references for Mix
}
```

---

## Zustand Store

### Store Structure

```typescript
interface ForgeTrayStore {
  // State
  slots: TraySlot[];
  prompt: string;
  destination: DestinationType;
  destinationAssetName: string;
  destinationAssetType: string;
  destinationParentId: string | null;
  isExpanded: boolean;

  // Actions
  addSlot: (asset: Asset, variant?: Variant) => void;
  removeSlot: (slotId: string) => void;
  clearSlots: () => void;
  setPrompt: (prompt: string) => void;
  setDestination: (destination: DestinationType) => void;
  setDestinationAssetName: (name: string) => void;
  setDestinationAssetType: (type: string) => void;
  setDestinationParentId: (id: string | null) => void;
  toggleExpanded: () => void;

  // Computed
  getOperation: () => ForgeOperation;
  canForge: () => boolean;
}
```

### Persistence

Tray state should persist across page navigation within the same space:
- Store in Zustand with space-scoped key
- Clear when changing spaces
- Optionally persist to localStorage

---

## Responsive Behavior

### Desktop (> 1024px)
- Full tray at bottom
- Side-by-side slots and prompt/destination

### Tablet (768px - 1024px)
- Tray takes full width
- Stacked layout: slots above, prompt/destination below

### Mobile (< 768px)
- Collapsed tray by default (just icon + count)
- Tap to expand as bottom sheet
- Full-screen Asset Picker

---

## Accessibility

- All interactive elements keyboard accessible
- Focus visible states
- ARIA labels for icon-only buttons
- Screen reader announcements for tray changes
- Escape closes modals
- Tab order: slots → prompt → destination → forge button
