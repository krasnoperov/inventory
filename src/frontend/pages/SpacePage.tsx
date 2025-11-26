import { useEffect, useState, useCallback } from 'react';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useRouteStore } from '../stores/routeStore';
import type { Asset, Variant } from '../hooks/useSpaceWebSocket';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import { useSpaceWebSocket } from '../hooks/useSpaceWebSocket';
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
    requestSync,
  } = useSpaceWebSocket({
    spaceId: spaceId || '',
    onConnect: () => {
      console.log('WebSocket connected, requesting sync...');
      requestSync();
    },
  });

  // Generation modal state
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateForm, setGenerateForm] = useState({
    prompt: '',
    assetName: '',
    assetType: 'character' as 'character' | 'item' | 'scene' | 'composite',
  });
  const [isGenerating, setIsGenerating] = useState(false);

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

      // Reset form and close modal
      setGenerateForm({ prompt: '', assetName: '', assetType: 'character' });
      setShowGenerateModal(false);
    } catch (err) {
      console.error('Generation error:', err);
      alert(err instanceof Error ? err.message : 'Failed to start generation');
    } finally {
      setIsGenerating(false);
    }
  }, [spaceId, generateForm]);

  // Get active variant for an asset
  const getActiveVariant = useCallback((assetId: string, activeVariantId: string | null) => {
    if (!activeVariantId) return null;
    return variants.find(v => v.id === activeVariantId && v.asset_id === assetId);
  }, [variants]);

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
    <div className={styles.page}>
      <AppHeader
        leftSlot={<Link to="/dashboard" className={styles.brand}>Inventory</Link>}
        rightSlot={headerRightSlot}
      />

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
          <p className={styles.subtitle}>
            {members.length} member{members.length !== 1 ? 's' : ''} &bull; {assets.length} asset{assets.length !== 1 ? 's' : ''}
            {wsError && <span className={styles.wsError}> (Connection error)</span>}
          </p>
        </div>

        {/* Asset Grid */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Assets</h2>
            {canEdit && (
              <button
                className={styles.generateButton}
                onClick={() => setShowGenerateModal(true)}
              >
                Generate Asset
              </button>
            )}
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
              <label className={styles.label}>Prompt</label>
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
