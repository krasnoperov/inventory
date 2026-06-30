import { useMemo, useState, type CSSProperties } from 'react';
import { Thumbnail } from '../Thumbnail';
import { CompositionPlacementControl } from '../CompositionPlacementControl';
import { getAudioCardMetadata } from '../assetCardMetadata';
import { Button, ColorInput, IconButton, TextInput, UiSelect, type SelectOption } from '../../ui';
import type {
  Asset,
  CollectionItem,
  CollectionItemCreateParams,
  CollectionItemUpdateParams,
  CollectionKind,
  Composition,
  CompositionItem,
  CompositionOverview,
  SpaceSubject,
  SpaceCollection,
  Variant,
} from '../../space/protocol';
import { isVariantAudioReady, isVariantForgeTrayReady, isVariantLoading, isVariantReady } from '../../space/protocol';
import type { CompositionShortcut } from '../../productionShortcuts';
import {
  aspectRatioForVariant,
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
  onRegenerateVariant?: (variant: Variant) => void;
  onCreateRelation?: (subject: SpaceSubject) => void;
  /** Compositions available as post-generation placement targets */
  compositions?: Array<Composition | CompositionOverview>;
  compositionItems?: CompositionItem[];
  /** Place a finished variant into a composition as a chosen role */
  onPlaceInComposition?: (variant: Variant, shortcut: CompositionShortcut) => void;
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

// Invisible flex children that absorb the free space on the final row so a
// sparse last row keeps its natural height instead of stretching to fill.
const ROW_FILLERS = Array.from({ length: 8 });
function renderRowFillers() {
  return ROW_FILLERS.map((_, index) => (
    <span key={`filler-${index}`} className={styles.cardFiller} aria-hidden="true" />
  ));
}

function MoreMenuIcon() {
  return (
    <svg className={styles.menuTriggerIcon} viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="4" cy="8" r="1.35" />
      <circle cx="8" cy="8" r="1.35" />
      <circle cx="12" cy="8" r="1.35" />
    </svg>
  );
}

const COLLECTION_KIND_OPTIONS: Array<SelectOption<CollectionKind>> = COLLECTION_KINDS.map((kind) => ({
  value: kind,
  label: COLLECTION_KIND_LABELS[kind],
}));

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
  onRegenerateVariant,
  onCreateRelation,
  compositions = [],
  compositionItems = [],
  onPlaceInComposition,
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
  const [isCreatePanelOpen, setIsCreatePanelOpen] = useState(false);
  const [openCollectionMenuId, setOpenCollectionMenuId] = useState<string | null>(null);
  const [openCardMenuKey, setOpenCardMenuKey] = useState<string | null>(null);
  const [addTargets, setAddTargets] = useState<Record<string, string>>({});
  const [cardTargets, setCardTargets] = useState<Record<string, string>>({});

  const toggleCreatePanel = () => {
    const nextOpen = !isCreatePanelOpen;
    setIsCreatePanelOpen(nextOpen);
    if (nextOpen) {
      setOpenCollectionMenuId(null);
      setOpenCardMenuKey(null);
    }
  };

  const toggleCollectionMenu = (collectionId: string) => {
    const nextOpenId = openCollectionMenuId === collectionId ? null : collectionId;
    setOpenCollectionMenuId(nextOpenId);
    if (nextOpenId) {
      setIsCreatePanelOpen(false);
      setOpenCardMenuKey(null);
    }
  };

  const toggleCardMenu = (cardKey: string) => {
    const nextOpenKey = openCardMenuKey === cardKey ? null : cardKey;
    setOpenCardMenuKey(nextOpenKey);
    if (nextOpenKey) {
      setIsCreatePanelOpen(false);
      setOpenCollectionMenuId(null);
    }
  };

  const orderedCollections = useMemo(() => sortCollections(collections), [collections]);
  const collectionOptions = useMemo<Array<SelectOption<string>>>(
    () => orderedCollections.map((collection) => ({ value: collection.id, label: collection.name })),
    [orderedCollections],
  );
  const assetOptions = useMemo<Array<SelectOption<string>>>(
    () => [
      { value: '', label: 'Add asset...' },
      ...assets.map((candidate) => ({ value: candidate.id, label: candidate.name })),
    ],
    [assets],
  );
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
    setIsCreatePanelOpen(false);
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

  const renderAssetCard = (
    asset: Asset,
    item: CollectionItem | null,
    collectionId?: string,
    itemIndex?: number,
    collectionItemIds: string[] = [],
  ) => {
    const displayVariant = getDisplayVariant(item, asset, variants);
    const assetVariants = variants.filter((variant) => variant.asset_id === asset.id);
    const generatingAudioVariant = assetVariants.find(
      (variant) => variant.media_kind === 'audio' && isVariantLoading(variant)
    );
    const itemCollection = item ? collections.find((collection) => collection.id === item.collection_id) : null;
    const itemPinnedVariantId =
      item?.subject_type === 'asset'
        ? (item.pinned_variant_id ?? getPinnedVariantIdForAssetCollection(itemCollection, asset) ?? '')
        : '';
    const cardKey = `${collectionId ?? 'unfiled'}:${item?.id ?? asset.id}`;
    const targetCollectionId = cardTargets[cardKey] ?? orderedCollections[0]?.id ?? '';
    const isCardMenuOpen = openCardMenuKey === cardKey;
    const aspectRatio = aspectRatioForVariant(displayVariant);
    const isAudioCard = displayVariant ? isVariantAudioReady(displayVariant) : false;
    const audioMetadata = getAudioCardMetadata(displayVariant);
    const pinnedVariantOptions: Array<SelectOption<string>> = [
      ...(itemCollection?.kind !== 'style_refs' ? [{ value: '', label: 'Main variant' }] : []),
      ...assetVariants.map((variant, index) => ({
        value: variant.id,
        label: `Variant ${index + 1}${variant.starred ? ' star' : ''}`,
      })),
    ];
    const audioFacts = [audioMetadata.name, audioMetadata.model, audioMetadata.voice].filter(
      (fact): fact is string => Boolean(fact),
    );
    const showAudioSummary = isAudioCard;
    const thumbnail = (
      <Thumbnail
        variant={displayVariant}
        size="fill"
        spaceId={spaceId}
        className={styles.thumbnail}
        showAudioControls={isAudioCard}
      />
    );

    return (
      <article
        key={cardKey}
        className={`${styles.assetCard} ${isAudioCard ? styles.audioAssetCard : ''} ${isCardMenuOpen ? styles.assetCardMenuHostOpen : ''}`}
        style={{ '--card-aspect': aspectRatio } as CSSProperties}
      >
        {isAudioCard ? (
          <div className={styles.thumbnailButton} title={asset.name}>
            {thumbnail}
          </div>
        ) : (
          <Button className={styles.thumbnailButton} onClick={() => onAssetClick(asset)} title={asset.name} variant="ghost" size="sm">
            {thumbnail}
          </Button>
        )}
        {!isAudioCard && (
          <div className={styles.caption}>
            <Button className={styles.assetName} onClick={() => onAssetClick(asset)} variant="ghost" size="sm">
              {asset.name}
            </Button>
            <div className={styles.assetMeta}>
              <span>{item?.subject_type === 'variant' ? 'variant' : asset.type}</span>
              {item?.role && item.role !== asset.type && <span>{item.role}</span>}
            </div>
          </div>
        )}
        {showAudioSummary && (
          <div className={styles.audioSummary}>
            <Button className={styles.audioAssetName} onClick={() => onAssetClick(asset)} variant="ghost" size="sm">
              {asset.name}
            </Button>
            <div className={styles.audioAssetMeta}>
              <span>{item?.subject_type === 'variant' ? 'variant' : asset.type}</span>
              {item?.role && item.role !== asset.type && <span>{item.role}</span>}
            </div>
            {audioFacts.length > 0 && (
              <div className={styles.audioMetaRow}>
                {audioFacts.map((value) => (
                  <span key={value} className={styles.audioMeta} title={value}>
                    {value}
                  </span>
                ))}
              </div>
            )}
            {audioMetadata.prompt && (
              <p className={styles.audioPrompt} title={audioMetadata.prompt}>
                {audioMetadata.prompt}
              </p>
            )}
            {generatingAudioVariant && displayVariant?.id !== generatingAudioVariant.id && (
              <div className={styles.audioProgressRow} aria-live="polite">
                <span className={styles.audioProgressSpinner} aria-hidden="true" />
                <span>
                  {generatingAudioVariant.status === 'pending'
                    ? 'New take queued'
                    : generatingAudioVariant.status === 'uploading'
                      ? 'New take uploading'
                      : 'New take generating'}
                </span>
              </div>
            )}
          </div>
        )}
        {(canEdit || onAddToTray || onCreateRelation || onPlaceInComposition) && (
          <div className={`${styles.cardMenu} ${isCardMenuOpen ? styles.cardMenuOpen : ''}`}>
            <IconButton
              className={styles.cardMenuTrigger}
              aria-label={`Actions for ${asset.name}`}
              title={`Actions for ${asset.name}`}
              aria-expanded={isCardMenuOpen}
              variant="ghost"
              size="sm"
              onClick={() => toggleCardMenu(cardKey)}
            >
              <MoreMenuIcon />
            </IconButton>
            {isCardMenuOpen && (
              <div className={styles.cardMenuPanel}>
                {onAddToTray && displayVariant && isVariantForgeTrayReady(displayVariant) && (
                  <Button className={styles.menuButton} onClick={() => onAddToTray(displayVariant, asset)}>
                    Add to Forge Tray
                  </Button>
                )}
                {onRegenerateVariant && displayVariant && isVariantAudioReady(displayVariant) && (
                  <Button className={styles.menuButton} onClick={() => onRegenerateVariant(displayVariant)}>
                    Regenerate audio
                  </Button>
                )}
                {onCreateRelation && (
                  <Button className={styles.menuButton} onClick={() => onCreateRelation({ subjectType: 'asset', assetId: asset.id })}>
                    Create relation
                  </Button>
                )}
                {canEdit && orderedCollections.length > 0 && (
                  <>
                    <label>
                      <span>Add to collection</span>
                      <UiSelect
                        className={styles.select}
                        fullWidth
                        label={`Collection target for ${asset.name}`}
                        value={targetCollectionId}
                        options={collectionOptions}
                        onValueChange={(value) => setCardTargets((prev) => ({ ...prev, [cardKey]: value }))}
                      />
                    </label>
                    <Button
                      className={styles.menuButton}
                      onClick={() => targetCollectionId && addAssetToCollection(targetCollectionId, asset.id, getCollectionRole(targetCollectionId, item?.role ?? 'custom'))}
                    >
                      Add asset
                    </Button>
                    <Button className={styles.menuButton} onClick={() => markAssetAsStyleReference(asset.id)}>
                      Mark style ref
                    </Button>
                  </>
                )}
                {canEdit && onPlaceInComposition && displayVariant && isVariantReady(displayVariant) && compositions.length > 0 && (
                  <CompositionPlacementControl
                    compositions={compositions}
                    compositionItems={compositionItems}
                    variant={displayVariant}
                    onPlace={onPlaceInComposition}
                  />
                )}
                {item && canEdit && (
                  <>
                    <label>
                      <span>Role</span>
                      <TextInput
                        value={item.role}
                        aria-label={`Role for ${asset.name}`}
                        onChange={(event) => updateCollectionItem(item.collection_id, item.id, { role: event.target.value })}
                        fullWidth
                      />
                    </label>
                    {item.subject_type === 'asset' && assetVariants.length > 0 && (
                      <label>
                        <span>Pinned variant</span>
                        <UiSelect
                          className={styles.select}
                          fullWidth
                          value={itemPinnedVariantId}
                          label={`Pinned variant for ${asset.name}`}
                          options={pinnedVariantOptions}
                          onValueChange={(value) => {
                            const pinnedVariantId =
                              value || getPinnedVariantIdForAssetCollection(itemCollection, asset);
                            updateCollectionItem(item.collection_id, item.id, { pinnedVariantId });
                          }}
                        />
                      </label>
                    )}
                  </>
                )}
                {item && canEdit && collectionId && itemIndex !== undefined && collectionItemIds.length > 0 && (
                  <div className={styles.menuButtonRow}>
                    <Button
                      className={styles.menuButton}
                      onClick={() => reorderCollectionItems(collectionId, moveId(collectionItemIds, item.id, -1))}
                      disabled={itemIndex === 0}
                    >
                      Move up
                    </Button>
                    <Button
                      className={styles.menuButton}
                      onClick={() => reorderCollectionItems(collectionId, moveId(collectionItemIds, item.id, 1))}
                      disabled={itemIndex === collectionItemIds.length - 1}
                    >
                      Move down
                    </Button>
                  </div>
                )}
                {item && canEdit && collectionId && (
                  <Button
                    className={styles.menuButton}
                    variant="danger"
                    onClick={() => deleteCollectionItem(collectionId, item.id)}
                  >
                    Remove from collection
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </article>
    );
  };

  const renderCollection = (collection: SpaceCollection, index: number) => {
    const items = getCollectionItems(collection.id, collectionItems);
    const selectedAssetId = addTargets[collection.id] ?? '';
    const color = collection.color ?? COLLECTION_KIND_COLORS[collection.kind];
    const style = { '--collection-color': color } as CSSProperties;
    const previewItems = items.slice(0, 6);
    const isCollectionMenuOpen = openCollectionMenuId === collection.id;

    return (
      <section
        key={collection.id}
        className={`${styles.collection} ${isCollectionMenuOpen ? styles.collectionMenuHostOpen : ''}`}
        style={style}
      >
        <header className={styles.collectionHeader}>
          <div className={styles.collectionTitleGroup}>
            <div className={styles.collectionEyebrow}>
              <span className={styles.colorDot} />
              <span>{COLLECTION_KIND_LABELS[collection.kind]}</span>
            </div>
            <h2>{collection.name}</h2>
            <p>{items.length} {items.length === 1 ? 'asset' : 'assets'}</p>
          </div>
          {canEdit && (
            <div className={`${styles.collectionMenu} ${isCollectionMenuOpen ? styles.collectionMenuOpen : ''}`}>
              <IconButton
                className={styles.collectionMenuTrigger}
                aria-label={`Manage collection ${collection.name}`}
                title={`Manage ${collection.name}`}
                aria-expanded={isCollectionMenuOpen}
                variant="ghost"
                size="sm"
                onClick={() => toggleCollectionMenu(collection.id)}
              >
                <MoreMenuIcon />
              </IconButton>
              {isCollectionMenuOpen && (
                <div className={styles.collectionMenuPanel}>
                  <label>
                    <span>Name</span>
                    <TextInput
                      className={styles.collectionNameInput}
                      value={collection.name}
                      aria-label="Collection name"
                      onChange={(event) => updateCollection(collection.id, { name: event.target.value })}
                      fullWidth
                    />
                  </label>
                  <label>
                    <span>Kind</span>
                    <UiSelect
                      className={styles.select}
                      fullWidth
                      value={collection.kind}
                      label="Collection kind"
                      options={COLLECTION_KIND_OPTIONS}
                      onValueChange={(kind) => updateCollection(collection.id, { kind })}
                    />
                  </label>
                  <label className={styles.colorField}>
                    <span>Color</span>
                    <ColorInput
                      value={color}
                      aria-label="Collection color"
                      onChange={(event) => updateCollection(collection.id, { color: event.target.value })}
                    />
                  </label>
                  {assets.length > 0 && (
                    <div className={styles.addRow}>
                      <UiSelect
                        className={styles.addSelect}
                        fullWidth
                        label={`Asset to add to ${collection.name}`}
                        value={selectedAssetId}
                        options={assetOptions}
                        onValueChange={(value) => setAddTargets((prev) => ({ ...prev, [collection.id]: value }))}
                      />
                      <Button
                        className={styles.menuButton}
                        onClick={() => selectedAssetId && addAssetToCollection(collection.id, selectedAssetId, getCollectionRole(collection.id))}
                      >
                        Add
                      </Button>
                    </div>
                  )}
                  <div className={styles.menuButtonRow}>
                    <Button
                      className={styles.menuButton}
                      onClick={() => moveCollection(collection, -1)}
                      disabled={index === 0}
                    >
                      Move up
                    </Button>
                    <Button
                      className={styles.menuButton}
                      onClick={() => moveCollection(collection, 1)}
                      disabled={index === orderedCollections.length - 1}
                    >
                      Move down
                    </Button>
                  </div>
                  <Button
                    className={styles.menuButton}
                    variant="danger"
                    onClick={() => {
                      if (window.confirm(`Delete "${collection.name}"? Assets and variants will remain in the space.`)) {
                        deleteCollection(collection.id);
                      }
                    }}
                  >
                    Delete collection
                  </Button>
                </div>
              )}
            </div>
          )}
        </header>
        {previewItems.length > 0 && (
          <div className={styles.previewStrip} aria-label={`${collection.name} preview assets`}>
            {previewItems.map((item) => {
              const asset = getItemAsset(item, assets, variants);
              if (!asset) return null;
              return (
                <Button key={item.id} className={styles.previewTile} onClick={() => onAssetClick(asset)} title={asset.name} variant="ghost" size="sm">
                  <Thumbnail
                    variant={getDisplayVariant(item, asset, variants)}
                    size="fill"
                    spaceId={spaceId}
                    className={styles.thumbnail}
                  />
                </Button>
              );
            })}
          </div>
        )}
        <div className={styles.cardGrid}>
          {items.map((item, itemIndex) => {
            const asset = getItemAsset(item, assets, variants);
            if (!asset) return null;
            const ids = items.map((candidate) => candidate.id);
            return renderAssetCard(asset, item, collection.id, itemIndex, ids);
          })}
          {items.length === 0 && <div className={styles.emptyCollection}>No items</div>}
          {items.length > 0 && renderRowFillers()}
        </div>
      </section>
    );
  };

  return (
    <main className={styles.board} aria-busy={isInitialSyncPending}>
      <div className={styles.boardHeader}>
        <div>
          <h2>Collections</h2>
          <p>{collections.length} collections · {assets.length} assets{unfiledAssets.length > 0 ? ` · ${unfiledAssets.length} unfiled` : ''}</p>
        </div>
        {canEdit && (
          <div className={styles.createControls}>
            <Button
              className={styles.createTrigger}
              onClick={toggleCreatePanel}
              aria-expanded={isCreatePanelOpen}
            >
              <span aria-hidden="true">+</span>
              <span>New collection</span>
            </Button>
            {isCreatePanelOpen && (
              <div className={styles.createPanel}>
                <TextInput
                  value={newName}
                  placeholder="Collection name"
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleCreateCollection();
                  }}
                  fullWidth
                />
                <UiSelect
                  className={styles.createKindSelect}
                  label="New collection kind"
                  value={newKind}
                  options={COLLECTION_KIND_OPTIONS}
                  onValueChange={(kind) => {
                    setNewKind(kind);
                    setNewColor(COLLECTION_KIND_COLORS[kind]);
                  }}
                />
                <ColorInput
                  value={newColor}
                  onChange={(event) => setNewColor(event.target.value)}
                  aria-label="New collection color"
                />
                <Button className={styles.menuButton} onClick={handleCreateCollection}>Create</Button>
              </div>
            )}
          </div>
        )}
      </div>

      {orderedCollections.length === 0 && canEdit && (
        <section className={styles.starterPanel}>
          <div>
            <h3>Start with production sections</h3>
            <p>Collections organize assets without changing lineage or parent fields.</p>
          </div>
          <Button className={styles.menuButton} onClick={createStarterCollections}>Create starters</Button>
        </section>
      )}

      <div className={styles.collectionsRail}>
        {orderedCollections.map(renderCollection)}
        {unfiledAssets.length > 0 && (
          <section className={`${styles.collection} ${styles.unfiled}`}>
            <header className={styles.collectionHeader}>
              <div className={styles.collectionTitleGroup}>
                <h2>Unfiled</h2>
                <span>{unfiledAssets.length} assets</span>
              </div>
            </header>
            <div className={styles.cardGrid}>
              {unfiledAssets.map((asset) => renderAssetCard(asset, null))}
              {renderRowFillers()}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

export default SpaceBoard;
