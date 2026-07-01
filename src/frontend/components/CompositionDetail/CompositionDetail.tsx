import { useMemo, useState, type ReactNode } from 'react';
import type {
  Asset,
  CollectionItem,
  Composition,
  CompositionItem,
  CompositionItemRole,
  CompositionOverview,
  Lineage,
  SpaceCollection,
  Variant,
} from '../../hooks/useSpaceWebSocket';
import { Thumbnail } from '../Thumbnail';
import { Button, IconButton, TextInput } from '../../ui';
import styles from './CompositionDetail.module.css';

const ROLE_CONFIG: Array<{
  role: CompositionItemRole;
  title: string;
  empty: string;
  single?: boolean;
}> = [
  { role: 'background', title: 'Background', empty: 'No background variant set', single: true },
  { role: 'character', title: 'Characters', empty: 'No character variants added' },
  { role: 'prop', title: 'Props', empty: 'No prop variants added' },
  { role: 'style_ref', title: 'Style References', empty: 'No style reference variants added' },
  { role: 'overlay', title: 'Overlays', empty: 'No overlay variants added' },
  { role: 'map', title: 'Map', empty: 'No map variant set', single: true },
  { role: 'thumbnail', title: 'Thumbnails', empty: 'No thumbnail variants added' },
];

type PickerTarget =
  | { kind: 'output' }
  | { kind: 'add'; role: CompositionItemRole }
  | { kind: 'replace'; item: CompositionItem };

export interface CompositionDetailProps {
  spaceId?: string;
  compositions: Array<Composition | CompositionOverview>;
  compositionItems: CompositionItem[];
  assets: Asset[];
  variants: Variant[];
  lineage?: Lineage[];
  collections?: SpaceCollection[];
  collectionItems?: CollectionItem[];
  selectedCompositionId: string | null;
  canEdit?: boolean;
  onSelectComposition: (compositionId: string) => void;
  onCreateComposition?: () => void;
  onUpdateComposition: (compositionId: string, changes: {
    name?: string;
    description?: string | null;
    status?: 'draft' | 'final';
    outputAssetId?: string | null;
    outputVariantId?: string | null;
  }) => void;
  onDeleteComposition?: (compositionId: string) => void;
  onCreateItem: (compositionId: string, params: {
    role: CompositionItemRole;
    assetId?: string | null;
    variantId: string;
    sortIndex?: number;
  }) => void;
  onUpdateItem: (compositionId: string, itemId: string, changes: {
    role?: CompositionItemRole;
    assetId?: string | null;
    variantId?: string;
    sortIndex?: number;
  }) => void;
  onDeleteItem: (compositionId: string, itemId: string) => void;
  onReorderItems: (compositionId: string, itemIds: string[]) => void;
  onOpenAsset?: (assetId: string) => void;
  onClose?: () => void;
}

export function CompositionDetail({
  spaceId,
  compositions,
  compositionItems,
  assets,
  variants,
  lineage = [],
  collections = [],
  collectionItems = [],
  selectedCompositionId,
  canEdit = true,
  onSelectComposition,
  onCreateComposition,
  onUpdateComposition,
  onDeleteComposition,
  onCreateItem,
  onUpdateItem,
  onDeleteItem,
  onReorderItems,
  onOpenAsset,
  onClose,
}: CompositionDetailProps) {
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [query, setQuery] = useState('');
  const [editingName, setEditingName] = useState(false);

  const selectedComposition = useMemo(
    () => compositions.find((composition) => composition.id === selectedCompositionId) ?? null,
    [compositions, selectedCompositionId],
  );
  const selectedItems = useMemo(
    () => compositionItems
      .filter((item) => item.composition_id === selectedCompositionId)
      .sort((a, b) => a.sort_index - b.sort_index || a.created_at - b.created_at),
    [compositionItems, selectedCompositionId],
  );

  const outputVariant = selectedComposition?.output_variant_id
    ? variants.find((variant) => variant.id === selectedComposition.output_variant_id) ?? null
    : null;
  const outputAsset = selectedComposition?.output_asset_id
    ? assets.find((asset) => asset.id === selectedComposition.output_asset_id) ?? null
    : outputVariant
      ? assets.find((asset) => asset.id === outputVariant.asset_id) ?? null
      : null;

  const filteredVariants = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return variants
      .map((variant) => ({
        variant,
        asset: assets.find((asset) => asset.id === variant.asset_id) ?? null,
      }))
      .filter(({ variant, asset }) => {
        if (!needle) return true;
        return (
          variant.id.toLowerCase().includes(needle) ||
          asset?.name.toLowerCase().includes(needle) ||
          asset?.type.toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => (a.asset?.name ?? '').localeCompare(b.asset?.name ?? '') || b.variant.created_at - a.variant.created_at);
  }, [assets, query, variants]);

  const collectionMemberships = useMemo(() => {
    const memberships = new Map<string, string[]>();
    for (const item of collectionItems) {
      const assetId = item.asset_id ?? variants.find((variant) => variant.id === item.variant_id)?.asset_id;
      if (!assetId) continue;
      const collection = collections.find((entry) => entry.id === item.collection_id);
      if (!collection) continue;
      memberships.set(assetId, [...(memberships.get(assetId) ?? []), collection.name]);
    }
    return memberships;
  }, [collectionItems, collections, variants]);

  const referencedVariantIds = new Set([
    selectedComposition?.output_variant_id,
    ...selectedItems.map((item) => item.variant_id),
  ].filter(Boolean) as string[]);
  const relatedLineageCount = lineage.filter((entry) => (
    referencedVariantIds.has(entry.parent_variant_id) || referencedVariantIds.has(entry.child_variant_id)
  )).length;

  const applyVariant = (variant: Variant) => {
    if (!selectedComposition || !pickerTarget) return;
    if (pickerTarget.kind === 'output') {
      onUpdateComposition(selectedComposition.id, {
        outputAssetId: variant.asset_id,
        outputVariantId: variant.id,
      });
    } else if (pickerTarget.kind === 'add') {
      const maxSort = selectedItems.reduce((max, item) => Math.max(max, item.sort_index), -1);
      onCreateItem(selectedComposition.id, {
        role: pickerTarget.role,
        assetId: variant.asset_id,
        variantId: variant.id,
        sortIndex: maxSort + 1,
      });
    } else {
      onUpdateItem(selectedComposition.id, pickerTarget.item.id, {
        assetId: variant.asset_id,
        variantId: variant.id,
      });
    }
    setPickerTarget(null);
    setQuery('');
  };

  const renameComposition = (name: string) => {
    if (!selectedComposition) return;
    const trimmed = name.trim();
    if (trimmed && trimmed !== selectedComposition.name) {
      onUpdateComposition(selectedComposition.id, { name: trimmed });
    }
    setEditingName(false);
  };

  const moveItem = (item: CompositionItem, direction: -1 | 1) => {
    if (!selectedComposition) return;
    const roleItems = selectedItems.filter((entry) => entry.role === item.role);
    const currentIndex = roleItems.findIndex((entry) => entry.id === item.id);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= roleItems.length) return;
    const reordered = [...roleItems];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, moved);
    const reorderedIds = reordered.map((entry) => entry.id);
    const allIds = selectedItems.map((entry) =>
      entry.role === item.role ? reorderedIds.shift()! : entry.id
    );
    onReorderItems(selectedComposition.id, allIds);
  };

  return (
    <aside className={styles.panel} aria-label="Composition detail">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Composition Detail</p>
          <h2>Exact variant production structure</h2>
        </div>
        {onClose && (
          <IconButton className={styles.panelIconAction} onClick={onClose} title="Close composition detail" aria-label="Close composition detail">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </IconButton>
        )}
      </div>

      <div className={styles.body}>
        <section className={styles.listSection} aria-label="Compositions">
          <div className={styles.sectionHeader}>
            <span>Compositions</span>
            {canEdit && onCreateComposition && (
              <IconButton
                className={styles.sectionCreateButton}
                size="sm"
                variant="ghost"
                onClick={() => onCreateComposition()}
                title="Create composition"
                aria-label="Create composition"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </IconButton>
            )}
          </div>
          <div className={styles.compositionList}>
            {compositions.length === 0 ? (
              <p className={styles.emptyText}>No compositions yet.</p>
            ) : compositions.map((composition) => (
              <Button
                key={composition.id}
                variant={composition.id === selectedCompositionId ? 'secondary' : 'ghost'}
                size="sm"
                className={`${styles.compositionButton} ${composition.id === selectedCompositionId ? styles.selected : ''}`}
                aria-pressed={composition.id === selectedCompositionId}
                onClick={() => onSelectComposition(composition.id)}
              >
                <span>{composition.name}</span>
                <small>{composition.status}</small>
              </Button>
            ))}
          </div>
        </section>

        {!selectedComposition ? (
          <div className={styles.noSelection}>Select or create a composition.</div>
        ) : (
          <section className={styles.detail}>
            <div className={styles.titleRow}>
              {editingName ? (
                <TextInput
                  aria-label="Composition name"
                  className={styles.nameInput}
                  defaultValue={selectedComposition.name}
                  autoFocus
                  fullWidth
                  onBlur={(event) => renameComposition(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') renameComposition(event.currentTarget.value);
                    if (event.key === 'Escape') setEditingName(false);
                  }}
                />
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.nameButton}
                  onClick={() => canEdit && setEditingName(true)}
                  disabled={!canEdit}
                >
                  {selectedComposition.name}
                </Button>
              )}
              {canEdit && onDeleteComposition && (
                <IconButton
                  className={styles.titleDeleteButton}
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${selectedComposition.name}`}
                  title={`Delete ${selectedComposition.name}`}
                  onClick={() => onDeleteComposition(selectedComposition.id)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M4 7h16" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M6 7l1 13h10l1-13" />
                    <path d="M9 7V4h6v3" />
                  </svg>
                </IconButton>
              )}
            </div>

            <div className={styles.notice}>
              Exact variant usage is stored here. Collection membership, relations, and generation lineage remain separate.
            </div>

            <SlotBlock
              title="Output"
              empty="No exact output variant set"
              addLabel="Add Output variant"
              canEdit={canEdit}
              single
              onAdd={() => setPickerTarget({ kind: 'output' })}
            >
              {outputVariant && outputAsset && (
                <VariantUsageRow
                  spaceId={spaceId}
                  variant={outputVariant}
                  asset={outputAsset}
                  collectionNames={collectionMemberships.get(outputAsset.id) ?? []}
                  canEdit={canEdit}
                  onOpenAsset={onOpenAsset}
                  onReplace={() => setPickerTarget({ kind: 'output' })}
                  onRemove={() => onUpdateComposition(selectedComposition.id, {
                    outputAssetId: null,
                    outputVariantId: null,
                  })}
                />
              )}
            </SlotBlock>

            {ROLE_CONFIG.map((config) => {
              const items = selectedItems.filter((item) => item.role === config.role);
              return (
                <SlotBlock
                  key={config.role}
                  title={config.title}
                  empty={config.empty}
                  addLabel={`Add ${config.title} variant`}
                  canEdit={canEdit}
                  single={config.single}
                  onAdd={() => setPickerTarget({ kind: 'add', role: config.role })}
                  hasItems={items.length > 0}
                >
                  {items.map((item, index) => {
                    const variant = variants.find((entry) => entry.id === item.variant_id);
                    const asset = assets.find((entry) => entry.id === (item.asset_id ?? variant?.asset_id));
                    if (!variant || !asset) {
                      return (
                        <div key={item.id} className={styles.missingRow}>
                          Missing source variant {item.variant_id}
                          {canEdit && (
                            <IconButton
                              className={`${styles.rowIconButton} ${styles.rowRemoveButton}`}
                              size="sm"
                              variant="ghost"
                              onClick={() => onDeleteItem(selectedComposition.id, item.id)}
                              title={`Remove missing variant ${item.variant_id} from composition`}
                              aria-label={`Remove missing variant ${item.variant_id} from composition`}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                <path d="M4 7h16" />
                                <path d="M10 11v6M14 11v6" />
                                <path d="M6 7l1 13h10l1-13" />
                                <path d="M9 7V4h6v3" />
                              </svg>
                            </IconButton>
                          )}
                        </div>
                      );
                    }
                    return (
                      <VariantUsageRow
                        key={item.id}
                        spaceId={spaceId}
                        variant={variant}
                        asset={asset}
                        collectionNames={collectionMemberships.get(asset.id) ?? []}
                        canEdit={canEdit}
                        onOpenAsset={onOpenAsset}
                        onReplace={() => setPickerTarget({ kind: 'replace', item })}
                        onRemove={() => onDeleteItem(selectedComposition.id, item.id)}
                        onMoveUp={index > 0 ? () => moveItem(item, -1) : undefined}
                        onMoveDown={index < items.length - 1 ? () => moveItem(item, 1) : undefined}
                      />
                    );
                  })}
                </SlotBlock>
              );
            })}

            <div className={styles.separationGrid}>
              <div>
                <strong>Collection membership</strong>
                <span>Shown as asset-level context only.</span>
              </div>
              <div>
                <strong>Variant lineage</strong>
                <span>{relatedLineageCount} nearby lineage link{relatedLineageCount === 1 ? '' : 's'}; not edited by composition slots.</span>
              </div>
            </div>
          </section>
        )}
      </div>

      {pickerTarget && (
        <div className={styles.pickerOverlay} role="dialog" aria-label="Choose exact variant">
          <div className={styles.picker}>
            <div className={styles.pickerHeader}>
              <strong>Choose exact variant</strong>
              <IconButton className={styles.panelIconAction} onClick={() => setPickerTarget(null)} title="Close variant picker" aria-label="Close variant picker">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </IconButton>
            </div>
            <TextInput
              aria-label="Search exact variants"
              className={styles.searchInput}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search assets or variant IDs"
            />
            <div className={styles.variantList}>
              {filteredVariants.map(({ variant, asset }) => (
                <Button
                  key={variant.id}
                  className={styles.variantChoice}
                  variant="secondary"
                  size="sm"
                  onClick={() => applyVariant(variant)}
                >
                  <Thumbnail variant={variant} size="xs" spaceId={spaceId} />
                  <span>
                    <strong>{asset?.name ?? 'Missing asset'}</strong>
                    <small>{variant.id}{asset?.active_variant_id === variant.id ? ' / active' : ''}</small>
                  </span>
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

interface SlotBlockProps {
  title: string;
  empty: string;
  addLabel: string;
  canEdit: boolean;
  single?: boolean;
  hasItems?: boolean;
  onAdd: () => void;
  children: ReactNode;
}

function SlotBlock({ title, empty, addLabel, canEdit, single, hasItems, onAdd, children }: SlotBlockProps) {
  const hasChildren = hasItems ?? Boolean(children);
  return (
    <section className={styles.slot}>
      <div className={styles.slotHeader}>
        <h3>{title}</h3>
        {canEdit && (!single || !hasChildren) && (
          <IconButton
            className={styles.slotAddButton}
            size="sm"
            variant="ghost"
            onClick={onAdd}
            title={addLabel}
            aria-label={addLabel}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </IconButton>
        )}
      </div>
      <div className={styles.slotBody}>
        {hasChildren ? children : <p className={styles.emptyText}>{empty}</p>}
      </div>
    </section>
  );
}

interface VariantUsageRowProps {
  spaceId?: string;
  variant: Variant;
  asset: Asset;
  collectionNames: string[];
  canEdit: boolean;
  onOpenAsset?: (assetId: string) => void;
  onReplace: () => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

function VariantUsageRow({
  spaceId,
  variant,
  asset,
  collectionNames,
  canEdit,
  onOpenAsset,
  onReplace,
  onRemove,
  onMoveUp,
  onMoveDown,
}: VariantUsageRowProps) {
  return (
    <div className={styles.usageRow}>
      <Thumbnail variant={variant} size="sm" spaceId={spaceId} />
      <div className={styles.usageInfo}>
        <strong>{asset.name}</strong>
        <span>Exact variant {variant.id}</span>
        <small>
          Asset collection: {collectionNames.length > 0 ? collectionNames.join(', ') : 'none'}
        </small>
      </div>
      <div className={styles.rowActions}>
        {canEdit && onMoveUp && (
          <IconButton className={styles.rowIconButton} onClick={onMoveUp} title="Move up" aria-label="Move up">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m18 15-6-6-6 6" />
            </svg>
          </IconButton>
        )}
        {canEdit && onMoveDown && (
          <IconButton className={styles.rowIconButton} onClick={onMoveDown} title="Move down" aria-label="Move down">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </IconButton>
        )}
        {onOpenAsset && (
          <IconButton
            className={styles.rowIconButton}
            size="sm"
            variant="ghost"
            onClick={() => onOpenAsset(asset.id)}
            title={`Open ${asset.name} asset`}
            aria-label={`Open ${asset.name} asset`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M7 17 17 7" />
              <path d="M9 7h8v8" />
            </svg>
          </IconButton>
        )}
        {canEdit && (
          <IconButton
            className={styles.rowIconButton}
            size="sm"
            variant="ghost"
            onClick={onReplace}
            title={`Replace ${asset.name} variant`}
            aria-label={`Replace ${asset.name} variant`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 12a9 9 0 0 1 14.5-7.1" />
              <path d="M17 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-14.5 7.1" />
              <path d="M7 21v-5h5" />
            </svg>
          </IconButton>
        )}
        {canEdit && (
          <IconButton
            className={`${styles.rowIconButton} ${styles.rowRemoveButton}`}
            size="sm"
            variant="ghost"
            onClick={onRemove}
            title={`Remove ${asset.name} from composition`}
            aria-label={`Remove ${asset.name} from composition`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M4 7h16" />
              <path d="M10 11v6M14 11v6" />
              <path d="M6 7l1 13h10l1-13" />
              <path d="M9 7V4h6v3" />
            </svg>
          </IconButton>
        )}
      </div>
    </div>
  );
}

export interface CompositionUsageListProps {
  targetAssetId: string;
  assets: Asset[];
  variants: Variant[];
  compositions: Array<Composition | CompositionOverview>;
  compositionItems: CompositionItem[];
  onOpenComposition: (compositionId: string) => void;
}

export function CompositionUsageList({
  targetAssetId,
  assets,
  variants,
  compositions,
  compositionItems,
  onOpenComposition,
}: CompositionUsageListProps) {
  const targetAsset = assets.find((asset) => asset.id === targetAssetId) ?? null;
  const variantIds = new Set(variants.filter((variant) => variant.asset_id === targetAssetId).map((variant) => variant.id));
  const usages = compositions
    .map((composition) => {
      const exactItems = compositionItems.filter((item) => (
        item.composition_id === composition.id && (
          item.asset_id === targetAssetId || variantIds.has(item.variant_id)
        )
      ));
      const outputMatches = (
        composition.output_asset_id === targetAssetId ||
        (composition.output_variant_id ? variantIds.has(composition.output_variant_id) : false)
      );
      return { composition, exactItems, outputMatches };
    })
    .filter((entry) => entry.outputMatches || entry.exactItems.length > 0);

  if (!targetAsset || usages.length === 0) {
    return null;
  }

  return (
    <section className={styles.usageList} aria-label="Composition usage">
      <div className={styles.usageHeader}>
        <h2 className={styles.usageTitle}>
          Composition usage
          <span className={styles.usageCount}>{usages.length}</span>
        </h2>
      </div>
      {usages.map(({ composition, exactItems, outputMatches }) => (
        <Button
          key={composition.id}
          className={styles.usageButton}
          variant="ghost"
          size="sm"
          onClick={() => onOpenComposition(composition.id)}
        >
          <strong>{composition.name}</strong>
          <span className={styles.usageRole}>
            {outputMatches ? 'output' : exactItems.map((item) => roleLabel(item.role)).join(', ')}
          </span>
        </Button>
      ))}
    </section>
  );
}

function roleLabel(role: CompositionItemRole): string {
  return ROLE_CONFIG.find((config) => config.role === role)?.title ?? role.replace('_', ' ');
}

export default CompositionDetail;
