import { create } from 'zustand';

/** Space style (mirrors backend SpaceStyle but with parsed fields) */
export interface SpaceStyleClient {
  id: string;
  name: string;
  description: string;
  imageKeys: string[];
  enabled: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

interface StyleState {
  style: SpaceStyleClient | null;
  setStyle: (style: SpaceStyleClient | null) => void;
  clearStyle: () => void;
}

export const useStyleStore = create<StyleState>((set) => ({
  style: null,
  setStyle: (style) => set({ style }),
  clearStyle: () => set({ style: null }),
}));
