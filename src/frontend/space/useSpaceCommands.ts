import { useCallback } from 'react';
import type {
  Asset,
  AssetChanges,
  AutoDescribeRequestParams,
  BatchRequestParams,
  ChatForgeContext,
  ChatRequestParams,
  CompareRequestParams,
  DescribeRequestParams,
  ForkParams,
  GenerationEstimateRequestParams,
  GenerateRequestParams,
  JobContext,
  RefineRequestParams,
  RotationRequestParams,
  TileSetRequestParams,
  UseSpaceWebSocketReturn,
} from './protocol';
import type { SpaceSessionState } from './spaceStore';
import { sharedSpaceSocketSession } from './spaceSocketSession';

interface SpaceCommandsInput {
  spaceId: string;
  assets: Asset[];
  setJobs: SpaceSessionState['setJobs'];
  syncModeRef: { current: 'full' | 'overview' | null };
}

type SpaceCommands = Pick<UseSpaceWebSocketReturn,
  | 'sendMessage'
  | 'createAsset'
  | 'updateAsset'
  | 'deleteAsset'
  | 'setActiveVariant'
  | 'deleteVariant'
  | 'forkAsset'
  | 'starVariant'
  | 'retryVariant'
  | 'severLineage'
  | 'requestSync'
  | 'requestOverviewSync'
  | 'trackJob'
  | 'clearJob'
  | 'updatePresence'
  | 'sendChatMessage'
  | 'sendChatRequest'
  | 'sendGenerateRequest'
  | 'sendRefineRequest'
  | 'sendDescribeRequest'
  | 'sendCompareRequest'
  | 'sendAutoDescribeRequest'
  | 'getChildren'
  | 'getAncestors'
  | 'getRootAssets'
  | 'approveApproval'
  | 'rejectApproval'
  | 'listApprovals'
  | 'getSession'
  | 'updateSession'
  | 'requestChatHistory'
  | 'startNewSession'
  | 'sendPersistentChatMessage'
  | 'clearChatSession'
  | 'sendStyleGet'
  | 'sendStyleSet'
  | 'sendStyleDelete'
  | 'sendStyleToggle'
  | 'sendBatchRequest'
  | 'sendGenerationEstimateRequest'
  | 'sendRotationRequest'
  | 'sendRotationCancel'
  | 'sendTileSetRequest'
  | 'sendTileSetCancel'
  | 'sendRetryTile'
  | 'sendRefineEdges'
  | 'sendRefineTile'
  | 'sendVariantRate'
>;

export function useSpaceCommands({ spaceId, assets, setJobs, syncModeRef }: SpaceCommandsInput): SpaceCommands {
  // Send a message through the WebSocket
  const sendMessage = useCallback((msg: object) => {
    if (
      sharedSpaceSocketSession.spaceId === spaceId &&
      sharedSpaceSocketSession.ws?.readyState === WebSocket.OPEN
    ) {
      sharedSpaceSocketSession.ws.send(JSON.stringify(msg));
    } else {
      console.warn('WebSocket not connected, cannot send message:', msg);
    }
  }, [spaceId]);

  // Asset mutation methods
  const createAsset = useCallback((name: string, type: string, parentAssetId?: string) => {
    sendMessage({ type: 'asset:create', name, assetType: type, parentAssetId });
  }, [sendMessage]);

  const updateAsset = useCallback((assetId: string, changes: AssetChanges) => {
    sendMessage({ type: 'asset:update', assetId, changes });
  }, [sendMessage]);

  const deleteAsset = useCallback((assetId: string) => {
    sendMessage({ type: 'asset:delete', assetId });
  }, [sendMessage]);

  const setActiveVariant = useCallback((assetId: string, variantId: string) => {
    sendMessage({ type: 'asset:setActive', assetId, variantId });
  }, [sendMessage]);

  const deleteVariant = useCallback((variantId: string) => {
    sendMessage({ type: 'variant:delete', variantId });
  }, [sendMessage]);

  // Fork new asset from existing asset or variant (copy operation with lineage)
  const forkAsset = useCallback((params: ForkParams) => {
    sendMessage({
      type: 'asset:fork',
      sourceAssetId: params.sourceAssetId,
      sourceVariantId: params.sourceVariantId,
      name: params.name,
      assetType: params.assetType,
      mediaKind: params.mediaKind,
      parentAssetId: params.parentAssetId,
    });
  }, [sendMessage]);

  // Star/unstar a variant
  const starVariant = useCallback((variantId: string, starred: boolean) => {
    sendMessage({ type: 'variant:star', variantId, starred });
  }, [sendMessage]);

  // Retry a failed variant generation
  const retryVariant = useCallback((variantId: string) => {
    sendMessage({ type: 'variant:retry', variantId });
  }, [sendMessage]);

  // Sever lineage link (cut historical connection)
  const severLineage = useCallback((lineageId: string) => {
    sendMessage({ type: 'lineage:sever', lineageId });
  }, [sendMessage]);

  const requestSync = useCallback(() => {
    syncModeRef.current = 'full';
    sharedSpaceSocketSession.syncMode = 'full';
    sendMessage({ type: 'sync:request' });
  }, [sendMessage, syncModeRef]);

  const requestOverviewSync = useCallback(() => {
    syncModeRef.current = 'overview';
    sharedSpaceSocketSession.syncMode = 'overview';
    sendMessage({ type: 'sync:overview' });
  }, [sendMessage, syncModeRef]);

  // Update presence (what asset the user is viewing)
  const updatePresence = useCallback((viewing?: string) => {
    sendMessage({ type: 'presence:update', viewing });
  }, [sendMessage]);

  // Send chat message via WebSocket
  const sendChatMessage = useCallback((content: string) => {
    sendMessage({ type: 'chat:send', content });
  }, [sendMessage]);

  // Send chat request to trigger ChatWorkflow
  const sendChatRequest = useCallback((params: ChatRequestParams): string => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'chat:request',
      requestId,
      message: params.message,
      mode: params.mode,
      forgeContext: params.forgeContext,
      viewingContext: params.viewingContext,
    });
    return requestId;
  }, [sendMessage]);

  // Send generate request to trigger GenerationWorkflow
  const sendGenerateRequest = useCallback((params: GenerateRequestParams): string => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'generate:request',
      requestId,
      name: params.name,
      assetType: params.assetType,
      mediaKind: params.mediaKind,
      prompt: params.prompt,
      referenceAssetIds: params.referenceAssetIds,
      referenceVariantIds: params.referenceVariantIds,
      model: params.model,
      aspectRatio: params.aspectRatio,
      imageSize: params.imageSize,
      parentAssetId: params.parentAssetId,
      disableStyle: params.disableStyle,
      voiceId: params.voiceId,
      dialogueVoiceIds: params.dialogueVoiceIds,
      musicProvider: params.musicProvider,
      generateAudio: params.generateAudio,
      videoResolution: params.videoResolution,
      videoDurationSeconds: params.videoDurationSeconds,
      videoTier: params.videoTier,
    });
    return requestId;
  }, [sendMessage]);

  // Send refine request to trigger GenerationWorkflow for variant refinement
  const sendRefineRequest = useCallback((params: RefineRequestParams): string => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'refine:request',
      requestId,
      assetId: params.assetId,
      mediaKind: params.mediaKind,
      prompt: params.prompt,
      sourceVariantId: params.sourceVariantId,
      sourceVariantIds: params.sourceVariantIds,
      referenceAssetIds: params.referenceAssetIds,
      model: params.model,
      aspectRatio: params.aspectRatio,
      imageSize: params.imageSize,
      disableStyle: params.disableStyle,
      voiceId: params.voiceId,
      dialogueVoiceIds: params.dialogueVoiceIds,
      musicProvider: params.musicProvider,
      generateAudio: params.generateAudio,
      videoResolution: params.videoResolution,
      videoDurationSeconds: params.videoDurationSeconds,
      videoTier: params.videoTier,
    });
    return requestId;
  }, [sendMessage]);

  // Send describe request to get image description via Claude vision
  const sendDescribeRequest = useCallback((params: DescribeRequestParams): string => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'describe:request',
      requestId,
      assetId: params.assetId,
      variantId: params.variantId,
      assetName: params.assetName,
      focus: params.focus,
      question: params.question,
    });
    return requestId;
  }, [sendMessage]);

  // Send compare request to compare multiple images via Claude vision
  const sendCompareRequest = useCallback((params: CompareRequestParams): string => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'compare:request',
      requestId,
      variantIds: params.variantIds,
      aspects: params.aspects,
    });
    return requestId;
  }, [sendMessage]);

  // Send auto-describe request to lazily cache variant description
  const sendAutoDescribeRequest = useCallback((params: AutoDescribeRequestParams): string => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'auto-describe:request',
      requestId,
      variantId: params.variantId,
    });
    return requestId;
  }, [sendMessage]);

  // Approval methods
  const approveApproval = useCallback((approvalId: string) => {
    sendMessage({ type: 'approval:approve', approvalId });
  }, [sendMessage]);

  const rejectApproval = useCallback((approvalId: string) => {
    sendMessage({ type: 'approval:reject', approvalId });
  }, [sendMessage]);

  const listApprovals = useCallback(() => {
    sendMessage({ type: 'approval:list' });
  }, [sendMessage]);

  // Session methods
  const getSession = useCallback(() => {
    sendMessage({ type: 'session:get' });
  }, [sendMessage]);

  const updateSessionMethod = useCallback((updates: {
    viewingAssetId?: string | null;
    viewingVariantId?: string | null;
    forgeContext?: string | null;
  }) => {
    sendMessage({ type: 'session:update', ...updates });
  }, [sendMessage]);

  // Request chat history via WebSocket (replaces REST endpoint)
  const requestChatHistory = useCallback((since?: number) => {
    sendMessage({ type: 'chat:history', since });
  }, [sendMessage]);

  // Start a new chat session
  const startNewSession = useCallback(() => {
    sendMessage({ type: 'chat:new_session' });
  }, [sendMessage]);

  // Send persistent chat message with forge context
  const sendPersistentChatMessage = useCallback((content: string, forgeContext?: ChatForgeContext) => {
    sendMessage({ type: 'chat:send', content, forgeContext });
  }, [sendMessage]);

  // Clear chat session (start fresh)
  const clearChatSession = useCallback(() => {
    sendMessage({ type: 'chat:clear' });
  }, [sendMessage]);

  // Style methods
  const sendStyleGet = useCallback(() => {
    sendMessage({ type: 'style:get' });
  }, [sendMessage]);

  const sendStyleSet = useCallback((data: { name?: string; description?: string; imageKeys?: string[]; enabled?: boolean }) => {
    sendMessage({ type: 'style:set', ...data });
  }, [sendMessage]);

  const sendStyleDelete = useCallback(() => {
    sendMessage({ type: 'style:delete' });
  }, [sendMessage]);

  const sendStyleToggle = useCallback((enabled: boolean) => {
    sendMessage({ type: 'style:toggle', enabled });
  }, [sendMessage]);

  // Batch request
  const sendBatchRequest = useCallback((params: BatchRequestParams): string => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'batch:request',
      requestId,
      name: params.name,
      assetType: params.assetType,
      mediaKind: params.mediaKind,
      prompt: params.prompt,
      count: params.count,
      mode: params.mode,
      referenceAssetIds: params.referenceAssetIds,
      referenceVariantIds: params.referenceVariantIds,
      model: params.model,
      aspectRatio: params.aspectRatio,
      imageSize: params.imageSize,
      parentAssetId: params.parentAssetId,
      disableStyle: params.disableStyle,
      voiceId: params.voiceId,
      dialogueVoiceIds: params.dialogueVoiceIds,
      musicProvider: params.musicProvider,
    });
    return requestId;
  }, [sendMessage]);

  const sendGenerationEstimateRequest = useCallback((params: GenerationEstimateRequestParams): string => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'generation:estimate',
      requestId,
      operation: params.operation,
      assetId: params.assetId,
      assetType: params.assetType,
      mediaKind: params.mediaKind,
      prompt: params.prompt,
      count: params.count,
      model: params.model,
      imageSize: params.imageSize,
      musicProvider: params.musicProvider,
      generateAudio: params.generateAudio,
      videoResolution: params.videoResolution,
      videoDurationSeconds: params.videoDurationSeconds,
      videoTier: params.videoTier,
    });
    return requestId;
  }, [sendMessage]);

  // Rotation pipeline methods
  const sendRotationRequest = useCallback((params: RotationRequestParams & { generationMode?: 'sequential' | 'single-shot' }) => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'rotation:request',
      requestId,
      sourceVariantId: params.sourceVariantId,
      config: params.config,
      subjectDescription: params.subjectDescription,
      aspectRatio: params.aspectRatio,
      disableStyle: params.disableStyle,
      generationMode: params.generationMode,
    });
  }, [sendMessage]);

  const sendRotationCancel = useCallback((rotationSetId: string) => {
    sendMessage({ type: 'rotation:cancel', rotationSetId });
  }, [sendMessage]);

  // Tile set pipeline methods
  const sendTileSetRequest = useCallback((params: TileSetRequestParams) => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'tileset:request',
      requestId,
      tileType: params.tileType,
      gridWidth: params.gridWidth,
      gridHeight: params.gridHeight,
      prompt: params.prompt,
      seedVariantId: params.seedVariantId,
      aspectRatio: params.aspectRatio,
      disableStyle: params.disableStyle,
      generationMode: params.generationMode,
    });
  }, [sendMessage]);

  const sendTileSetCancel = useCallback((tileSetId: string) => {
    sendMessage({ type: 'tileset:cancel', tileSetId });
  }, [sendMessage]);

  const sendRetryTile = useCallback((tileSetId: string, gridX: number, gridY: number) => {
    sendMessage({ type: 'tileset:retry_tile', tileSetId, gridX, gridY });
  }, [sendMessage]);

  const sendRefineEdges = useCallback((tileSetId: string) => {
    sendMessage({ type: 'tileset:refine_edges', tileSetId });
  }, [sendMessage]);

  const sendRefineTile = useCallback((tileSetId: string, gridX: number, gridY: number) => {
    sendMessage({ type: 'tileset:refine_tile', tileSetId, gridX, gridY });
  }, [sendMessage]);

  const sendVariantRate = useCallback((variantId: string, rating: 'approved' | 'rejected') => {
    sendMessage({ type: 'variant:rate', variantId, rating });
  }, [sendMessage]);

  // Helper methods for hierarchy navigation
  const getChildren = useCallback((assetId: string): Asset[] => {
    return assets.filter(a => a.parent_asset_id === assetId);
  }, [assets]);

  const getAncestors = useCallback((assetId: string): Asset[] => {
    const ancestors: Asset[] = [];
    let current = assets.find(a => a.id === assetId);

    while (current?.parent_asset_id) {
      const parent = assets.find(a => a.id === current!.parent_asset_id);
      if (parent) {
        ancestors.unshift(parent);  // Add to front for root-first order
        current = parent;
      } else {
        break;
      }
    }

    return ancestors;
  }, [assets]);

  const getRootAssets = useCallback((): Asset[] => {
    return assets.filter(a => a.parent_asset_id === null);
  }, [assets]);

  // Job tracking methods
  const trackJob = useCallback((jobId: string, context?: JobContext) => {
    setJobs((prev) => {
      const next = new Map(prev);
      next.set(jobId, {
        jobId,
        status: 'pending',
        ...context,
      });
      return next;
    });
  }, [setJobs]);

  const clearJob = useCallback((jobId: string) => {
    setJobs((prev) => {
      const next = new Map(prev);
      next.delete(jobId);
      return next;
    });
  }, [setJobs]);

  return {
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
    requestSync,
    requestOverviewSync,
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
    getChildren,
    getAncestors,
    getRootAssets,
    trackJob,
    clearJob,
  };
}
