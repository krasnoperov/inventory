import { create } from 'zustand';
import type {
  Asset,
  CollectionItem,
  ConnectionStatus,
  JobStatus,
  Lineage,
  UserPresence,
  Variant,
  SpaceCollection,
} from './protocol';
import type { SpaceStateSnapshot } from './spaceSnapshots';

export type StateUpdater<T> = T | ((prev: T) => T);

function resolveStateUpdater<T>(prev: T, updater: StateUpdater<T>): T {
  return typeof updater === 'function' ? (updater as (prev: T) => T)(prev) : updater;
}

export interface SpaceSessionState {
  stateSpaceId: string;
  status: ConnectionStatus;
  error: string | null;
  hasSynced: boolean;
  assets: Asset[];
  variants: Variant[];
  lineage: Lineage[];
  collections: SpaceCollection[];
  collectionItems: CollectionItem[];
  jobs: Map<string, JobStatus>;
  presence: UserPresence[];
  hydrateFromSnapshot: (spaceId: string, snapshot: SpaceStateSnapshot | null) => void;
  markSynced: () => void;
  setStatus: (updater: StateUpdater<ConnectionStatus>) => void;
  setError: (updater: StateUpdater<string | null>) => void;
  setAssets: (updater: StateUpdater<Asset[]>) => void;
  setVariants: (updater: StateUpdater<Variant[]>) => void;
  setLineage: (updater: StateUpdater<Lineage[]>) => void;
  setCollections: (updater: StateUpdater<SpaceCollection[]>) => void;
  setCollectionItems: (updater: StateUpdater<CollectionItem[]>) => void;
  setJobs: (updater: StateUpdater<Map<string, JobStatus>>) => void;
  setPresence: (updater: StateUpdater<UserPresence[]>) => void;
}

export const useSpaceSessionStore = create<SpaceSessionState>()((set) => ({
  stateSpaceId: '',
  status: 'connecting',
  error: null,
  hasSynced: false,
  assets: [],
  variants: [],
  lineage: [],
  collections: [],
  collectionItems: [],
  jobs: new Map(),
  presence: [],
  hydrateFromSnapshot: (spaceId, snapshot) => set({
    stateSpaceId: spaceId,
    status: 'connecting',
    error: null,
    hasSynced: Boolean(snapshot),
    assets: snapshot?.assets ?? [],
    variants: snapshot?.variants ?? [],
    lineage: snapshot?.lineage ?? [],
    collections: snapshot?.collections ?? [],
    collectionItems: snapshot?.collectionItems ?? [],
    presence: snapshot?.presence ?? [],
    jobs: new Map(),
  }),
  markSynced: () => set({ hasSynced: true }),
  setStatus: (updater) => set((state) => ({ status: resolveStateUpdater(state.status, updater) })),
  setError: (updater) => set((state) => ({ error: resolveStateUpdater(state.error, updater) })),
  setAssets: (updater) => set((state) => ({ assets: resolveStateUpdater(state.assets, updater) })),
  setVariants: (updater) => set((state) => ({ variants: resolveStateUpdater(state.variants, updater) })),
  setLineage: (updater) => set((state) => ({ lineage: resolveStateUpdater(state.lineage, updater) })),
  setCollections: (updater) => set((state) => ({ collections: resolveStateUpdater(state.collections, updater) })),
  setCollectionItems: (updater) => set((state) => ({ collectionItems: resolveStateUpdater(state.collectionItems, updater) })),
  setJobs: (updater) => set((state) => ({ jobs: resolveStateUpdater(state.jobs, updater) })),
  setPresence: (updater) => set((state) => ({ presence: resolveStateUpdater(state.presence, updater) })),
}));

export const EMPTY_ASSETS: Asset[] = [];
export const EMPTY_VARIANTS: Variant[] = [];
export const EMPTY_LINEAGE: Lineage[] = [];
export const EMPTY_COLLECTIONS: SpaceCollection[] = [];
export const EMPTY_COLLECTION_ITEMS: CollectionItem[] = [];
export const EMPTY_JOBS = new Map<string, JobStatus>();
export const EMPTY_PRESENCE: UserPresence[] = [];
