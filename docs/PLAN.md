# Forge Tray UX Redesign Plan

## Overview

Redesign the Forge UI from a complex 7-operation system to a simplified 3-operation model with a minimal, always-visible floating bar aesthetic. This is a clean replacement of the existing `ReferenceShelf` component.

### Design Decisions
- **Operations**: Collapse to 3 (Generate / Transform / Combine) based on slot count
- **Aesthetic**: Minimal floating bar - clean, prompt-first, understated elegance
- **Visibility**: Always visible dock at bottom (even when empty)
- **Migration**: Clean swap - replace ReferenceShelf entirely

---

## Simplified Operation Model

| Slots | Operation | Description | API Job Type |
|-------|-----------|-------------|--------------|
| 0 | **Generate** | Create from scratch with prompt | `generate` |
| 1 | **Transform** | Modify single reference | `derive` |
| 2+ | **Combine** | Merge multiple sources | `compose` |

The destination (new asset vs existing asset variant) is determined by user selection in the modal, not by operation name.

---

## Visual Design: Minimal Floating Bar

### Core Concept
A slim, elegant dock that prioritizes the prompt input. The bar is always visible but unobtrusive - it communicates state through subtle visual cues rather than elaborate effects.

### Layout (Always Visible)
```
┌─────────────────────────────────────────────────────────────────────────┐
│  [ref] [ref] [+]  │  "describe what you want..."              [Forge ▸] │
└─────────────────────────────────────────────────────────────────────────┘
     ^                              ^                              ^
  slot pills                   prompt input                  action button
  (0-14 items)               (always visible)              (mode-aware label)
```

### Empty State
```
┌─────────────────────────────────────────────────────────────────────────┐
│  [+]  │  "describe what you want..."                       [Generate ▸] │
└─────────────────────────────────────────────────────────────────────────┘
```

### Visual Characteristics
- **Glass morphism** base matching existing theme (`--surface-glass`)
- **Monochrome mode indicators** - subtle text/icon changes, no dramatic color shifts
- **Micro-animations** - smooth 200ms transitions for state changes
- **Typography-led** - operation name in button is the primary mode indicator

### Mode Indicator (Button Label)
- 0 slots: "Generate"
- 1 slot: "Transform"
- 2+ slots: "Combine"

---

## Component Architecture

### New Files to Create

```
src/frontend/
├── stores/
│   └── forgeTrayStore.ts           # New Zustand store (replaces referenceStore)
└── components/
    └── ForgeTray/
        ├── index.ts                 # Barrel exports
        ├── ForgeTray.tsx            # Main container
        ├── ForgeTray.module.css
        ├── ForgeSlots.tsx           # Slot pills display
        ├── ForgeSlots.module.css
        ├── ForgePromptBar.tsx       # Prompt input section
        ├── ForgePromptBar.module.css
        ├── ForgeButton.tsx          # Mode-aware action button
        ├── ForgeButton.module.css
        ├── ForgeModal.tsx           # Unified prompt + destination modal
        ├── ForgeModal.module.css
        └── useForgeSubmit.ts        # API submission hook
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/frontend/pages/SpacePage.tsx` | Replace ReferenceShelf with ForgeTray, simplify modal state |
| `src/frontend/components/VariantPopover.tsx` | Use `forgeTrayStore.addSlot` |
| `src/frontend/components/AssetCard.tsx` | Update add-to-tray handler |
| `src/frontend/styles/theme.css` | Add forge-specific CSS variables |
| `src/frontend/components/forge/index.ts` | Export new ForgeTray components |

### Files to Delete

| File | Reason |
|------|--------|
| `src/frontend/stores/referenceStore.ts` | Replaced by forgeTrayStore |
| `src/frontend/components/ReferenceShelf.tsx` | Replaced by ForgeTray |
| `src/frontend/components/ReferenceShelf.module.css` | Replaced |
| `src/frontend/components/RefineModal.tsx` | Merged into ForgeModal |
| `src/frontend/components/RefineModal.module.css` | Merged |

---

## Store Design: `forgeTrayStore.ts`

```typescript
interface ForgeSlot {
  id: string;
  variant: Variant;
  asset: Asset;
  position: number;
}

type ForgeOperation = 'generate' | 'transform' | 'combine';

interface ForgeTarget {
  type: 'new_asset' | 'existing_asset';
  assetId?: string;
  assetName?: string;
  assetType?: string;
  parentAssetId?: string;
}

interface ForgeTrayState {
  slots: ForgeSlot[];
  maxSlots: 14;
  prompt: string;  // Prompt lives in store (enables assistant control)

  // Actions
  addSlot: (variant: Variant, asset: Asset) => boolean;
  removeSlot: (slotId: string) => void;
  clearSlots: () => void;
  hasVariant: (variantId: string) => boolean;
  reorderSlots: (fromIndex: number, toIndex: number) => void;
  setPrompt: (prompt: string) => void;  // For assistant integration

  // Context export (for assistant)
  getContext: () => ForgeContext;
}

// Context for AI assistant integration (see ASSISTANT-PLAN.md)
interface ForgeContext {
  operation: ForgeOperation;
  slots: Array<{ assetId: string; assetName: string; variantId: string }>;
  prompt: string;
}

// Derived (computed on access)
const getOperation = (slotCount: number): ForgeOperation => {
  if (slotCount === 0) return 'generate';
  if (slotCount === 1) return 'transform';
  return 'combine';
};
```

---

## ForgeTray Component Structure

### ForgeTray.tsx (Main Container)
- Fixed position at bottom center
- Always visible
- Contains: ForgeSlots, ForgePromptBar (inline), ForgeButton
- Opens ForgeModal on button click

### ForgeSlots.tsx
- Horizontal list of slot pills (thumbnails with remove button)
- Shows [+] button when under 14 slots
- Clicking [+] could open AssetPicker or be drag-drop target
- Pills are compact (40x40px thumbnails)

### ForgePromptBar.tsx
- Single-line text input (expandable on focus)
- Placeholder: "describe what you want..."
- Cmd+Enter shortcut to submit

### ForgeButton.tsx
- Dynamic label based on operation (Generate/Transform/Combine)
- Enabled state: always (Generate works with 0 slots)
- Opens ForgeModal with current state

### ForgeModal.tsx
- Unified modal replacing GenerateModal + RefineModal
- Sections:
  1. **References display** (read-only, shows what's in tray)
  2. **Prompt input** (pre-filled from tray, editable)
  3. **Destination picker**:
     - "Create new asset" (name, type, parent fields)
     - "Add variant to [Asset]" (quick options from slots + searchable list)
  4. **Submit button** (label matches operation)

---

## CSS Architecture

### New Variables for `theme.css`

```css
:root {
  /* Forge Tray */
  --forge-bar-bg: var(--surface-glass);
  --forge-bar-border: var(--border-glass);
  --forge-bar-shadow: 0 -4px 20px oklch(0% 0 0 / 0.1);

  /* Slot pills */
  --forge-slot-size: 40px;
  --forge-slot-radius: 8px;
  --forge-slot-border: var(--border-subtle);

  /* Mode accents (subtle) */
  --forge-generate-accent: var(--color-text-secondary);
  --forge-transform-accent: var(--color-text-secondary);
  --forge-combine-accent: var(--color-text-secondary);
}
```

### ForgeTray.module.css Skeleton

```css
.tray {
  position: fixed;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;

  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;

  background: var(--forge-bar-bg);
  backdrop-filter: blur(16px);
  border: 1px solid var(--forge-bar-border);
  border-radius: 12px;
  box-shadow: var(--forge-bar-shadow);

  min-width: 400px;
  max-width: 600px;
}

.slots {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.promptSection {
  flex: 1;
  min-width: 200px;
}

.promptInput {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  font-size: 0.875rem;
  color: var(--color-text);
}

.promptInput::placeholder {
  color: var(--color-text-muted);
}
```

---

## Implementation Phases

### Phase 1: Store + Basic Tray
1. Create `forgeTrayStore.ts` with slot management
2. Create `ForgeTray.tsx` container with basic layout
3. Create `ForgeSlots.tsx` with add/remove functionality
4. Create `ForgeButton.tsx` with dynamic labels
5. Wire up to SpacePage (replace ReferenceShelf import)

### Phase 2: Modal Integration
1. Create `ForgeModal.tsx` with prompt + destination
2. Create `useForgeSubmit.ts` hook for API calls
3. Integrate with existing `trackJob` from WebSocket hook
4. Handle job completion flow

### Phase 3: Entry Points
1. Update `VariantPopover.tsx` to use forgeTrayStore
2. Update `AssetCard.tsx` add-to-tray handler
3. Add keyboard shortcut (`/` or `Cmd+K`) to focus prompt

### Phase 4: Cleanup
1. Delete `referenceStore.ts`
2. Delete `ReferenceShelf.tsx` and CSS
3. Delete `RefineModal.tsx` and CSS
4. Update barrel exports

### Phase 5: Polish
1. Entrance/exit animations (200ms fade+slide)
2. Slot add/remove micro-animations
3. Focus states and keyboard navigation
4. Responsive behavior (mobile: full-width bar)

---

## API Integration

The existing API endpoints support the simplified model without changes:

```typescript
// Generate (0 slots) or Combine (2+) -> New Asset
POST /api/spaces/:spaceId/assets
{ name, type, prompt, referenceVariantIds? }

// Transform (1 slot) or any -> Existing Asset Variant
POST /api/spaces/:spaceId/assets/:assetId/variants
{ sourceVariantId?, prompt, referenceVariantIds? }
```

Job type mapping:
- `generate` -> 0 references
- `derive` -> 1 reference (Transform)
- `compose` -> 2+ references (Combine)

---

## Critical Files to Read Before Implementation

1. **`src/frontend/stores/referenceStore.ts`** - Understand current API for compatibility
2. **`src/frontend/pages/SpacePage.tsx`** - Main integration point, modal state management
3. **`src/frontend/components/GenerateModal.tsx`** - Pattern for ForgeModal
4. **`src/frontend/hooks/useSpaceWebSocket.ts`** - Data models, trackJob integration
5. **`src/frontend/components/VariantPopover.tsx`** - Entry point for adding to tray
6. **`src/frontend/styles/theme.css`** - Existing CSS variables to extend

---

## Success Criteria

1. Users can perform all existing operations (generate, derive, compose, fork) through the simplified 3-operation model
2. The tray is always visible but unobtrusive
3. Operation mode is automatically detected from slot count
4. Single unified modal handles all forge flows
5. Clean codebase with no legacy reference store code
6. Smooth animations that feel polished but not flashy

---

## Future: Assistant Integration

This plan is designed to support AI assistant control of the Forge Tray. Key provisions:

- **`prompt` in store**: Prompt state lives in the store (not just modal), enabling external control
- **`setPrompt()` action**: Assistant can programmatically set the prompt
- **`getContext()` selector**: Exports tray state for assistant context building

See **[ASSISTANT-PLAN.md](./ASSISTANT-PLAN.md)** for the full assistant integration specification.

No blockers identified - assistant features can be built on top of this implementation.