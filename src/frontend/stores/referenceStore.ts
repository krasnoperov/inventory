import { create } from 'zustand';
import type { Variant, Asset } from '../hooks/useSpaceWebSocket';

export interface Reference {
  variant: Variant;
  asset: Asset;
  addedAt: number;
}

interface ReferenceState {
  references: Reference[];
  maxReferences: number;
  addReference: (variant: Variant, asset: Asset) => boolean;
  removeReference: (variantId: string) => void;
  clearReferences: () => void;
  hasReference: (variantId: string) => boolean;
}

export const useReferenceStore = create<ReferenceState>()((set, get) => ({
  references: [],
  maxReferences: 5,

  addReference: (variant, asset) => {
    const state = get();

    // Check if already at max
    if (state.references.length >= state.maxReferences) {
      return false;
    }

    // Check if already added
    if (state.references.some(r => r.variant.id === variant.id)) {
      return false;
    }

    set({
      references: [
        ...state.references,
        {
          variant,
          asset,
          addedAt: Date.now(),
        },
      ],
    });

    return true;
  },

  removeReference: (variantId) => {
    set((state) => ({
      references: state.references.filter(r => r.variant.id !== variantId),
    }));
  },

  clearReferences: () => {
    set({ references: [] });
  },

  hasReference: (variantId) => {
    return get().references.some(r => r.variant.id === variantId);
  },
}));
