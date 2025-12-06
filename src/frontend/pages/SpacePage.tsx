import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRouteStore } from '../stores/routeStore';
import { useForgeTrayStore } from '../stores/forgeTrayStore';
import { useChatStore, useChatIsOpen, type ToolProgress } from '../stores/chatStore';
import type {
  Asset,
  Variant,
  ChatResponseResult,
  DescribeResponseResult,
  CompareResponseResult,
  PendingApproval,
  AutoExecuted,
} from '../hooks/useSpaceWebSocket';
import { AppHeader } from '../components/AppHeader';
import { HeaderNav } from '../components/HeaderNav';
import { UsageIndicator } from '../components/UsageIndicator';
import { useSpaceWebSocket } from '../hooks/useSpaceWebSocket';
import { ChatSidebar } from '../components/ChatSidebar';
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

  // Chat sidebar state (persisted in store)
  const isChatOpen = useChatIsOpen(spaceId || '');
  const setIsOpen = useChatStore((state) => state.setIsOpen);
  const toggleChat = useCallback(() => {
    setIsOpen(spaceId || '', !isChatOpen);
  }, [setIsOpen, spaceId, isChatOpen]);
  const closeChat = useCallback(() => {
    setIsOpen(spaceId || '', false);
  }, [setIsOpen, spaceId]);

  // Initialize chat to open on first visit to a space
  useEffect(() => {
    if (!spaceId) return;
    const session = useChatStore.getState().sessions[spaceId];
    if (!session) {
      setIsOpen(spaceId, true);
    }
  }, [spaceId, setIsOpen]);

  // Set page title
  useDocumentTitle(space?.name);

  // Forge tray store
  const { addSlot } = useForgeTrayStore();

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
    addToolProgress,
  } = useChatStore();

  // WebSocket connection for real-time updates
  const {
    status: wsStatus,
    assets,
    variants,
    jobs,
    requestSync,
    clearJob,
    sendChatRequest,
    sendGenerateRequest,
    sendRefineRequest,
    sendDescribeRequest,
    sendCompareRequest,
    forkAsset,
    updateAsset,
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
      // Sync session: user is viewing space overview (no specific asset)
      updateSession({ viewingAssetId: null, viewingVariantId: null });
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
    // Tool progress during agentic loop
    // Note: Backend may send 'complete'/'failed' without 'executing' first
    onChatProgress: (progress) => {
      if (spaceId) {
        const toolProgress: ToolProgress = {
          requestId: progress.requestId,
          toolName: progress.toolName,
          toolParams: progress.toolParams,
          status: progress.status,
          result: progress.result,
          error: progress.error,
          timestamp: Date.now(),
        };
        // Always add - store will handle duplicates via update
        addToolProgress(spaceId, toolProgress);
      }
    },
  });

  // Track last completed job for assistant auto-review
  const [lastCompletedJob, setLastCompletedJob] = useState<{
    jobId: string;
    variantId: string;
    assetId?: string;
    assetName?: string;
    prompt?: string;
    thumbKey?: string;
  } | null>(null);

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
  const { handleForgeSubmit, onGenerate, onFork, onDerive, onRefine } = useForgeOperations({
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

        {/* Tools overlay - top right (when chat is closed) */}
        {!isChatOpen && (
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
        )}

        {/* Chat toggle button */}
        <button
          className={`${styles.chatToggle} ${isChatOpen ? styles.active : ''}`}
          onClick={toggleChat}
          title={isChatOpen ? 'Hide chat' : 'Show chat'}
          style={{ right: isChatOpen ? 'calc(380px + 1.5rem)' : '1rem' }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>

        {/* Floating chat panel */}
        <div className={`${styles.chatPanel} ${!isChatOpen ? styles.collapsed : ''}`}>
          <ChatSidebar
            spaceId={spaceId || ''}
            isOpen={true}
            onClose={closeChat}
            allAssets={assets}
            allVariants={variants}
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
        />
      )}
    </div>
  );
}
