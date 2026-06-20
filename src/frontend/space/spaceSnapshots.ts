import type {
  Asset,
  CollectionItem,
  Lineage,
  RotationSet,
  RotationView,
  SpaceRelation,
  TilePosition,
  TileSet,
  UserPresence,
  Variant,
  SpaceCollection,
  StylePresetRaw,
  StyleReferenceCollectionRaw,
} from './protocol';

export interface SpaceStateSnapshot {
  assets: Asset[];
  variants: Variant[];
  lineage: Lineage[];
  relations: SpaceRelation[];
  collections: SpaceCollection[];
  collectionItems: CollectionItem[];
  presence: UserPresence[];
  rotationSets: RotationSet[];
  rotationViews: RotationView[];
  tileSets: TileSet[];
  tilePositions: TilePosition[];
  stylePresets?: StylePresetRaw[];
  styleReferenceCollections?: StyleReferenceCollectionRaw[];
  syncMode: 'full' | 'overview';
  updatedAt: number;
}

const spaceStateSnapshots = new Map<string, SpaceStateSnapshot>();

function cloneSpaceStateSnapshot(snapshot: SpaceStateSnapshot): SpaceStateSnapshot {
  return {
    assets: [...snapshot.assets],
    variants: [...snapshot.variants],
    lineage: [...snapshot.lineage],
    relations: [...snapshot.relations],
    collections: [...snapshot.collections],
    collectionItems: [...snapshot.collectionItems],
    presence: [...snapshot.presence],
    rotationSets: [...snapshot.rotationSets],
    rotationViews: [...snapshot.rotationViews],
    tileSets: [...snapshot.tileSets],
    tilePositions: [...snapshot.tilePositions],
    stylePresets: [...(snapshot.stylePresets ?? [])],
    styleReferenceCollections: [...(snapshot.styleReferenceCollections ?? [])],
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
  relations: SpaceRelation[];
  collections: SpaceCollection[];
  collectionItems: CollectionItem[];
  presence: UserPresence[];
  rotationSets: RotationSet[];
  rotationViews: RotationView[];
  tileSets: TileSet[];
  tilePositions: TilePosition[];
  stylePresets: StylePresetRaw[];
  styleReferenceCollections: StyleReferenceCollectionRaw[];
  syncMode: 'full' | 'overview' | null;
}): void {
  const existing = spaceStateSnapshots.get(args.spaceId);
  spaceStateSnapshots.set(args.spaceId, {
    assets: [...args.assets],
    variants: [...args.variants],
    lineage: args.syncMode === 'overview' ? [...(existing?.lineage ?? args.lineage)] : [...args.lineage],
    relations: args.syncMode === 'overview' ? [...(existing?.relations ?? args.relations)] : [...args.relations],
    collections: [...args.collections],
    collectionItems: [...args.collectionItems],
    presence: [...args.presence],
    rotationSets: [...args.rotationSets],
    rotationViews: [...args.rotationViews],
    tileSets: [...args.tileSets],
    tilePositions: [...args.tilePositions],
    stylePresets: [...args.stylePresets],
    styleReferenceCollections: [...args.styleReferenceCollections],
    syncMode: args.syncMode ?? existing?.syncMode ?? 'overview',
    updatedAt: Date.now(),
  });
}
