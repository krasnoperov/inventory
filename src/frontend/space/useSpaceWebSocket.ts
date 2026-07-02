import { useEffect } from 'react';
import type { UseSpaceWebSocketParams, UseSpaceWebSocketReturn } from './protocol';
import {
  EMPTY_ASSETS,
  EMPTY_COLLECTION_ITEMS,
  EMPTY_COLLECTIONS,
  EMPTY_JOBS,
  EMPTY_LINEAGE,
  EMPTY_PRESENCE,
  EMPTY_ROTATION_SETS,
  EMPTY_ROTATION_VIEWS,
  EMPTY_STYLE_PRESETS,
  EMPTY_STYLE_REFERENCE_COLLECTIONS,
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
  onBatchStarted,
  onBatchProgress,
  onBatchCompleted,
  onGenerationEstimate,
  onRotationStarted,
  onRotationStepCompleted,
  onRotationCompleted,
  onRotationFailed,
  onRotationCancelled,
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
  const rawCollections = useSpaceSessionStore((state) => state.collections);
  const rawCollectionItems = useSpaceSessionStore((state) => state.collectionItems);
  const rawJobs = useSpaceSessionStore((state) => state.jobs);
  const rawPresence = useSpaceSessionStore((state) => state.presence);
  const rawRotationSets = useSpaceSessionStore((state) => state.rotationSets);
  const rawRotationViews = useSpaceSessionStore((state) => state.rotationViews);
  const rawStylePresets = useSpaceSessionStore((state) => state.stylePresets);
  const rawStyleReferenceCollections = useSpaceSessionStore((state) => state.styleReferenceCollections);
  const setJobs = useSpaceSessionStore((state) => state.setJobs);

  const ownsState = stateSpaceId === spaceId;
  const status = ownsState ? rawStatus : 'connecting';
  const error = ownsState ? rawError : null;
  const hasSynced = ownsState ? rawHasSynced : false;
  const assets = ownsState ? rawAssets : EMPTY_ASSETS;
  const variants = ownsState ? rawVariants : EMPTY_VARIANTS;
  const lineage = ownsState ? rawLineage : EMPTY_LINEAGE;
  const collections = ownsState ? rawCollections : EMPTY_COLLECTIONS;
  const collectionItems = ownsState ? rawCollectionItems : EMPTY_COLLECTION_ITEMS;
  const jobs = ownsState ? rawJobs : EMPTY_JOBS;
  const presence = ownsState ? rawPresence : EMPTY_PRESENCE;
  const rotationSets = ownsState ? rawRotationSets : EMPTY_ROTATION_SETS;
  const rotationViews = ownsState ? rawRotationViews : EMPTY_ROTATION_VIEWS;
  const stylePresets = ownsState ? rawStylePresets : EMPTY_STYLE_PRESETS;
  const styleReferenceCollections = ownsState ? rawStyleReferenceCollections : EMPTY_STYLE_REFERENCE_COLLECTIONS;

  const syncModeRef = getSpaceSessionSyncModeRef();
  const commands = useSpaceCommands({ spaceId, setJobs, syncModeRef });
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
    regenerateVariant,
    severLineage,
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
    approveApproval,
    rejectApproval,
    listApprovals,
    getSession,
    updateSession: updateSessionMethod,
    requestChatHistory,
    startNewSession,
    sendPersistentChatMessage,
    clearChatSession,
    createStylePreset,
    updateStylePreset,
    deleteStylePreset,
    sendBatchRequest,
    sendGenerationEstimateRequest,
    sendRotationRequest,
    sendRotationCancel,
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
    onBatchStarted,
    onBatchProgress,
    onBatchCompleted,
    onGenerationEstimate,
    onRotationStarted,
    onRotationStepCompleted,
    onRotationCompleted,
    onRotationFailed,
    onRotationCancelled,
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
    collections,
    collectionItems,
    jobs,
    presence,
    stylePresets,
    styleReferenceCollections,
    sendMessage,
    createAsset,
    updateAsset,
    deleteAsset,
    setActiveVariant,
    deleteVariant,
    forkAsset,
    starVariant,
    retryVariant,
    regenerateVariant,
    severLineage,
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
    createStylePreset,
    updateStylePreset,
    deleteStylePreset,
    // Batch methods
    sendBatchRequest,
    sendGenerationEstimateRequest,
    // Rotation pipeline
    rotationSets,
    rotationViews,
    sendRotationRequest,
    sendRotationCancel,
    sendVariantRate,
  };
}

export default useSpaceWebSocket;
