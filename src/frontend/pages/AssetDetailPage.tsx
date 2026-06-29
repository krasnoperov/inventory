import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useParams } from '../hooks/useParams';
import { useForgeTrayStore, type PrefillAudioParams } from '../stores/forgeTrayStore';
import { useChatStore } from '../stores/chatStore';
import { useAssetDetailStore, useSelectedVariantId } from '../stores/assetDetailStore';
import { HeaderNav } from '../components/HeaderNav';
import { WorkspaceChrome } from '../components/WorkspaceChrome';
import {
  CanvasToolbar,
  CanvasToolbarButton,
  CanvasToolbarDivider,
  CanvasToolbarGroup,
  CanvasToolbarLink,
  CanvasToolbarLive,
  CanvasToolbarTitle,
} from '../components/CanvasToolbar';
import { UsageIndicator } from '../components/UsageIndicator';
import {
  useSpaceWebSocket,
  PREDEFINED_ASSET_TYPES,
  type Asset,
  type Variant,
  type ChatForgeContext,
  type SpaceRelation,
  type SpaceRelationContext,
  type SpaceRelationType,
  type SpaceSubject,
  type GenerationEstimateResult,
} from '../hooks/useSpaceWebSocket';
import { ForgeTray } from '../components/ForgeTray';
import { VariantCanvas } from '../components/VariantCanvas';
import { useForgeOperations } from '../hooks/useForgeOperations';
import { useImageUpload } from '../hooks/useImageUpload';
import { RotationPanel } from '../components/RotationPanel/RotationPanel';
import { TileGrid } from '../components/TileGrid/TileGrid';
import { RelationEditorDialog, RelationsPanel } from '../components/RelationsPanel';
import { CompositionDetail, CompositionUsageList } from '../components/CompositionDetail';
import { StyleReferenceUsagePanel } from '../components/StyleReferenceUsagePanel';
import {
  applyCompositionShortcut,
  type CompositionShortcut,
} from '../productionShortcuts';
import { applyCreatedOutputCollectionPlacements } from '../collectionPlacements';
import { CollectionPlacementPicker } from '../components/CollectionPlacementPicker';
import type { CollectionPlacementInput } from '../../shared/websocket-types';
import type { CollectionItem, SpaceCollection } from '../space/protocol';
import { formatMediaKind } from '../mediaKind';
import { assetDetailsQueryOptions, sessionQueryOptions, spacePageQueryOptions } from '../queries';
import { isWebRotationEnabled } from '../feature-flags';
import { Button, UiSelect, type SelectOption } from '../ui';
import styles from './AssetDetailPage.module.css';

// Confirmation dialog types
interface ConfirmDialog {
  type: 'deleteVariant' | 'deleteAsset';
  title: string;
  message: string;
  onConfirm: () => void;
}

type RelationEditorState =
  | { mode: 'create'; subject: SpaceSubject }
  | { mode: 'edit'; relation: SpaceRelation };

interface AssetTypeSelectProps {
  className?: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

interface AssetCollectionsPanelProps {
  assetPlacementControlsOpen?: boolean;
  assetPlacementDrafts: CollectionPlacementInput[];
  collections: SpaceCollection[];
  collectionItems: CollectionItem[];
  onAssetPlacementControlsOpenChange?: (open: boolean) => void;
  onApplyAssetPlacements: () => void;
  onApplyVariantPlacements: () => void;
  onAssetPlacementDraftsChange: (value: CollectionPlacementInput[]) => void;
  onDeleteCollectionItem: (collectionId: string, itemId: string) => void;
  onUpdateCollectionItem: (collectionId: string, itemId: string, changes: { role?: string; pinnedVariantId?: string | null }) => void;
  onVariantPlacementControlsOpenChange?: (open: boolean) => void;
  onVariantPlacementDraftsChange: (value: CollectionPlacementInput[]) => void;
  selectedVariant: Variant | null;
  variantPlacementControlsOpen?: boolean;
  variantPlacementDrafts: CollectionPlacementInput[];
  variants: Variant[];
}

interface AssetDetailsStripProps {
  asset: Asset;
  assetCollectionCount: number;
  assetTypeDisabled?: boolean;
  fullDetailsOpen: boolean;
  onAssetTypeChange?: (value: string) => void;
  onToggleFullDetails: () => void;
  selectedVariant: Variant | null;
  selectedVariantCollectionCount: number;
  variantCount: number;
}

interface AssetDetailsContextProps extends AssetDetailsStripProps {
  children?: React.ReactNode;
}

function titleizeAssetType(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replace('-', ' ');
}

function getVariantOptionLabel(variant: Variant, index: number) {
  return `Variant ${index + 1}${variant.starred ? ' star' : ''}`;
}

function titleizeStatus(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replace('-', ' ');
}

function formatDimensions(variant: Variant | null) {
  if (!variant?.media_width || !variant.media_height) return null;
  return `${variant.media_width}x${variant.media_height}`;
}

function formatDuration(ms: number | null | undefined) {
  if (!ms) return null;
  const seconds = ms / 1000;
  return seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`;
}

function formatSelectedVariant(variant: Variant | null) {
  if (!variant) return 'None';
  return `${formatMediaKind(variant.media_kind)} · ${titleizeStatus(variant.status)}`;
}

const ASSET_TYPE_OPTIONS: Array<SelectOption<string>> = PREDEFINED_ASSET_TYPES.map((type) => ({
  value: type,
  label: titleizeAssetType(type),
}));

export function AssetTypeSelect({
  className,
  value,
  disabled = false,
  onChange,
}: AssetTypeSelectProps) {
  return (
    <UiSelect
      value={value}
      options={ASSET_TYPE_OPTIONS}
      onValueChange={onChange}
      disabled={disabled}
      label="Asset type"
      className={className ?? styles.assetTypeSelect}
    />
  );
}

export function AssetCollectionsPanel({
  assetPlacementControlsOpen,
  assetPlacementDrafts,
  collections,
  collectionItems,
  onAssetPlacementControlsOpenChange,
  onApplyAssetPlacements,
  onApplyVariantPlacements,
  onAssetPlacementDraftsChange,
  onDeleteCollectionItem,
  onUpdateCollectionItem,
  onVariantPlacementControlsOpenChange,
  onVariantPlacementDraftsChange,
  selectedVariant,
  variantPlacementControlsOpen,
  variantPlacementDrafts,
  variants,
}: AssetCollectionsPanelProps) {
  const [assetPlacementOpen, setAssetPlacementOpen] = useState(false);
  const [variantPlacementOpen, setVariantPlacementOpen] = useState(false);
  const assetCollectionMemberships = collectionItems.filter((item) => item.subject_type === 'asset');
  const selectedVariantCollectionMemberships = selectedVariant
    ? collectionItems.filter((item) => item.subject_type === 'variant' && item.variant_id === selectedVariant.id)
    : [];
  const variantOptions = useMemo<Array<SelectOption<string>>>(() => [
    { value: '', label: 'Main variant' },
    ...variants.map((variant, index) => ({
      value: variant.id,
      label: getVariantOptionLabel(variant, index),
    })),
  ], [variants]);
  const resolvedAssetPlacementOpen = assetPlacementControlsOpen ?? assetPlacementOpen;
  const resolvedVariantPlacementOpen = variantPlacementControlsOpen ?? variantPlacementOpen;
  const setResolvedAssetPlacementOpen = onAssetPlacementControlsOpenChange ?? setAssetPlacementOpen;
  const setResolvedVariantPlacementOpen = onVariantPlacementControlsOpenChange ?? setVariantPlacementOpen;
  const showAssetPlacementControls = resolvedAssetPlacementOpen || assetPlacementDrafts.length > 0;
  const showVariantPlacementControls = resolvedVariantPlacementOpen || variantPlacementDrafts.length > 0;

  if (collections.length === 0) return null;

  return (
    <section className={styles.collectionPanel} aria-label="Collection membership">
      <div className={styles.collectionPanelHeader}>
        <span>Asset collections</span>
        {assetCollectionMemberships.length > 0 && <span>{assetCollectionMemberships.length}</span>}
      </div>
      {assetCollectionMemberships.map((item) => {
        const collection = collections.find((entry) => entry.id === item.collection_id);
        const collectionName = collection?.name ?? 'collection';
        return (
          <div key={item.id} className={styles.collectionMembershipRow}>
            <span>{collection?.name ?? 'Collection'}</span>
            <input
              value={item.role}
              aria-label={`Role in ${collectionName}`}
              onChange={(event) => onUpdateCollectionItem(item.collection_id, item.id, { role: event.target.value })}
            />
            <UiSelect
              value={item.pinned_variant_id ?? ''}
              options={variantOptions}
              onValueChange={(nextValue) => onUpdateCollectionItem(item.collection_id, item.id, { pinnedVariantId: nextValue || null })}
              label={`Pinned variant in ${collectionName}`}
              fullWidth
            />
            <Button
              size="sm"
              variant="danger"
              onClick={() => onDeleteCollectionItem(item.collection_id, item.id)}
            >
              Remove
            </Button>
          </div>
        );
      })}
      {showAssetPlacementControls ? (
        <div className={styles.collectionPlacementControls}>
          <CollectionPlacementPicker
            collections={collections}
            value={assetPlacementDrafts}
            onChange={onAssetPlacementDraftsChange}
            label="Add asset to collections"
            defaultSubjectType="asset"
            showPinToCreatedVariant={Boolean(selectedVariant)}
          />
          <div className={styles.collectionPanelActions}>
            {assetPlacementDrafts.length > 0 && (
              <Button
                size="sm"
                className={styles.collectionPanelAction}
                  onClick={() => {
                    onApplyAssetPlacements();
                    setResolvedAssetPlacementOpen(false);
                  }}
              >
                Add asset placement
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className={styles.collectionPanelAction}
              onClick={() => setResolvedAssetPlacementOpen(false)}
            >
              Hide
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" className={styles.collectionPanelAction} onClick={() => setResolvedAssetPlacementOpen(true)}>
          Add asset to collection
        </Button>
      )}

      {selectedVariant && (
        <>
          <div className={styles.collectionPanelHeader}>
            <span>Selected variant collections</span>
            {selectedVariantCollectionMemberships.length > 0 && <span>{selectedVariantCollectionMemberships.length}</span>}
          </div>
          {selectedVariantCollectionMemberships.map((item) => {
            const collection = collections.find((entry) => entry.id === item.collection_id);
            const collectionName = collection?.name ?? 'collection';
            return (
              <div key={item.id} className={styles.collectionMembershipRow}>
                <span>{collection?.name ?? 'Collection'}</span>
                <input
                  value={item.role}
                  aria-label={`Variant role in ${collectionName}`}
                  onChange={(event) => onUpdateCollectionItem(item.collection_id, item.id, { role: event.target.value })}
                />
                <Button
                  size="sm"
                  variant="danger"
                  className={styles.variantCollectionRemoveButton}
                  onClick={() => onDeleteCollectionItem(item.collection_id, item.id)}
                >
                  Remove
                </Button>
              </div>
            );
          })}
          {showVariantPlacementControls ? (
            <div className={styles.collectionPlacementControls}>
              <CollectionPlacementPicker
                collections={collections}
                value={variantPlacementDrafts}
                onChange={onVariantPlacementDraftsChange}
                label="Add selected variant to collections"
                defaultSubjectType="variant"
              />
              <div className={styles.collectionPanelActions}>
                {variantPlacementDrafts.length > 0 && (
                  <Button
                    size="sm"
                    className={styles.collectionPanelAction}
                    onClick={() => {
                      onApplyVariantPlacements();
                      setResolvedVariantPlacementOpen(false);
                    }}
                  >
                    Add variant placement
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className={styles.collectionPanelAction}
                  onClick={() => setResolvedVariantPlacementOpen(false)}
                >
                  Hide
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" className={styles.collectionPanelAction} onClick={() => setResolvedVariantPlacementOpen(true)}>
              Add variant to collection
            </Button>
          )}
        </>
      )}
    </section>
  );
}

export function AssetDetailsStrip({
  asset,
  assetCollectionCount,
  assetTypeDisabled = false,
  fullDetailsOpen,
  onAssetTypeChange,
  onToggleFullDetails,
  selectedVariant,
  selectedVariantCollectionCount,
  variantCount,
}: AssetDetailsStripProps) {
  const dimensions = formatDimensions(selectedVariant);
  const duration = formatDuration(selectedVariant?.media_duration_ms);
  const collectionCount = assetCollectionCount + selectedVariantCollectionCount;
  const detailsActionLabel = `${fullDetailsOpen ? 'Hide' : 'Show'} ${formatMediaKind(asset.media_kind).toLowerCase()} details`;

  return (
    <section className={styles.assetDetailsStrip} aria-label="Asset details">
      <div className={styles.assetDetailsIdentity}>
        <div className={styles.assetDetailsEyebrow}>
          <span>Asset details</span>
          <span>{formatMediaKind(asset.media_kind)}</span>
        </div>
        <div className={styles.assetDetailsName} title={asset.name}>
          {asset.name}
        </div>
      </div>

      <dl className={styles.assetDetailsFacts}>
        <div>
          <dt>Type</dt>
          <dd>
            {onAssetTypeChange ? (
              <AssetTypeSelect
                className={styles.assetDetailsTypeSelect}
                value={asset.type}
                onChange={onAssetTypeChange}
                disabled={assetTypeDisabled}
              />
            ) : (
              titleizeAssetType(asset.type)
            )}
          </dd>
        </div>
        <div>
          <dt>Variants</dt>
          <dd>{variantCount}</dd>
        </div>
        <div>
          <dt>Selected</dt>
          <dd>{formatSelectedVariant(selectedVariant)}</dd>
        </div>
        {dimensions && (
          <div>
            <dt>Size</dt>
            <dd>{dimensions}</dd>
          </div>
        )}
        {duration && (
          <div>
            <dt>Duration</dt>
            <dd>{duration}</dd>
          </div>
        )}
        <div>
          <dt>Collections</dt>
          <dd>{collectionCount}</dd>
        </div>
      </dl>

      <Button
        size="sm"
        variant="secondary"
        className={`${styles.assetDetailsAction} ${fullDetailsOpen ? styles.assetDetailsActionOpen : ''}`}
        onClick={() => onToggleFullDetails()}
        aria-expanded={fullDetailsOpen}
        aria-label={detailsActionLabel}
        title={detailsActionLabel}
      >
        Details
        <svg
          className={styles.assetDetailsChevron}
          viewBox="0 0 16 16"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </Button>
    </section>
  );
}

export function AssetDetailsContext({
  children,
  ...stripProps
}: AssetDetailsContextProps) {
  return (
    <div className={styles.assetDetailsContext}>
      <AssetDetailsStrip {...stripProps} />
      {stripProps.fullDetailsOpen && children && (
        <div className={styles.assetExpandedDetailsPanel}>
          {children}
        </div>
      )}
    </div>
  );
}

export default function AssetDetailPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const params = useParams();
  const spaceId = params.spaceId;
  const assetId = params.assetId;
  const assetDetailsQuery = useQuery({
    ...assetDetailsQueryOptions(spaceId || '', assetId || ''),
    enabled: Boolean(user && spaceId && assetId),
  });
  const spaceDataQuery = useQuery({
    ...spacePageQueryOptions(spaceId || ''),
    enabled: Boolean(user && spaceId),
  });
  const sessionQuery = useQuery(sessionQueryOptions());

  const space = spaceDataQuery.data?.space ?? null;
  const canEdit = space?.role === 'owner' || space?.role === 'editor';
  const queryAsset = assetDetailsQuery.data?.asset ?? null;
  const queryVariants = assetDetailsQuery.data?.variants ?? [];
  const queryLineage = useMemo(
    () => assetDetailsQuery.data?.lineage ?? [],
    [assetDetailsQuery.data?.lineage],
  );
  const error = assetDetailsQuery.error instanceof Error ? assetDetailsQuery.error.message : null;
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [forgeError, setForgeError] = useState<string | null>(null);
  const [forgeErrorCode, setForgeErrorCode] = useState<string | null>(null);
  const [generationEstimate, setGenerationEstimate] = useState<GenerationEstimateResult | null>(null);
  const [assetPlacementDrafts, setAssetPlacementDrafts] = useState<CollectionPlacementInput[]>([]);
  const [variantPlacementDrafts, setVariantPlacementDrafts] = useState<CollectionPlacementInput[]>([]);
  const [variantPlacementControlsOpen, setVariantPlacementControlsOpen] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [relationEditor, setRelationEditor] = useState<RelationEditorState | null>(null);
  const [showCompositionPanel, setShowCompositionPanel] = useState(false);
  const [selectedCompositionId, setSelectedCompositionId] = useState<string | null>(null);
  const collectionPanelRef = React.useRef<HTMLDivElement | null>(null);
  const rotationEnabled = isWebRotationEnabled(sessionQuery.data);

  // Variant selection state (persisted in store)
  const selectedVariantId = useSelectedVariantId(assetId || '');
  const setSelectedVariantId = useAssetDetailStore((state) => state.setSelectedVariantId);

  // Rotation panel state
  const [showRotationPanel, setShowRotationPanel] = useState(false);

  // Inline editing state
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');

  // Forge tray store
  const { addSlot, prefillFromVariant } = useForgeTrayStore();

  // Persistent chat state from Zustand store (shared across pages)
  const chatMessages = useChatStore((state) => state.messages);
  const isChatLoading = useChatStore((state) => state.isLoading);
  const chatProgress = useChatStore((state) => state.progress);
  const chatError = useChatStore((state) => state.error);
  const historyLoaded = useChatStore((state) => state.historyLoaded);
  const {
    setMessages: setChatMessages,
    replaceTemporaryMessage,
    addMessage: addChatMessage,
    addTemporaryUserMessage,
    setLoading: setChatLoading,
    setProgress: setChatProgress,
    setError: setChatError,
    resetOnDisconnect: resetChatOnDisconnect,
    initForSpace,
  } = useChatStore();

  // Initialize chat store for this space (clears if different space)
  useEffect(() => {
    if (spaceId) {
      initForSpace(spaceId);
    }
  }, [spaceId, initForSpace]);

  // WebSocket for real-time updates
  const {
    assets: wsAssets,
    variants: wsVariants,
    collections,
    collectionItems,
    stylePresets,
    compositions,
    compositionItems,
    lineage: wsLineage,
    relations: wsRelations,
    jobs,
    setActiveVariant,
    deleteVariant,
    deleteAsset,
    starVariant,
    retryVariant,
    regenerateVariant,
    updateAsset,
    addCollectionItem,
    updateCollectionItem,
    deleteCollectionItem,
    createRelation,
    updateRelation,
    deleteRelation,
    clearJob,
    requestSync,
    status: wsStatus,
    sendGenerateRequest,
    sendRefineRequest,
    sendPersistentChatMessage,
    requestChatHistory,
    clearChatSession,
    forkAsset,
    createComposition,
    updateComposition,
    deleteComposition,
    createCompositionItem,
    updateCompositionItem,
    reorderCompositionItems,
    deleteCompositionItem,
    updateSession,
    createStylePreset,
    updateStylePreset,
    deleteStylePreset,
    sendBatchRequest,
    sendGenerationEstimateRequest,
    rotationSets,
    rotationViews,
    sendRotationRequest,
    sendRotationCancel,
    sendVariantRate,
    tileSets,
    tilePositions,
    sendRetryTile,
    sendRefineEdges,
    sendRefineTile,
  } = useSpaceWebSocket({
    spaceId: spaceId || '',
    syncMode: 'full',
    requestChatHistoryOnConnect: true,
    onDisconnect: () => {
      // Reset chat loading states on disconnect
      resetChatOnDisconnect();
    },
    onJobComplete: (completedJob) => {
      // Navigate to new asset if this job created one (different from current)
      if (completedJob.assetId && completedJob.assetId !== assetId) {
        navigate(`/spaces/${spaceId}/assets/${completedJob.assetId}`);
      }
    },
    onChatHistory: (messages) => {
      setChatMessages(messages);
    },
    onPersistentChatMessage: (message) => {
      if (message.role === 'user') {
        // User message confirmation from server - replace temp message
        replaceTemporaryMessage(message);
      } else {
        // Bot response - append and clear loading state
        setChatLoading(false);
        setChatProgress(null);
        addChatMessage(message);
      }
    },
    onPersistentChatProgress: (progress) => {
      setChatProgress(progress);
    },
    onGenerateError: (data) => {
      setForgeError(data.error);
      setForgeErrorCode(data.code);
      setTimeout(() => {
        setForgeError(null);
        setForgeErrorCode(null);
      }, 5000);
    },
    onRefineError: (data) => {
      setForgeError(data.error);
      setForgeErrorCode(data.code);
      setTimeout(() => {
        setForgeError(null);
        setForgeErrorCode(null);
      }, 5000);
    },
    onBatchError: (data) => {
      setForgeError(data.error);
      setForgeErrorCode(data.code);
      setTimeout(() => {
        setForgeError(null);
        setForgeErrorCode(null);
      }, 5000);
    },
    onGenerationEstimate: setGenerationEstimate,
    onError: (error) => {
      // Handle WebSocket errors - clear chat loading state
      if (isChatLoading) {
        setChatError(error.message || 'Chat request failed');
      }
    },
  });

  const wsAsset = wsStatus === 'connected' && assetId
    ? wsAssets.find(a => a.id === assetId)
    : undefined;
  const asset = wsAsset ?? queryAsset;
  const wsAssetVariants = useMemo(
    () => (
      wsStatus === 'connected' && assetId
        ? wsVariants.filter(v => v.asset_id === assetId)
        : []
    ),
    [assetId, wsStatus, wsVariants],
  );
  const variants = wsAssetVariants.length > 0 ? wsAssetVariants : queryVariants;
  const lineage = useMemo(() => {
    if (wsStatus !== 'connected' || wsAssetVariants.length === 0 || wsLineage.length === 0) {
      return queryLineage;
    }

    const variantIds = new Set(wsAssetVariants.map(v => v.id));
    return wsLineage.filter(
      l => variantIds.has(l.child_variant_id) || variantIds.has(l.parent_variant_id)
    );
  }, [queryLineage, wsStatus, wsAssetVariants, wsLineage]);
  const relationSubjects = useMemo<SpaceSubject[]>(() => {
    if (!assetId) return [];
    return [
      { subjectType: 'asset', assetId },
      ...variants.map((variant) => ({ subjectType: 'variant' as const, variantId: variant.id })),
    ];
  }, [assetId, variants]);
  const relationAssets = wsAssets.length > 0 ? wsAssets : ([asset].filter(Boolean) as Asset[]);
  const relationVariants = wsVariants.length > 0 ? wsVariants : variants;
  const isLoading = assetDetailsQuery.isPending && !asset;

  // Derive selectedVariant from variants array
  const selectedVariant = useMemo(() => {
    if (!selectedVariantId) return null;
    return variants.find(v => v.id === selectedVariantId) || null;
  }, [selectedVariantId, variants]);
  const assetCollectionMemberships = useMemo(() => {
    if (!assetId) return [];
    return collectionItems.filter((item) => item.subject_type === 'asset' && item.asset_id === assetId);
  }, [assetId, collectionItems]);
  const selectedVariantCollectionMemberships = useMemo(() => {
    if (!selectedVariant) return [];
    return collectionItems.filter((item) => item.subject_type === 'variant' && item.variant_id === selectedVariant.id);
  }, [collectionItems, selectedVariant]);

  useEffect(() => {
    setVariantPlacementDrafts([]);
  }, [selectedVariantId]);

  // Set page title
  useDocumentTitle(asset?.name);

  // Child assets derived from variant lineage. Historical parent_asset_id values
  // stay readable in asset payloads but are no longer used as organization UI.
  const styleUsage = useMemo(() => {
    if (!assetId) {
      return { collections: [], presets: [], outputs: [] as Asset[] };
    }
    const assetVariantIds = new Set(variants.map((variant) => variant.id));
    const usedCollectionIds = new Set(
      collectionItems
        .filter((item) => (
          item.role === 'style_ref' &&
          (
            item.asset_id === assetId ||
            (item.variant_id ? assetVariantIds.has(item.variant_id) : false) ||
            (item.pinned_variant_id ? assetVariantIds.has(item.pinned_variant_id) : false)
          )
        ))
        .map((item) => item.collection_id)
    );
    const usedCollections = collections.filter((collection) => usedCollectionIds.has(collection.id));
    const usedPresets = stylePresets.filter((preset) => (
      Boolean(preset.collection_id && usedCollectionIds.has(preset.collection_id)) ||
      preset.style_reference_variant_ids.some((variantId) => assetVariantIds.has(variantId))
    ));
    const outputAssetIds = new Set<string>();
    for (const relation of wsRelations) {
      if (relation.relation_type !== 'style_reference_for') continue;
      const subjectMatches =
        relation.subject_asset_id === assetId ||
        (relation.subject_variant_id ? assetVariantIds.has(relation.subject_variant_id) : false);
      if (!subjectMatches) continue;
      if (relation.object_asset_id) {
        outputAssetIds.add(relation.object_asset_id);
      } else if (relation.object_variant_id) {
        const outputVariant = wsVariants.find((variant) => variant.id === relation.object_variant_id);
        if (outputVariant) outputAssetIds.add(outputVariant.asset_id);
      }
    }
    const outputs = wsAssets.filter((candidate) => outputAssetIds.has(candidate.id));
    return { collections: usedCollections, presets: usedPresets, outputs };
  }, [assetId, collectionItems, collections, stylePresets, variants, wsAssets, wsRelations, wsVariants]);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    if (!spaceId || !assetId) {
      navigate('/dashboard');
      return;
    }
  }, [user, spaceId, assetId, navigate]);

  useEffect(() => {
    const data = assetDetailsQuery.data;
    if (!data || !assetId) {
      return;
    }

    const variantsData = data.variants || [];

    // Select active variant by default (only if no stored selection)
    const storedSelection = useAssetDetailStore.getState().sessions[assetId]?.selectedVariantId;
    const hasValidStoredSelection = storedSelection && variantsData.some(v => v.id === storedSelection);

    if (!hasValidStoredSelection) {
      if (data.asset.active_variant_id) {
        const activeVariant = variantsData.find(v => v.id === data.asset.active_variant_id);
        if (activeVariant) {
          setSelectedVariantId(assetId, activeVariant.id);
        }
      } else if (variantsData.length > 0) {
        setSelectedVariantId(assetId, variantsData[0].id);
      }
    }
  }, [assetDetailsQuery.data, assetId, setSelectedVariantId]);

  // Sync session context when asset/variant changes
  useEffect(() => {
    if (wsStatus !== 'connected' || !assetId) return;
    updateSession({
      viewingAssetId: assetId,
      viewingVariantId: selectedVariantId ?? null,
    });
  }, [wsStatus, assetId, selectedVariantId, updateSession]);

  // Keep variant selection valid as WebSocket state replaces the initial REST payload.
  useEffect(() => {
    if (wsStatus !== 'connected' || !assetId) return;

    const assetVariants = wsVariants.filter(v => v.asset_id === assetId);
    if (
      assetVariants.length > 0 &&
      selectedVariantId &&
      !assetVariants.some(v => v.id === selectedVariantId)
    ) {
      setSelectedVariantId(assetId, assetVariants[0]?.id || null);
    }
  }, [wsStatus, wsVariants, assetId, selectedVariantId, setSelectedVariantId]);

  // Action handlers
  const handleSetActiveVariant = useCallback((variantId: string) => {
    if (!assetId || actionInProgress) return;
    setActionInProgress(true);
    setActiveVariant(assetId, variantId);
    setTimeout(() => setActionInProgress(false), 500);
  }, [assetId, setActiveVariant, actionInProgress]);

  const handleStarVariant = useCallback((variantId: string, starred: boolean) => {
    starVariant(variantId, starred);
  }, [starVariant]);

  const handleStartEditName = useCallback(() => {
    if (!asset) return;
    setEditNameValue(asset.name);
    setEditingName(true);
  }, [asset]);

  const handleSaveName = useCallback(() => {
    if (!asset || !assetId) return;
    const newName = editNameValue.trim();
    if (newName && newName !== asset.name) {
      updateAsset(assetId, { name: newName });
    }
    setEditingName(false);
  }, [asset, assetId, editNameValue, updateAsset]);

  const handleCancelEditName = useCallback(() => {
    setEditingName(false);
    setEditNameValue('');
  }, []);

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveName();
    } else if (e.key === 'Escape') {
      handleCancelEditName();
    }
  }, [handleSaveName, handleCancelEditName]);

  const handleTypeChange = useCallback((newType: string) => {
    if (!asset || !assetId || newType === asset.type) return;
    updateAsset(assetId, { type: newType });
  }, [asset, assetId, updateAsset]);

  const handleDeleteVariant = useCallback((variant: Variant) => {
    setConfirmDialog({
      type: 'deleteVariant',
      title: 'Delete Variant',
      message: `Are you sure you want to delete this variant? This action cannot be undone.`,
      onConfirm: () => {
        setActionInProgress(true);
        deleteVariant(variant.id);
        setConfirmDialog(null);
        if (selectedVariantId === variant.id) {
          const remaining = variants.filter(v => v.id !== variant.id);
          setSelectedVariantId(assetId!, remaining[0]?.id || null);
        }
        setTimeout(() => setActionInProgress(false), 500);
      },
    });
  }, [deleteVariant, selectedVariantId, variants, assetId, setSelectedVariantId]);

  const handleDeleteAsset = useCallback(() => {
    if (!assetId) return;
    setConfirmDialog({
      type: 'deleteAsset',
      title: 'Delete Asset',
      message: `Are you sure you want to delete "${asset?.name}"? All variants will be permanently deleted. This action cannot be undone.`,
      onConfirm: () => {
        setActionInProgress(true);
        deleteAsset(assetId);
        setConfirmDialog(null);
        setTimeout(() => {
          navigate(`/spaces/${spaceId}`);
        }, 500);
      },
    });
  }, [assetId, asset?.name, deleteAsset, navigate, spaceId]);

  const handleOpenCreateRelation = useCallback((subject: SpaceSubject) => {
    setRelationEditor({ mode: 'create', subject });
  }, []);

  const handleOpenEditRelation = useCallback((relation: SpaceRelation) => {
    setRelationEditor({ mode: 'edit', relation });
  }, []);

  const handleCreateRelation = useCallback((params: {
    subject: SpaceSubject;
    object: SpaceSubject;
    relationType: SpaceRelationType;
    context: SpaceRelationContext | null;
  }) => {
    createRelation(params);
    setRelationEditor(null);
  }, [createRelation]);

  const handleUpdateRelation = useCallback((relationId: string, changes: {
    relationType: SpaceRelationType;
    context: SpaceRelationContext | null;
  }) => {
    updateRelation(relationId, changes);
    setRelationEditor(null);
  }, [updateRelation]);

  const handleVariantClick = useCallback((variant: Variant) => {
    setSelectedVariantId(assetId!, variant.id);
    setVariantPlacementDrafts([]);
  }, [assetId, setSelectedVariantId]);

  // Handle add to forge tray
  const handleAddToTray = useCallback((variant: Variant, targetAsset?: Asset) => {
    if (targetAsset) {
      addSlot(variant, targetAsset);
    } else if (asset) {
      addSlot(variant, asset);
    }
  }, [addSlot, asset]);

  const handleAddVariantToCollection = useCallback((variant: Variant) => {
    if (!assetId || !canEdit) return;
    setSelectedVariantId(assetId, variant.id);
    setVariantPlacementDrafts([]);
    setVariantPlacementControlsOpen(true);
    setShowInspector(true);
    requestAnimationFrame(() => {
      collectionPanelRef.current?.scrollIntoView({ block: 'nearest' });
    });
  }, [assetId, canEdit, setSelectedVariantId]);

  const handleApplyAssetPlacements = useCallback(() => {
    if (!asset || assetPlacementDrafts.length === 0) return;
    const pinVariantId = selectedVariant?.id ?? asset.active_variant_id ?? variants[0]?.id;
    if (!pinVariantId) return;
    applyCreatedOutputCollectionPlacements(
      assetPlacementDrafts,
      { assetId: asset.id, variantId: pinVariantId },
      collectionItems,
      addCollectionItem,
      'asset'
    );
    setAssetPlacementDrafts([]);
  }, [addCollectionItem, asset, assetPlacementDrafts, collectionItems, selectedVariant, variants]);

  const handleApplyVariantPlacements = useCallback(() => {
    if (!asset || !selectedVariant || variantPlacementDrafts.length === 0) return;
    applyCreatedOutputCollectionPlacements(
      variantPlacementDrafts,
      { assetId: asset.id, variantId: selectedVariant.id },
      collectionItems,
      addCollectionItem,
      'variant'
    );
    setVariantPlacementDrafts([]);
  }, [addCollectionItem, asset, collectionItems, selectedVariant, variantPlacementDrafts]);

  // Handle retry recipe - restore ForgeTray state from variant's recipe and lineage
  const handleRetryRecipe = useCallback((variant: Variant) => {
    // Parse the recipe to get the prompt and parentVariantIds (fallback)
    let prompt = '';
    let recipeParentVariantIds: string[] = [];
    let audioParams: PrefillAudioParams | undefined;
    try {
      const recipe = JSON.parse(variant.recipe);
      prompt = recipe.prompt || '';
      // Recipe stores parentVariantIds for retry support (in case lineage is missing)
      recipeParentVariantIds = recipe.parentVariantIds || [];
      // Carry audio params so regeneration reuses the same voices/provider.
      if (variant.media_kind === 'audio') {
        audioParams = {
          voiceId: recipe.voiceId,
          dialogueVoiceIds: recipe.dialogueVoiceIds,
          musicProvider: recipe.musicProvider,
        };
      }
    } catch {
      // Ignore parse errors
    }

    // Find parent variant IDs from lineage first, fall back to recipe
    let parentVariantIds = lineage
      .filter(l => l.child_variant_id === variant.id)
      .map(l => l.parent_variant_id);

    // If lineage is empty, use recipe's parentVariantIds (legacy/retry support)
    if (parentVariantIds.length === 0 && recipeParentVariantIds.length > 0) {
      parentVariantIds = recipeParentVariantIds;
    }

    // Prefill the forge tray with the same state
    prefillFromVariant(parentVariantIds, prompt, wsAssets, wsVariants, audioParams);
  }, [lineage, prefillFromVariant, wsAssets, wsVariants]);

  const handleRegenerateVariant = useCallback((variant: Variant) => {
    regenerateVariant(variant.id);
  }, [regenerateVariant]);

  const handleCreateCompositionFromVariant = useCallback(() => {
    if (!canEdit || !asset || !selectedVariant) return;
    const id = createComposition({
      name: `${asset.name} composition`,
      outputAssetId: asset.id,
      outputVariantId: selectedVariant.id,
    });
    setSelectedCompositionId(id);
    setShowCompositionPanel(true);
  }, [asset, canEdit, createComposition, selectedVariant]);

  const handleOpenComposition = useCallback((compositionId: string) => {
    requestSync();
    setSelectedCompositionId(compositionId);
    setShowCompositionPanel(true);
  }, [requestSync]);

  // Use shared forge operations hook
  const { handleForgeSubmit } = useForgeOperations({
    sendGenerateRequest,
    sendRefineRequest,
    forkAsset,
    sendBatchRequest,
  });

  // Post-generation composition placement: apply a chosen role to a finished
  // variant, replacing the old pre-generation shortcut dropdown.
  const handlePlaceInComposition = useCallback((variant: Variant, shortcut: CompositionShortcut) => {
    applyCompositionShortcut(shortcut, variant, compositionItems, {
      updateComposition,
      createCompositionItem,
      updateCompositionItem,
    });
  }, [compositionItems, updateComposition, createCompositionItem, updateCompositionItem]);

  // Image upload hook
  const { upload: uploadImage, isUploading } = useImageUpload({
    spaceId: spaceId || '',
  });

  const handleUpload = useCallback(async (file: File, assetId: string) => {
    await uploadImage(file, assetId);
  }, [uploadImage]);

  const handleExportTrainingData = useCallback((pipeline: 'tiles' | 'rotations' | 'all') => {
    if (!spaceId) return;
    window.open(`/api/spaces/${spaceId}/training-data?pipeline=${pipeline}`, '_blank');
  }, [spaceId]);

  // Handle persistent chat message - wraps sendPersistentChatMessage to manage loading state
  const handleSendChatMessage = useCallback((content: string, forgeContext?: ChatForgeContext) => {
    // Add user message to UI immediately (optimistic) and set loading
    addTemporaryUserMessage(content);
    sendPersistentChatMessage(content, forgeContext);
  }, [sendPersistentChatMessage, addTemporaryUserMessage]);

  const headerRightSlot = user ? (
    <div className={styles.headerRight}>
      <HeaderNav userName={user.name} userEmail={user.email} />
    </div>
  ) : (
    <Link to="/login" className={styles.authButton}>Sign In</Link>
  );

  if (isLoading) {
    return (
      <div className={styles.page}>
        <WorkspaceChrome
          leftSlot={<Link to="/dashboard" className={styles.brand}>Make Effects</Link>}
          rightSlot={headerRightSlot}
          statusSlot={<UsageIndicator />}
        />
        <div className={styles.loadingPage}>
          <div className={styles.loading}>Loading asset...</div>
        </div>
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div className={styles.page}>
        <WorkspaceChrome
          leftSlot={<Link to="/dashboard" className={styles.brand}>Make Effects</Link>}
          rightSlot={headerRightSlot}
          statusSlot={<UsageIndicator />}
        />
        <div className={styles.errorPage}>
          <div className={styles.error}>
            <h2>Error</h2>
            <p>{error || 'Asset not found'}</p>
            <Link to={`/spaces/${spaceId}`} className={styles.backLink}>Back to Space</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <WorkspaceChrome
        leftSlot={<Link to="/dashboard" className={styles.brand}>Make Effects</Link>}
        rightSlot={headerRightSlot}
        statusSlot={<UsageIndicator />}
      />

      {/* Full-screen canvas container */}
      <div className={styles.canvasContainer}>
        {/* Variant Canvas - fills entire container */}
        <VariantCanvas
          spaceId={spaceId}
          asset={asset}
          variants={variants}
          lineage={lineage}
          selectedVariantId={selectedVariant?.id}
          jobs={jobs}
          onVariantClick={handleVariantClick}
          onAddToTray={handleAddToTray}
          onSetActive={handleSetActiveVariant}
          onRetry={retryVariant}
          onRetryRecipe={handleRetryRecipe}
          onRegenerateVariant={handleRegenerateVariant}
          allVariants={wsVariants}
          allAssets={wsAssets}
          onGhostNodeClick={(assetId) => navigate(`/spaces/${spaceId}/assets/${assetId}`)}
          onStarVariant={handleStarVariant}
          onDeleteVariant={handleDeleteVariant}
          onCreateRelation={handleOpenCreateRelation}
          onAddVariantToCollection={canEdit && collections.length > 0 ? handleAddVariantToCollection : undefined}
          compositions={compositions}
          compositionItems={compositionItems}
          onPlaceInComposition={canEdit ? handlePlaceInComposition : undefined}
        />

        {/* Tile Grid overlay for tile-set assets */}
        {(() => {
          const tileSet = tileSets.find(ts => ts.asset_id === assetId);
          if (!tileSet) return null;
          return (
            <div className={styles.tileGridOverlay}>
              <TileGrid
                tileSet={tileSet}
                tilePositions={tilePositions}
                variants={wsVariants}
                selectedVariantId={selectedVariant?.id}
                onCellClick={(variantId) => setSelectedVariantId(assetId!, variantId)}
                onRetryTile={sendRetryTile}
                onRefineTile={sendRefineTile}
                onRefineEdges={sendRefineEdges}
                onRateVariant={sendVariantRate}
                onExportTrainingData={() => handleExportTrainingData('tiles')}
              />
            </div>
          );
        })()}

        {/* Asset info overlay - top left */}
        <div className={styles.assetOverlay}>
          <CanvasToolbar ariaLabel="Asset detail controls" className={styles.detailToolbar}>
            <CanvasToolbarLink to={`/spaces/${spaceId}`} title="Back to space">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5" />
                <path d="M12 19l-7-7 7-7" />
              </svg>
            </CanvasToolbarLink>
            <CanvasToolbarTitle className={styles.assetTitleSlot}>
              {editingName ? (
                <input
                  type="text"
                  className={styles.titleInput}
                  value={editNameValue}
                  onChange={(e) => setEditNameValue(e.target.value)}
                  onKeyDown={handleNameKeyDown}
                  onBlur={handleSaveName}
                  autoFocus
                />
              ) : (
                <h1
                  className={styles.title}
                  onClick={handleStartEditName}
                  title="Click to rename"
                >
                  {asset.name}
                </h1>
              )}
            </CanvasToolbarTitle>
            {wsStatus === 'connected' && (
              <CanvasToolbarGroup>
                <CanvasToolbarLive />
              </CanvasToolbarGroup>
            )}
            <CanvasToolbarDivider />
            {rotationEnabled && selectedVariant?.status === 'completed' && selectedVariant?.image_key && (
              <CanvasToolbarButton
                onClick={() => setShowRotationPanel(true)}
                title="Generate rotation views from selected variant"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                  <path d="M21 3v6h-6" />
                </svg>
              </CanvasToolbarButton>
            )}
            <CanvasToolbarButton
              onClick={() => handleOpenCreateRelation({ subjectType: 'asset', assetId })}
              disabled={actionInProgress}
              title="Create relation"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4.93" />
                <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L13 19.07" />
              </svg>
            </CanvasToolbarButton>
            {canEdit && (
              <CanvasToolbarButton
                onClick={handleCreateCompositionFromVariant}
                disabled={!selectedVariant}
                title="Create composition from selected variant"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="4" y="4" width="7" height="7" rx="1" />
                  <rect x="13" y="4" width="7" height="7" rx="1" />
                  <rect x="8.5" y="13" width="7" height="7" rx="1" />
                  <path d="M11 7.5h2" />
                  <path d="M12 11v2" />
                </svg>
              </CanvasToolbarButton>
            )}
            <CanvasToolbarButton
              onClick={handleDeleteAsset}
              disabled={actionInProgress}
              danger
              title="Delete asset"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v5" />
                <path d="M14 11v5" />
              </svg>
            </CanvasToolbarButton>
          </CanvasToolbar>

          {/* Derivatives aren't listed here — the canvas already shows them as
              clickable lineage nodes. */}
        </div>

        {/* Jobs overlay - bottom left */}
        {jobs.size > 0 && (() => {
          const assetJobs = Array.from(jobs.values()).filter(
            j => j.assetId === assetId || j.assetName === asset.name
          );
          if (assetJobs.length === 0) return null;

          return (
            <div className={styles.jobsOverlay}>
              {assetJobs.map((job) => (
                <div key={job.jobId} className={`${styles.jobCard} ${styles[job.status]}`}>
                  <div className={styles.jobStatus}>
                    {job.status === 'pending' && '⏳'}
                    {job.status === 'processing' && '🎨'}
                    {job.status === 'completed' && '✓'}
                    {job.status === 'failed' && '✗'}
                  </div>
                  <div className={styles.jobInfo}>
                    <span className={styles.jobTitle}>
                      {job.status === 'pending' && 'Queued'}
                      {job.status === 'processing' && 'Creating variant...'}
                      {job.status === 'completed' && 'Done'}
                      {job.status === 'failed' && 'Failed'}
                    </span>
                    {job.prompt && job.status !== 'completed' && (
                      <span className={styles.jobPrompt}>
                        "{job.prompt.length > 60 ? job.prompt.slice(0, 60) + '...' : job.prompt}"
                      </span>
                    )}
                    {job.error && <span className={styles.jobError}>{job.error}</span>}
                  </div>
                  {(job.status === 'completed' || job.status === 'failed') && (
                    <button
                      className={styles.dismissButton}
                      onClick={() => clearJob(job.jobId)}
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              ))}
            </div>
          );
        })()}

      </div>

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div className={styles.dialogOverlay} onClick={() => setConfirmDialog(null)}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.dialogTitle}>{confirmDialog.title}</h3>
            <p className={styles.dialogMessage}>{confirmDialog.message}</p>
            <div className={styles.dialogActions}>
              <button
                className={styles.dialogCancel}
                onClick={() => setConfirmDialog(null)}
              >
                Cancel
              </button>
              <button
                className={styles.dialogConfirm}
                onClick={confirmDialog.onConfirm}
              >
                {confirmDialog.type === 'deleteAsset' ? 'Delete Asset' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCompositionPanel && (
        <div className={styles.compositionPanelContainer}>
          <CompositionDetail
            spaceId={spaceId}
            compositions={compositions}
            compositionItems={compositionItems}
            assets={wsAssets}
            variants={wsVariants}
            lineage={wsLineage}
            collections={collections}
            collectionItems={collectionItems}
            selectedCompositionId={selectedCompositionId}
            canEdit={canEdit}
            onSelectComposition={setSelectedCompositionId}
            onCreateComposition={canEdit ? () => {
              const id = createComposition({ name: `Composition ${compositions.length + 1}` });
              setSelectedCompositionId(id);
            } : undefined}
            onUpdateComposition={updateComposition}
            onDeleteComposition={(compositionId) => {
              deleteComposition(compositionId);
              setSelectedCompositionId((current) => current === compositionId ? null : current);
            }}
            onCreateItem={createCompositionItem}
            onUpdateItem={updateCompositionItem}
            onDeleteItem={deleteCompositionItem}
            onReorderItems={reorderCompositionItems}
            onOpenAsset={(nextAssetId) => navigate(`/spaces/${spaceId}/assets/${nextAssetId}`)}
            onClose={() => setShowCompositionPanel(false)}
          />
        </div>
      )}

      {/* Forge Tray - persistent bottom bar for generation */}
      <ForgeTray
        allAssets={wsAssets}
        allVariants={wsVariants}
        onSubmit={handleForgeSubmit}
        onBrandBackground={false}
        currentAsset={asset}
        contextSlot={(
          <AssetDetailsContext
            asset={asset}
            assetCollectionCount={assetCollectionMemberships.length}
            assetTypeDisabled={actionInProgress}
            fullDetailsOpen={showInspector}
            onAssetTypeChange={handleTypeChange}
            onToggleFullDetails={() => setShowInspector((open) => !open)}
            selectedVariant={selectedVariant}
            selectedVariantCollectionCount={selectedVariantCollectionMemberships.length}
            variantCount={variants.length}
          >
            {canEdit && collections.length > 0 && (
              <div ref={collectionPanelRef}>
                <AssetCollectionsPanel
                  assetPlacementDrafts={assetPlacementDrafts}
                  collections={collections}
                  collectionItems={[
                    ...assetCollectionMemberships,
                    ...selectedVariantCollectionMemberships,
                  ]}
                  onApplyAssetPlacements={handleApplyAssetPlacements}
                  onApplyVariantPlacements={handleApplyVariantPlacements}
                  onAssetPlacementDraftsChange={setAssetPlacementDrafts}
                  onDeleteCollectionItem={deleteCollectionItem}
                  onUpdateCollectionItem={updateCollectionItem}
                  onVariantPlacementControlsOpenChange={setVariantPlacementControlsOpen}
                  onVariantPlacementDraftsChange={setVariantPlacementDrafts}
                  selectedVariant={selectedVariant}
                  variantPlacementControlsOpen={variantPlacementControlsOpen}
                  variantPlacementDrafts={variantPlacementDrafts}
                  variants={variants}
                />
              </div>
            )}

            <StyleReferenceUsagePanel
              spaceId={spaceId || ''}
              collections={styleUsage.collections}
              presets={styleUsage.presets}
              outputs={styleUsage.outputs}
            />

            {relationSubjects.length > 0 && (
              <RelationsPanel
                assets={relationAssets}
                variants={relationVariants}
                relations={wsRelations}
                subjects={relationSubjects}
                primarySubject={{ subjectType: 'asset', assetId }}
                onCreate={handleOpenCreateRelation}
                onEdit={handleOpenEditRelation}
                onDelete={deleteRelation}
              />
            )}

            {assetId && (
              <CompositionUsageList
                targetAssetId={assetId}
                assets={wsAssets}
                variants={wsVariants}
                compositions={compositions}
                compositionItems={compositionItems}
                onOpenComposition={handleOpenComposition}
              />
            )}
          </AssetDetailsContext>
        )}
        onUpload={handleUpload}
        isUploading={isUploading}
        chatMessages={chatMessages}
        isChatLoading={isChatLoading}
        chatProgress={chatProgress}
        chatError={chatError}
        chatHistoryLoaded={historyLoaded}
        sendChatMessage={handleSendChatMessage}
        requestChatHistory={requestChatHistory}
        clearChatSession={clearChatSession}
        spaceId={spaceId}
        createStylePreset={createStylePreset}
        updateStylePreset={updateStylePreset}
        deleteStylePreset={deleteStylePreset}
        stylePresets={stylePresets}
        collections={collections}
        collectionItems={collectionItems}
        forgeError={forgeError}
        forgeErrorCode={forgeErrorCode}
        generationEstimate={generationEstimate}
        sendGenerationEstimateRequest={sendGenerationEstimateRequest}
      />

      {/* Rotation Panel modal */}
      {showRotationPanel && selectedVariant && asset && (
        <RotationPanel
          sourceVariant={selectedVariant}
          sourceAsset={asset}
          rotationSets={rotationSets}
          rotationViews={rotationViews}
          variants={wsVariants}
          hasDefaultStyle={stylePresets.some((preset) => (
            (preset.enabled === true || preset.enabled === 1) &&
            (preset.is_default === true || preset.is_default === 1)
          ))}
          onSubmit={(params) => {
            sendRotationRequest(params);
          }}
          onCancel={(rotationSetId) => {
            sendRotationCancel(rotationSetId);
          }}
          onClose={() => setShowRotationPanel(false)}
          onRateVariant={sendVariantRate}
          onExportTrainingData={() => handleExportTrainingData('rotations')}
        />
      )}
      {relationEditor && (
        <RelationEditorDialog
          mode={relationEditor.mode}
          assets={relationAssets}
          variants={relationVariants}
          sourceSubject={relationEditor.mode === 'create' ? relationEditor.subject : (
            relationEditor.relation.subject_type === 'asset'
              ? { subjectType: 'asset', assetId: relationEditor.relation.subject_asset_id ?? undefined }
              : { subjectType: 'variant', variantId: relationEditor.relation.subject_variant_id ?? undefined }
          )}
          relation={relationEditor.mode === 'edit' ? relationEditor.relation : undefined}
          onCancel={() => setRelationEditor(null)}
          onCreate={handleCreateRelation}
          onUpdate={handleUpdateRelation}
        />
      )}
    </div>
  );
}
