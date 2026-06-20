import { useEffect } from 'react';
import type { UseSpaceWebSocketParams, UseSpaceWebSocketReturn } from './protocol';
import {
  EMPTY_ASSETS,
  EMPTY_COLLECTION_ITEMS,
  EMPTY_COLLECTIONS,
  EMPTY_JOBS,
  EMPTY_LINEAGE,
  EMPTY_PRESENCE,
  EMPTY_RELATIONS,
  EMPTY_ROTATION_SETS,
  EMPTY_ROTATION_VIEWS,
  EMPTY_TILE_POSITIONS,
  EMPTY_TILE_SETS,
  EMPTY_VARIANTS,
  useSpaceSessionStore,
} from './spaceStore';
import { getSpaceSessionSyncModeRef, registerSpaceView } from './spaceSessionRuntime';
import { useSpaceCallbackRefs } from './useSpaceCallbackRefs';
import { useSpaceCommands } from './useSpaceCommands';

export * from './protocol';
export {
  clearSpaceStateSnapshotCacheForTests,
  getSpaceStateSnapshotForTests,
  saveSpaceStateSnapshotForTests,
  shouldPersistSpaceStateSnapshotForTests,
} from './spaceSnapshots';
export {
  getInitialSyncModeForSpaceForTests,
  getSharedSpaceSocketSessionForTests,
  resetSharedSpaceSocketSessionForTests,
  shouldApplyOverviewSyncForTests,
  shouldReuseSharedSpaceSocketForTests,
} from './spaceSocketSession';
export { useSpaceSessionStore } from './spaceStore';

/**
 * View adapter for the opened Space session.
 * The socket lifecycle lives in spaceSessionRuntime and is mounted by /spaces/$id.
 */
export function useSpaceWebSocket({
  spaceId,
  syncMode,
  requestChatHistoryOnConnect,
  sessionUpdateOnConnect,
  onConnect,
  onDisconnect,
  onJobComplete,
  onChatMessage,
  onChatResponse,
  onChatProgress,
  onGenerateStarted,
  onGenerateResult,
  onDescribeResponse,
  onCompareResponse,
  onApprovalCreated,
  onApprovalUpdated,
  onApprovalList,
  onAutoExecuted,
  onSessionState,
  onChatHistory,
  onPersistentChatMessage,
  onPersistentChatProgress,
  onSessionCreated,
  onPlanUpdated,
  onPlanArchived,
  onStyleState,
  onStyleUpdated,
  onStyleDeleted,
  onBatchStarted,
  onBatchProgress,
  onBatchCompleted,
  onGenerationEstimate,
  onRotationStarted,
  onRotationStepCompleted,
  onRotationCompleted,
  onRotationFailed,
  onRotationCancelled,
  onTileSetStarted,
  onTileSetTileCompleted,
  onTileSetCompleted,
  onTileSetFailed,
  onTileSetCancelled,
  onGenerateError,
  onRefineError,
  onBatchError,
  onError,
}: UseSpaceWebSocketParams): UseSpaceWebSocketReturn {
  const stateSpaceId = useSpaceSessionStore((state) => state.stateSpaceId);
  const rawStatus = useSpaceSessionStore((state) => state.status);
  const rawError = useSpaceSessionStore((state) => state.error);
  const rawHasSynced = useSpaceSessionStore((state) => state.hasSynced);
  const rawAssets = useSpaceSessionStore((state) => state.assets);
  const rawVariants = useSpaceSessionStore((state) => state.variants);
  const rawLineage = useSpaceSessionStore((state) => state.lineage);
  const rawRelations = useSpaceSessionStore((state) => state.relations);
  const rawCollections = useSpaceSessionStore((state) => state.collections);
  const rawCollectionItems = useSpaceSessionStore((state) => state.collectionItems);
  const rawJobs = useSpaceSessionStore((state) => state.jobs);
  const rawPresence = useSpaceSessionStore((state) => state.presence);
  const rawRotationSets = useSpaceSessionStore((state) => state.rotationSets);
  const rawRotationViews = useSpaceSessionStore((state) => state.rotationViews);
  const rawTileSets = useSpaceSessionStore((state) => state.tileSets);
  const rawTilePositions = useSpaceSessionStore((state) => state.tilePositions);
  const setJobs = useSpaceSessionStore((state) => state.setJobs);

  const ownsState = stateSpaceId === spaceId;
  const status = ownsState ? rawStatus : 'connecting';
  const error = ownsState ? rawError : null;
  const hasSynced = ownsState ? rawHasSynced : false;
  const assets = ownsState ? rawAssets : EMPTY_ASSETS;
  const variants = ownsState ? rawVariants : EMPTY_VARIANTS;
  const lineage = ownsState ? rawLineage : EMPTY_LINEAGE;
  const relations = ownsState ? rawRelations : EMPTY_RELATIONS;
  const collections = ownsState ? rawCollections : EMPTY_COLLECTIONS;
  const collectionItems = ownsState ? rawCollectionItems : EMPTY_COLLECTION_ITEMS;
  const jobs = ownsState ? rawJobs : EMPTY_JOBS;
  const presence = ownsState ? rawPresence : EMPTY_PRESENCE;
  const rotationSets = ownsState ? rawRotationSets : EMPTY_ROTATION_SETS;
  const rotationViews = ownsState ? rawRotationViews : EMPTY_ROTATION_VIEWS;
  const tileSets = ownsState ? rawTileSets : EMPTY_TILE_SETS;
  const tilePositions = ownsState ? rawTilePositions : EMPTY_TILE_POSITIONS;

  const syncModeRef = getSpaceSessionSyncModeRef();
  const commands = useSpaceCommands({ spaceId, assets, setJobs, syncModeRef });
  const {
    sendMessage,
    createAsset,
    updateAsset,
    deleteAsset,
    setActiveVariant,
    deleteVariant,
    forkAsset,
    starVariant,
    retryVariant,
    severLineage,
    createRelation,
    updateRelation,
    deleteRelation,
    createCollection,
    updateCollection,
    deleteCollection,
    addCollectionItem,
    updateCollectionItem,
    reorderCollectionItems,
    deleteCollectionItem,
    requestSync,
    requestOverviewSync,
    trackJob,
    clearJob,
    updatePresence,
    sendChatMessage,
    sendChatRequest,
    sendGenerateRequest,
    sendRefineRequest,
    sendDescribeRequest,
    sendCompareRequest,
    sendAutoDescribeRequest,
    getChildren,
    getAncestors,
    getRootAssets,
    approveApproval,
    rejectApproval,
    listApprovals,
    getSession,
    updateSession: updateSessionMethod,
    requestChatHistory,
    startNewSession,
    sendPersistentChatMessage,
    clearChatSession,
    sendStyleGet,
    sendStyleSet,
    sendStyleDelete,
    sendStyleToggle,
    sendBatchRequest,
    sendGenerationEstimateRequest,
    sendRotationRequest,
    sendRotationCancel,
    sendTileSetRequest,
    sendTileSetCancel,
    sendRetryTile,
    sendRefineEdges,
    sendRefineTile,
    sendVariantRate,
  } = commands;

  const callbackRefs = useSpaceCallbackRefs({
    spaceId,
    syncMode,
    requestChatHistoryOnConnect,
    sessionUpdateOnConnect,
    onConnect,
    onDisconnect,
    onJobComplete,
    onChatMessage,
    onChatResponse,
    onChatProgress,
    onGenerateStarted,
    onGenerateResult,
    onDescribeResponse,
    onCompareResponse,
    onApprovalCreated,
    onApprovalUpdated,
    onApprovalList,
    onAutoExecuted,
    onSessionState,
    onChatHistory,
    onPersistentChatMessage,
    onPersistentChatProgress,
    onSessionCreated,
    onPlanUpdated,
    onPlanArchived,
    onStyleState,
    onStyleUpdated,
    onStyleDeleted,
    onBatchStarted,
    onBatchProgress,
    onBatchCompleted,
    onGenerationEstimate,
    onRotationStarted,
    onRotationStepCompleted,
    onRotationCompleted,
    onRotationFailed,
    onRotationCancelled,
    onTileSetStarted,
    onTileSetTileCompleted,
    onTileSetCompleted,
    onTileSetFailed,
    onTileSetCancelled,
    onGenerateError,
    onRefineError,
    onBatchError,
    onError,
  });
  useEffect(() => {
    if (!spaceId) return;
    return registerSpaceView({
      spaceId,
      syncMode,
      requestChatHistoryOnConnect,
      callbacks: callbackRefs,
    });
  }, [spaceId, syncMode, requestChatHistoryOnConnect, callbackRefs]);

  return {
    status,
    error,
    hasSynced,
    assets,
    variants,
    lineage,
    relations,
    collections,
    collectionItems,
    jobs,
    presence,
    sendMessage,
    createAsset,
    updateAsset,
    deleteAsset,
    setActiveVariant,
    deleteVariant,
    forkAsset,
    starVariant,
    retryVariant,
    severLineage,
    createRelation,
    updateRelation,
    deleteRelation,
    createCollection,
    updateCollection,
    deleteCollection,
    addCollectionItem,
    updateCollectionItem,
    reorderCollectionItems,
    deleteCollectionItem,
    requestSync,
    requestOverviewSync,
    trackJob,
    clearJob,
    updatePresence,
    sendChatMessage,
    sendChatRequest,
    sendGenerateRequest,
    sendRefineRequest,
    sendDescribeRequest,
    sendCompareRequest,
    sendAutoDescribeRequest,
    getChildren,
    getAncestors,
    getRootAssets,
    // Approval methods
    approveApproval,
    rejectApproval,
    listApprovals,
    // Session methods
    getSession,
    updateSession: updateSessionMethod,
    // Chat history (WebSocket-based)
    requestChatHistory,
    // Chat session methods
    startNewSession,
    // Persistent chat methods
    sendPersistentChatMessage,
    clearChatSession,
    // Style methods
    sendStyleGet,
    sendStyleSet,
    sendStyleDelete,
    sendStyleToggle,
    // Batch methods
    sendBatchRequest,
    sendGenerationEstimateRequest,
    // Rotation pipeline
    rotationSets,
    rotationViews,
    sendRotationRequest,
    sendRotationCancel,
    // Tile set pipeline
    tileSets,
    tilePositions,
    sendTileSetRequest,
    sendTileSetCancel,
    sendRetryTile,
    sendRefineEdges,
    sendRefineTile,
    sendVariantRate,
  };
}

export default useSpaceWebSocket;
