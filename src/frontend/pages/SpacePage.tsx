import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRouteStore } from '../stores/routeStore';
import { useForgeTrayStore } from '../stores/forgeTrayStore';
import { useChatStore } from '../stores/chatStore';
import type {
  Asset,
  Variant,
  ChatForgeContext,
} from '../hooks/useSpaceWebSocket';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import { UsageIndicator } from '../components/UsageIndicator';
import { useSpaceWebSocket } from '../hooks/useSpaceWebSocket';
import { AssetCanvas } from '../components/AssetCanvas';
import { ForgeTray } from '../components/ForgeTray';
import { useForgeOperations } from '../hooks/useForgeOperations';
import { useImageUpload } from '../hooks/useImageUpload';
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

  // Persistent chat state from Zustand store (shared across pages)
  const chatMessages = useChatStore((state) => state.messages);
  const isChatLoading = useChatStore((state) => state.isLoading);
  const chatProgress = useChatStore((state) => state.progress);
  const chatError = useChatStore((state) => state.error);
  const {
    setMessages: setChatMessages,
    replaceTemporaryMessage,
    addMessage: addChatMessage,
    addTemporaryUserMessage,
    setLoading: setChatLoading,
    setProgress: setChatProgress,
    setError: setChatError,
    resetOnDisconnect: resetChatOnDisconnect,
  } = useChatStore();

  // WebSocket connection for real-time updates
  const {
    status: wsStatus,
    assets,
    variants,
    jobs,
    requestSync,
    clearJob,
    sendGenerateRequest,
    sendRefineRequest,
    sendPersistentChatMessage,
    requestChatHistory,
    clearChatSession,
    forkAsset,
    updateAsset,
    updateSession,
  } = useSpaceWebSocket({
    spaceId: spaceId || '',
    onConnect: () => {
      requestSync();
      // Sync session: user is viewing space overview (no specific asset)
      updateSession({ viewingAssetId: null, viewingVariantId: null });
    },
    onDisconnect: () => {
      // Reset chat loading states on disconnect
      resetChatOnDisconnect();
    },
    onJobComplete: () => {
      // Job completed - variant is now visible on canvas
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
    onError: (error) => {
      // Handle WebSocket errors - clear chat loading state
      if (isChatLoading) {
        setChatError(error.message || 'Chat request failed');
      }
    },
  });

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

  // Use shared forge operations hook (all operations via WebSocket)
  const { handleForgeSubmit } = useForgeOperations({
    sendGenerateRequest,
    sendRefineRequest,
    forkAsset,
  });

  // Image upload hook
  const { upload: uploadImage, uploadNewAsset, isUploading } = useImageUpload({
    spaceId: spaceId || '',
  });

  const handleUpload = useCallback(async (file: File, assetId: string) => {
    await uploadImage(file, assetId);
  }, [uploadImage]);

  const handleUploadNewAsset = useCallback(async (file: File, assetName: string) => {
    await uploadNewAsset({ file, assetName });
  }, [uploadNewAsset]);

  // Handle add to forge tray
  const handleAddToTray = useCallback((variant: Variant, asset: Asset) => {
    addSlot(variant, asset);
  }, [addSlot]);

  // Handle persistent chat message - wraps sendPersistentChatMessage to manage loading state
  const handleSendChatMessage = useCallback((content: string, forgeContext?: ChatForgeContext) => {
    // Add user message to UI immediately (optimistic) and set loading
    addTemporaryUserMessage(content);
    sendPersistentChatMessage(content, forgeContext);
  }, [sendPersistentChatMessage, addTemporaryUserMessage]);

  // Handle asset reparenting via drag-and-drop on canvas
  const handleReparent = useCallback((childAssetId: string, newParentAssetId: string | null) => {
    updateAsset(childAssetId, { parentAssetId: newParentAssetId });
  }, [updateAsset]);

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
          leftSlot={<Link to="/" className={styles.brand}>Inventory</Link>}
          rightSlot={headerRightSlot}
          statusSlot={<UsageIndicator />}
        />
        <div className={styles.loadingPage}>
          <div className={styles.loading}>Loading space...</div>
        </div>
      </div>
    );
  }

  if (error || !space) {
    return (
      <div className={styles.page}>
        <AppHeader
          leftSlot={<Link to="/" className={styles.brand}>Inventory</Link>}
          rightSlot={headerRightSlot}
          statusSlot={<UsageIndicator />}
        />
        <div className={styles.errorPage}>
          <div className={styles.error}>
            <h2>Error</h2>
            <p>{error || 'Space not found'}</p>
            <Link to="/" className={styles.backLink}>Back to Spaces</Link>
          </div>
        </div>
      </div>
    );
  }

  const canEdit = space.role === 'owner' || space.role === 'editor';

  return (
    <div className={styles.page}>
      <AppHeader
        leftSlot={<Link to="/" className={styles.brand}>Inventory</Link>}
        rightSlot={headerRightSlot}
        statusSlot={<UsageIndicator />}
      />

      {/* Full-screen canvas container */}
      <div className={styles.canvasContainer}>
        {/* Asset Canvas - fills entire container */}
        <AssetCanvas
          assets={assets}
          variants={variants}
          jobs={jobs}
          onAssetClick={(clickedAsset) => {
            navigate(`/spaces/${spaceId}/assets/${clickedAsset.id}`);
          }}
          onAddToTray={canEdit ? handleAddToTray : undefined}
          onReparent={canEdit ? handleReparent : undefined}
        />

        {/* Space info overlay - top left */}
        <div className={styles.spaceOverlay}>
          <div className={styles.spaceHeader}>
            <h1 className={styles.spaceTitle}>{space.name}</h1>
          </div>
          <div className={styles.spaceMeta}>
            <span className={`${styles.roleBadge} ${styles[space.role]}`}>
              {space.role}
            </span>
            <span className={styles.metaBadge}>
              {members.length} member{members.length !== 1 ? 's' : ''}
            </span>
            <span className={styles.metaBadge}>
              {assets.length} asset{assets.length !== 1 ? 's' : ''}
            </span>
            {wsStatus === 'connected' && (
              <span className={styles.liveIndicator}>Live</span>
            )}
          </div>
        </div>

        {/* Tools overlay - top right */}
        <div className={styles.toolsOverlay}>
          <button
            className={styles.toolButton}
            onClick={handleExport}
            disabled={isExporting || assets.length === 0}
            title={assets.length === 0 ? 'No assets to export' : 'Export all assets as ZIP'}
          >
            {isExporting ? 'Exporting...' : 'Export'}
          </button>
          {canEdit && (
            <>
              <button
                className={styles.toolButton}
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

        {/* Jobs overlay - bottom left */}
        {jobs.size > 0 && (
          <div className={styles.jobsOverlay}>
            {Array.from(jobs.values()).map((job) => {
              const operationLabel = {
                derive: 'Deriving',
                refine: 'Refining',
              }[job.operation || 'derive'] || 'Processing';

              return (
                <div key={job.jobId} className={`${styles.jobCard} ${styles[job.status]}`}>
                  <div className={styles.jobStatus}>
                    {job.status === 'pending' && '⏳'}
                    {job.status === 'processing' && '🎨'}
                    {job.status === 'completed' && '✓'}
                    {job.status === 'failed' && '✗'}
                  </div>
                  <div className={styles.jobInfo}>
                    <span className={styles.jobTitle}>
                      {job.status === 'pending' && `${operationLabel} queued`}
                      {job.status === 'processing' && `${operationLabel}...`}
                      {job.status === 'completed' && 'Done'}
                      {job.status === 'failed' && 'Failed'}
                    </span>
                    {job.assetName && (
                      <span className={styles.jobAssetName}>{job.assetName}</span>
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
              );
            })}
          </div>
        )}
      </div>

      {/* Forge Tray - floating bottom bar */}
      {canEdit && (
        <ForgeTray
          allAssets={assets}
          allVariants={variants}
          onSubmit={handleForgeSubmit}
          onBrandBackground={false}
          onUpload={handleUpload}
          onUploadNewAsset={handleUploadNewAsset}
          isUploading={isUploading}
          chatMessages={chatMessages}
          isChatLoading={isChatLoading}
          chatProgress={chatProgress}
          chatError={chatError}
          sendChatMessage={handleSendChatMessage}
          requestChatHistory={requestChatHistory}
          clearChatSession={clearChatSession}
        />
      )}
    </div>
  );
}
