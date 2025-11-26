import { useEffect, useState, useCallback } from 'react';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useRouteStore } from '../stores/routeStore';
import type { Asset, Variant } from '../hooks/useSpaceWebSocket';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import { useSpaceWebSocket } from '../hooks/useSpaceWebSocket';
import styles from './ForgePage.module.css';

interface Space {
  id: string;
  name: string;
  role: string;
}

const MAX_SELECTIONS = 14; // gemini-3-pro-image-preview supports up to 14 reference images

export default function ForgePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const params = useRouteStore((state) => state.params);
  const spaceId = params.spaceId;

  const [space, setSpace] = useState<Space | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [selectedVariantIds, setSelectedVariantIds] = useState<Set<string>>(new Set());
  const [expandedAssets, setExpandedAssets] = useState<Set<string>>(new Set());

  // Forge form state
  const [forgeForm, setForgeForm] = useState({
    prompt: '',
    assetName: '',
    assetType: 'composite' as 'character' | 'item' | 'scene' | 'composite',
  });
  const [isForging, setIsForging] = useState(false);

  // WebSocket connection for real-time updates
  const {
    status: wsStatus,
    assets,
    variants,
    trackJob,
    requestSync,
  } = useSpaceWebSocket({
    spaceId: spaceId || '',
    onConnect: () => {
      requestSync();
    },
  });

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    if (!spaceId) {
      navigate('/dashboard');
      return;
    }

    fetchSpace();
  }, [user, spaceId, navigate]);

  const fetchSpace = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`/api/spaces/${spaceId}`, { credentials: 'include' });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('You do not have access to this space');
        }
        if (response.status === 404) {
          throw new Error('Space not found');
        }
        throw new Error('Failed to fetch space');
      }

      const data = await response.json() as { success: boolean; space: Space };
      setSpace(data.space);
    } catch (err) {
      console.error('Space fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load space');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleAssetExpansion = useCallback((assetId: string) => {
    setExpandedAssets((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  }, []);

  const toggleVariantSelection = useCallback((variantId: string) => {
    setSelectedVariantIds((prev) => {
      const next = new Set(prev);
      if (next.has(variantId)) {
        next.delete(variantId);
      } else if (next.size < MAX_SELECTIONS) {
        next.add(variantId);
      }
      return next;
    });
  }, []);

  const removeSelection = useCallback((variantId: string) => {
    setSelectedVariantIds((prev) => {
      const next = new Set(prev);
      next.delete(variantId);
      return next;
    });
  }, []);

  const clearSelections = useCallback(() => {
    setSelectedVariantIds(new Set());
  }, []);

  const handleForge = useCallback(async () => {
    if (selectedVariantIds.size < 2 || !forgeForm.prompt.trim() || !forgeForm.assetName.trim()) {
      return;
    }

    setIsForging(true);
    try {
      const response = await fetch(`/api/spaces/${spaceId}/compose`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceVariantIds: Array.from(selectedVariantIds),
          prompt: forgeForm.prompt,
          assetName: forgeForm.assetName,
          assetType: forgeForm.assetType,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || 'Failed to start forge');
      }

      const result = await response.json() as { success: boolean; jobId: string };

      // Track the job for real-time updates
      trackJob(result.jobId);

      // Navigate back to space to see the result
      navigate(`/spaces/${spaceId}`);
    } catch (err) {
      console.error('Forge error:', err);
      alert(err instanceof Error ? err.message : 'Failed to start forge');
    } finally {
      setIsForging(false);
    }
  }, [spaceId, selectedVariantIds, forgeForm, trackJob, navigate]);

  // Get selected variants data
  const selectedVariants = variants.filter((v) => selectedVariantIds.has(v.id));

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
          <div className={styles.loading}>Loading...</div>
        </main>
      </div>
    );
  }

  if (error || !space) {
    return (
      <div className={styles.page}>
        <AppHeader
          leftSlot={<Link to="/dashboard" className={styles.brand}>Inventory</Link>}
          rightSlot={headerRightSlot}
        />
        <main className={styles.main}>
          <div className={styles.error}>
            <h2>Error</h2>
            <p>{error || 'Space not found'}</p>
            <Link to="/dashboard" className={styles.backLink}>Back to Dashboard</Link>
          </div>
        </main>
      </div>
    );
  }

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
          <Link to={`/spaces/${spaceId}`}>{space.name}</Link>
          <span>/</span>
          <span>Forge</span>
        </nav>

        <div className={styles.header}>
          <h1 className={styles.title}>Forge Composite</h1>
          <p className={styles.subtitle}>
            Select variants to combine into a new asset
            {wsStatus === 'connected' && <span className={styles.liveIndicator}>Live</span>}
          </p>
        </div>

        <div className={styles.content}>
          {/* Left Panel: Asset/Variant Grid */}
          <div className={styles.pickerPanel}>
            <h2 className={styles.panelTitle}>Select Variants</h2>
            <p className={styles.panelSubtitle}>
              {selectedVariantIds.size} of {MAX_SELECTIONS} selected
            </p>

            {assets.length === 0 ? (
              <div className={styles.emptyState}>
                <p>No assets available. Create some assets first.</p>
                <Link to={`/spaces/${spaceId}`} className={styles.backLink}>
                  Back to Space
                </Link>
              </div>
            ) : (
              <div className={styles.assetList}>
                {assets.map((asset) => {
                  const assetVariants = variants.filter((v) => v.asset_id === asset.id);
                  const isExpanded = expandedAssets.has(asset.id);
                  const selectedCount = assetVariants.filter((v) =>
                    selectedVariantIds.has(v.id)
                  ).length;

                  return (
                    <div key={asset.id} className={styles.assetItem}>
                      <div
                        className={styles.assetHeader}
                        onClick={() => toggleAssetExpansion(asset.id)}
                      >
                        <span className={styles.expandIcon}>
                          {isExpanded ? '▼' : '▶'}
                        </span>
                        <span className={styles.assetName}>{asset.name}</span>
                        <span className={styles.assetMeta}>
                          {assetVariants.length} variant{assetVariants.length !== 1 ? 's' : ''}
                          {selectedCount > 0 && (
                            <span className={styles.selectedBadge}>
                              {selectedCount} selected
                            </span>
                          )}
                        </span>
                      </div>

                      {isExpanded && (
                        <div className={styles.variantGrid}>
                          {assetVariants.map((variant) => {
                            const isSelected = selectedVariantIds.has(variant.id);
                            const canSelect = isSelected || selectedVariantIds.size < MAX_SELECTIONS;

                            return (
                              <div
                                key={variant.id}
                                className={`${styles.variantCard} ${isSelected ? styles.selected : ''} ${!canSelect ? styles.disabled : ''}`}
                                onClick={() => canSelect && toggleVariantSelection(variant.id)}
                              >
                                <img
                                  src={`/api/images/${variant.thumb_key}`}
                                  alt="Variant"
                                  className={styles.variantImage}
                                />
                                {isSelected && (
                                  <span className={styles.checkmark}>✓</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Panel: Selection Summary & Form */}
          <div className={styles.forgePanel}>
            <h2 className={styles.panelTitle}>Forge</h2>

            {/* Selected Variants Preview */}
            <div className={styles.selectionPreview}>
              <div className={styles.selectionHeader}>
                <span>Selected ({selectedVariants.length})</span>
                {selectedVariants.length > 0 && (
                  <button className={styles.clearButton} onClick={clearSelections}>
                    Clear All
                  </button>
                )}
              </div>
              {selectedVariants.length === 0 ? (
                <p className={styles.selectionEmpty}>
                  Click on variants to select them
                </p>
              ) : (
                <div className={styles.selectionGrid}>
                  {selectedVariants.map((variant) => (
                    <div key={variant.id} className={styles.selectedItem}>
                      <img
                        src={`/api/images/${variant.thumb_key}`}
                        alt="Selected variant"
                        className={styles.selectedImage}
                      />
                      <button
                        className={styles.removeButton}
                        onClick={() => removeSelection(variant.id)}
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Forge Form */}
            <div className={styles.forgeForm}>
              <div className={styles.formGroup}>
                <label className={styles.label}>Asset Name</label>
                <input
                  type="text"
                  className={styles.input}
                  value={forgeForm.assetName}
                  onChange={(e) =>
                    setForgeForm((f) => ({ ...f, assetName: e.target.value }))
                  }
                  placeholder="e.g., Knight with Magic Sword"
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Asset Type</label>
                <select
                  className={styles.select}
                  value={forgeForm.assetType}
                  onChange={(e) =>
                    setForgeForm((f) => ({
                      ...f,
                      assetType: e.target.value as typeof f.assetType,
                    }))
                  }
                >
                  <option value="composite">Composite</option>
                  <option value="character">Character</option>
                  <option value="item">Item</option>
                  <option value="scene">Scene</option>
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Composition Prompt</label>
                <textarea
                  className={styles.textarea}
                  value={forgeForm.prompt}
                  onChange={(e) =>
                    setForgeForm((f) => ({ ...f, prompt: e.target.value }))
                  }
                  placeholder="Describe how to combine these variants..."
                  rows={4}
                />
              </div>

              <button
                className={styles.forgeButton}
                onClick={handleForge}
                disabled={
                  isForging ||
                  selectedVariantIds.size < 2 ||
                  !forgeForm.prompt.trim() ||
                  !forgeForm.assetName.trim()
                }
              >
                {isForging ? 'Forging...' : `Forge ${selectedVariantIds.size} Variants`}
              </button>

              {selectedVariantIds.size < 2 && (
                <p className={styles.formHint}>
                  Select at least 2 variants to forge
                </p>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
