import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useParams } from '../hooks/useParams';
import { useForgeTrayStore } from '../stores/forgeTrayStore';
import { useChatStore } from '../stores/chatStore';
import { useAssetDetailStore, useSelectedVariantId } from '../stores/assetDetailStore';
import { HeaderNav } from '../components/HeaderNav';
import { WorkspaceChrome } from '../components/WorkspaceChrome';
import { CanvasDropHint } from '../components/CanvasDropHint';
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
  type GenerationEstimateResult,
} from '../hooks/useSpaceWebSocket';
import { ForgeTray } from '../components/ForgeTray';
import { VariantCanvas } from '../components/VariantCanvas';
import { useForgeOperations } from '../hooks/useForgeOperations';
import { useImageUpload } from '../hooks/useImageUpload';
import { findAcceptedUploadFile } from '../mediaUpload';
import { RotationPanel } from '../components/RotationPanel/RotationPanel';
import { TileGrid } from '../components/TileGrid/TileGrid';
import { formatMediaKind } from '../mediaKind';
import { assetDetailsQueryOptions, sessionQueryOptions, spacePageQueryOptions } from '../queries';
import { isWebRotationEnabled } from '../feature-flags';
import { Button, ButtonLink, TextInput, UiSelect, type SelectOption } from '../ui';
import styles from './AssetDetailPage.module.css';

// Confirmation dialog types
interface ConfirmDialog {
  type: 'deleteVariant' | 'deleteAsset';
  title: string;
  message: string;
  onConfirm: () => void;
}

const JOB_STATUS_LABELS = {
  pending: 'Queued',
  processing: 'Generating',
  completed: 'Done',
  failed: 'Failed',
} as const;

interface AssetTypeSelectProps {
  className?: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

interface AssetTitleInlineEditorProps {
  assetName: string;
  editingName: boolean;
  editNameValue: string;
  onEditNameValueChange: (value: string) => void;
  onNameKeyDown: React.KeyboardEventHandler<HTMLInputElement>;
  onSaveName: () => void;
  onStartEditName: () => void;
}

interface AssetDetailsStripProps {
  asset: Asset;
  assetTypeDisabled?: boolean;
  onAssetTypeChange?: (value: string) => void;
  selectedVariant: Variant | null;
  selectedVariantIndex?: number;
  variantCount: number;
}

type AssetDetailsContextProps = AssetDetailsStripProps;

function titleizeAssetType(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replace('-', ' ');
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

function formatVariantOrdinal(index: number | undefined, count: number) {
  if (typeof index === 'number' && index >= 0 && count > 0) {
    return `Variant ${index + 1}/${count}`;
  }
  return 'Variant';
}

function formatSelectedVariant(variant: Variant | null, index: number | undefined, count: number) {
  if (!variant) return 'None';
  return `${formatVariantOrdinal(index, count)} · ${formatMediaKind(variant.media_kind)} · ${titleizeStatus(variant.status)}`;
}

function formatVariantCount(count: number) {
  return `${count} ${count === 1 ? 'variant' : 'variants'}`;
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

export function AssetTitleInlineEditor({
  assetName,
  editingName,
  editNameValue,
  onEditNameValueChange,
  onNameKeyDown,
  onSaveName,
  onStartEditName,
}: AssetTitleInlineEditorProps) {
  if (editingName) {
    return (
      <TextInput
        className={styles.titleInput}
        value={editNameValue}
        onChange={(event) => onEditNameValueChange(event.target.value)}
        onKeyDown={onNameKeyDown}
        onBlur={onSaveName}
        aria-label="Asset name"
        autoFocus
      />
    );
  }

  return (
    <h1 className={styles.titleHeading}>
      <Button
        className={styles.title}
        onClick={onStartEditName}
        title="Click to rename"
        aria-label={`Rename ${assetName}`}
        variant="ghost"
        size="sm"
      >
        {assetName}
      </Button>
    </h1>
  );
}

export function AssetDetailsStrip({
  asset,
  assetTypeDisabled = false,
  onAssetTypeChange,
  selectedVariant,
  selectedVariantIndex,
  variantCount,
}: AssetDetailsStripProps) {
  const dimensions = formatDimensions(selectedVariant);
  const duration = formatDuration(selectedVariant?.media_duration_ms);
  const variantScope = selectedVariant
    ? formatSelectedVariant(selectedVariant, selectedVariantIndex, variantCount)
    : `${formatVariantCount(variantCount)} · None`;

  return (
    <section className={styles.assetDetailsStrip} aria-label="Details scoped space summary">
      <div className={styles.assetDetailsIdentity} aria-label="Asset scope">
        <div className={styles.assetDetailsEyebrow}>
          <span>Details</span>
          <span>Asset</span>
          <span>{formatMediaKind(asset.media_kind)}</span>
        </div>
        <div className={styles.assetDetailsName} title={asset.name}>
          {asset.name}
        </div>
      </div>

      <div className={styles.variantFocus} aria-label="Variants scope">
        <span className={styles.variantFocusLabel}>Variants</span>
        <span className={styles.variantFocusValue}>{variantScope}</span>
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
      </dl>
    </section>
  );
}

export function AssetDetailsContext({
  ...stripProps
}: AssetDetailsContextProps) {
  return (
    <div className={styles.assetDetailsContext}>
      <AssetDetailsStrip {...stripProps} />
    </div>
  );
}

export function AssetGenerationDock({
  details,
  tray,
}: {
  details?: React.ReactNode;
  tray: React.ReactNode;
}) {
  return (
    <section className={styles.assetGenerationDock} aria-label="Asset generation controls">
      {details && (
        <div className={styles.assetDetailsDock}>
          {details}
        </div>
      )}
      {tray}
    </section>
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
  const [isDetailsDragOver, setIsDetailsDragOver] = useState(false);
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
  const { addSlot } = useForgeTrayStore();

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
    stylePresets,
    lineage: wsLineage,
    jobs,
    setActiveVariant,
    deleteVariant,
    deleteAsset,
    starVariant,
    retryVariant,
    updateAsset,
    clearJob,
    status: wsStatus,
    sendGenerateRequest,
    sendRefineRequest,
    sendPersistentChatMessage,
    requestChatHistory,
    clearChatSession,
    forkAsset,
    updateSession,
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
  const isLoading = assetDetailsQuery.isPending && !asset;

  // Derive selectedVariant from variants array
  const selectedVariant = useMemo(() => {
    if (!selectedVariantId) return null;
    return variants.find(v => v.id === selectedVariantId) || null;
  }, [selectedVariantId, variants]);
  const selectedVariantIndex = selectedVariant
    ? variants.findIndex((variant) => variant.id === selectedVariant.id)
    : -1;
  // Set page title
  useDocumentTitle(asset?.name);

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

  const handleAssetTypeChange = useCallback((type: string) => {
    if (!assetId || !canEdit) return;
    updateAsset(assetId, { type });
  }, [assetId, canEdit, updateAsset]);

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

  const handleVariantClick = useCallback((variant: Variant) => {
    setSelectedVariantId(assetId!, variant.id);
  }, [assetId, setSelectedVariantId]);

  // Handle add to forge tray
  const handleAddToTray = useCallback((variant: Variant, targetAsset?: Asset) => {
    if (targetAsset) {
      addSlot(variant, targetAsset);
    } else if (asset) {
      addSlot(variant, asset);
    }
  }, [addSlot, asset]);

  // Use shared forge operations hook
  const { handleForgeSubmit } = useForgeOperations({
    sendGenerateRequest,
    sendRefineRequest,
    forkAsset,
    sendBatchRequest,
  });

  // Image upload hook
  const { upload: uploadImage, isUploading } = useImageUpload({
    spaceId: spaceId || '',
  });

  const handleUpload = useCallback(async (file: File, assetId: string) => {
    await uploadImage(file, assetId);
  }, [uploadImage]);

  const handleDetailsDragOver = useCallback((event: React.DragEvent) => {
    if (!canEdit || isUploading || !assetId) return;
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDetailsDragOver(true);
  }, [assetId, canEdit, isUploading]);

  const handleDetailsDragLeave = useCallback((event: React.DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDetailsDragOver(false);
    }
  }, []);

  const handleDetailsDrop = useCallback(async (event: React.DragEvent) => {
    if (!canEdit || isUploading || !assetId) return;
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDetailsDragOver(false);
    const file = findAcceptedUploadFile(event.dataTransfer.files);
    if (!file) return;
    await uploadImage(file, assetId);
  }, [assetId, canEdit, isUploading, uploadImage]);

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
    <ButtonLink to="/login" variant="primary" size="sm">Sign In</ButtonLink>
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
          <div className={styles.loading}>Loading asset</div>
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
      <div
        className={`${styles.canvasContainer} ${isDetailsDragOver ? styles.canvasDropActive : ''}`}
        onDragOver={handleDetailsDragOver}
        onDragLeave={handleDetailsDragLeave}
        onDrop={handleDetailsDrop}
      >
        <div className={styles.canvasStage}>
        {/* Variant Canvas - fills entire container */}
        <VariantCanvas
          spaceId={spaceId}
          canvasLabel="Details canvas"
          scope="asset-details"
          avoidGenerationDock
          asset={asset}
          variants={variants}
          lineage={lineage}
          selectedVariantId={selectedVariant?.id}
          jobs={jobs}
          onVariantClick={handleVariantClick}
          onAddToTray={handleAddToTray}
          onSetActive={handleSetActiveVariant}
          onRetry={retryVariant}
          allVariants={wsVariants}
          allAssets={wsAssets}
          onGhostNodeClick={(assetId) => navigate(`/spaces/${spaceId}/assets/${assetId}`)}
          onStarVariant={handleStarVariant}
          onDeleteVariant={handleDeleteVariant}
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
          <CanvasToolbar ariaLabel="Scoped asset canvas controls" className={styles.detailToolbar}>
            <CanvasToolbarLink to={`/spaces/${spaceId}`} title="Back to space">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5" />
                <path d="M12 19l-7-7 7-7" />
              </svg>
            </CanvasToolbarLink>
            <CanvasToolbarTitle className={styles.assetTitleSlot}>
              <AssetTitleInlineEditor
                assetName={asset.name}
                editingName={editingName}
                editNameValue={editNameValue}
                onEditNameValueChange={setEditNameValue}
                onNameKeyDown={handleNameKeyDown}
                onSaveName={handleSaveName}
                onStartEditName={handleStartEditName}
              />
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

        {isDetailsDragOver && (
          <CanvasDropHint
            scope="Details"
            message="New variant"
            detail={asset.name}
          />
        )}

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
                  <span className={styles.jobStatus} aria-label={`${JOB_STATUS_LABELS[job.status]} job`} />
                  <div className={styles.jobInfo}>
                    <span className={styles.jobTitle}>{JOB_STATUS_LABELS[job.status]}</span>
                    {job.prompt && job.status !== 'completed' && (
                      <span className={styles.jobPrompt}>
                        "{job.prompt}"
                      </span>
                    )}
                    {job.error && <span className={styles.jobError}>{job.error}</span>}
                  </div>
                  {(job.status === 'completed' || job.status === 'failed') && (
                    <Button
                      className={styles.dismissButton}
                      onClick={() => clearJob(job.jobId)}
                      variant="ghost"
                      size="sm"
                    >
                      Dismiss
                    </Button>
                  )}
                </div>
              ))}
            </div>
          );
        })()}

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div className={styles.dialogOverlay} onClick={() => setConfirmDialog(null)}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.dialogTitle}>{confirmDialog.title}</h3>
            <p className={styles.dialogMessage}>{confirmDialog.message}</p>
            <div className={styles.dialogActions}>
              <Button
                className={styles.dialogCancel}
                onClick={() => setConfirmDialog(null)}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                className={styles.dialogConfirm}
                onClick={confirmDialog.onConfirm}
                variant="danger"
              >
                {confirmDialog.type === 'deleteAsset' ? 'Delete Asset' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}

        </div>

      {/* Asset details + Forge Tray - persistent bottom controls */}
      <AssetGenerationDock
        details={(
          <AssetDetailsContext
            asset={asset}
            assetTypeDisabled={!canEdit}
            onAssetTypeChange={canEdit ? handleAssetTypeChange : undefined}
            selectedVariant={selectedVariant}
            selectedVariantIndex={selectedVariantIndex >= 0 ? selectedVariantIndex : undefined}
            variantCount={variants.length}
          />
        )}
        tray={(
          <ForgeTray
            allAssets={wsAssets}
            allVariants={wsVariants}
            onSubmit={handleForgeSubmit}
            onBrandBackground={false}
            currentAsset={asset}
            floating={false}
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
            stylePresets={stylePresets}
            forgeError={forgeError}
            forgeErrorCode={forgeErrorCode}
            generationEstimate={generationEstimate}
            sendGenerationEstimateRequest={sendGenerationEstimateRequest}
          />
        )}
      />
      </div>

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
    </div>
  );
}
