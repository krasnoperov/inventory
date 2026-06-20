import { useMemo, useState, type CSSProperties } from 'react';
import { Thumbnail } from '../Thumbnail';
import type {
  Asset,
  CollectionItem,
  CollectionItemCreateParams,
  CollectionItemUpdateParams,
  CollectionKind,
  SpaceSubject,
  SpaceCollection,
  Variant,
} from '../../space/protocol';
import { isVariantForgeTrayReady } from '../../space/protocol';
import {
  COLLECTION_KIND_COLORS,
  COLLECTION_KIND_LABELS,
  COLLECTION_KINDS,
  getCollectionItems,
  getDisplayVariant,
  getItemAsset,
  getPinnedVariantIdForAssetCollection,
  getUnfiledAssets,
  moveId,
  sortCollections,
} from './spaceBoardModel';
import styles from './SpaceBoard.module.css';

interface SpaceBoardProps {
  spaceId: string;
  assets: Asset[];
  variants: Variant[];
  collections: SpaceCollection[];
  collectionItems: CollectionItem[];
  canEdit: boolean;
  isInitialSyncPending?: boolean;
  onAssetClick: (asset: Asset) => void;
  onAddToTray?: (variant: Variant, asset: Asset) => void;
  onCreateRelation?: (subject: SpaceSubject) => void;
  createCollection: (params: { id?: string; name: string; kind?: CollectionKind; color?: string | null; sortIndex?: number }) => void;
  updateCollection: (collectionId: string, changes: { name?: string; kind?: CollectionKind; color?: string | null; sortIndex?: number }) => void;
  deleteCollection: (collectionId: string) => void;
  addCollectionItem: (params: CollectionItemCreateParams) => void;
  updateCollectionItem: (collectionId: string, itemId: string, changes: CollectionItemUpdateParams) => void;
  reorderCollectionItems: (collectionId: string, itemIds: string[]) => void;
  deleteCollectionItem: (collectionId: string, itemId: string) => void;
}

const DEFAULT_STARTERS: Array<{ name: string; kind: CollectionKind }> = [
  { name: 'Cast', kind: 'cast' },
  { name: 'Backgrounds', kind: 'backgrounds' },
  { name: 'Scenes', kind: 'scenes' },
  { name: 'Thumbnails', kind: 'thumbnails' },
  { name: 'Maps', kind: 'maps' },
  { name: 'Deliverables', kind: 'deliverables' },
  { name: 'Style References', kind: 'style_refs' },
];

export function SpaceBoard({
  spaceId,
  assets,
  variants,
  collections,
  collectionItems,
  canEdit,
  isInitialSyncPending,
  onAssetClick,
  onAddToTray,
  onCreateRelation,
  createCollection,
  updateCollection,
  deleteCollection,
  addCollectionItem,
  updateCollectionItem,
  reorderCollectionItems,
  deleteCollectionItem,
}: SpaceBoardProps) {
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<CollectionKind>('custom');
  const [newColor, setNewColor] = useState(COLLECTION_KIND_COLORS.custom);
  const [addTargets, setAddTargets] = useState<Record<string, string>>({});
  const [cardTargets, setCardTargets] = useState<Record<string, string>>({});

  const orderedCollections = useMemo(() => sortCollections(collections), [collections]);
  const unfiledAssets = useMemo(
    () => getUnfiledAssets(assets, collectionItems, variants),
    [assets, collectionItems, variants],
  );

  const handleCreateCollection = () => {
    const name = newName.trim();
    if (!name || !canEdit) return;
    createCollection({
      name,
      kind: newKind,
      color: newColor,
      sortIndex: orderedCollections.length,
    });
    setNewName('');
  };

  const createStarterCollections = () => {
    DEFAULT_STARTERS.forEach((starter, index) => {
      createCollection({
        name: starter.name,
        kind: starter.kind,
        color: COLLECTION_KIND_COLORS[starter.kind],
        sortIndex: index,
      });
    });
  };

  const moveCollection = (collection: SpaceCollection, direction: -1 | 1) => {
    const currentIndex = orderedCollections.findIndex((candidate) => candidate.id === collection.id);
    const target = orderedCollections[currentIndex + direction];
    if (!target) return;
    updateCollection(collection.id, { sortIndex: target.sort_index });
    updateCollection(target.id, { sortIndex: collection.sort_index });
  };

  const getCollectionRole = (collectionId: string, fallback = 'custom') => {
    const collection = collections.find((candidate) => candidate.id === collectionId);
    return collection?.kind === 'style_refs' ? 'style_ref' : fallback;
  };

  const addAssetToCollection = (collectionId: string, assetId: string, role = getCollectionRole(collectionId)) => {
    const collection = collections.find((candidate) => candidate.id === collectionId);
    const asset = assets.find((candidate) => candidate.id === assetId);
    const items = getCollectionItems(collectionId, collectionItems);
    addCollectionItem({
      collectionId,
      subjectType: 'asset',
      assetId,
      role,
      pinnedVariantId: getPinnedVariantIdForAssetCollection(collection, asset),
      sortIndex: items.length,
    });
  };

  const markAssetAsStyleReference = (assetId: string) => {
    let collection = orderedCollections.find((candidate) => candidate.kind === 'style_refs');
    let collectionId = collection?.id;
    if (!collectionId) {
      collectionId = crypto.randomUUID();
      createCollection({
        id: collectionId,
        name: 'Style References',
        kind: 'style_refs',
        color: COLLECTION_KIND_COLORS.style_refs,
        sortIndex: orderedCollections.length,
      });
      collection = {
        id: collectionId,
        name: 'Style References',
        kind: 'style_refs',
        color: COLLECTION_KIND_COLORS.style_refs,
        description: null,
        sort_index: orderedCollections.length,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
    }
    const items = collection ? getCollectionItems(collection.id, collectionItems) : [];
    const asset = assets.find((candidate) => candidate.id === assetId);
    addCollectionItem({
      collectionId,
      subjectType: 'asset',
      assetId,
      role: 'style_ref',
      pinnedVariantId: getPinnedVariantIdForAssetCollection(collection, asset),
      sortIndex: items.length,
    });
  };

  const renderAssetCard = (asset: Asset, item: CollectionItem | null, collectionId?: string) => {
    const displayVariant = getDisplayVariant(item, asset, variants);
    const assetVariants = variants.filter((variant) => variant.asset_id === asset.id);
    const itemCollection = item ? collections.find((collection) => collection.id === item.collection_id) : null;
    const itemPinnedVariantId =
      item?.subject_type === 'asset'
        ? (item.pinned_variant_id ?? getPinnedVariantIdForAssetCollection(itemCollection, asset) ?? '')
        : '';
    const cardKey = `${collectionId ?? 'unfiled'}:${item?.id ?? asset.id}`;
    const targetCollectionId = cardTargets[cardKey] ?? orderedCollections[0]?.id ?? '';

    return (
      <article key={cardKey} className={styles.assetCard}>
        <button className={styles.thumbnailButton} onClick={() => onAssetClick(asset)}>
          <Thumbnail
            variant={displayVariant}
            size="fill"
            spaceId={spaceId}
            className={styles.thumbnail}
          />
        </button>
        <div className={styles.cardBody}>
          <button className={styles.assetName} onClick={() => onAssetClick(asset)}>
            {asset.name}
          </button>
          <div className={styles.assetMeta}>
            <span>{item?.subject_type === 'variant' ? 'Variant' : asset.type}</span>
            {item?.role && <span>{item.role}</span>}
          </div>
          {item && canEdit && (
            <div className={styles.itemEditors}>
              <input
                className={styles.roleInput}
                value={item.role}
                aria-label={`Role for ${asset.name}`}
                onChange={(event) => updateCollectionItem(item.collection_id, item.id, { role: event.target.value })}
              />
              {item.subject_type === 'asset' && assetVariants.length > 0 && (
                <select
                  className={styles.compactSelect}
                  value={itemPinnedVariantId}
                  aria-label={`Pinned variant for ${asset.name}`}
                  onChange={(event) => {
                    const pinnedVariantId =
                      event.target.value || getPinnedVariantIdForAssetCollection(itemCollection, asset);
                    updateCollectionItem(item.collection_id, item.id, { pinnedVariantId });
                  }}
                >
                  {itemCollection?.kind !== 'style_refs' && <option value="">Active variant</option>}
                  {assetVariants.map((variant, index) => (
                    <option key={variant.id} value={variant.id}>
                      Variant {index + 1}{variant.starred ? ' star' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
        <div className={styles.cardActions}>
          {onAddToTray && displayVariant && isVariantForgeTrayReady(displayVariant) && (
            <button className={styles.iconButton} onClick={() => onAddToTray(displayVariant, asset)} title="Add to Forge Tray">
              +
            </button>
          )}
          {onCreateRelation && (
            <button
              className={styles.iconButton}
              onClick={() => onCreateRelation({ subjectType: 'asset', assetId: asset.id })}
              title="Create relation"
            >
              Link
            </button>
          )}
          {canEdit && orderedCollections.length > 0 && (
            <details className={styles.cardMenu}>
              <summary title="Asset menu">...</summary>
              <div className={styles.cardMenuPanel}>
                <label>
                  <span>Add to</span>
                  <select
                    value={targetCollectionId}
                    onChange={(event) => setCardTargets((prev) => ({ ...prev, [cardKey]: event.target.value }))}
                  >
                    {orderedCollections.map((collection) => (
                      <option key={collection.id} value={collection.id}>{collection.name}</option>
                    ))}
                  </select>
                </label>
                <button onClick={() => targetCollectionId && addAssetToCollection(targetCollectionId, asset.id, getCollectionRole(targetCollectionId, item?.role ?? 'custom'))}>
                  Add asset
                </button>
                <button onClick={() => markAssetAsStyleReference(asset.id)}>
                  Mark style ref
                </button>
              </div>
            </details>
          )}
          {item && canEdit && collectionId && (
            <button
              className={styles.removeButton}
              onClick={() => deleteCollectionItem(collectionId, item.id)}
              title="Remove from collection"
            >
              x
            </button>
          )}
        </div>
      </article>
    );
  };

  const renderCollection = (collection: SpaceCollection, index: number) => {
    const items = getCollectionItems(collection.id, collectionItems);
    const selectedAssetId = addTargets[collection.id] ?? '';
    const color = collection.color ?? COLLECTION_KIND_COLORS[collection.kind];
    const style = { '--collection-color': color } as CSSProperties;

    return (
      <section key={collection.id} className={styles.collection} style={style}>
        <header className={styles.collectionHeader}>
          <span className={styles.colorSwatch} />
          <div className={styles.collectionTitleGroup}>
            {canEdit ? (
              <input
                className={styles.collectionNameInput}
                value={collection.name}
                aria-label="Collection name"
                onChange={(event) => updateCollection(collection.id, { name: event.target.value })}
              />
            ) : (
              <h2>{collection.name}</h2>
            )}
            <span>{COLLECTION_KIND_LABELS[collection.kind]} / {items.length}</span>
          </div>
          {canEdit && (
            <div className={styles.collectionActions}>
              <select
                className={styles.compactSelect}
                value={collection.kind}
                aria-label="Collection kind"
                onChange={(event) => updateCollection(collection.id, { kind: event.target.value as CollectionKind })}
              >
                {COLLECTION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{COLLECTION_KIND_LABELS[kind]}</option>
                ))}
              </select>
              <input
                className={styles.colorInput}
                type="color"
                value={color}
                aria-label="Collection color"
                onChange={(event) => updateCollection(collection.id, { color: event.target.value })}
              />
              <button className={styles.iconButton} onClick={() => moveCollection(collection, -1)} disabled={index === 0} title="Move collection up">Up</button>
              <button className={styles.iconButton} onClick={() => moveCollection(collection, 1)} disabled={index === orderedCollections.length - 1} title="Move collection down">Down</button>
              <button
                className={styles.dangerButton}
                onClick={() => {
                  if (window.confirm(`Delete "${collection.name}"? Assets and variants will remain in the space.`)) {
                    deleteCollection(collection.id);
                  }
                }}
              >
                Delete
              </button>
            </div>
          )}
        </header>
        {canEdit && assets.length > 0 && (
          <div className={styles.addRow}>
            <select
              value={selectedAssetId}
              onChange={(event) => setAddTargets((prev) => ({ ...prev, [collection.id]: event.target.value }))}
            >
              <option value="">Add asset...</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.name}</option>
              ))}
            </select>
            <button onClick={() => selectedAssetId && addAssetToCollection(collection.id, selectedAssetId, getCollectionRole(collection.id))}>
              Add
            </button>
          </div>
        )}
        <div className={styles.cardGrid}>
          {items.map((item, itemIndex) => {
            const asset = getItemAsset(item, assets, variants);
            if (!asset) return null;
            const ids = items.map((candidate) => candidate.id);
            return (
              <div key={item.id} className={styles.itemShell}>
                {canEdit && (
                  <div className={styles.itemOrder}>
                    <button onClick={() => reorderCollectionItems(collection.id, moveId(ids, item.id, -1))} disabled={itemIndex === 0} title="Move item up">Up</button>
                    <button onClick={() => reorderCollectionItems(collection.id, moveId(ids, item.id, 1))} disabled={itemIndex === items.length - 1} title="Move item down">Down</button>
                  </div>
                )}
                {renderAssetCard(asset, item, collection.id)}
              </div>
            );
          })}
          {items.length === 0 && <div className={styles.emptyCollection}>No items</div>}
        </div>
      </section>
    );
  };

  return (
    <main className={styles.board} aria-busy={isInitialSyncPending}>
      <div className={styles.boardHeader}>
        <div>
          <h2>Board</h2>
          <p>{collections.length} collections / {assets.length} assets</p>
        </div>
        {canEdit && (
          <div className={styles.createControls}>
            <input
              value={newName}
              placeholder="New collection"
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleCreateCollection();
              }}
            />
            <select value={newKind} onChange={(event) => {
              const kind = event.target.value as CollectionKind;
              setNewKind(kind);
              setNewColor(COLLECTION_KIND_COLORS[kind]);
            }}>
              {COLLECTION_KINDS.map((kind) => (
                <option key={kind} value={kind}>{COLLECTION_KIND_LABELS[kind]}</option>
              ))}
            </select>
            <input type="color" value={newColor} onChange={(event) => setNewColor(event.target.value)} aria-label="New collection color" />
            <button onClick={handleCreateCollection}>Create</button>
          </div>
        )}
      </div>

      {orderedCollections.length === 0 && canEdit && (
        <section className={styles.starterPanel}>
          <div>
            <h3>Start with production sections</h3>
            <p>Collections organize assets without changing lineage or parent fields.</p>
          </div>
          <button onClick={createStarterCollections}>Create starters</button>
        </section>
      )}

      <div className={styles.collectionsRail}>
        {orderedCollections.map(renderCollection)}
        {unfiledAssets.length > 0 && (
          <section className={`${styles.collection} ${styles.unfiled}`}>
            <header className={styles.collectionHeader}>
              <span className={styles.colorSwatch} />
              <div className={styles.collectionTitleGroup}>
                <h2>Unfiled</h2>
                <span>{unfiledAssets.length} assets</span>
              </div>
            </header>
            <div className={styles.cardGrid}>
              {unfiledAssets.map((asset) => renderAssetCard(asset, null))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

export default SpaceBoard;
