import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRouteStore } from '../stores/routeStore';
import { useForgeTrayStore } from '../stores/forgeTrayStore';
import { useAssetDetailStore, useSelectedVariantId, useShowDetailsPanel } from '../stores/assetDetailStore';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import {
  useSpaceWebSocket,
  PREDEFINED_ASSET_TYPES,
  type Asset,
  type Variant,
  type Lineage,
  type EnhanceResponseResult,
  type ForgeChatResponseResult,
  type ForgeChatProgressResult,
} from '../hooks/useSpaceWebSocket';
import { ForgeTray } from '../components/ForgeTray';
import { VariantCanvas } from '../components/VariantCanvas';
import { useForgeOperations } from '../hooks/useForgeOperations';
import { useImageUpload } from '../hooks/useImageUpload';
import styles from './AssetDetailPage.module.css';

interface AssetDetailsResponse {
  success: boolean;
  asset: Asset;
  variants: Variant[];
  lineage: Lineage[];
}

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
  const params = useRouteStore((state) => state.params);
  const spaceId = params.spaceId;
  const assetId = params.assetId;

  const [asset, setAsset] = useState<Asset | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [lineage, setLineage] = useState<Lineage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [actionInProgress, setActionInProgress] = useState(false);

  // Variant selection and details panel state (persisted in store)
  const selectedVariantId = useSelectedVariantId(assetId || '');
  const showDetails = useShowDetailsPanel(assetId || '');
  const setSelectedVariantId = useAssetDetailStore((state) => state.setSelectedVariantId);
  const setShowDetailsPanel = useAssetDetailStore((state) => state.setShowDetailsPanel);

  // Derive selectedVariant from variants array
  const selectedVariant = useMemo(() => {
    if (!selectedVariantId) return null;
    return variants.find(v => v.id === selectedVariantId) || null;
  }, [selectedVariantId, variants]);

  // Set page title
  useDocumentTitle(asset?.name);

  // Inline editing state
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');

  // Forge tray store
  const { addSlot, prefillFromVariant, setPrompt } = useForgeTrayStore();

  // Enhance state
  const [isEnhancing, setIsEnhancing] = useState(false);

  // Forge chat state
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [forgeChatResponse, setForgeChatResponse] = useState<ForgeChatResponseResult | null>(null);
  const [forgeChatProgress, setForgeChatProgress] = useState<ForgeChatProgressResult | null>(null);

  // Handle enhance response
  const handleEnhanceResponse = useCallback((response: EnhanceResponseResult) => {
    setIsEnhancing(false);
    if (response.success && response.enhancedPrompt) {
      setPrompt(response.enhancedPrompt);
    } else if (response.error) {
      console.error('Enhance failed:', response.error);
    }
  }, [setPrompt]);

  // Handle forge chat progress
  const handleForgeChatProgress = useCallback((progress: ForgeChatProgressResult) => {
    setForgeChatProgress(progress);
  }, []);

  // Handle forge chat response
  const handleForgeChatResponse = useCallback((response: ForgeChatResponseResult) => {
    setIsChatLoading(false);
    setForgeChatResponse(response);
    // Clear progress when response arrives
    setForgeChatProgress(null);
  }, []);

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
    requestSync,
    status: wsStatus,
    sendGenerateRequest,
    sendRefineRequest,
    sendEnhanceRequest,
    sendForgeChatRequest,
    forkAsset,
    getChildren,
    updateSession,
  } = useSpaceWebSocket({
    spaceId: spaceId || '',
    onConnect: () => {
      requestSync();
    },
    onJobComplete: (completedJob) => {
      // Navigate to new asset if this job created one (different from current)
      if (completedJob.assetId && completedJob.assetId !== assetId) {
        navigate(`/spaces/${spaceId}/assets/${completedJob.assetId}`);
      }
    },
    onEnhanceResponse: handleEnhanceResponse,
    onForgeChatProgress: handleForgeChatProgress,
    onForgeChatResponse: handleForgeChatResponse,
  });

  // Compute parent asset
  const parentAsset = useMemo(() => {
    if (!asset?.parent_asset_id) return null;
    return wsAssets.find(a => a.id === asset.parent_asset_id) || null;
  }, [asset?.parent_asset_id, wsAssets]);

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

    const fetchAssetDetails = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(`/api/spaces/${spaceId}/assets/${assetId}`, {
          credentials: 'include',
        });

        if (!response.ok) {
          if (response.status === 403) {
            throw new Error('You do not have access to this asset');
          }
          if (response.status === 404) {
            throw new Error('Asset not found');
          }
          throw new Error('Failed to fetch asset');
        }

        const data = await response.json() as AssetDetailsResponse;
        const variantsData = data.variants || [];
        const lineageData = data.lineage || [];

        setAsset(data.asset);
        setVariants(variantsData);
        setLineage(lineageData);

        // Select active variant by default (only if no stored selection)
        const storedSelection = useAssetDetailStore.getState().sessions[assetId!]?.selectedVariantId;
        const hasValidStoredSelection = storedSelection && variantsData.some(v => v.id === storedSelection);

        if (!hasValidStoredSelection) {
          if (data.asset.active_variant_id) {
            const activeVariant = variantsData.find(v => v.id === data.asset.active_variant_id);
            if (activeVariant) {
              setSelectedVariantId(assetId!, activeVariant.id);
            }
          } else if (variantsData.length > 0) {
            setSelectedVariantId(assetId!, variantsData[0].id);
          }
        }
      } catch (err) {
        console.error('Asset fetch error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load asset');
      } finally {
        setIsLoading(false);
      }
    };

    fetchAssetDetails();
  }, [user, spaceId, assetId, navigate, setSelectedVariantId]);

  // Sync session context when asset/variant changes
  useEffect(() => {
    if (wsStatus !== 'connected' || !assetId) return;
    updateSession({
      viewingAssetId: assetId,
      viewingVariantId: selectedVariantId ?? null,
    });
  }, [wsStatus, assetId, selectedVariantId, updateSession]);

  // Sync WebSocket updates with local state
  useEffect(() => {
    if (wsStatus !== 'connected' || !assetId) return;

    // Update asset from WebSocket
    const wsAsset = wsAssets.find(a => a.id === assetId);
    if (wsAsset) {
      setAsset(wsAsset);
    }

    // Update variants from WebSocket (filter to current asset)
    const assetVariants = wsVariants.filter(v => v.asset_id === assetId);
    if (assetVariants.length > 0) {
      setVariants(assetVariants);

      // If selected variant was deleted, select first available
      if (selectedVariantId && !assetVariants.some(v => v.id === selectedVariantId)) {
        setSelectedVariantId(assetId!, assetVariants[0]?.id || null);
      }
    }

    // Update lineage from WebSocket
    // Include lineage where EITHER parent OR child variant belongs to this asset
    // - child in this asset: allows cross-asset parents to be shown as ghost nodes
    // - parent in this asset: allows derivative children to be shown as ghost nodes
    const variantIds = new Set(assetVariants.map(v => v.id));
    const assetLineage = wsLineage.filter(
      l => variantIds.has(l.child_variant_id) || variantIds.has(l.parent_variant_id)
    );
    setLineage(assetLineage);
  }, [wsStatus, wsAssets, wsVariants, wsLineage, assetId, selectedVariantId, setSelectedVariantId]);

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
    setShowDetailsPanel(assetId!, true);
  }, [assetId, setSelectedVariantId, setShowDetailsPanel]);

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
  });

  // Image upload hook
  const { upload: uploadImage, isUploading } = useImageUpload({
    spaceId: spaceId || '',
  });

  const handleUpload = useCallback(async (file: File, assetId: string) => {
    await uploadImage(file, assetId);
  }, [uploadImage]);

  // Handle enhance request - wraps sendEnhanceRequest to manage isEnhancing state
  const handleSendEnhanceRequest = useCallback((params: { prompt: string; enhanceType: 'geminify'; slotVariantIds?: string[] }) => {
    setIsEnhancing(true);
    return sendEnhanceRequest(params);
  }, [sendEnhanceRequest]);

  // Handle forge chat request - wraps sendForgeChatRequest to manage loading state
  const handleSendForgeChatRequest = useCallback((params: Parameters<typeof sendForgeChatRequest>[0]) => {
    setIsChatLoading(true);
    setForgeChatResponse(null); // Clear previous response
    return sendForgeChatRequest(params);
  }, [sendForgeChatRequest]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const parseRecipe = (recipe: string) => {
    try {
      return JSON.parse(recipe);
    } catch {
      return null;
    }
  };

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
        <AppHeader
          leftSlot={<Link to="/dashboard" className={styles.brand}>Inventory</Link>}
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
        <AppHeader
          leftSlot={<Link to="/dashboard" className={styles.brand}>Inventory</Link>}
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

  const selectedRecipe = selectedVariant ? parseRecipe(selectedVariant.recipe) : null;

  return (
    <div className={styles.page}>
      <AppHeader
        leftSlot={<Link to="/dashboard" className={styles.brand}>Inventory</Link>}
        rightSlot={headerRightSlot}
      />

      {/* Full-screen canvas container */}
      <div className={styles.canvasContainer}>
        {/* Variant Canvas - fills entire container */}
        <VariantCanvas
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
        />

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

        {/* Variant details panel - bottom right (when variant selected and showDetails) */}
        {selectedVariant && showDetails && (
          <div className={styles.detailsPanel}>
            <div className={styles.detailsHeader}>
              <h3>Variant Details</h3>
              <button
                className={styles.closeDetails}
                onClick={() => setShowDetailsPanel(assetId!, false)}
                title="Close"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Large preview */}
            <div className={styles.detailsPreview}>
              <img
                src={`/api/images/${selectedVariant.image_key}`}
                alt={asset.name}
                className={styles.previewImage}
              />
            </div>

            {/* Actions */}
            <div className={styles.detailsActions}>
              <button
                className={`${styles.starButton} ${selectedVariant.starred ? styles.starred : ''}`}
                onClick={() => handleStarVariant(selectedVariant.id, !selectedVariant.starred)}
                title={selectedVariant.starred ? 'Unstar' : 'Star'}
              >
                {selectedVariant.starred ? '★' : '☆'}
              </button>
              <a
                className={styles.downloadButton}
                href={`/api/images/${selectedVariant.image_key}`}
                download={`${asset.name}-${selectedVariant.id.slice(0, 8)}.png`}
                title="Download full image"
              >
                Download
              </a>
              <button
                className={styles.addToTrayButton}
                onClick={() => handleAddToTray(selectedVariant)}
                title="Add to Forge Tray"
              >
                Add to Tray
              </button>
              {selectedVariant.id !== asset.active_variant_id && (
                <button
                  className={styles.setActiveButton}
                  onClick={() => handleSetActiveVariant(selectedVariant.id)}
                  disabled={actionInProgress}
                >
                  Set Active
                </button>
              )}
              <button
                className={styles.deleteVariantButton}
                onClick={() => handleDeleteVariant(selectedVariant)}
                disabled={actionInProgress || variants.length <= 1}
                title={variants.length <= 1 ? 'Cannot delete the only variant' : 'Delete'}
              >
                Delete
              </button>
            </div>

            {/* Metadata */}
            <div className={styles.detailsGrid}>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Created</span>
                <span className={styles.detailValue}>{formatDate(selectedVariant.created_at)}</span>
              </div>
              {selectedRecipe && (
                <>
                  <div className={styles.detailItem}>
                    <span className={styles.detailLabel}>Type</span>
                    <span className={styles.detailValue}>{selectedRecipe.type}</span>
                  </div>
                  <div className={styles.detailItem}>
                    <span className={styles.detailLabel}>Model</span>
                    <span className={styles.detailValue}>{selectedRecipe.model}</span>
                  </div>
                </>
              )}
            </div>

            {selectedRecipe?.prompt && (
              <div className={styles.promptSection}>
                <span className={styles.detailLabel}>Prompt</span>
                <p className={styles.promptText}>{selectedRecipe.prompt}</p>
              </div>
            )}

            {selectedVariant.description && (
              <div className={styles.promptSection}>
                <span className={styles.detailLabel}>AI Description</span>
                <p className={styles.promptText}>{selectedVariant.description}</p>
              </div>
            )}
          </div>
        )}
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
        sendEnhanceRequest={handleSendEnhanceRequest}
        isEnhancing={isEnhancing}
        sendForgeChatRequest={handleSendForgeChatRequest}
        isChatLoading={isChatLoading}
        forgeChatResponse={forgeChatResponse}
        forgeChatProgress={forgeChatProgress}
      />
    </div>
  );
}
