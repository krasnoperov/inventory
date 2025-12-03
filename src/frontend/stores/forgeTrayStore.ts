import { create } from 'zustand';
import type { Variant, Asset } from '../hooks/useSpaceWebSocket';

export interface ForgeSlot {
  id: string;
  variant: Variant;
  asset: Asset;
  position: number;
}

export type ForgeOperation = 'generate' | 'fork' | 'refine' | 'create' | 'combine';

export interface ForgeTarget {
  type: 'new_asset' | 'existing_asset';
  assetId?: string;
  assetName?: string;
  assetType?: string;
  parentAssetId?: string;
}

// Context for AI assistant integration
export interface ForgeContext {
  operation: ForgeOperation;
  slots: Array<{ assetId: string; assetName: string; variantId: string }>;
  prompt: string;
}

interface ForgeTrayState {
  slots: ForgeSlot[];
  maxSlots: number;
  prompt: string;

  // Actions
  addSlot: (variant: Variant, asset: Asset) => boolean;
  removeSlot: (slotId: string) => void;
  clearSlots: () => void;
  hasVariant: (variantId: string) => boolean;
  reorderSlots: (fromIndex: number, toIndex: number) => void;
  setPrompt: (prompt: string) => void;

  // Prefill from plan step (resolves asset IDs to slots)
  prefillFromStep: (
    referenceAssetIds: string[],
    prompt: string,
    allAssets: Asset[],
    allVariants: Variant[]
  ) => void;

  // Prefill from existing variant (for retry/recreate)
  prefillFromVariant: (
    parentVariantIds: string[],
    prompt: string,
    allAssets: Asset[],
    allVariants: Variant[]
  ) => void;

  // Context export (for assistant)
  getContext: () => ForgeContext;
}

// Basic operation from slot count (for context export)
// Full operation logic is in ForgeTray component
export const getBasicOperation = (slotCount: number): ForgeOperation => {
  if (slotCount === 0) return 'generate';
  if (slotCount === 1) return 'refine'; // default for 1 slot
  return 'combine';
};

export const useForgeTrayStore = create<ForgeTrayState>()((set, get) => ({
  slots: [],
  maxSlots: 14, // Gemini image input limit
  prompt: '',

  addSlot: (variant, asset) => {
    const state = get();

    // Check if already at max
    if (state.slots.length >= state.maxSlots) {
      return false;
    }

    // Check if already added
    if (state.slots.some(s => s.variant.id === variant.id)) {
      return false;
    }

    const newSlot: ForgeSlot = {
      id: `${variant.id}-${Date.now()}`,
      variant,
      asset,
      position: state.slots.length,
    };

    set({
      slots: [...state.slots, newSlot],
    });

    return true;
  },

  removeSlot: (slotId) => {
    set((state) => ({
      slots: state.slots
        .filter(s => s.id !== slotId)
        .map((s, idx) => ({ ...s, position: idx })),
    }));
  },

  clearSlots: () => {
    set({ slots: [], prompt: '' });
  },

  hasVariant: (variantId) => {
    return get().slots.some(s => s.variant.id === variantId);
  },

  reorderSlots: (fromIndex, toIndex) => {
    set((state) => {
      const slots = [...state.slots];
      const [removed] = slots.splice(fromIndex, 1);
      slots.splice(toIndex, 0, removed);
      return {
        slots: slots.map((s, idx) => ({ ...s, position: idx })),
      };
    });
  },

  setPrompt: (prompt) => {
    set({ prompt });
  },

  prefillFromStep: (referenceAssetIds, prompt, allAssets, allVariants) => {
    // Clear existing slots first
    const newSlots: ForgeSlot[] = [];

    for (const assetId of referenceAssetIds) {
      const asset = allAssets.find(a => a.id === assetId);
      if (!asset) continue;

      // Find the active variant for this asset
      const variant = allVariants.find(v => v.id === asset.active_variant_id);
      if (!variant) continue;

      newSlots.push({
        id: `${variant.id}-${Date.now()}-${newSlots.length}`,
        variant,
        asset,
        position: newSlots.length,
      });
    }

    set({
      slots: newSlots,
      prompt,
    });
  },

  prefillFromVariant: (parentVariantIds, prompt, allAssets, allVariants) => {
    // Restore exact variant references (for retry/recreate)
    const newSlots: ForgeSlot[] = [];

    for (const variantId of parentVariantIds) {
      const variant = allVariants.find(v => v.id === variantId);
      if (!variant) continue;

      const asset = allAssets.find(a => a.id === variant.asset_id);
      if (!asset) continue;

      newSlots.push({
        id: `${variant.id}-${Date.now()}-${newSlots.length}`,
        variant,
        asset,
        position: newSlots.length,
      });
    }

    set({
      slots: newSlots,
      prompt,
    });
  },

  getContext: () => {
    const state = get();
    return {
      operation: getBasicOperation(state.slots.length),
      slots: state.slots.map(s => ({
        assetId: s.asset.id,
        assetName: s.asset.name,
        variantId: s.variant.id,
      })),
      prompt: state.prompt,
    };
  },
}));
