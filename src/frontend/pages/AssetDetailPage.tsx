import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useParams } from '../hooks/useParams';
import { useForgeTrayStore } from '../stores/forgeTrayStore';
import { useChatStore } from '../stores/chatStore';
import { useStyleStore, type SpaceStyleClient } from '../stores/styleStore';
import { useAssetDetailStore, useSelectedVariantId } from '../stores/assetDetailStore';
import { HeaderNav } from '../components/HeaderNav';
import { WorkspaceChrome } from '../components/WorkspaceChrome';
import {
  useSpaceWebSocket,
  PREDEFINED_ASSET_TYPES,
  type Asset,
  type Variant,
  type ChatForgeContext,
  type SpaceStyleRaw,
  type GenerationEstimateResult,
} from '../hooks/useSpaceWebSocket';
import { ForgeTray } from '../components/ForgeTray';
import { VariantCanvas } from '../components/VariantCanvas';
import { useForgeOperations } from '../hooks/useForgeOperations';
import { useImageUpload } from '../hooks/useImageUpload';
import { RotationPanel } from '../components/RotationPanel/RotationPanel';
import { TileGrid } from '../components/TileGrid/TileGrid';
import { formatMediaKind } from '../mediaKind';
import { assetDetailsQueryOptions, sessionQueryOptions } from '../queries';
import { isWebRotationEnabled } from '../feature-flags';
import styles from './AssetDetailPage.module.css';

// Confirmation dialog types
interface ConfirmDialog {
  type: 'deleteVariant' | 'deleteAsset';
  title: string;
  message: string;
  onConfirm: () => void;
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
  const sessionQuery = useQuery(sessionQueryOptions());

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

  // Style store
  const setStyle = useStyleStore((s) => s.setStyle);
  const clearStyle = useStyleStore((s) => s.clearStyle);

  const parseStyle = useCallback((raw: SpaceStyleRaw): SpaceStyleClient => ({
    id: raw.id,
    name: raw.name,
    description: raw.description,
    imageKeys: JSON.parse(raw.image_keys || '[]'),
    enabled: raw.enabled === 1,
    createdBy: raw.created_by,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }), []);

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
    lineage: wsLineage,
    jobs,
    setActiveVariant,
    deleteVariant,
    deleteAsset,
    starVariant,
    updateAsset,
    clearJob,
    status: wsStatus,
    sendGenerateRequest,
    sendRefineRequest,
    sendPersistentChatMessage,
    requestChatHistory,
    clearChatSession,
    forkAsset,
    getChildren,
    updateSession,
    sendStyleSet,
    sendStyleDelete,
    sendStyleToggle,
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
    onStyleState: (raw) => {
      if (raw) {
        const parsed = parseStyle(raw);
        setStyle(parsed);
        const imageCount = parsed.enabled ? parsed.imageKeys.length : 0;
        useForgeTrayStore.getState().setMaxSlots(14 - imageCount);
      } else {
        clearStyle();
        useForgeTrayStore.getState().setMaxSlots(14);
      }
    },
    onStyleUpdated: (raw) => {
      const parsed = parseStyle(raw);
      setStyle(parsed);
      const imageCount = parsed.enabled ? parsed.imageKeys.length : 0;
      useForgeTrayStore.getState().setMaxSlots(14 - imageCount);
    },
    onStyleDeleted: () => {
      clearStyle();
      useForgeTrayStore.getState().setMaxSlots(14);
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

  // Set page title
  useDocumentTitle(asset?.name);

  // Compute parent asset
  const parentAsset = useMemo(() => {
    if (!asset?.parent_asset_id) return null;
    return wsAssets.find(a => a.id === asset.parent_asset_id) || null;
  }, [asset, wsAssets]);

  // Build breadcrumb path (ancestors)
  const ancestorPath = useMemo(() => {
    const path: Asset[] = [];
    let current = parentAsset;
    while (current) {
      path.unshift(current);
      current = wsAssets.find(a => a.id === current?.parent_asset_id) || null;
    }
    return path;
  }, [parentAsset, wsAssets]);

  // Child assets - combine two sources:
  // 1. Direct children via parent_asset_id (asset hierarchy)
  // 2. Assets with variants that are children of this asset's variants (lineage)
  const childAssets = useMemo(() => {
    if (!assetId) return [];

    // Get variant IDs for this asset
    const thisAssetVariantIds = new Set(variants.map(v => v.id));

    // Find child variant IDs from lineage (where parent is one of this asset's variants)
    const childVariantIds = new Set(
      wsLineage
        .filter(l => thisAssetVariantIds.has(l.parent_variant_id))
        .map(l => l.child_variant_id)
    );

    // Find assets that own those child variants (excluding this asset)
    const lineageChildAssetIds = new Set(
      wsVariants
        .filter(v => childVariantIds.has(v.id) && v.asset_id !== assetId)
        .map(v => v.asset_id)
    );

    // Combine: direct children + lineage-derived children
    const directChildren = getChildren(assetId);
    const lineageChildren = wsAssets.filter(a => lineageChildAssetIds.has(a.id));

    // Deduplicate by id
    const allChildIds = new Set([
      ...directChildren.map(a => a.id),
      ...lineageChildren.map(a => a.id),
    ]);

    return wsAssets.filter(a => allChildIds.has(a.id));
  }, [assetId, variants, wsLineage, wsVariants, wsAssets, getChildren]);

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

  // Handle retry recipe - restore ForgeTray state from variant's recipe and lineage
  const handleRetryRecipe = useCallback((variant: Variant) => {
    // Parse the recipe to get the prompt and parentVariantIds (fallback)
    let prompt = '';
    let recipeParentVariantIds: string[] = [];
    try {
      const recipe = JSON.parse(variant.recipe);
      prompt = recipe.prompt || '';
      // Recipe stores parentVariantIds for retry support (in case lineage is missing)
      recipeParentVariantIds = recipe.parentVariantIds || [];
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
    prefillFromVariant(parentVariantIds, prompt, wsAssets, wsVariants);
  }, [lineage, prefillFromVariant, wsAssets, wsVariants]);

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
          onRetryRecipe={handleRetryRecipe}
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
          {/* Breadcrumb */}
          <nav className={styles.breadcrumb}>
            <Link to="/dashboard">Dashboard</Link>
            <span>/</span>
            <Link to={`/spaces/${spaceId}`}>Space</Link>
            {ancestorPath.map((ancestor) => (
              <React.Fragment key={ancestor.id}>
                <span>/</span>
                <Link to={`/spaces/${spaceId}/assets/${ancestor.id}`}>{ancestor.name}</Link>
              </React.Fragment>
            ))}
          </nav>

          {/* Asset header */}
          <div className={styles.assetHeader}>
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
          </div>

          <div className={styles.assetMeta}>
            <select
              className={styles.typeSelect}
              value={asset.type}
              onChange={(e) => handleTypeChange(e.target.value)}
              disabled={actionInProgress}
            >
              {PREDEFINED_ASSET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1).replace('-', ' ')}
                </option>
              ))}
            </select>
            <span className={styles.metaBadge}>
              {formatMediaKind(asset.media_kind)}
            </span>
            <span className={styles.metaBadge}>
              {variants.length} variant{variants.length !== 1 ? 's' : ''}
            </span>
            {wsStatus === 'connected' && (
              <span className={styles.liveIndicator}>Live</span>
            )}
          </div>

          {/* Child assets (forks/derivatives) */}
          {childAssets.length > 0 && (
            <div className={styles.childAssets}>
              <span className={styles.childLabel}>Derivatives:</span>
              {childAssets.map((child) => (
                <Link
                  key={child.id}
                  to={`/spaces/${spaceId}/assets/${child.id}`}
                  className={styles.childLink}
                  title={child.name}
                >
                  {child.name}
                </Link>
              ))}
            </div>
          )}

          <div className={styles.assetActions}>
            {rotationEnabled && selectedVariant?.status === 'completed' && selectedVariant?.image_key && (
              <button
                className={styles.actionButton}
                onClick={() => setShowRotationPanel(true)}
                title="Generate rotation views from selected variant"
              >
                Rotation Set
              </button>
            )}
            <button
              className={styles.deleteAssetButton}
              onClick={handleDeleteAsset}
              disabled={actionInProgress}
              title="Delete Asset"
            >
              Delete Asset
            </button>
          </div>
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

      {/* Forge Tray - persistent bottom bar for generation */}
      <ForgeTray
        allAssets={wsAssets}
        allVariants={wsVariants}
        onSubmit={handleForgeSubmit}
        onBrandBackground={false}
        currentAsset={asset}
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
        sendStyleSet={sendStyleSet}
        sendStyleDelete={sendStyleDelete}
        sendStyleToggle={sendStyleToggle}
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
