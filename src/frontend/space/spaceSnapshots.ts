import type {
  Asset,
  Lineage,
  RotationSet,
  RotationView,
  TilePosition,
  TileSet,
  UserPresence,
  Variant,
} from './protocol';

export interface SpaceStateSnapshot {
  assets: Asset[];
  variants: Variant[];
  lineage: Lineage[];
  presence: UserPresence[];
  rotationSets: RotationSet[];
  rotationViews: RotationView[];
  tileSets: TileSet[];
  tilePositions: TilePosition[];
  syncMode: 'full' | 'overview';
  updatedAt: number;
}

const spaceStateSnapshots = new Map<string, SpaceStateSnapshot>();

function cloneSpaceStateSnapshot(snapshot: SpaceStateSnapshot): SpaceStateSnapshot {
  return {
    assets: [...snapshot.assets],
    variants: [...snapshot.variants],
    lineage: [...snapshot.lineage],
    presence: [...snapshot.presence],
    rotationSets: [...snapshot.rotationSets],
    rotationViews: [...snapshot.rotationViews],
    tileSets: [...snapshot.tileSets],
    tilePositions: [...snapshot.tilePositions],
    syncMode: snapshot.syncMode,
    updatedAt: snapshot.updatedAt,
  };
}

export function getCachedSpaceStateSnapshot(spaceId: string): SpaceStateSnapshot | null {
  if (!spaceId) return null;
  const snapshot = spaceStateSnapshots.get(spaceId);
  return snapshot ? cloneSpaceStateSnapshot(snapshot) : null;
}

export function shouldPersistSpaceStateSnapshot(
  spaceId: string,
  stateSpaceId: string,
  hasSynced: boolean
): boolean {
  return Boolean(spaceId && hasSynced && stateSpaceId === spaceId);
}

export function getSpaceStateSnapshotForTests(spaceId: string): SpaceStateSnapshot | null {
  return getCachedSpaceStateSnapshot(spaceId);
}

export function shouldPersistSpaceStateSnapshotForTests(
  spaceId: string,
  stateSpaceId: string,
  hasSynced: boolean
): boolean {
  return shouldPersistSpaceStateSnapshot(spaceId, stateSpaceId, hasSynced);
}

export function clearSpaceStateSnapshotCacheForTests(): void {
  spaceStateSnapshots.clear();
}

export function saveSpaceStateSnapshotForTests(spaceId: string, snapshot: SpaceStateSnapshot): void {
  spaceStateSnapshots.set(spaceId, cloneSpaceStateSnapshot(snapshot));
}

export function persistSpaceStateSnapshot(args: {
  spaceId: string;
  assets: Asset[];
  variants: Variant[];
  lineage: Lineage[];
  presence: UserPresence[];
  rotationSets: RotationSet[];
  rotationViews: RotationView[];
  tileSets: TileSet[];
  tilePositions: TilePosition[];
  syncMode: 'full' | 'overview' | null;
}): void {
  const existing = spaceStateSnapshots.get(args.spaceId);
  spaceStateSnapshots.set(args.spaceId, {
    assets: [...args.assets],
    variants: [...args.variants],
    lineage: args.syncMode === 'overview' ? [...(existing?.lineage ?? args.lineage)] : [...args.lineage],
    presence: [...args.presence],
    rotationSets: [...args.rotationSets],
    rotationViews: [...args.rotationViews],
    tileSets: [...args.tileSets],
    tilePositions: [...args.tilePositions],
    syncMode: args.syncMode ?? existing?.syncMode ?? 'overview',
    updatedAt: Date.now(),
  });
}
