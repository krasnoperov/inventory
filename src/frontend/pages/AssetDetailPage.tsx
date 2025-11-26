import { useEffect, useState, useCallback } from 'react';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useRouteStore } from '../stores/routeStore';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import { useSpaceWebSocket } from '../hooks/useSpaceWebSocket';
import { LineageTree } from '../components/LineageTree';
import styles from './AssetDetailPage.module.css';

interface Asset {
  id: string;
  name: string;
  type: 'character' | 'item' | 'scene' | 'composite';
  tags: string;
  active_variant_id: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

interface Variant {
  id: string;
  asset_id: string;
  job_id: string | null;
  image_key: string;
  thumb_key: string;
  recipe: string;
  created_by: string;
  created_at: number;
}

interface Lineage {
  id: string;
  parent_variant_id: string;
  child_variant_id: string;
  relation_type: 'derived' | 'composed';
  created_at: number;
}

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

  // Compare mode state
  const [compareMode, setCompareMode] = useState(false);
  const [compareVariant, setCompareVariant] = useState<Variant | null>(null);

  // Refine modal state
  const [showRefineModal, setShowRefineModal] = useState(false);
  const [refinePrompt, setRefinePrompt] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [isSuggestingRefine, setIsSuggestingRefine] = useState(false);

  // Use as Reference modal state
  const [showReferenceModal, setShowReferenceModal] = useState(false);
  const [referenceForm, setReferenceForm] = useState({
    prompt: '',
    assetName: '',
    assetType: 'character' as 'character' | 'item' | 'scene' | 'composite',
  });
  const [isCreatingReference, setIsCreatingReference] = useState(false);

  // WebSocket for real-time updates
  const {
    assets: wsAssets,
    variants: wsVariants,
    setActiveVariant,
    deleteVariant,
    deleteAsset,
    trackJob,
    status: wsStatus,
  } = useSpaceWebSocket({ spaceId: spaceId || '' });

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    if (!spaceId || !assetId) {
      navigate('/dashboard');
      return;
    }

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
  }, [wsStatus, wsAssets, wsVariants, assetId, selectedVariant]);

  // Action handlers
  const handleSetActiveVariant = useCallback((variantId: string) => {
    if (!assetId || actionInProgress) return;
    setActionInProgress(true);
    setActiveVariant(assetId, variantId);
    // Action completes via WebSocket update
    setTimeout(() => setActionInProgress(false), 500);
  }, [assetId, setActiveVariant, actionInProgress]);

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

  const toggleCompareMode = useCallback(() => {
    setCompareMode((prev) => {
      if (prev) {
        // Exiting compare mode, clear compare variant
        setCompareVariant(null);
      }
      return !prev;
    });
  }, []);

  const handleVariantClick = useCallback((variant: Variant) => {
    if (compareMode) {
      // In compare mode, clicking sets the compare variant
      if (variant.id === selectedVariant?.id) {
        // Can't compare with itself
        return;
      }
      setCompareVariant(variant);
    } else {
      // Normal mode, select the variant
      setSelectedVariant(variant);
    }
  }, [compareMode, selectedVariant]);

  const handleRefine = useCallback(async () => {
    if (!assetId || !selectedVariant || !refinePrompt.trim() || isRefining) return;

    setIsRefining(true);
    try {
      const response = await fetch(`/api/spaces/${spaceId}/assets/${assetId}/edit`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: refinePrompt,
          variantId: selectedVariant.id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || 'Failed to start refinement');
      }

      const result = await response.json() as { success: boolean; jobId: string };

      // Track the job for real-time updates
      trackJob(result.jobId);

      // Close modal and reset
      setShowRefineModal(false);
      setRefinePrompt('');
    } catch (err) {
      console.error('Refine error:', err);
      alert(err instanceof Error ? err.message : 'Failed to refine variant');
    } finally {
      setIsRefining(false);
    }
  }, [assetId, spaceId, selectedVariant, refinePrompt, isRefining, trackJob]);

  const handleSuggestRefine = useCallback(async () => {
    if (isSuggestingRefine || !asset) return;

    setIsSuggestingRefine(true);
    try {
      const response = await fetch(`/api/spaces/${spaceId}/chat/suggest`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetType: asset.type,
          theme: `refinement for ${asset.name}`,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get suggestion');
      }

      const data = await response.json() as { success: boolean; suggestion: string };
      if (data.success && data.suggestion) {
        // Extract a shorter refinement suggestion
        const refineSuggestion = data.suggestion.length > 200
          ? data.suggestion.substring(0, 200).trim() + '...'
          : data.suggestion;
        setRefinePrompt(refineSuggestion);
      }
    } catch (err) {
      console.error('Suggestion error:', err);
    } finally {
      setIsSuggestingRefine(false);
    }
  }, [spaceId, asset, isSuggestingRefine]);

  const handleCreateFromReference = useCallback(async () => {
    if (!selectedVariant || !referenceForm.prompt.trim() || !referenceForm.assetName.trim() || isCreatingReference) return;

    setIsCreatingReference(true);
    try {
      const response = await fetch(`/api/spaces/${spaceId}/generate-from`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: referenceForm.prompt,
          assetName: referenceForm.assetName,
          assetType: referenceForm.assetType,
          sourceVariantId: selectedVariant.id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || 'Failed to create from reference');
      }

      const result = await response.json() as { success: boolean; jobId: string; assetId: string };

      // Track the job for real-time updates
      trackJob(result.jobId);

      // Close modal and reset
      setShowReferenceModal(false);
      setReferenceForm({ prompt: '', assetName: '', assetType: 'character' });

      // Navigate to space to see the new asset being created
      navigate(`/spaces/${spaceId}`);
    } catch (err) {
      console.error('Create from reference error:', err);
      alert(err instanceof Error ? err.message : 'Failed to create from reference');
    } finally {
      setIsCreatingReference(false);
    }
  }, [spaceId, selectedVariant, referenceForm, isCreatingReference, trackJob, navigate]);

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
    <HeaderNav userName={user.name} userEmail={user.email} />
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
    <div className={styles.page}>
      <AppHeader
        leftSlot={<Link to="/dashboard" className={styles.brand}>Inventory</Link>}
        rightSlot={headerRightSlot}
      />

      <main className={styles.main}>
        <nav className={styles.breadcrumb}>
          <Link to="/dashboard">Dashboard</Link>
          <span>/</span>
          <Link to={`/spaces/${spaceId}`}>Space</Link>
          <span>/</span>
          <span>{asset.name}</span>
        </nav>

        <div className={styles.header}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{asset.name}</h1>
            <span className={`${styles.typeBadge} ${styles[asset.type]}`}>
              {asset.type}
            </span>
            <button
              className={styles.deleteAssetButton}
              onClick={handleDeleteAsset}
              disabled={actionInProgress}
              title="Delete Asset"
            >
              Delete Asset
            </button>
          </div>
          <p className={styles.subtitle}>
            {variants.length} variant{variants.length !== 1 ? 's' : ''}
          </p>
        </div>

        <div className={styles.content}>
          {/* Main Image Preview or Comparison View */}
          <div className={styles.previewSection}>
            {compareMode && selectedVariant && compareVariant ? (
              /* Side-by-side comparison view */
              <div className={styles.comparisonView}>
                <div className={styles.comparisonSide}>
                  <div className={styles.comparisonLabel}>A - Original</div>
                  <div className={styles.comparisonPreview}>
                    <img
                      src={`/api/images/${selectedVariant.image_key}`}
                      alt="Variant A"
                      className={styles.comparisonImage}
                    />
                  </div>
                  <div className={styles.comparisonMeta}>
                    <span>{formatDate(selectedVariant.created_at)}</span>
                  </div>
                </div>
                <div className={styles.comparisonDivider} />
                <div className={styles.comparisonSide}>
                  <div className={styles.comparisonLabel}>B - Comparing</div>
                  <div className={styles.comparisonPreview}>
                    <img
                      src={`/api/images/${compareVariant.image_key}`}
                      alt="Variant B"
                      className={styles.comparisonImage}
                    />
                  </div>
                  <div className={styles.comparisonMeta}>
                    <span>{formatDate(compareVariant.created_at)}</span>
                  </div>
                </div>
              </div>
            ) : selectedVariant ? (
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
                      className={styles.refineButton}
                      onClick={() => setShowRefineModal(true)}
                      disabled={actionInProgress}
                    >
                      Refine
                    </button>
                    <button
                      className={styles.referenceButton}
                      onClick={() => setShowReferenceModal(true)}
                      disabled={actionInProgress}
                      title="Create a new asset using this variant as reference"
                    >
                      Use as Reference
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
            <div className={styles.variantsSectionHeader}>
              <h3>All Variants</h3>
              {variants.length >= 2 && (
                <button
                  className={`${styles.compareToggle} ${compareMode ? styles.active : ''}`}
                  onClick={toggleCompareMode}
                >
                  {compareMode ? 'Exit Compare' : 'Compare'}
                </button>
              )}
            </div>
            {compareMode && (
              <p className={styles.compareHint}>
                Click a variant to compare with the selected one
              </p>
            )}
            <div className={styles.variantsList}>
              {variants.map((variant) => (
                <div
                  key={variant.id}
                  className={`${styles.variantThumb} ${selectedVariant?.id === variant.id ? styles.selected : ''} ${variant.id === asset.active_variant_id ? styles.active : ''} ${compareVariant?.id === variant.id ? styles.comparing : ''}`}
                  onClick={() => handleVariantClick(variant)}
                >
                  <img
                    src={`/api/images/${variant.thumb_key}`}
                    alt={`Variant ${variant.id}`}
                  />
                  {variant.id === asset.active_variant_id && (
                    <span className={styles.activeIndicator}>Active</span>
                  )}
                  {selectedVariant?.id === variant.id && compareMode && (
                    <span className={styles.compareLabel}>A</span>
                  )}
                  {compareVariant?.id === variant.id && (
                    <span className={styles.compareLabel}>B</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

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

      {/* Refine Modal */}
      {showRefineModal && selectedVariant && (
        <div className={styles.dialogOverlay} onClick={() => setShowRefineModal(false)}>
          <div className={styles.refineModal} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.dialogTitle}>Refine Variant</h3>
            <p className={styles.refineDescription}>
              Create a new variant by modifying this one. The original will be preserved.
            </p>

            <div className={styles.refinePreview}>
              <img
                src={`/api/images/${selectedVariant.thumb_key}`}
                alt="Source variant"
                className={styles.refinePreviewImage}
              />
            </div>

            <div className={styles.refineFormGroup}>
              <div className={styles.refineLabelRow}>
                <label className={styles.refineLabel}>Modification prompt</label>
                <button
                  type="button"
                  className={styles.refineSuggestButton}
                  onClick={handleSuggestRefine}
                  disabled={isSuggestingRefine || isRefining}
                >
                  {isSuggestingRefine ? 'Thinking...' : 'Suggest'}
                </button>
              </div>
              <textarea
                className={styles.refineTextarea}
                value={refinePrompt}
                onChange={(e) => setRefinePrompt(e.target.value)}
                placeholder="Describe the changes you want to make..."
                rows={4}
                autoFocus
              />
            </div>

            <div className={styles.dialogActions}>
              <button
                className={styles.dialogCancel}
                onClick={() => {
                  setShowRefineModal(false);
                  setRefinePrompt('');
                }}
                disabled={isRefining}
              >
                Cancel
              </button>
              <button
                className={styles.refineSubmitButton}
                onClick={handleRefine}
                disabled={isRefining || !refinePrompt.trim()}
              >
                {isRefining ? 'Starting...' : 'Refine'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Use as Reference Modal */}
      {showReferenceModal && selectedVariant && (
        <div className={styles.dialogOverlay} onClick={() => setShowReferenceModal(false)}>
          <div className={styles.refineModal} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.dialogTitle}>Create from Reference</h3>
            <p className={styles.refineDescription}>
              Create a new asset using this variant as a style reference.
            </p>

            <div className={styles.refinePreview}>
              <img
                src={`/api/images/${selectedVariant.thumb_key}`}
                alt="Reference variant"
                className={styles.refinePreviewImage}
              />
            </div>

            <div className={styles.refineFormGroup}>
              <label className={styles.refineLabel}>New Asset Name</label>
              <input
                type="text"
                className={styles.refineInput}
                value={referenceForm.assetName}
                onChange={(e) => setReferenceForm(f => ({ ...f, assetName: e.target.value }))}
                placeholder="e.g., Princess"
                autoFocus
              />
            </div>

            <div className={styles.refineFormGroup}>
              <label className={styles.refineLabel}>Asset Type</label>
              <select
                className={styles.refineSelect}
                value={referenceForm.assetType}
                onChange={(e) => setReferenceForm(f => ({ ...f, assetType: e.target.value as typeof f.assetType }))}
              >
                <option value="character">Character</option>
                <option value="item">Item</option>
                <option value="scene">Scene</option>
                <option value="composite">Composite</option>
              </select>
            </div>

            <div className={styles.refineFormGroup}>
              <label className={styles.refineLabel}>Description</label>
              <textarea
                className={styles.refineTextarea}
                value={referenceForm.prompt}
                onChange={(e) => setReferenceForm(f => ({ ...f, prompt: e.target.value }))}
                placeholder="Describe the new asset, using the reference for style consistency..."
                rows={4}
              />
            </div>

            <div className={styles.dialogActions}>
              <button
                className={styles.dialogCancel}
                onClick={() => {
                  setShowReferenceModal(false);
                  setReferenceForm({ prompt: '', assetName: '', assetType: 'character' });
                }}
                disabled={isCreatingReference}
              >
                Cancel
              </button>
              <button
                className={styles.refineSubmitButton}
                onClick={handleCreateFromReference}
                disabled={isCreatingReference || !referenceForm.prompt.trim() || !referenceForm.assetName.trim()}
              >
                {isCreatingReference ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
