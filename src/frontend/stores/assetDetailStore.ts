import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useCallback } from 'react';

// =============================================================================
// Types
// =============================================================================

interface AssetDetailSession {
  selectedVariantId: string | null;
  showDetailsPanel: boolean;
  lastUpdated: number;
}

interface AssetDetailState {
  // Sessions keyed by assetId
  sessions: Record<string, AssetDetailSession>;

  // Actions
  getSession: (assetId: string) => AssetDetailSession;
  setSelectedVariantId: (assetId: string, variantId: string | null) => void;
  setShowDetailsPanel: (assetId: string, show: boolean) => void;
}

// =============================================================================
// Helpers
// =============================================================================

const createEmptySession = (): AssetDetailSession => ({
  selectedVariantId: null,
  showDetailsPanel: false,
  lastUpdated: Date.now(),
});

// =============================================================================
// Store
// =============================================================================

export const useAssetDetailStore = create<AssetDetailState>()(
  persist(
    (set, get) => ({
      sessions: {},

      getSession: (assetId) => {
        const session = get().sessions[assetId];
        return session || createEmptySession();
      },

      setSelectedVariantId: (assetId, variantId) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [assetId]: {
              ...(state.sessions[assetId] || createEmptySession()),
              selectedVariantId: variantId,
              lastUpdated: Date.now(),
            },
          },
        }));
      },

      setShowDetailsPanel: (assetId, show) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [assetId]: {
              ...(state.sessions[assetId] || createEmptySession()),
              showDetailsPanel: show,
              lastUpdated: Date.now(),
            },
          },
        }));
      },
    }),
    {
      name: 'asset-detail-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sessions: state.sessions,
      }),
      version: 1,
    }
  )
);

// =============================================================================
// Stable default values
// =============================================================================

const defaultSession: AssetDetailSession = {
  selectedVariantId: null,
  showDetailsPanel: false,
  lastUpdated: 0,
};

// =============================================================================
// Hooks for accessing session data (with stable selector references)
// =============================================================================

export function useSelectedVariantId(assetId: string) {
  const selector = useCallback(
    (state: AssetDetailState) => state.sessions[assetId]?.selectedVariantId ?? null,
    [assetId]
  );
  return useAssetDetailStore(selector);
}

export function useShowDetailsPanel(assetId: string) {
  const selector = useCallback(
    (state: AssetDetailState) => state.sessions[assetId]?.showDetailsPanel ?? false,
    [assetId]
  );
  return useAssetDetailStore(selector);
}

export function useAssetDetailSession(assetId: string) {
  const selector = useCallback(
    (state: AssetDetailState) => state.sessions[assetId] ?? defaultSession,
    [assetId]
  );
  return useAssetDetailStore(selector);
}
