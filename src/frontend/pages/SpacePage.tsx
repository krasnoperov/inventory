import { useEffect, useState, useCallback, useMemo, useRef, type DragEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '../components/Link';
import { useNavigate } from '../hooks/useNavigate';
import { useAuth } from '../contexts/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useParams } from '../hooks/useParams';
import { useForgeTrayStore } from '../stores/forgeTrayStore';
import { useChatStore } from '../stores/chatStore';
import type {
  Asset,
  Variant,
  ChatForgeContext,
  GenerationEstimateResult,
} from '../hooks/useSpaceWebSocket';
import { HeaderNav } from '../components/HeaderNav';
import { WorkspaceChrome } from '../components/WorkspaceChrome';
import {
  CanvasToolbar,
  CanvasToolbarBadge,
  CanvasToolbarButton,
  CanvasToolbarDivider,
  CanvasToolbarGroup,
  CanvasToolbarLive,
  CanvasToolbarStat,
  CanvasToolbarTitle,
} from '../components/CanvasToolbar';
import { UsageIndicator } from '../components/UsageIndicator';
import { SpaceSharingPanel } from '../components/SpaceSharingPanel';
import { useSpaceWebSocket } from '../hooks/useSpaceWebSocket';
import { SpaceCanvas } from '../components/SpaceCanvas';
import { CanvasDropHint } from '../components/CanvasDropHint';
import { ForgeTray } from '../components/ForgeTray';
import { useForgeOperations } from '../hooks/useForgeOperations';
import { useImageUpload } from '../hooks/useImageUpload';
import { defaultAssetNameFromFile, findAcceptedUploadFile } from '../mediaUpload';
import { TileSetPanel } from '../components/TileSetPanel/TileSetPanel';
import { ButtonLink, IconButton } from '../ui';
import {
  approveSpaceAccessRequest,
  inviteSpaceEmail,
  rejectSpaceAccessRequest,
  revokeSpaceInvitation,
  revokeSpaceMember,
  spacePageQueryOptions,
  spaceSharingQueryOptions,
  updateSpaceMemberRole,
} from '../queries';
import type { SpaceAccessRole } from '../../shared/api/schemas';
import styles from './SpacePage.module.css';

const sharingActionKey = (prefix: string, id: string) => `${prefix}:${id}`;

const JOB_STATUS_LABELS = {
  pending: 'Queued',
  processing: 'Generating',
  completed: 'Done',
  failed: 'Failed',
} as const;

export default function SpacePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const params = useParams();
  const spaceId = params.id;

  const spaceDataQuery = useQuery({
    ...spacePageQueryOptions(spaceId || ''),
    enabled: Boolean(user && spaceId),
  });
  const space = spaceDataQuery.data?.space ?? null;
  const members = spaceDataQuery.data?.members ?? [];
  const isOwner = space?.role === 'owner';
  const canEdit = space?.role === 'owner' || space?.role === 'editor';
  const isLoading = spaceDataQuery.isPending;
  const error = spaceDataQuery.error instanceof Error ? spaceDataQuery.error.message : null;
  const [forgeError, setForgeError] = useState<string | null>(null);
  const [forgeErrorCode, setForgeErrorCode] = useState<string | null>(null);
  const [generationEstimate, setGenerationEstimate] = useState<GenerationEstimateResult | null>(null);
  const [showSharingPanel, setShowSharingPanel] = useState(false);
  const [sharingActionError, setSharingActionError] = useState<string | null>(null);
  const [busySharingAction, setBusySharingAction] = useState<string | null>(null);
  const [isSpaceDragOver, setIsSpaceDragOver] = useState(false);

  const sharingQuery = useQuery({
    ...spaceSharingQueryOptions(spaceId || ''),
    enabled: Boolean(user && spaceId && isOwner && showSharingPanel),
  });

  // Set page title
  useDocumentTitle(space?.name);

  // Forge tray store
  const { addSlot } = useForgeTrayStore();
  const forgeTraySlots = useForgeTrayStore((state) => state.slots);
  const forgeTrayVariantIds = useMemo(
    () => new Set(forgeTraySlots.map((slot) => slot.variant.id)),
    [forgeTraySlots],
  );
  const isVariantInForgeTray = useCallback(
    (variantId: string) => forgeTrayVariantIds.has(variantId),
    [forgeTrayVariantIds],
  );

  // Persistent chat state from Zustand store (shared across pages)
  const chatMessages = useChatStore((state) => state.messages);
  const isChatLoading = useChatStore((state) => state.isLoading);
  const chatProgress = useChatStore((state) => state.progress);
  const chatError = useChatStore((state) => state.error);
  const historyLoaded = useChatStore((state) => state.historyLoaded);
  const {
    setMessages: setChatMessages,
    replaceTemporaryMessage,
    addMessage: addChatMessage,
    addTemporaryUserMessage,
    setLoading: setChatLoading,
    setProgress: setChatProgress,
    setError: setChatError,
    resetOnDisconnect: resetChatOnDisconnect,
    initForSpace,
  } = useChatStore();

  // Initialize chat store for this space (clears if different space)
  useEffect(() => {
    if (spaceId) {
      initForSpace(spaceId);
    }
  }, [spaceId, initForSpace]);

  // WebSocket connection for real-time updates
  const {
    status: wsStatus,
    hasSynced,
    assets,
    variants,
    lineage,
    collections,
    collectionItems,
    stylePresets,
    jobs,
    requestSync,
    requestOverviewSync,
    clearJob,
    sendGenerateRequest,
    sendRefineRequest,
    sendPersistentChatMessage,
    requestChatHistory,
    clearChatSession,
    forkAsset,
    sendBatchRequest,
    sendGenerationEstimateRequest,
    tileSets,
    tilePositions,
    sendTileSetRequest,
    sendTileSetCancel,
  } = useSpaceWebSocket({
    spaceId: spaceId || '',
    syncMode: 'overview',
    requestChatHistoryOnConnect: true,
    sessionUpdateOnConnect: { viewingAssetId: null, viewingVariantId: null },
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
    onGenerateError: (data) => {
      setForgeError(data.error);
      setForgeErrorCode(data.code);
      setTimeout(() => {
        setForgeError(null);
        setForgeErrorCode(null);
      }, 5000);
    },
    onRefineError: (data) => {
      setForgeError(data.error);
      setForgeErrorCode(data.code);
      setTimeout(() => {
        setForgeError(null);
        setForgeErrorCode(null);
      }, 5000);
    },
    onBatchError: (data) => {
      setForgeError(data.error);
      setForgeErrorCode(data.code);
      setTimeout(() => {
        setForgeError(null);
        setForgeErrorCode(null);
      }, 5000);
    },
    onGenerationEstimate: setGenerationEstimate,
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

  // The Space overview is the canvas. It draws lineage edges, while the default
  // overview sync omits lineage, so upgrade to a full sync once the socket is
  // open.
  useEffect(() => {
    if (wsStatus === 'connected') {
      requestSync();
    }
  }, [wsStatus, requestSync]);

  // Tile Set panel state
  const [showTileSetPanel, setShowTileSetPanel] = useState(false);

  const defaultStylePreset = stylePresets.find((preset) => (
    (preset.enabled === true || preset.enabled === 1) &&
    (preset.is_default === true || preset.is_default === 1)
  ));
  const hasSpaceSidePanel = showSharingPanel && isOwner;

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    if (!spaceId) {
      navigate('/');
      return;
    }
  }, [user, spaceId, navigate]);

  // Use shared forge operations hook (all operations via WebSocket)
  const { handleForgeSubmit } = useForgeOperations({
    sendGenerateRequest,
    sendRefineRequest,
    forkAsset,
    sendBatchRequest,
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

  const handleSpaceDragOver = useCallback((event: DragEvent) => {
    if (!canEdit || isUploading) return;
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsSpaceDragOver(true);
  }, [canEdit, isUploading]);

  const handleSpaceDragLeave = useCallback((event: DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsSpaceDragOver(false);
    }
  }, []);

  const handleSpaceDrop = useCallback(async (event: DragEvent) => {
    if (!canEdit || isUploading) return;
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    setIsSpaceDragOver(false);
    const file = findAcceptedUploadFile(event.dataTransfer.files);
    if (!file) return;
    await uploadNewAsset({ file, assetName: defaultAssetNameFromFile(file) });
  }, [canEdit, isUploading, uploadNewAsset]);

  // Handle add to forge tray
  const handleAddToTray = useCallback((variant: Variant, asset: Asset) => {
    addSlot(variant, asset);
  }, [addSlot]);

  const handleAssetOpen = useCallback((clickedAsset: Asset) => {
    navigate(`/spaces/${spaceId}/assets/${clickedAsset.id}`);
  }, [navigate, spaceId]);

  // Handle persistent chat message - wraps sendPersistentChatMessage to manage loading state
  const handleSendChatMessage = useCallback((content: string, forgeContext?: ChatForgeContext) => {
    // Add user message to UI immediately (optimistic) and set loading
    addTemporaryUserMessage(content);
    sendPersistentChatMessage(content, forgeContext);
  }, [sendPersistentChatMessage, addTemporaryUserMessage]);

  const refreshSharingState = useCallback(async () => {
    if (!spaceId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['spaces', spaceId] }),
      sharingQuery.refetch(),
    ]);
  }, [queryClient, sharingQuery, spaceId]);

  const runSharingAction = useCallback(async (
    actionKey: string,
    action: () => Promise<unknown>,
  ) => {
    if (!spaceId || busySharingAction) return false;
    setBusySharingAction(actionKey);
    setSharingActionError(null);
    try {
      await action();
      await refreshSharingState();
      return true;
    } catch (err) {
      setSharingActionError(err instanceof Error ? err.message : 'Sharing action failed');
      return false;
    } finally {
      setBusySharingAction(null);
    }
  }, [busySharingAction, refreshSharingState, spaceId]);

  const handleInviteMember = useCallback((email: string, role: SpaceAccessRole) => (
    runSharingAction('invite', () => inviteSpaceEmail(spaceId || '', email, role))
  ), [runSharingAction, spaceId]);

  const handleApproveRequest = useCallback((requestId: string, role: SpaceAccessRole) => (
    runSharingAction(
      sharingActionKey(`approve-${role}`, requestId),
      () => approveSpaceAccessRequest(spaceId || '', requestId, role),
    )
  ), [runSharingAction, spaceId]);

  const handleRejectRequest = useCallback((requestId: string) => (
    runSharingAction(
      sharingActionKey('reject-request', requestId),
      () => rejectSpaceAccessRequest(spaceId || '', requestId),
    )
  ), [runSharingAction, spaceId]);

  const handleRevokeInvitation = useCallback((invitationId: string) => (
    runSharingAction(
      sharingActionKey('revoke-invitation', invitationId),
      () => revokeSpaceInvitation(spaceId || '', invitationId),
    )
  ), [runSharingAction, spaceId]);

  const handleChangeMemberRole = useCallback((memberUserId: string, role: SpaceAccessRole) => (
    runSharingAction(
      sharingActionKey('member-role', memberUserId),
      () => updateSpaceMemberRole(spaceId || '', memberUserId, role),
    )
  ), [runSharingAction, spaceId]);

  const handleRevokeMember = useCallback((memberUserId: string) => (
    runSharingAction(
      sharingActionKey('revoke-member', memberUserId),
      () => revokeSpaceMember(spaceId || '', memberUserId),
    )
  ), [runSharingAction, spaceId]);

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
      requestOverviewSync();
    } catch (err) {
      console.error('Import error:', err);
      alert(err instanceof Error ? err.message : 'Failed to import');
    } finally {
      setIsImporting(false);
      if (importInputRef.current) {
        importInputRef.current.value = '';
      }
    }
  }, [spaceId, isImporting, requestOverviewSync]);

  const headerRightSlot = user ? (
    <div className={styles.headerRight}>
      <HeaderNav userName={user.name} userEmail={user.email} />
    </div>
  ) : (
    <ButtonLink to="/login" variant="primary" size="sm">Sign In</ButtonLink>
  );

  if (isLoading) {
    return (
      <div className={styles.page}>
        <WorkspaceChrome
          leftSlot={<Link to="/" className={styles.brand}>Make Effects</Link>}
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
        <WorkspaceChrome
          leftSlot={<Link to="/" className={styles.brand}>Make Effects</Link>}
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

  return (
    <div className={styles.page}>
      <WorkspaceChrome
        leftSlot={<Link to="/" className={styles.brand}>Make Effects</Link>}
        rightSlot={headerRightSlot}
        statusSlot={<UsageIndicator />}
      />

      {/* Full-screen canvas container */}
      <div
        className={`${styles.canvasContainer} ${isSpaceDragOver ? styles.canvasDropActive : ''}`}
        onDragOver={handleSpaceDragOver}
        onDragLeave={handleSpaceDragLeave}
        onDrop={handleSpaceDrop}
      >
        <div className={`${styles.canvasWorkspace} ${hasSpaceSidePanel ? styles.canvasWorkspaceWithInspector : ''}`}>
          <div className={styles.canvasStage}>
        <SpaceCanvas
          spaceId={spaceId || ''}
          assets={assets}
          variants={variants}
          collections={collections}
          collectionItems={collectionItems}
          lineage={lineage}
          isInitialSyncPending={!hasSynced}
          onAssetClick={handleAssetOpen}
          onAddToTray={canEdit ? handleAddToTray : undefined}
          isVariantInForgeTray={isVariantInForgeTray}
        />

        <CanvasToolbar ariaLabel="Space controls">
          <CanvasToolbarTitle>
            <h1 className={styles.spaceTitle}>{space.name}</h1>
          </CanvasToolbarTitle>
          <CanvasToolbarBadge tone={space.role}>
            {space.role}
          </CanvasToolbarBadge>
          <CanvasToolbarDivider />
          <CanvasToolbarGroup>
            <CanvasToolbarStat
              title="Space members"
              icon={(
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              )}
            >
              {members.length}
            </CanvasToolbarStat>
            {isOwner && (
              <CanvasToolbarButton
                active={showSharingPanel}
                onClick={() => {
                  setSharingActionError(null);
                  setShowSharingPanel((value) => {
                    const next = !value;
                    return next;
                  });
                }}
                title="Manage sharing"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M19 8v6" />
                  <path d="M22 11h-6" />
                </svg>
              </CanvasToolbarButton>
            )}
            <CanvasToolbarStat
              title="Assets"
              icon={(
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              )}
            >
              {assets.length}
            </CanvasToolbarStat>
            {wsStatus === 'connected' && <CanvasToolbarLive />}
          </CanvasToolbarGroup>
          <CanvasToolbarDivider />
          <CanvasToolbarButton
            onClick={handleExport}
            disabled={isExporting || assets.length === 0}
            title={assets.length === 0 ? 'No assets to export' : 'Export all assets as ZIP'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </CanvasToolbarButton>
          {canEdit && (
            <>
              <CanvasToolbarButton
                onClick={() => importInputRef.current?.click()}
                disabled={isImporting}
                title="Import from ZIP"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </CanvasToolbarButton>
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
              <CanvasToolbarDivider />
              <CanvasToolbarButton
                onClick={() => setShowTileSetPanel(true)}
                title="Create Tile Set"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="8" height="8" rx="1" />
                  <rect x="13" y="3" width="8" height="8" rx="1" />
                  <rect x="3" y="13" width="8" height="8" rx="1" />
                  <rect x="13" y="13" width="8" height="8" rx="1" />
                </svg>
              </CanvasToolbarButton>
            </>
          )}
        </CanvasToolbar>

        {isSpaceDragOver && (
          <CanvasDropHint
            scope="Space"
            message="New asset"
            detail="Drop a media file onto the canvas"
          />
        )}

        {/* Jobs overlay - compact toast-style at bottom left */}
        {jobs.size > 0 && (
          <div className={styles.jobsOverlay}>
            {Array.from(jobs.values()).map((job) => {
              return (
                <div key={job.jobId} className={`${styles.jobCard} ${styles[job.status]}`}>
                  <span className={styles.jobStatus} aria-label={`${JOB_STATUS_LABELS[job.status]} job`} />
                  <div className={styles.jobInfo}>
                    {job.assetName && (
                      <span className={styles.jobAssetName}>{job.assetName}</span>
                    )}
                    {job.prompt && job.status !== 'completed' && (
                      <span className={styles.jobPrompt}>"{job.prompt}"</span>
                    )}
                    {job.error && <span className={styles.jobError}>{job.error}</span>}
                  </div>
                  {(job.status === 'completed' || job.status === 'failed') && (
                    <IconButton
                      className={styles.dismissButton}
                      onClick={() => clearJob(job.jobId)}
                      aria-label="Dismiss job"
                      title="Dismiss"
                      variant="ghost"
                      size="sm"
                    >
                      ×
                    </IconButton>
                  )}
                </div>
              );
            })}
          </div>
        )}
          </div>

          {showSharingPanel && isOwner && (
            <div className={styles.spaceSidePanelContainer}>
              <SpaceSharingPanel
                currentUserRole={space.role}
                layout="rail"
                sharing={sharingQuery.data ?? null}
                isLoading={sharingQuery.isPending}
                error={sharingQuery.error instanceof Error ? sharingQuery.error.message : null}
                actionError={sharingActionError}
                busyAction={busySharingAction}
                onClose={() => setShowSharingPanel(false)}
                onInvite={handleInviteMember}
                onApproveRequest={handleApproveRequest}
                onRejectRequest={handleRejectRequest}
                onRevokeInvitation={handleRevokeInvitation}
                onChangeMemberRole={handleChangeMemberRole}
                onRevokeMember={handleRevokeMember}
              />
            </div>
          )}
        </div>
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
          chatHistoryLoaded={historyLoaded}
          sendChatMessage={handleSendChatMessage}
          requestChatHistory={requestChatHistory}
          clearChatSession={clearChatSession}
          stylePresets={stylePresets}
          forgeError={forgeError}
          forgeErrorCode={forgeErrorCode}
          generationEstimate={generationEstimate}
          sendGenerationEstimateRequest={sendGenerationEstimateRequest}
        />
      )}

      {/* Tile Set Panel modal */}
      {showTileSetPanel && (
        <TileSetPanel
          tileSets={tileSets}
          tilePositions={tilePositions}
          variants={variants}
          hasDefaultStyle={Boolean(defaultStylePreset)}
          onSubmit={(params) => {
            sendTileSetRequest(params);
          }}
          onCancel={(tileSetId) => {
            sendTileSetCancel(tileSetId);
          }}
          onClose={() => setShowTileSetPanel(false)}
        />
      )}

    </div>
  );
}
