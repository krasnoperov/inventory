import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRouteStore } from '../stores/routeStore';
import { useForgeTrayStore } from '../stores/forgeTrayStore';
import { useChatStore, useChatIsOpen } from '../stores/chatStore';
import { useAssetDetailStore, useSelectedVariantId, useShowDetailsPanel } from '../stores/assetDetailStore';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import {
  useSpaceWebSocket,
  PREDEFINED_ASSET_TYPES,
  type Asset,
  type Variant,
  type Lineage,
  type ChatResponseResult,
  type DescribeResponseResult,
  type CompareResponseResult,
  type PendingApproval,
  type AutoExecuted,
} from '../hooks/useSpaceWebSocket';
import { ChatSidebar } from '../components/ChatSidebar';
import { ForgeTray } from '../components/ForgeTray';
import { VariantCanvas } from '../components/VariantCanvas';
import { useForgeOperations } from '../hooks/useForgeOperations';
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

  // Chat sidebar state (persisted in store)
  const showChat = useChatIsOpen(spaceId || '');
  const setIsOpen = useChatStore((state) => state.setIsOpen);
  const toggleChat = useCallback(() => {
    setIsOpen(spaceId || '', !showChat);
  }, [setIsOpen, spaceId, showChat]);
  const closeChat = useCallback(() => {
    setIsOpen(spaceId || '', false);
  }, [setIsOpen, spaceId]);

  // Initialize chat as open on first visit to this space
  useEffect(() => {
    if (!spaceId) return;
    const session = useChatStore.getState().sessions[spaceId];
    if (!session) {
      // No session exists yet, create one with chat open
      setIsOpen(spaceId, true);
    }
  }, [spaceId, setIsOpen]);

  // Track last completed job for assistant auto-review
  const [lastCompletedJob, setLastCompletedJob] = useState<{
    jobId: string;
    variantId: string;
    assetId?: string;
    assetName?: string;
    prompt?: string;
    thumbKey?: string;
  } | null>(null);

  // Inline editing state
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');

  // Forge tray store
  const { addSlot, prefillFromVariant } = useForgeTrayStore();

  // Track chat response for ChatSidebar
  const [chatResponse, setChatResponse] = useState<ChatResponseResult | null>(null);
  // Track describe/compare responses for ChatSidebar tool execution
  const [describeResponse, setDescribeResponse] = useState<DescribeResponseResult | null>(null);
  const [compareResponse, setCompareResponse] = useState<CompareResponseResult | null>(null);

  // Get chatStore sync methods
  const {
    setMessages,
    clearMessages,
    syncServerApproval,
    updateServerApproval,
    syncServerApprovals,
    syncServerAutoExecuted,
    setPlan,
    clearPlan,
  } = useChatStore();

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
    sendChatRequest,
    sendGenerateRequest,
    sendRefineRequest,
    sendDescribeRequest,
    sendCompareRequest,
    forkAsset,
    getChildren,
    approveApproval: wsApproveApproval,
    rejectApproval: wsRejectApproval,
    updateSession,
    requestChatHistory,
    startNewSession: wsStartNewSession,
  } = useSpaceWebSocket({
    spaceId: spaceId || '',
    onConnect: () => {
      requestSync();
      // Request chat history via WebSocket (replaces REST)
      requestChatHistory();
    },
    onJobComplete: (completedJob, variant) => {
      setLastCompletedJob({
        jobId: completedJob.jobId,
        variantId: variant.id,
        assetId: completedJob.assetId,
        assetName: completedJob.assetName,
        prompt: completedJob.prompt,
        thumbKey: variant.thumb_key ?? variant.image_key ?? undefined,
      });
      // Navigate to new asset if this job created one (different from current)
      if (completedJob.assetId && completedJob.assetId !== assetId) {
        navigate(`/spaces/${spaceId}/assets/${completedJob.assetId}`);
      }
    },
    onChatResponse: (response) => {
      setChatResponse(response);
    },
    onDescribeResponse: (response) => {
      setDescribeResponse(response);
    },
    onCompareResponse: (response) => {
      setCompareResponse(response);
    },
    // Approval lifecycle callbacks
    onApprovalCreated: (approval: PendingApproval) => {
      if (spaceId) {
        syncServerApproval(spaceId, approval);
      }
    },
    onApprovalUpdated: (approval: PendingApproval) => {
      if (spaceId) {
        updateServerApproval(spaceId, approval);
      }
    },
    onApprovalList: (approvals: PendingApproval[]) => {
      if (spaceId) {
        syncServerApprovals(spaceId, approvals);
      }
    },
    onAutoExecuted: (autoExecuted: AutoExecuted) => {
      if (spaceId) {
        syncServerAutoExecuted(spaceId, autoExecuted);
      }
    },
    // Chat history via WebSocket (replaces REST)
    onChatHistory: (messages, _sessionId) => { // eslint-disable-line @typescript-eslint/no-unused-vars
      if (spaceId) {
        if (messages.length > 0) {
          // Convert server format to client format
          const formattedMessages = messages.map((msg, idx) => ({
            id: `history_${idx}_${msg.created_at}`,
            role: msg.sender_type === 'user' ? 'user' as const : 'assistant' as const,
            content: msg.content,
            timestamp: msg.created_at,
          }));
          setMessages(spaceId, formattedMessages);
        } else {
          // Empty history (new session) - clear messages
          clearMessages(spaceId);
        }
      }
    },
    // New session created - clear local messages
    onSessionCreated: () => {
      if (spaceId) {
        clearMessages(spaceId);
      }
    },
    // SimplePlan callbacks
    onPlanUpdated: (plan) => {
      if (spaceId) {
        setPlan(spaceId, plan);
      }
    },
    onPlanArchived: () => {
      if (spaceId) {
        clearPlan(spaceId);
      }
    },
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
    // Parse the recipe to get the prompt
    let prompt = '';
    try {
      const recipe = JSON.parse(variant.recipe);
      prompt = recipe.prompt || '';
    } catch {
      // Ignore parse errors
    }

    // Find parent variant IDs from lineage
    const parentVariantIds = lineage
      .filter(l => l.child_variant_id === variant.id)
      .map(l => l.parent_variant_id);

    // Prefill the forge tray with the same state
    prefillFromVariant(parentVariantIds, prompt, wsAssets, wsVariants);
  }, [lineage, prefillFromVariant, wsAssets, wsVariants]);

  // Use shared forge operations hook
  const { handleForgeSubmit, onGenerate, onFork, onDerive, onRefine } = useForgeOperations({
    sendGenerateRequest,
    sendRefineRequest,
    forkAsset,
  });

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
          </div>
        )}

        {/* Chat toggle button */}
        <button
          className={`${styles.chatToggle} ${showChat ? styles.active : ''}`}
          onClick={toggleChat}
          title={showChat ? 'Hide assistant' : 'Show assistant'}
          style={{ right: showChat ? 'calc(380px + 1.5rem)' : '1rem' }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>

        {/* Floating chat panel */}
        <div className={`${styles.chatPanel} ${!showChat ? styles.collapsed : ''}`}>
          <ChatSidebar
            spaceId={spaceId || ''}
            isOpen={true}
            onClose={closeChat}
            currentAsset={asset}
            currentVariant={selectedVariant}
            allAssets={wsAssets}
            allVariants={wsVariants}
            lastCompletedJob={lastCompletedJob}
            onGenerate={onGenerate}
            onFork={onFork}
            onDerive={onDerive}
            onRefine={onRefine}
            sendChatRequest={sendChatRequest}
            chatResponse={chatResponse}
            sendDescribeRequest={sendDescribeRequest}
            sendCompareRequest={sendCompareRequest}
            describeResponse={describeResponse}
            compareResponse={compareResponse}
            wsApproveApproval={wsApproveApproval}
            wsRejectApproval={wsRejectApproval}
            wsStartNewSession={wsStartNewSession}
          />
        </div>
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
      />
    </div>
  );
}
