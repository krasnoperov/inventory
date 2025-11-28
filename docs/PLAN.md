# Forge Tray Implementation Plan

## Status: COMPLETED

The Forge Tray has been implemented with a simplified operation model and unified input area design.

---

## Implementation Summary

### Completed Features

- [x] **ForgeTray component** — Always-visible floating bar at bottom
- [x] **Unified input area** — Textarea, thumbnails, and controls in single container
- [x] **5 operations** — Generate, Fork, Create, Refine, Combine
- [x] **Inline destination toggle** — [Current] / [New] buttons
- [x] **AssetPickerModal** — Grid selection for adding references
- [x] **forgeTrayStore** — Zustand store with slots, prompt, actions
- [x] **Consistent thumbnail styling** — CSS variables for sizing and actions
- [x] **Glossy glass aesthetic** — Backdrop blur, soft shadows, unified styling

### Files Created

```
src/frontend/
├── components/ForgeTray/
│   ├── index.ts
│   ├── ForgeTray.tsx
│   ├── ForgeTray.module.css
│   ├── AssetPickerModal.tsx
│   ├── AssetPickerModal.module.css
│   ├── ForgeSlots.tsx
│   └── ForgeSlots.module.css
└── stores/
    └── forgeTrayStore.ts
```

### Files Deleted (Replaced)

- `src/frontend/stores/referenceStore.ts`
- `src/frontend/components/ReferenceShelf.tsx`
- `src/frontend/components/ReferenceShelf.module.css`
- `src/frontend/components/RefineModal.tsx`
- `src/frontend/components/RefineModal.module.css`
- `src/frontend/components/GenerateModal.tsx`
- `src/frontend/components/GenerateModal.module.css`
- `src/frontend/components/VariantPopover.tsx`
- `src/frontend/components/VariantPopover.module.css`
- `src/frontend/components/VariantThumbnail.tsx`
- `src/frontend/components/VariantThumbnail.module.css`
- `src/frontend/components/LineagePopover.tsx`
- `src/frontend/components/LineagePopover.module.css`
- `src/frontend/components/PlaceResultModal.tsx`
- `src/frontend/components/PlaceResultModal.module.css`

---

## Operation Model

| Slots | Has Prompt | Destination | Operation | API Job Type |
|-------|------------|-------------|-----------|--------------|
| 0 | Yes | New | **Generate** | `generate` |
| 1 | No | New | **Fork** | `derive` |
| 1 | Yes | New | **Create** | `derive` |
| 1 | Yes | Existing | **Refine** | `derive` |
| 2+ | Yes | Any | **Combine** | `compose` |

---

## Store Design

```typescript
// forgeTrayStore.ts
interface ForgeTrayState {
  slots: ForgeSlot[];
  maxSlots: 14;
  prompt: string;

  // Actions
  addSlot: (variant: Variant, asset: Asset) => boolean;
  removeSlot: (slotId: string) => void;
  clearSlots: () => void;
  hasVariant: (variantId: string) => boolean;
  reorderSlots: (fromIndex: number, toIndex: number) => void;
  setPrompt: (prompt: string) => void;

  // Context export (for assistant integration)
  getContext: () => ForgeContext;
}
```

---

## CSS Design System

New variables added to `theme.css`:

```css
/* Thumbnail sizing */
--thumb-size-lg: 150px;
--thumb-size-sm: 75px;
--thumb-size-xs: 48px;
--thumb-radius: 10px;
--thumb-radius-sm: 6px;

/* Forge Tray */
--forge-slot-size: var(--thumb-size-sm);
--forge-bar-bg: ...;
--forge-button-bg: ...;
--forge-input-focus-glow: ...;

/* Thumbnail action buttons */
--thumb-action-size: 24px;
--thumb-action-size-sm: 18px;
--thumb-action-bg: ...;
--thumb-action-shadow: ...;

/* Selection badges */
--thumb-badge-size: 20px;
--thumb-badge-bg: var(--color-primary);
--thumb-badge-shadow: ...;
```

---

## Key Design Decisions

1. **No ForgeModal** — All controls inline in tray (simpler UX)
2. **Destination toggle** — [Current] / [New] instead of radio buttons
3. **Auto-parenting** — New assets auto-parent to first reference
4. **5 operations** — Fork added for copy-without-change use case
5. **Unified styling** — CSS variables for consistent thumbnail actions

---

## Future: Assistant Integration

The store exposes `getContext()` and `setPrompt()` for AI assistant control:

```typescript
// Get current forge state
const context = useForgeTrayStore.getState().getContext();
// { operation, slots, prompt }

// Programmatically set prompt
useForgeTrayStore.getState().setPrompt("your prompt here");
```

See [ASSISTANT-PLAN.md](./ASSISTANT-PLAN.md) for integration details.
