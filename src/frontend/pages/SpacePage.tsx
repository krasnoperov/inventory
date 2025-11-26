import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useRouteStore } from '../stores/routeStore';
import type { Asset, Variant } from '../hooks/useSpaceWebSocket';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import { useSpaceWebSocket } from '../hooks/useSpaceWebSocket';
import { ChatSidebar } from '../components/ChatSidebar';
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
  } = useSpaceWebSocket({
    spaceId: spaceId || '',
    onConnect: () => {
      console.log('WebSocket connected, requesting sync...');
      requestSync();
    },
  });

  // Chat sidebar state
  const [showChat, setShowChat] = useState(false);

  // Generation modal state
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateForm, setGenerateForm] = useState({
    prompt: '',
    assetName: '',
    assetType: 'character' as 'character' | 'item' | 'scene' | 'composite',
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);

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

  const handleGenerate = useCallback(async () => {
    if (!generateForm.prompt.trim() || !generateForm.assetName.trim()) {
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch(`/api/spaces/${spaceId}/generate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: generateForm.prompt,
          assetName: generateForm.assetName,
          assetType: generateForm.assetType,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || 'Failed to start generation');
      }

      const result = await response.json() as { success: boolean; jobId: string };

      // Track the job for real-time updates
      trackJob(result.jobId);

      // Reset form and close modal
      setGenerateForm({ prompt: '', assetName: '', assetType: 'character' });
      setShowGenerateModal(false);
    } catch (err) {
      console.error('Generation error:', err);
      alert(err instanceof Error ? err.message : 'Failed to start generation');
    } finally {
      setIsGenerating(false);
    }
  }, [spaceId, generateForm, trackJob]);

  const handleSuggestPrompt = useCallback(async () => {
    if (isSuggesting) return;

    setIsSuggesting(true);
    try {
      const response = await fetch(`/api/spaces/${spaceId}/chat/suggest`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetType: generateForm.assetType,
          theme: generateForm.assetName || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || 'Failed to get suggestion');
      }

      const data = await response.json() as { success: boolean; suggestion: string };
      if (data.success && data.suggestion) {
        setGenerateForm(f => ({ ...f, prompt: data.suggestion }));
      }
    } catch (err) {
      console.error('Suggestion error:', err);
      // Silently fail - user can still type their own prompt
    } finally {
      setIsSuggesting(false);
    }
  }, [spaceId, generateForm.assetType, generateForm.assetName, isSuggesting]);

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

      // Get filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch?.[1] || `space-export-${new Date().toISOString().split('T')[0]}.zip`;

      // Download the file
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

      // Request sync to get updated data
      requestSync();
    } catch (err) {
      console.error('Import error:', err);
      alert(err instanceof Error ? err.message : 'Failed to import');
    } finally {
      setIsImporting(false);
      // Reset file input
      if (importInputRef.current) {
        importInputRef.current.value = '';
      }
    }
  }, [spaceId, isImporting, requestSync]);

  // Get active variant for an asset
  const getActiveVariant = useCallback((assetId: string, activeVariantId: string | null) => {
    if (!activeVariantId) return null;
    return variants.find(v => v.id === activeVariantId && v.asset_id === assetId);
  }, [variants]);

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
            {Array.from(jobs.values()).map((job) => (
              <div key={job.jobId} className={`${styles.jobCard} ${styles[job.status]}`}>
                <div className={styles.jobStatus}>
                  {job.status === 'pending' && '⏳ Queued...'}
                  {job.status === 'processing' && '🎨 Generating...'}
                  {job.status === 'completed' && '✅ Complete'}
                  {job.status === 'failed' && '❌ Failed'}
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
            ))}
          </section>
        )}

        {/* Asset Grid */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Assets</h2>
            <div className={styles.sectionActions}>
              {canEdit && assets.length >= 2 && (
                <button
                  className={styles.forgeButton}
                  onClick={() => navigate(`/spaces/${spaceId}/forge`)}
                >
                  Forge
                </button>
              )}
              {canEdit && (
                <button
                  className={styles.generateButton}
                  onClick={() => setShowGenerateModal(true)}
                >
                  Generate Asset
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
                  ? 'Click "Generate Asset" to create your first asset'
                  : 'Assets will appear here when created'}
              </p>
            </div>
          ) : (
            <div className={styles.assetGrid}>
              {assets.map((asset) => {
                const activeVariant = getActiveVariant(asset.id, asset.active_variant_id);
                const assetVariants = variants.filter(v => v.asset_id === asset.id);

                return (
                  <div
                    key={asset.id}
                    className={styles.assetCard}
                    onClick={() => navigate(`/spaces/${spaceId}/assets/${asset.id}`)}
                  >
                    <div className={styles.assetThumb}>
                      {activeVariant ? (
                        <img
                          src={`/api/images/${activeVariant.thumb_key}`}
                          alt={asset.name}
                          className={styles.assetImage}
                        />
                      ) : (
                        <div className={styles.assetPlaceholder}>
                          {assetVariants.length === 0 ? '⏳' : '🖼️'}
                        </div>
                      )}
                    </div>
                    <div className={styles.assetInfo}>
                      <span className={styles.assetName}>{asset.name}</span>
                      <span className={styles.assetMeta}>
                        {asset.type} &bull; {assetVariants.length} variant{assetVariants.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
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

      {/* Generate Modal */}
      {showGenerateModal && (
        <div className={styles.modalOverlay} onClick={() => setShowGenerateModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Generate New Asset</h2>

            <div className={styles.formGroup}>
              <label className={styles.label}>Asset Name</label>
              <input
                type="text"
                className={styles.input}
                value={generateForm.assetName}
                onChange={(e) => setGenerateForm(f => ({ ...f, assetName: e.target.value }))}
                placeholder="e.g., Knight Character"
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Asset Type</label>
              <select
                className={styles.select}
                value={generateForm.assetType}
                onChange={(e) => setGenerateForm(f => ({ ...f, assetType: e.target.value as typeof f.assetType }))}
              >
                <option value="character">Character</option>
                <option value="item">Item</option>
                <option value="scene">Scene</option>
                <option value="composite">Composite</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <div className={styles.promptLabelRow}>
                <label className={styles.label}>Prompt</label>
                <button
                  type="button"
                  className={styles.suggestButton}
                  onClick={handleSuggestPrompt}
                  disabled={isSuggesting || isGenerating}
                >
                  {isSuggesting ? 'Thinking...' : 'Suggest'}
                </button>
              </div>
              <textarea
                className={styles.textarea}
                value={generateForm.prompt}
                onChange={(e) => setGenerateForm(f => ({ ...f, prompt: e.target.value }))}
                placeholder="Describe the asset you want to generate..."
                rows={4}
              />
            </div>

            <div className={styles.modalActions}>
              <button
                className={styles.cancelButton}
                onClick={() => setShowGenerateModal(false)}
                disabled={isGenerating}
              >
                Cancel
              </button>
              <button
                className={styles.submitButton}
                onClick={handleGenerate}
                disabled={isGenerating || !generateForm.prompt.trim() || !generateForm.assetName.trim()}
              >
                {isGenerating ? 'Starting...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
