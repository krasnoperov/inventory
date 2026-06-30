import { useEffect, useState, useCallback, useRef } from 'react';
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
import { SpaceBoard } from '../components/SpaceBoard';
import { SpaceCanvas } from '../components/SpaceCanvas';
import { RelationsCanvas } from '../components/RelationsCanvas';
import { ForgeTray } from '../components/ForgeTray';
import { useForgeOperations } from '../hooks/useForgeOperations';
import { useImageUpload } from '../hooks/useImageUpload';
import { TileSetPanel } from '../components/TileSetPanel/TileSetPanel';
import { StylePanel } from '../components/ForgeTray/StylePanel';
import { CompositionDetail } from '../components/CompositionDetail';
import { IconButton } from '../ui';
import {
  applyCompositionShortcut,
  type CompositionShortcut,
} from '../productionShortcuts';
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
  const isLoading = spaceDataQuery.isPending;
  const error = spaceDataQuery.error instanceof Error ? spaceDataQuery.error.message : null;
  const [forgeError, setForgeError] = useState<string | null>(null);
  const [forgeErrorCode, setForgeErrorCode] = useState<string | null>(null);
  const [generationEstimate, setGenerationEstimate] = useState<GenerationEstimateResult | null>(null);
  const [showSharingPanel, setShowSharingPanel] = useState(false);
  const [sharingActionError, setSharingActionError] = useState<string | null>(null);
  const [busySharingAction, setBusySharingAction] = useState<string | null>(null);

  const sharingQuery = useQuery({
    ...spaceSharingQueryOptions(spaceId || ''),
    enabled: Boolean(user && spaceId && isOwner && showSharingPanel),
  });

  // Set page title
  useDocumentTitle(space?.name);

  // Forge tray store
  const { addSlot } = useForgeTrayStore();

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
    relations,
    collections,
    collectionItems,
    stylePresets,
    compositions,
    compositionItems,
    jobs,
    regenerateVariant,
    requestSync,
    requestOverviewSync,
    clearJob,
    sendGenerateRequest,
    sendRefineRequest,
    sendPersistentChatMessage,
    requestChatHistory,
    clearChatSession,
    forkAsset,
    createCollection,
    updateCollection,
    deleteCollection,
    addCollectionItem,
    updateCollectionItem,
    reorderCollectionItems,
    deleteCollectionItem,
    createComposition,
    updateComposition,
    deleteComposition,
    createCompositionItem,
    updateCompositionItem,
    reorderCompositionItems,
    deleteCompositionItem,
    createStylePreset,
    updateStylePreset,
    deleteStylePreset,
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

  // Board (scrolling wall) vs canvas (floating collection frames) vs relations
  // (asset graph with typed edges) view.
  const [viewMode, setViewMode] = useState<'wall' | 'canvas' | 'relations'>('wall');

  // The graph views (canvas, relations) draw lineage edges, but the default
  // overview sync omits lineage — leaving the relations Story view empty (every
  // asset reads as an unlinked orphan). Upgrade to a full sync when a graph view
  // is open; the full sync then sticks. Gated on a live connection so the
  // request isn't dropped before the socket opens — it re-fires on (re)connect,
  // covering the slow-connection path where the toolbar renders before OPEN.
  useEffect(() => {
    if ((viewMode === 'relations' || viewMode === 'canvas') && wsStatus === 'connected') {
      requestSync();
    }
  }, [viewMode, wsStatus, requestSync]);

  // Tile Set panel state
  const [showTileSetPanel, setShowTileSetPanel] = useState(false);

  // Composition detail panel state
  const [showCompositionPanel, setShowCompositionPanel] = useState(false);
  const [selectedCompositionId, setSelectedCompositionId] = useState<string | null>(null);

  // Style panel state
  const [showStylePanel, setShowStylePanel] = useState(false);
  const defaultStylePreset = stylePresets.find((preset) => (
    (preset.enabled === true || preset.enabled === 1) &&
    (preset.is_default === true || preset.is_default === 1)
  ));

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

  // Post-generation composition placement: apply a chosen role to a finished
  // variant. Replaces the old pre-generation shortcut dropdown — the decision
  // now happens over a real result, not predicted before it exists.
  const handlePlaceInComposition = useCallback((variant: Variant, shortcut: CompositionShortcut) => {
    applyCompositionShortcut(shortcut, variant, compositionItems, {
      updateComposition,
      createCompositionItem,
      updateCompositionItem,
    });
  }, [compositionItems, updateComposition, createCompositionItem, updateCompositionItem]);

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

  const handleRegenerateVariant = useCallback((variant: Variant) => {
    regenerateVariant(variant.id);
  }, [regenerateVariant]);

  const handleAssetOpen = useCallback((clickedAsset: Asset) => {
    navigate(`/spaces/${spaceId}/assets/${clickedAsset.id}`);
  }, [navigate, spaceId]);

  // Handle persistent chat message - wraps sendPersistentChatMessage to manage loading state
  const handleSendChatMessage = useCallback((content: string, forgeContext?: ChatForgeContext) => {
    // Add user message to UI immediately (optimistic) and set loading
    addTemporaryUserMessage(content);
    sendPersistentChatMessage(content, forgeContext);
  }, [sendPersistentChatMessage, addTemporaryUserMessage]);

  const handleOpenCompositions = useCallback(() => {
    requestSync();
    setSelectedCompositionId((current) => current ?? compositions[0]?.id ?? null);
    setShowCompositionPanel(true);
  }, [compositions, requestSync]);

  const handleCreateComposition = useCallback(() => {
    const id = createComposition({
      name: `Composition ${compositions.length + 1}`,
    });
    setSelectedCompositionId(id);
    setShowCompositionPanel(true);
  }, [compositions.length, createComposition]);

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
    <Link to="/login" className={styles.authButton}>Sign In</Link>
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

  const canEdit = space.role === 'owner' || space.role === 'editor';

  return (
    <div className={styles.page}>
      <WorkspaceChrome
        leftSlot={<Link to="/" className={styles.brand}>Make Effects</Link>}
        rightSlot={headerRightSlot}
        statusSlot={<UsageIndicator />}
      />

      {/* Full-screen canvas container */}
      <div className={styles.canvasContainer}>
        {viewMode === 'relations' ? (
          <RelationsCanvas
            spaceId={spaceId || ''}
            assets={assets}
            variants={variants}
            lineage={lineage}
            relations={relations}
            collections={collections}
            collectionItems={collectionItems}
            compositions={compositions}
            compositionItems={compositionItems}
            isInitialSyncPending={!hasSynced}
            onAssetClick={handleAssetOpen}
          />
        ) : viewMode === 'canvas' ? (
          <SpaceCanvas
            spaceId={spaceId || ''}
            assets={assets}
            variants={variants}
            collections={collections}
            collectionItems={collectionItems}
            lineage={lineage}
            isInitialSyncPending={!hasSynced}
            onAssetClick={handleAssetOpen}
          />
        ) : (
          <SpaceBoard
            spaceId={spaceId || ''}
            assets={assets}
            variants={variants}
            collections={collections}
            collectionItems={collectionItems}
            canEdit={canEdit}
            isInitialSyncPending={!hasSynced}
            onAssetClick={handleAssetOpen}
            onAddToTray={canEdit ? handleAddToTray : undefined}
            onRegenerateVariant={canEdit ? handleRegenerateVariant : undefined}
            compositions={compositions}
            compositionItems={compositionItems}
            onPlaceInComposition={canEdit ? handlePlaceInComposition : undefined}
            createCollection={createCollection}
            updateCollection={updateCollection}
            deleteCollection={deleteCollection}
            addCollectionItem={addCollectionItem}
            updateCollectionItem={updateCollectionItem}
            reorderCollectionItems={reorderCollectionItems}
            deleteCollectionItem={deleteCollectionItem}
          />
        )}

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
                  setShowSharingPanel((value) => !value);
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
            active={viewMode === 'canvas'}
            onClick={() => setViewMode((mode) => (mode === 'canvas' ? 'wall' : 'canvas'))}
            title={viewMode === 'canvas' ? 'Switch to board view' : 'Switch to canvas view'}
          >
            {viewMode === 'canvas' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="8" height="6" rx="1.5" />
                <rect x="14" y="4" width="7" height="9" rx="1.5" />
                <rect x="3" y="13" width="8" height="7" rx="1.5" />
                <rect x="14" y="16" width="7" height="4" rx="1.5" />
              </svg>
            )}
          </CanvasToolbarButton>
          <CanvasToolbarButton
            active={viewMode === 'relations'}
            onClick={() => setViewMode((mode) => (mode === 'relations' ? 'wall' : 'relations'))}
            title={viewMode === 'relations' ? 'Switch to board view' : 'Switch to relations view'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="5" cy="6" r="2.5" />
              <circle cx="19" cy="6" r="2.5" />
              <circle cx="12" cy="18" r="2.5" />
              <path d="M7 7.5 17 7.5M6.5 8 11 16M17.5 8 13 16" />
            </svg>
          </CanvasToolbarButton>
          <CanvasToolbarDivider />
          <CanvasToolbarButton
            onClick={() => navigate(`/spaces/${spaceId}/production`)}
            title="Open Production view"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16" />
              <path d="M4 12h16" />
              <path d="M4 18h10" />
              <circle cx="17" cy="18" r="3" />
            </svg>
          </CanvasToolbarButton>
          <CanvasToolbarButton
            onClick={handleOpenCompositions}
            title="Open compositions"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="4" y="4" width="7" height="7" rx="1" />
              <rect x="13" y="4" width="7" height="7" rx="1" />
              <rect x="8.5" y="13" width="7" height="7" rx="1" />
              <path d="M11 7.5h2" />
              <path d="M12 11v2" />
            </svg>
          </CanvasToolbarButton>
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
              <CanvasToolbarButton
                className={defaultStylePreset ? styles.styleActive : undefined}
                onClick={() => setShowStylePanel(v => !v)}
                title={defaultStylePreset ? `Style: ${defaultStylePreset.name}` : 'Configure style presets'}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.8-.1 2.6-.4.5-.2.8-.7.7-1.2-.1-.4-.3-.7-.6-.9-.4-.3-.6-.8-.6-1.3 0-1 .8-1.8 1.8-1.8h2.1c3 0 5.5-2.5 5.5-5.5C23.5 5.5 18.5 2 12 2z" />
                  <circle cx="8" cy="10" r="1.5" fill="currentColor" stroke="none" />
                  <circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none" />
                  <circle cx="16" cy="10" r="1.5" fill="currentColor" stroke="none" />
                </svg>
              </CanvasToolbarButton>
            </>
          )}
        </CanvasToolbar>

        {showSharingPanel && isOwner && (
          <div className={styles.sharingPanelContainer}>
            <SpaceSharingPanel
              currentUserRole={space.role}
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

        {/* Jobs overlay - compact toast-style at bottom left */}
        {jobs.size > 0 && (
          <div className={styles.jobsOverlay}>
            {Array.from(jobs.values()).map((job) => {
              return (
                <div key={job.jobId} className={`${styles.jobCard} ${styles[job.status]}`}>
                  <div className={styles.jobStatus}>
                    {job.status === 'pending' && '⏳'}
                    {job.status === 'processing' && '🔄'}
                    {job.status === 'completed' && '✓'}
                    {job.status === 'failed' && '✗'}
                  </div>
                  <div className={styles.jobInfo}>
                    {job.assetName && (
                      <span className={styles.jobAssetName}>{job.assetName}</span>
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
          spaceId={spaceId}
          createStylePreset={createStylePreset}
          updateStylePreset={updateStylePreset}
          deleteStylePreset={deleteStylePreset}
          stylePresets={stylePresets}
          collections={collections}
          collectionItems={collectionItems}
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

      {showCompositionPanel && (
        <div className={styles.compositionPanelContainer}>
          <CompositionDetail
            spaceId={spaceId}
            compositions={compositions}
            compositionItems={compositionItems}
            assets={assets}
            variants={variants}
            lineage={lineage}
            collections={collections}
            collectionItems={collectionItems}
            selectedCompositionId={selectedCompositionId}
            canEdit={canEdit}
            onSelectComposition={setSelectedCompositionId}
            onCreateComposition={canEdit ? handleCreateComposition : undefined}
            onUpdateComposition={updateComposition}
            onDeleteComposition={(compositionId) => {
              deleteComposition(compositionId);
              setSelectedCompositionId((current) => current === compositionId ? null : current);
            }}
            onCreateItem={createCompositionItem}
            onUpdateItem={updateCompositionItem}
            onDeleteItem={deleteCompositionItem}
            onReorderItems={reorderCompositionItems}
            onOpenAsset={(assetId) => navigate(`/spaces/${spaceId}/assets/${assetId}`)}
            onClose={() => setShowCompositionPanel(false)}
          />
        </div>
      )}

      {/* Style Panel - floating panel from toolbar */}
      {showStylePanel && spaceId && (
        <div className={styles.stylePanelContainer}>
          <StylePanel
            spaceId={spaceId}
            onClose={() => setShowStylePanel(false)}
            createStylePreset={createStylePreset}
            updateStylePreset={updateStylePreset}
            deleteStylePreset={deleteStylePreset}
            stylePresets={stylePresets}
            styleReferenceCollections={collections.filter((collection) => collection.kind === 'style_refs')}
          />
        </div>
      )}
    </div>
  );
}
