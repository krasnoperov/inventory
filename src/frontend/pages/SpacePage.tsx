import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRouteStore } from '../stores/routeStore';
import { useForgeTrayStore } from '../stores/forgeTrayStore';
import { useChatStore, useChatIsOpen } from '../stores/chatStore';
import type { Asset, Variant } from '../hooks/useSpaceWebSocket';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import { useSpaceWebSocket } from '../hooks/useSpaceWebSocket';
import { ChatSidebar } from '../components/ChatSidebar';
import { AssetCard } from '../components/AssetCard';
import { NewAssetModal } from '../components/NewAssetModal';
import { ForgeTray, type ForgeSubmitParams } from '../components/ForgeTray';
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

  // Set page title
  useDocumentTitle(space?.name);

  // Forge tray store
  const { addSlot } = useForgeTrayStore();

  // WebSocket connection for real-time updates
  const {
    status: wsStatus,
    error: wsError,
    assets,
    variants,
    jobs,
    requestSync,
    trackJob,
    clearJob,
    deleteAsset,
    spawnAsset,
    createAsset,
    updateAsset,
  } = useSpaceWebSocket({
    spaceId: spaceId || '',
    onConnect: () => {
      requestSync();
    },
    onJobComplete: (completedJob, variant) => {
      // Notify ChatSidebar of completed job for auto-review
      // Pass thumbKey directly to avoid race condition with variants state
      setLastCompletedJob({
        jobId: completedJob.jobId,
        variantId: variant.id,
        assetId: completedJob.assetId,
        assetName: completedJob.assetName,
        prompt: completedJob.prompt,
        thumbKey: variant.thumb_key,
      });
    },
  });

  // Chat sidebar state (persisted in store)
  const showChat = useChatIsOpen(spaceId || '');
  const setIsOpen = useChatStore((state) => state.setIsOpen);
  const toggleChat = useCallback(() => {
    setIsOpen(spaceId || '', !showChat);
  }, [setIsOpen, spaceId, showChat]);
  const closeChat = useCallback(() => {
    setIsOpen(spaceId || '', false);
  }, [setIsOpen, spaceId]);

  // Track last completed job for assistant auto-review
  const [lastCompletedJob, setLastCompletedJob] = useState<{
    jobId: string;
    variantId: string;
    assetId?: string;
    assetName?: string;
    prompt?: string;
    thumbKey?: string;
  } | null>(null);

  // Modal states
  const [newAssetModalState, setNewAssetModalState] = useState<{ variant: Variant; asset: Asset } | null>(null);

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
      navigate('/');
      return;
    }

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

    fetchSpaceData();
  }, [user, spaceId, navigate]);

  // Get all assets sorted by hierarchy (root first, then by name)
  const sortedAssets = useMemo(() => {
    // Build a path for each asset for sorting
    const getPath = (asset: Asset): string[] => {
      const path: string[] = [];
      let current: Asset | undefined = asset;
      while (current) {
        path.unshift(current.name);
        current = assets.find(a => a.id === current?.parent_asset_id);
      }
      return path;
    };

    return [...assets].sort((a, b) => {
      const pathA = getPath(a);
      const pathB = getPath(b);
      // Sort by path depth first (roots first), then alphabetically
      if (pathA.length !== pathB.length) {
        return pathA.length - pathB.length;
      }
      return pathA.join('/').localeCompare(pathB.join('/'));
    });
  }, [assets]);

  // Build parent path for each asset
  const getParentPath = useCallback((asset: Asset): Asset[] => {
    const path: Asset[] = [];
    let current = assets.find(a => a.id === asset.parent_asset_id);
    while (current) {
      path.unshift(current);
      current = assets.find(a => a.id === current?.parent_asset_id);
    }
    return path;
  }, [assets]);

  // Handle forge submit (unified handler for generate, transform, combine)
  // Returns the job ID for tracking
  const handleForgeSubmit = useCallback(async (params: ForgeSubmitParams): Promise<string> => {
    const { prompt, referenceVariantIds, destination } = params;

    if (destination.type === 'existing_asset' && destination.assetId) {
      // Add variant to existing asset
      const asset = assets.find(a => a.id === destination.assetId);
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
        assetName: asset?.name,
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
  }, [spaceId, trackJob, assets]);

  // Handle new asset from variant (spawn)
  const handleNewAsset = useCallback((sourceVariant: Variant, name: string, type: string, parentAssetId: string | null) => {
    spawnAsset({
      sourceVariantId: sourceVariant.id,
      name,
      assetType: type,
      parentAssetId: parentAssetId || undefined,
    });
  }, [spawnAsset]);

  // Handle add to forge tray
  const handleAddToTray = useCallback((variant: Variant, asset: Asset) => {
    addSlot(variant, asset);
  }, [addSlot]);

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
        onClick={toggleChat}
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
          leftSlot={<Link to="/" className={styles.brand}>Inventory</Link>}
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
          leftSlot={<Link to="/" className={styles.brand}>Inventory</Link>}
          rightSlot={headerRightSlot}
        />
        <main className={styles.main}>
          <div className={styles.error}>
            <h2>Error</h2>
            <p>{error || 'Space not found'}</p>
            <Link to="/" className={styles.backLink}>Back to Spaces</Link>
          </div>
        </main>
      </div>
    );
  }

  const canEdit = space.role === 'owner' || space.role === 'editor';

  return (
    <div className={`${styles.page} ${showChat ? styles.withChat : ''}`}>
      <AppHeader
        leftSlot={<Link to="/" className={styles.brand}>Inventory</Link>}
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
            </div>

            {assets.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}>🎨</span>
                <p className={styles.emptyText}>No assets yet</p>
                <p className={styles.emptySubtext}>
                  {canEdit
                    ? 'Use the Forge Tray below to create your first asset'
                    : 'Assets will appear here when created'}
                </p>
              </div>
            ) : (
              <div className={styles.assetCatalogue}>
                {sortedAssets.map((asset) => {
                  const assetVariants = variants.filter(v => v.asset_id === asset.id);
                  const parentPath = getParentPath(asset);

                  return (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      variants={assetVariants}
                      childAssets={[]}
                      allAssets={assets}
                      allVariants={variants}
                      depth={0}
                      parentPath={parentPath}
                      isGenerating={isAssetGenerating(asset.id)}
                      generatingStatus={getGeneratingStatus(asset.id)}
                      canEdit={canEdit}
                      spaceId={spaceId || ''}
                      onAssetClick={(clickedAsset) => {
                        navigate(`/spaces/${spaceId}/assets/${clickedAsset.id}`);
                      }}
                      onAddToTray={canEdit ? handleAddToTray : undefined}
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
          onClose={closeChat}
          allAssets={assets}
          allVariants={variants}
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
            const asset = assets.find(a => a.id === params.assetId);
            const sourceVariant = variants.find(v => v.id === asset?.active_variant_id);
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
              .map(id => assets.find(a => a.id === id)?.active_variant_id)
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

      {/* Forge Tray - persistent bottom bar for generation */}
      {canEdit && (
        <ForgeTray
          allAssets={assets}
          allVariants={variants}
          onSubmit={handleForgeSubmit}
          onBrandBackground={false}
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

    </div>
  );
}
