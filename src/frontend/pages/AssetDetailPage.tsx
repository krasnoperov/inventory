import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRouteStore } from '../stores/routeStore';
import { useForgeTrayStore } from '../stores/forgeTrayStore';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import {
  useSpaceWebSocket,
  PREDEFINED_ASSET_TYPES,
  type Asset,
  type Variant,
  type Lineage,
} from '../hooks/useSpaceWebSocket';
import { LineageTree } from '../components/LineageTree';
import { ChatSidebar } from '../components/ChatSidebar';
import { ForgeTray, type ForgeSubmitParams } from '../components/ForgeTray';
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
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [actionInProgress, setActionInProgress] = useState(false);

  // Set page title
  useDocumentTitle(asset?.name);

  // Chat sidebar state
  const [showChat, setShowChat] = useState(false);

  // Track last completed job for assistant auto-review
  const [lastCompletedJob, setLastCompletedJob] = useState<{
    jobId: string;
    variantId: string;
    assetId?: string;
    assetName?: string;
    prompt?: string;
  } | null>(null);

  // Inline editing state
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');

  // Forge tray store
  const { addSlot } = useForgeTrayStore();

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
    trackJob,
    clearJob,
    requestSync,
    status: wsStatus,
  } = useSpaceWebSocket({
    spaceId: spaceId || '',
    onConnect: () => {
      requestSync();
    },
    onJobComplete: (completedJob, variant) => {
      // Notify ChatSidebar of completed job for auto-review
      setLastCompletedJob({
        jobId: completedJob.jobId,
        variantId: variant.id,
        assetId: completedJob.assetId,
        assetName: completedJob.assetName,
        prompt: completedJob.prompt,
      });
    },
  });

  // Compute parent asset and child assets
  const parentAsset = useMemo(() => {
    if (!asset?.parent_asset_id) return null;
    return wsAssets.find(a => a.id === asset.parent_asset_id) || null;
  }, [asset?.parent_asset_id, wsAssets]);

  const childAssets = useMemo(() => {
    if (!asset) return [];
    return wsAssets.filter(a => a.parent_asset_id === asset.id);
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

        // Select active variant by default
        if (data.asset.active_variant_id) {
          const activeVariant = variantsData.find(v => v.id === data.asset.active_variant_id);
          if (activeVariant) {
            setSelectedVariant(activeVariant);
          }
        } else if (variantsData.length > 0) {
          setSelectedVariant(variantsData[0]);
        }
      } catch (err) {
        console.error('Asset fetch error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load asset');
      } finally {
        setIsLoading(false);
      }
    };

    fetchAssetDetails();
  }, [user, spaceId, assetId, navigate]);

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

      // Update selected variant if it was modified or deleted
      if (selectedVariant) {
        const updated = assetVariants.find(v => v.id === selectedVariant.id);
        if (updated) {
          setSelectedVariant(updated);
        } else if (!assetVariants.some(v => v.id === selectedVariant.id)) {
          // Selected variant was deleted, select first available
          setSelectedVariant(assetVariants[0] || null);
        }
      }
    }

    // Update lineage from WebSocket (filter to variants of this asset)
    const variantIds = new Set(assetVariants.map(v => v.id));
    const assetLineage = wsLineage.filter(
      l => variantIds.has(l.parent_variant_id) || variantIds.has(l.child_variant_id)
    );
    if (assetLineage.length > 0 || wsLineage.length > 0) {
      setLineage(assetLineage);
    }
  }, [wsStatus, wsAssets, wsVariants, wsLineage, assetId, selectedVariant]);

  // Action handlers
  const handleSetActiveVariant = useCallback((variantId: string) => {
    if (!assetId || actionInProgress) return;
    setActionInProgress(true);
    setActiveVariant(assetId, variantId);
    // Action completes via WebSocket update
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
        // If deleting selected variant, select another
        if (selectedVariant?.id === variant.id) {
          const remaining = variants.filter(v => v.id !== variant.id);
          setSelectedVariant(remaining[0] || null);
        }
        setTimeout(() => setActionInProgress(false), 500);
      },
    });
  }, [deleteVariant, selectedVariant, variants]);

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
        // Navigate back to space after deletion
        setTimeout(() => {
          navigate(`/spaces/${spaceId}`);
        }, 500);
      },
    });
  }, [assetId, asset?.name, deleteAsset, navigate, spaceId]);

  const handleVariantClick = useCallback((variant: Variant) => {
    setSelectedVariant(variant);
  }, []);

  // Handle add to forge tray (specific variant from detail view)
  const handleAddToTray = useCallback((variant: Variant) => {
    if (asset) {
      addSlot(variant, asset);
    }
  }, [addSlot, asset]);

  // Handle forge submit (unified handler for generate, transform, combine)
  // Returns the job ID for tracking
  const handleForgeSubmit = useCallback(async (params: ForgeSubmitParams): Promise<string> => {
    const { prompt, referenceVariantIds, destination } = params;

    if (destination.type === 'existing_asset' && destination.assetId) {
      // Add variant to existing asset
      const targetAsset = wsAssets.find(a => a.id === destination.assetId);
      const sourceVariantId = referenceVariantIds.length > 0 ? referenceVariantIds[0] : undefined;

      const response = await fetch(`/api/spaces/${spaceId}/assets/${destination.assetId}/variants`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceVariantId,
          prompt,
          referenceVariantIds: referenceVariantIds.length > 1 ? referenceVariantIds.slice(1) : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || 'Failed to start variant generation');
      }

      const result = await response.json() as { success: boolean; jobId: string };
      trackJob(result.jobId, {
        jobType: referenceVariantIds.length > 1 ? 'compose' : 'derive',
        prompt,
        assetId: destination.assetId,
        assetName: targetAsset?.name,
      });
      return result.jobId;
    } else {
      // Create new asset
      const response = await fetch(`/api/spaces/${spaceId}/assets`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: destination.assetName || 'Generated Asset',
          type: destination.assetType || 'character',
          parentAssetId: destination.parentAssetId || undefined,
          prompt,
          referenceVariantIds: referenceVariantIds.length > 0 ? referenceVariantIds : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || 'Failed to start generation');
      }

      const result = await response.json() as { success: boolean; jobId: string; mode: string; assetId: string };
      trackJob(result.jobId, {
        jobType: result.mode as 'generate' | 'derive' | 'compose',
        prompt,
        assetId: result.assetId,
        assetName: destination.assetName,
      });
      return result.jobId;
    }
  }, [spaceId, trackJob, wsAssets]);

  const getVariantLineage = useCallback((variantId: string) => {
    const parents = lineage
      .filter(l => l.child_variant_id === variantId)
      .map(l => {
        const parentVariant = variants.find(v => v.id === l.parent_variant_id);
        return parentVariant ? { ...l, variant: parentVariant } : null;
      })
      .filter(Boolean);

    const children = lineage
      .filter(l => l.parent_variant_id === variantId)
      .map(l => {
        const childVariant = variants.find(v => v.id === l.child_variant_id);
        return childVariant ? { ...l, variant: childVariant } : null;
      })
      .filter(Boolean);

    return { parents, children };
  }, [lineage, variants]);

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
      <button
        className={`${styles.chatToggle} ${showChat ? styles.active : ''}`}
        onClick={() => setShowChat(!showChat)}
        title={showChat ? 'Close chat' : 'Open assistant'}
      >
        🤖
      </button>
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
        <main className={styles.main}>
          <div className={styles.loading}>Loading asset...</div>
        </main>
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
        <main className={styles.main}>
          <div className={styles.error}>
            <h2>Error</h2>
            <p>{error || 'Asset not found'}</p>
            <Link to={`/spaces/${spaceId}`} className={styles.backLink}>Back to Space</Link>
          </div>
        </main>
      </div>
    );
  }

  const selectedLineage = selectedVariant ? getVariantLineage(selectedVariant.id) : null;
  const selectedRecipe = selectedVariant ? parseRecipe(selectedVariant.recipe) : null;

  return (
    <div className={`${styles.page} ${showChat ? styles.withChat : ''}`}>
      <AppHeader
        leftSlot={<Link to="/dashboard" className={styles.brand}>Inventory</Link>}
        rightSlot={headerRightSlot}
      />

      <div className={styles.pageContent}>
        <main className={styles.main}>
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
          <span>/</span>
          <span>{asset.name}</span>
        </nav>

        <div className={styles.header}>
          <div className={styles.titleRow}>
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
            <div className={styles.assetActions}>
              <button
                className={styles.deleteAssetButton}
                onClick={handleDeleteAsset}
                disabled={actionInProgress}
                title="Delete Asset"
              >
                Delete
              </button>
            </div>
          </div>
          <p className={styles.subtitle}>
            {variants.length} variant{variants.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Active Jobs for this Asset */}
        {(() => {
          const assetJobs = Array.from(jobs.values()).filter(
            j => j.assetId === assetId || j.assetName === asset.name
          );
          if (assetJobs.length === 0) return null;

          return (
            <div className={styles.jobsSection}>
              {assetJobs.map((job) => (
                <div key={job.jobId} className={`${styles.jobCard} ${styles[job.status]}`}>
                  <div className={styles.jobIcon}>
                    {job.status === 'pending' && '⏳'}
                    {job.status === 'processing' && '🎨'}
                    {job.status === 'completed' && '✅'}
                    {job.status === 'failed' && '❌'}
                  </div>
                  <div className={styles.jobContent}>
                    <span className={styles.jobTitle}>
                      {job.status === 'pending' && 'Refinement queued...'}
                      {job.status === 'processing' && 'Creating new variant...'}
                      {job.status === 'completed' && 'New variant ready'}
                      {job.status === 'failed' && 'Refinement failed'}
                    </span>
                    {job.prompt && job.status !== 'completed' && (
                      <span className={styles.jobPrompt}>
                        "{job.prompt.length > 80 ? job.prompt.slice(0, 80) + '...' : job.prompt}"
                      </span>
                    )}
                    {job.error && (
                      <span className={styles.jobError}>{job.error}</span>
                    )}
                  </div>
                  {(job.status === 'completed' || job.status === 'failed') && (
                    <button
                      className={styles.jobDismiss}
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

        <div className={styles.content}>
          {/* Main Image Preview */}
          <div className={styles.previewSection}>
            {selectedVariant ? (
              <div className={styles.preview}>
                <img
                  src={`/api/images/${selectedVariant.image_key}`}
                  alt={asset.name}
                  className={styles.previewImage}
                />
              </div>
            ) : (
              <div className={styles.emptyPreview}>
                <span>No variants available</span>
              </div>
            )}

            {/* Variant Details */}
            {selectedVariant && (
              <div className={styles.variantDetails}>
                <div className={styles.variantDetailsHeader}>
                  <h3>Variant Details</h3>
                  <div className={styles.variantActions}>
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
                      title="Add to Forge Tray for generation"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      Add to Tray
                    </button>
                    {selectedVariant.id !== asset.active_variant_id && (
                      <button
                        className={styles.setActiveButton}
                        onClick={() => handleSetActiveVariant(selectedVariant.id)}
                        disabled={actionInProgress}
                      >
                        Set as Active
                      </button>
                    )}
                    <button
                      className={styles.deleteVariantButton}
                      onClick={() => handleDeleteVariant(selectedVariant)}
                      disabled={actionInProgress || variants.length <= 1}
                      title={variants.length <= 1 ? 'Cannot delete the only variant' : 'Delete Variant'}
                    >
                      Delete
                    </button>
                  </div>
                </div>
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

            {/* Lineage Section */}
            {selectedVariant && selectedLineage && (selectedLineage.parents.length > 0 || selectedLineage.children.length > 0) && (
              <LineageTree
                currentVariant={selectedVariant}
                parents={selectedLineage.parents
                  .filter((p): p is NonNullable<typeof p> => p !== null)
                  .map(p => ({ variant: p.variant, relation_type: p.relation_type as 'derived' | 'composed' }))}
                children={selectedLineage.children
                  .filter((c): c is NonNullable<typeof c> => c !== null)
                  .map(c => ({ variant: c.variant, relation_type: c.relation_type as 'derived' | 'composed' }))}
                onSelectVariant={(v) => {
                  const fullVariant = variants.find(variant => variant.id === v.id);
                  if (fullVariant) setSelectedVariant(fullVariant);
                }}
                spaceId={spaceId}
              />
            )}
          </div>

          {/* Variant List */}
          <div className={styles.variantsSection}>
            <div className={styles.variantsList}>
              {/* Pending variant placeholders for active jobs */}
              {Array.from(jobs.values())
                .filter(j => (j.assetId === assetId || j.assetName === asset.name) &&
                       j.jobType === 'derive' &&
                       (j.status === 'pending' || j.status === 'processing'))
                .map((job) => (
                  <div key={job.jobId} className={`${styles.variantThumb} ${styles.pendingVariant}`}>
                    <div className={styles.pendingContent}>
                      <div className={styles.pendingSpinner} />
                      <span className={styles.pendingText}>
                        {job.status === 'pending' ? 'Queued' : 'Creating'}
                      </span>
                    </div>
                  </div>
                ))
              }
              {variants.map((variant) => (
                <div
                  key={variant.id}
                  className={`${styles.variantThumb} ${selectedVariant?.id === variant.id ? styles.selected : ''} ${variant.id === asset.active_variant_id ? styles.active : ''} ${variant.starred ? styles.starred : ''}`}
                  onClick={() => handleVariantClick(variant)}
                >
                  <img
                    src={`/api/images/${variant.thumb_key}`}
                    alt={`Variant ${variant.id}`}
                  />
                  {variant.starred && (
                    <span className={styles.starIndicator}>★</span>
                  )}
                  {variant.id === asset.active_variant_id && (
                    <span className={styles.activeIndicator}>Active</span>
                  )}
                  <button
                    className={styles.addToTrayButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddToTray(variant);
                    }}
                    title="Add to Forge Tray"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sub-Assets Section */}
        {childAssets.length > 0 && (
          <div className={styles.subAssetsSection}>
            <h2 className={styles.subAssetsTitle}>Sub-Assets ({childAssets.length})</h2>
            <div className={styles.subAssetsGrid}>
              {childAssets.map((child) => {
                const childVariant = wsVariants.find(v => v.asset_id === child.id && v.id === child.active_variant_id)
                  || wsVariants.find(v => v.asset_id === child.id);
                return (
                  <Link
                    key={child.id}
                    to={`/spaces/${spaceId}/assets/${child.id}`}
                    className={styles.subAssetCard}
                  >
                    <div className={styles.subAssetThumb}>
                      {childVariant ? (
                        <img
                          src={`/api/images/${childVariant.thumb_key}`}
                          alt={child.name}
                        />
                      ) : (
                        <div className={styles.emptyThumb}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="24" height="24">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <polyline points="21 15 16 10 5 21" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className={styles.subAssetInfo}>
                      <span className={styles.subAssetName}>{child.name}</span>
                      <span className={styles.subAssetType}>{child.type}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
        </main>

        {/* Chat Sidebar */}
        <ChatSidebar
          spaceId={spaceId || ''}
          isOpen={showChat}
          onClose={() => setShowChat(false)}
          currentAsset={asset}
          allAssets={wsAssets}
          allVariants={wsVariants}
          lastCompletedJob={lastCompletedJob}
          onGenerateAsset={async (params) => {
            return await handleForgeSubmit({
              prompt: params.prompt,
              referenceVariantIds: [],
              destination: {
                type: 'new_asset',
                assetName: params.name,
                assetType: params.type,
                parentAssetId: params.parentAssetId || null,
              },
              operation: 'generate',
            });
          }}
          onRefineAsset={async (params) => {
            const targetAsset = wsAssets.find(a => a.id === params.assetId);
            const sourceVariant = wsVariants.find(v => v.id === targetAsset?.active_variant_id);
            if (sourceVariant) {
              return await handleForgeSubmit({
                prompt: params.prompt,
                referenceVariantIds: [sourceVariant.id],
                destination: {
                  type: 'existing_asset',
                  assetId: params.assetId,
                },
                operation: 'refine',
              });
            }
          }}
          onCombineAssets={async (params) => {
            const sourceVariantIds = params.sourceAssetIds
              .map(id => wsAssets.find(a => a.id === id)?.active_variant_id)
              .filter((id): id is string => !!id);
            return await handleForgeSubmit({
              prompt: params.prompt,
              referenceVariantIds: sourceVariantIds,
              destination: {
                type: 'new_asset',
                assetName: params.targetName,
                assetType: params.targetType,
                parentAssetId: null,
              },
              operation: 'combine',
            });
          }}
        />
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
