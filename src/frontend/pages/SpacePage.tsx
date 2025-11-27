import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useRouteStore } from '../stores/routeStore';
import { useReferenceStore } from '../stores/referenceStore';
import type { Asset, Variant } from '../hooks/useSpaceWebSocket';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import { useSpaceWebSocket, PREDEFINED_ASSET_TYPES } from '../hooks/useSpaceWebSocket';
import { ChatSidebar } from '../components/ChatSidebar';
import { AssetCard } from '../components/AssetCard';
import { RefineModal } from '../components/RefineModal';
import { NewAssetModal } from '../components/NewAssetModal';
import { GenerateModal } from '../components/GenerateModal';
import { ReferenceShelf } from '../components/ReferenceShelf';
import { LineagePopover } from '../components/LineagePopover';
import styles from './SpacePage.module.css';

interface Space {
  id: string;
  name: string;
  role: string;
  owner_id: string;
  created_at: number;
}

interface Member {
  user_id: string;
  role: string;
  joined_at: number;
  user: {
    id: number;
    email: string;
    name: string;
  };
}

export default function SpacePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const params = useRouteStore((state) => state.params);
  const spaceId = params.id;

  const [space, setSpace] = useState<Space | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reference store
  const { addReference } = useReferenceStore();

  // WebSocket connection for real-time updates
  const {
    status: wsStatus,
    error: wsError,
    assets,
    variants,
    lineage,
    jobs,
    requestSync,
    trackJob,
    clearJob,
    deleteVariant,
    starVariant,
    setActiveVariant,
    deleteAsset,
    spawnAsset,
    createAsset,
    updateAsset,
    getRootAssets,
  } = useSpaceWebSocket({
    spaceId: spaceId || '',
    onConnect: () => {
      console.log('WebSocket connected, requesting sync...');
      requestSync();
    },
  });

  // Chat sidebar state
  const [showChat, setShowChat] = useState(false);

  // Modal states
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateForAsset, setGenerateForAsset] = useState<Asset | null>(null); // When generating for specific asset
  const [refineModalState, setRefineModalState] = useState<{ variant: Variant; asset: Asset } | null>(null);
  const [newAssetModalState, setNewAssetModalState] = useState<{ variant: Variant; asset: Asset } | null>(null);
  const [lineagePopoverState, setLineagePopoverState] = useState<{ variant: Variant; asset: Asset; position: { x: number; y: number } } | null>(null);

  // Export/Import state
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    if (!spaceId) {
      navigate('/dashboard');
      return;
    }

    fetchSpaceData();
  }, [user, spaceId, navigate]);

  const fetchSpaceData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [spaceResponse, membersResponse] = await Promise.all([
        fetch(`/api/spaces/${spaceId}`, { credentials: 'include' }),
        fetch(`/api/spaces/${spaceId}/members`, { credentials: 'include' }),
      ]);

      if (!spaceResponse.ok) {
        if (spaceResponse.status === 403) {
          throw new Error('You do not have access to this space');
        }
        if (spaceResponse.status === 404) {
          throw new Error('Space not found');
        }
        throw new Error('Failed to fetch space');
      }

      const spaceData = await spaceResponse.json() as { success: boolean; space: Space };
      setSpace(spaceData.space);

      if (membersResponse.ok) {
        const membersData = await membersResponse.json() as { success: boolean; members: Member[] };
        setMembers(membersData.members || []);
      }
    } catch (err) {
      console.error('Space fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load space');
    } finally {
      setIsLoading(false);
    }
  };

  // Get root assets for hierarchical display
  const rootAssets = useMemo(() => getRootAssets(), [getRootAssets]);

  // Handle generate (with optional asset context)
  // If targetAsset is set, this creates a new variant in that asset using the active variant as source
  // Otherwise, this triggers the top-level generate flow for creating a NEW asset
  const handleGenerate = useCallback(async (prompt: string, referenceIds: string[], assetName?: string, assetType?: string) => {
    const targetAsset = generateForAsset;

    if (targetAsset) {
      // Create new variant in existing asset - POST /assets/:assetId/variants
      const activeVariantId = targetAsset.active_variant_id;
      const sourceVariant = activeVariantId
        ? variants.find(v => v.id === activeVariantId)
        : variants.find(v => v.asset_id === targetAsset.id); // Fallback to any variant

      if (!sourceVariant) {
        throw new Error('No source variant found for this asset. The asset must have at least one variant.');
      }

      const response = await fetch(`/api/spaces/${spaceId}/assets/${targetAsset.id}/variants`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceVariantId: sourceVariant.id,
          prompt,
          referenceVariantIds: referenceIds.length > 0 ? referenceIds : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || 'Failed to start variant generation');
      }

      const result = await response.json() as { success: boolean; jobId: string };
      trackJob(result.jobId, {
        jobType: 'derive',
        prompt,
        assetId: targetAsset.id,
        assetName: targetAsset.name,
      });
    } else {
      // Create new asset - POST /assets
      // This handles generate, derive, and compose based on inputs
      const response = await fetch(`/api/spaces/${spaceId}/assets`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: assetName || 'Generated Asset',
          type: assetType || 'character',
          prompt,
          referenceVariantIds: referenceIds.length > 0 ? referenceIds : undefined,
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
        assetName: assetName,
      });
    }

    // Clear asset context after generation starts
    setGenerateForAsset(null);
  }, [spaceId, trackJob, generateForAsset, variants]);

  // Handle refine (create new variant in same asset)
  const handleRefine = useCallback(async (variant: Variant, asset: Asset, prompt: string, referenceIds: string[]) => {
    const response = await fetch(`/api/spaces/${spaceId}/assets/${asset.id}/variants`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceVariantId: variant.id,
        prompt,
        referenceVariantIds: referenceIds.length > 0 ? referenceIds : undefined,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json() as { error?: string };
      throw new Error(errorData.error || 'Failed to start refinement');
    }

    const result = await response.json() as { success: boolean; jobId: string };
    trackJob(result.jobId, { assetId: asset.id, assetName: asset.name, jobType: 'derive', prompt });
  }, [spaceId, trackJob]);

  // Handle new asset from variant (spawn)
  const handleNewAsset = useCallback((sourceVariant: Variant, name: string, type: string, parentAssetId: string | null) => {
    spawnAsset({
      sourceVariantId: sourceVariant.id,
      name,
      assetType: type,
      parentAssetId: parentAssetId || undefined,
    });
  }, [spawnAsset]);

  // Handle add reference
  const handleAddReference = useCallback((variant: Variant, asset: Asset) => {
    addReference(variant, asset);
  }, [addReference]);

  // Handle generate variant for specific asset - opens modal with asset context
  const handleGenerateVariant = useCallback((asset: Asset) => {
    setGenerateForAsset(asset);
    setShowGenerateModal(true);
  }, []);

  // Export space as ZIP
  const handleExport = useCallback(async () => {
    if (isExporting) return;

    setIsExporting(true);
    try {
      const response = await fetch(`/api/spaces/${spaceId}/export`, {
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || 'Failed to export');
      }

      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch?.[1] || `space-export-${new Date().toISOString().split('T')[0]}.zip`;

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      alert(err instanceof Error ? err.message : 'Failed to export');
    } finally {
      setIsExporting(false);
    }
  }, [spaceId, isExporting]);

  // Import from ZIP
  const handleImport = useCallback(async (file: File) => {
    if (isImporting) return;

    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`/api/spaces/${spaceId}/import`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || 'Failed to import');
      }

      const result = await response.json() as {
        success: boolean;
        imported: { assets: number; variants: number; lineage: number };
      };

      alert(`Import successful!\nAssets: ${result.imported.assets}\nVariants: ${result.imported.variants}\nLineage: ${result.imported.lineage}`);
      requestSync();
    } catch (err) {
      console.error('Import error:', err);
      alert(err instanceof Error ? err.message : 'Failed to import');
    } finally {
      setIsImporting(false);
      if (importInputRef.current) {
        importInputRef.current.value = '';
      }
    }
  }, [spaceId, isImporting, requestSync]);

  // Check if asset is generating
  const isAssetGenerating = useCallback((assetId: string) => {
    return Array.from(jobs.values()).some(
      j => j.assetId === assetId && (j.status === 'pending' || j.status === 'processing')
    );
  }, [jobs]);

  const getGeneratingStatus = useCallback((assetId: string) => {
    const job = Array.from(jobs.values()).find(
      j => j.assetId === assetId && (j.status === 'pending' || j.status === 'processing')
    );
    return job?.status as 'pending' | 'processing' | undefined;
  }, [jobs]);

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
          <div className={styles.loading}>Loading space...</div>
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

  const canEdit = space.role === 'owner' || space.role === 'editor';

  return (
    <div className={`${styles.page} ${showChat ? styles.withChat : ''}`}>
      <AppHeader
        leftSlot={<Link to="/dashboard" className={styles.brand}>Inventory</Link>}
        rightSlot={headerRightSlot}
      />

      <div className={styles.pageContent}>
        <main className={styles.main}>
          <div className={styles.header}>
            <div className={styles.titleRow}>
              <h1 className={styles.title}>{space.name}</h1>
              <span className={`${styles.roleBadge} ${styles[space.role]}`}>
                {space.role}
              </span>
              {wsStatus === 'connected' && (
                <span className={styles.liveIndicator}>Live</span>
              )}
            </div>
            <div className={styles.headerActions}>
              <p className={styles.subtitle}>
                {members.length} member{members.length !== 1 ? 's' : ''} &bull; {assets.length} asset{assets.length !== 1 ? 's' : ''}
                {wsError && <span className={styles.wsError}> (Connection error)</span>}
              </p>
              <div className={styles.exportImportButtons}>
                <button
                  className={styles.exportButton}
                  onClick={handleExport}
                  disabled={isExporting || assets.length === 0}
                  title={assets.length === 0 ? 'No assets to export' : 'Export all assets as ZIP'}
                >
                  {isExporting ? 'Exporting...' : 'Export'}
                </button>
                {canEdit && (
                  <>
                    <button
                      className={styles.importButton}
                      onClick={() => importInputRef.current?.click()}
                      disabled={isImporting}
                    >
                      {isImporting ? 'Importing...' : 'Import'}
                    </button>
                    <input
                      ref={importInputRef}
                      type="file"
                      accept=".zip"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImport(file);
                      }}
                    />
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Active Jobs */}
          {jobs.size > 0 && (
            <section className={styles.jobsSection}>
              {Array.from(jobs.values()).map((job) => {
                const jobTypeLabel = {
                  generate: 'Generating',
                  derive: 'Creating variant',
                  compose: 'Composing',
                }[job.jobType || 'generate'] || 'Processing';

                return (
                  <div key={job.jobId} className={`${styles.jobCard} ${styles[job.status]}`}>
                    <div className={styles.jobHeader}>
                      <div className={styles.jobStatus}>
                        {job.status === 'pending' && '⏳'}
                        {job.status === 'processing' && '🎨'}
                        {job.status === 'completed' && '✅'}
                        {job.status === 'failed' && '❌'}
                      </div>
                      <div className={styles.jobInfo}>
                        <span className={styles.jobTitle}>
                          {job.status === 'pending' && `${jobTypeLabel} queued...`}
                          {job.status === 'processing' && `${jobTypeLabel}...`}
                          {job.status === 'completed' && `${jobTypeLabel} complete`}
                          {job.status === 'failed' && `${jobTypeLabel} failed`}
                        </span>
                        {job.assetName && (
                          <span className={styles.jobAssetName}>{job.assetName}</span>
                        )}
                        {job.prompt && job.status !== 'completed' && (
                          <span className={styles.jobPrompt} title={job.prompt}>
                            "{job.prompt.length > 60 ? job.prompt.slice(0, 60) + '...' : job.prompt}"
                          </span>
                        )}
                      </div>
                    </div>
                    {job.error && <div className={styles.jobError}>{job.error}</div>}
                    {(job.status === 'completed' || job.status === 'failed') && (
                      <button
                        className={styles.dismissButton}
                        onClick={() => clearJob(job.jobId)}
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          {/* Asset Catalogue - Hierarchical View */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Assets</h2>
              <div className={styles.sectionActions}>
                {canEdit && (
                  <button
                    className={styles.generateButton}
                    onClick={() => setShowGenerateModal(true)}
                  >
                    Generate
                  </button>
                )}
              </div>
            </div>

            {assets.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}>🎨</span>
                <p className={styles.emptyText}>No assets yet</p>
                <p className={styles.emptySubtext}>
                  {canEdit
                    ? 'Click "Generate" to create your first asset'
                    : 'Assets will appear here when created'}
                </p>
              </div>
            ) : (
              <div className={styles.assetCatalogue}>
                {rootAssets.map((asset) => {
                  const assetVariants = variants.filter(v => v.asset_id === asset.id);
                  const childAssets = assets.filter(a => a.parent_asset_id === asset.id);

                  return (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      variants={assetVariants}
                      lineage={lineage}
                      childAssets={childAssets}
                      allAssets={assets}
                      allVariants={variants}
                      depth={0}
                      isGenerating={isAssetGenerating(asset.id)}
                      generatingStatus={getGeneratingStatus(asset.id)}
                      canEdit={canEdit}
                      spaceId={spaceId || ''}
                      onVariantClick={(variant, clickedAsset) => {
                        // Variant click is handled by popover in AssetCard
                      }}
                      onAssetClick={(clickedAsset) => {
                        navigate(`/spaces/${spaceId}/assets/${clickedAsset.id}`);
                      }}
                      onRefine={(variant, clickedAsset) => {
                        setRefineModalState({ variant, asset: clickedAsset });
                      }}
                      onNewAsset={(variant, clickedAsset) => {
                        setNewAssetModalState({ variant, asset: clickedAsset });
                      }}
                      onAddReference={(variant) => {
                        const variantAsset = assets.find(a => a.id === variant.asset_id);
                        if (variantAsset) {
                          handleAddReference(variant, variantAsset);
                        }
                      }}
                      onStarVariant={(variant, starred) => {
                        starVariant(variant.id, starred);
                      }}
                      onSetActiveVariant={(clickedAsset, variant) => {
                        setActiveVariant(clickedAsset.id, variant.id);
                      }}
                      onDeleteVariant={(variant) => {
                        if (confirm('Delete this variant? This cannot be undone.')) {
                          deleteVariant(variant.id);
                        }
                      }}
                      onGenerateVariant={handleGenerateVariant}
                      onAddChildAsset={(parentAsset) => {
                        const name = window.prompt('Child asset name:');
                        if (!name || !name.trim()) return;
                        const type = window.prompt('Asset type (character, item, scene, etc.):', 'character');
                        if (!type) return;
                        createAsset(name.trim(), type.trim(), parentAsset.id);
                      }}
                      onRenameAsset={(clickedAsset) => {
                        const newName = window.prompt('Rename asset:', clickedAsset.name);
                        if (newName && newName.trim() && newName !== clickedAsset.name) {
                          updateAsset(clickedAsset.id, { name: newName.trim() });
                        }
                      }}
                      onDeleteAsset={(clickedAsset) => {
                        if (confirm(`Delete "${clickedAsset.name}" and all its variants? This cannot be undone.`)) {
                          deleteAsset(clickedAsset.id);
                        }
                      }}
                      onViewLineage={(variant) => {
                        const variantAsset = assets.find(a => a.id === variant.asset_id);
                        if (variantAsset) {
                          // Position in center of screen
                          setLineagePopoverState({
                            variant,
                            asset: variantAsset,
                            position: {
                              x: window.innerWidth / 2,
                              y: window.innerHeight / 3,
                            },
                          });
                        }
                      }}
                    />
                  );
                })}
              </div>
            )}
          </section>

          {/* Members Section */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Members</h2>
            </div>

            <div className={styles.memberList}>
              {members.map((member) => (
                <div key={member.user_id} className={styles.memberCard}>
                  <div className={styles.memberInfo}>
                    <span className={styles.memberName}>{member.user.name || member.user.email}</span>
                    <span className={styles.memberEmail}>{member.user.email}</span>
                  </div>
                  <span className={`${styles.memberRole} ${styles[member.role]}`}>
                    {member.role}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </main>

        <ChatSidebar
          spaceId={spaceId || ''}
          isOpen={showChat}
          onClose={() => setShowChat(false)}
        />
      </div>

      {/* Reference Shelf */}
      <ReferenceShelf onGenerate={() => setShowGenerateModal(true)} />

      {/* Generate Modal */}
      {showGenerateModal && (
        <GenerateModal
          targetAsset={generateForAsset}
          sourceVariant={generateForAsset ? (
            // Find the source variant (active or first available)
            generateForAsset.active_variant_id
              ? variants.find(v => v.id === generateForAsset.active_variant_id)
              : variants.find(v => v.asset_id === generateForAsset.id)
          ) : undefined}
          onClose={() => {
            setShowGenerateModal(false);
            setGenerateForAsset(null);
          }}
          onGenerate={handleGenerate}
        />
      )}

      {/* Refine Modal */}
      {refineModalState && (
        <RefineModal
          variant={refineModalState.variant}
          asset={refineModalState.asset}
          onClose={() => setRefineModalState(null)}
          onRefine={(prompt, referenceIds) => {
            handleRefine(refineModalState.variant, refineModalState.asset, prompt, referenceIds);
          }}
        />
      )}

      {/* New Asset Modal */}
      {newAssetModalState && (
        <NewAssetModal
          sourceVariant={newAssetModalState.variant}
          sourceAsset={newAssetModalState.asset}
          allAssets={assets}
          allVariants={variants}
          onClose={() => setNewAssetModalState(null)}
          onCreate={(name, type, parentAssetId) => {
            handleNewAsset(newAssetModalState.variant, name, type, parentAssetId);
          }}
        />
      )}

      {/* Lineage Popover */}
      {lineagePopoverState && (
        <LineagePopover
          variant={lineagePopoverState.variant}
          asset={lineagePopoverState.asset}
          allVariants={variants}
          allAssets={assets}
          lineage={lineage}
          position={lineagePopoverState.position}
          onClose={() => setLineagePopoverState(null)}
          onVariantClick={(variant, clickedAsset) => {
            setLineagePopoverState(null);
            navigate(`/spaces/${spaceId}/assets/${clickedAsset.id}`);
          }}
        />
      )}
    </div>
  );
}
