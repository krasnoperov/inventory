import { create } from 'zustand';
import type {
  Asset,
  ConnectionStatus,
  JobStatus,
  Lineage,
  RotationSet,
  RotationView,
  SpaceRelation,
  TilePosition,
  TileSet,
  UserPresence,
  Variant,
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
  relations: SpaceRelation[];
  jobs: Map<string, JobStatus>;
  presence: UserPresence[];
  rotationSets: RotationSet[];
  rotationViews: RotationView[];
  tileSets: TileSet[];
  tilePositions: TilePosition[];
  hydrateFromSnapshot: (spaceId: string, snapshot: SpaceStateSnapshot | null) => void;
  markSynced: () => void;
  setStatus: (updater: StateUpdater<ConnectionStatus>) => void;
  setError: (updater: StateUpdater<string | null>) => void;
  setAssets: (updater: StateUpdater<Asset[]>) => void;
  setVariants: (updater: StateUpdater<Variant[]>) => void;
  setLineage: (updater: StateUpdater<Lineage[]>) => void;
  setRelations: (updater: StateUpdater<SpaceRelation[]>) => void;
  setJobs: (updater: StateUpdater<Map<string, JobStatus>>) => void;
  setPresence: (updater: StateUpdater<UserPresence[]>) => void;
  setRotationSets: (updater: StateUpdater<RotationSet[]>) => void;
  setRotationViews: (updater: StateUpdater<RotationView[]>) => void;
  setTileSets: (updater: StateUpdater<TileSet[]>) => void;
  setTilePositions: (updater: StateUpdater<TilePosition[]>) => void;
}

export const useSpaceSessionStore = create<SpaceSessionState>()((set) => ({
  stateSpaceId: '',
  status: 'connecting',
  error: null,
  hasSynced: false,
  assets: [],
  variants: [],
  lineage: [],
  relations: [],
  jobs: new Map(),
  presence: [],
  rotationSets: [],
  rotationViews: [],
  tileSets: [],
  tilePositions: [],
  hydrateFromSnapshot: (spaceId, snapshot) => set({
    stateSpaceId: spaceId,
    status: 'connecting',
    error: null,
    hasSynced: Boolean(snapshot),
    assets: snapshot?.assets ?? [],
    variants: snapshot?.variants ?? [],
    lineage: snapshot?.lineage ?? [],
    relations: snapshot?.relations ?? [],
    presence: snapshot?.presence ?? [],
    rotationSets: snapshot?.rotationSets ?? [],
    rotationViews: snapshot?.rotationViews ?? [],
    tileSets: snapshot?.tileSets ?? [],
    tilePositions: snapshot?.tilePositions ?? [],
    jobs: new Map(),
  }),
  markSynced: () => set({ hasSynced: true }),
  setStatus: (updater) => set((state) => ({ status: resolveStateUpdater(state.status, updater) })),
  setError: (updater) => set((state) => ({ error: resolveStateUpdater(state.error, updater) })),
  setAssets: (updater) => set((state) => ({ assets: resolveStateUpdater(state.assets, updater) })),
  setVariants: (updater) => set((state) => ({ variants: resolveStateUpdater(state.variants, updater) })),
  setLineage: (updater) => set((state) => ({ lineage: resolveStateUpdater(state.lineage, updater) })),
  setRelations: (updater) => set((state) => ({ relations: resolveStateUpdater(state.relations, updater) })),
  setJobs: (updater) => set((state) => ({ jobs: resolveStateUpdater(state.jobs, updater) })),
  setPresence: (updater) => set((state) => ({ presence: resolveStateUpdater(state.presence, updater) })),
  setRotationSets: (updater) => set((state) => ({ rotationSets: resolveStateUpdater(state.rotationSets, updater) })),
  setRotationViews: (updater) => set((state) => ({ rotationViews: resolveStateUpdater(state.rotationViews, updater) })),
  setTileSets: (updater) => set((state) => ({ tileSets: resolveStateUpdater(state.tileSets, updater) })),
  setTilePositions: (updater) => set((state) => ({ tilePositions: resolveStateUpdater(state.tilePositions, updater) })),
}));

export const EMPTY_ASSETS: Asset[] = [];
export const EMPTY_VARIANTS: Variant[] = [];
export const EMPTY_LINEAGE: Lineage[] = [];
export const EMPTY_RELATIONS: SpaceRelation[] = [];
export const EMPTY_JOBS = new Map<string, JobStatus>();
export const EMPTY_PRESENCE: UserPresence[] = [];
export const EMPTY_ROTATION_SETS: RotationSet[] = [];
export const EMPTY_ROTATION_VIEWS: RotationView[] = [];
export const EMPTY_TILE_SETS: TileSet[] = [];
export const EMPTY_TILE_POSITIONS: TilePosition[] = [];
