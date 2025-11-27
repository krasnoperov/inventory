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

// Consolidated destination type - all fields for each variant in one place
type Destination =
  | {
      type: 'new-asset';
      name: string;              // Required, validated before forge
      assetType: string;         // Required, validated before forge
      parentId: string | null;   // Optional nesting
    }
  | {
      type: 'existing-asset';
      assetId: string;
      assetName: string;         // For display
    };

interface ForgeTrayState {
  slots: TraySlot[];             // Max 14 (Gemini limit)
  prompt: string;
  destination: Destination;
  isExpanded: boolean;
}
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

### Slot Capacity & Display

**Capacity:** Maximum 14 slots (Gemini image input limit)

**Display rules:**
- Show only filled slots + one [+] button (no empty placeholders)
- Hide [+] button when `slots.length === 14` (max capacity reached)
- `addSlot()` should no-op when at capacity

```
Empty:      [+]
1 item:     [Hero] [+]
3 items:    [Hero] [Style] [Sword] [+]
14 items:   [1] [2] [3] ... [14]  (no [+] button, max reached)
```

**Capacity enforcement:**
```typescript
const MAX_SLOTS = 14;

function addSlot(state: ForgeTrayState, slot: TraySlot): ForgeTrayState {
  if (state.slots.length >= MAX_SLOTS) {
    return state; // No-op at max capacity
  }
  return { ...state, slots: [...state.slots, slot] };
}

function canAddSlot(state: ForgeTrayState): boolean {
  return state.slots.length < MAX_SLOTS;
}
```

**Slot contents:**
- From Catalog: adds asset's **primary variant** (shows asset name only)
- From Detail: adds **specific variant** (shows "Asset vN")

```
┌─────┐     ┌─────┐
│Hero │     │Hero │
│     │  vs │ v3  │
│  ×  │     │  ×  │
└─────┘     └─────┘
 asset       specific
 (primary)   variant
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
  id: 'generate' | 'generate-variant' | 'fork' | 'remix' | 'refine' | 'compose' | 'mix';
  label: string;
  icon: string;
  description: string;
  enabled: boolean;
  disabledReason?: string;
}

function detectOperation(state: ForgeTrayState): ForgeOperation {
  const slotCount = state.slots.length;
  const hasPrompt = state.prompt.trim().length > 0;
  const dest = state.destination;
  const isNewAsset = dest.type === 'new-asset';

  // Validation for new-asset destination
  const newAssetValid = isNewAsset
    && dest.name.trim().length > 0
    && dest.assetType.length > 0;

  // 0 slots, new asset → Generate
  if (slotCount === 0 && isNewAsset) {
    const enabled = hasPrompt && newAssetValid;
    let disabledReason: string | undefined;
    if (!hasPrompt) {
      disabledReason = 'Add a prompt to generate';
    } else if (!newAssetValid) {
      disabledReason = 'Enter asset name and type';
    }

    return {
      id: 'generate',
      label: 'Generate',
      icon: '⚡',
      description: 'Create new asset from scratch using AI',
      enabled,
      disabledReason
    };
  }

  // 0 slots, existing asset → Generate Variant (pure AI into existing asset)
  if (slotCount === 0 && !isNewAsset) {
    return {
      id: 'generate-variant',
      label: 'Generate Variant',
      icon: '⚡',
      description: `Create new variant in "${dest.assetName}" from prompt`,
      enabled: hasPrompt,
      disabledReason: !hasPrompt ? 'Add a prompt to generate' : undefined
    };
  }

  // 1 slot, no prompt → Fork
  if (slotCount === 1 && !hasPrompt) {
    const enabled = newAssetValid;
    return {
      id: 'fork',
      label: 'Fork',
      icon: '📋',
      description: 'Copy to new asset (no AI generation)',
      enabled,
      disabledReason: !isNewAsset ? 'Select "New Asset" to fork' :
                      !enabled ? 'Enter asset name and type' : undefined
    };
  }

  // 1 slot, has prompt, new asset → Remix
  if (slotCount === 1 && hasPrompt && isNewAsset) {
    return {
      id: 'remix',
      label: 'Remix',
      icon: '✨',
      description: 'Transform into new asset using AI',
      enabled: newAssetValid,
      disabledReason: !newAssetValid ? 'Enter asset name and type' : undefined
    };
  }

  // 1 slot, has prompt, existing asset → Refine
  if (slotCount === 1 && hasPrompt && !isNewAsset) {
    return {
      id: 'refine',
      label: 'Refine',
      icon: '🔄',
      description: 'Create new variant in this asset',
      enabled: true
    };
  }

  // 2+ slots, new asset → Compose
  if (isNewAsset) {
    const enabled = hasPrompt && newAssetValid;
    let disabledReason: string | undefined;
    if (!hasPrompt) {
      disabledReason = 'Add a prompt to combine references';
    } else if (!newAssetValid) {
      disabledReason = 'Enter asset name and type';
    }

    return {
      id: 'compose',
      label: 'Compose',
      icon: '🎨',
      description: 'Combine references into new asset',
      enabled,
      disabledReason
    };
  }

  // 2+ slots, existing asset → Mix
  return {
    id: 'mix',
    label: 'Mix',
    icon: '🔀',
    description: 'Blend references into new variant',
    enabled: hasPrompt,
    disabledReason: !hasPrompt ? 'Add a prompt to blend references' : undefined
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
// Uses the consolidated Destination type from ForgeTrayState

interface DestinationOption {
  destination: Destination;
  label: string;
  isQuickOption?: boolean;  // Assets in tray shown at top
}

interface Asset {
  id: string;
  name: string;
}

function getDestinationOptions(
  allAssets: Asset[],           // All assets in the space
  slots: TraySlot[],
  currentDestination: Destination
): DestinationOption[] {
  const options: DestinationOption[] = [];

  // "New Asset" option - preserve current values if already new-asset
  const newAssetDest: Destination = currentDestination.type === 'new-asset'
    ? currentDestination
    : { type: 'new-asset', name: '', assetType: 'character', parentId: null };

  options.push({
    destination: newAssetDest,
    label: 'New Asset'
  });

  // Quick options: assets currently in tray (shown first)
  const assetsInTray = new Set<string>();
  for (const slot of slots) {
    if (!assetsInTray.has(slot.assetId)) {
      assetsInTray.add(slot.assetId);
      options.push({
        destination: { type: 'existing-asset', assetId: slot.assetId, assetName: slot.assetName },
        label: `New Variant in "${slot.assetName}"`,
        isQuickOption: true
      });
    }
  }

  // All other assets in space (for "Generate Variant" without references)
  for (const asset of allAssets) {
    if (!assetsInTray.has(asset.id)) {
      options.push({
        destination: { type: 'existing-asset', assetId: asset.id, assetName: asset.name },
        label: `New Variant in "${asset.name}"`
      });
    }
  }

  return options;
}

// Destination is always user's choice
// - User can select any existing asset as destination, regardless of tray contents
// - This allows "Generate Variant" (0 slots + prompt + existing asset)
// - Assets in tray shown as quick options at top, all others below
```

### Visual Layout

```
Destination:
┌─────────────────────────────────────────────────────────────────────────────┐
│ ● New Asset                                                                 │
│   Name: [________________]  Type: [character ▼]  Parent: [None ▼]          │
├─────────────────────────────────────────────────────────────────────────────┤
│ Quick (in tray):                                                            │
│ ○ New Variant in "Hero"                                                     │
│ ○ New Variant in "Style Guide"                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ All Assets:                          [Search... 🔍]                         │
│ ○ New Variant in "Knight"                                                   │
│ ○ New Variant in "Tavern"                                                   │
│ ○ New Variant in "Forest"                                                   │
│ ...                                                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Sections:**
- **New Asset**: Always first, with inline name/type/parent fields
- **Quick (in tray)**: Assets currently in tray slots (if any)
- **All Assets**: All other assets in space, searchable

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
| Generate Variant | `/api/spaces/:spaceId/assets/:assetId/variants` | POST | `{ prompt }` |
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

// For new variant in existing asset (Generate Variant, Refine, Mix)
interface CreateVariantRequest {
  sourceVariantId?: string;           // Required for Refine/Mix, absent for Generate Variant
  prompt: string;
  referenceVariantIds?: string[];     // Additional references for Mix
}
```

---

## Zustand Store

### Store Structure

```typescript
const MAX_SLOTS = 14;

// Default destination for empty tray or reset
const defaultNewAssetDestination: Destination = {
  type: 'new-asset',
  name: '',
  assetType: 'character',
  parentId: null
};

interface ForgeTrayStore {
  // State
  slots: TraySlot[];
  prompt: string;
  destination: Destination;  // Consolidated type (see ForgeTrayState)
  isExpanded: boolean;

  // Actions
  addSlot: (asset: Asset, variant?: Variant) => void;  // No-op if slots.length >= 14
  removeSlot: (slotId: string) => void;
  clearSlots: () => void;
  setPrompt: (prompt: string) => void;
  setDestination: (destination: Destination) => void;
  setNewAssetName: (name: string) => void;      // Only when destination.type === 'new-asset'
  setNewAssetType: (assetType: string) => void; // Only when destination.type === 'new-asset'
  setNewAssetParent: (parentId: string | null) => void;
  toggleExpanded: () => void;
  reset: () => void;  // Clear all state

  // Computed (call these, don't store)
  getOperation: () => ForgeOperation;
  canAddSlot: () => boolean;
}

// Behavior notes:
// - Destination is always user's choice (no auto-reset based on slots)
// - When switching destination type, preserve prompt
// - addSlot should no-op when at MAX_SLOTS capacity
// - 0 slots + existing asset destination = "Generate Variant" operation
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
