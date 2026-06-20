import type { ChatMessage, ChatMessageClient, JobStatus, ServerMessage } from './protocol';
import type { SpaceSessionState } from './spaceStore';
import type { SpaceCallbackRefs } from './useSpaceCallbackRefs';
import { sharedSpaceSocketSession, shouldApplyOverviewSync } from './spaceSocketSession';

export interface SpaceMessageContext {
  syncModeRef: { current: 'full' | 'overview' | null };
  variantIdsRef: { current: Set<string> };
  callbacks?: SpaceCallbackRefs;
  sendMessage: (message: object) => void;
  markSynced: SpaceSessionState['markSynced'];
  setAssets: SpaceSessionState['setAssets'];
  setVariants: SpaceSessionState['setVariants'];
  setLineage: SpaceSessionState['setLineage'];
  setJobs: SpaceSessionState['setJobs'];
  setPresence: SpaceSessionState['setPresence'];
  setRotationSets: SpaceSessionState['setRotationSets'];
  setRotationViews: SpaceSessionState['setRotationViews'];
  setTileSets: SpaceSessionState['setTileSets'];
  setTilePositions: SpaceSessionState['setTilePositions'];
  setError: SpaceSessionState['setError'];
}

const emptySpaceCallbackRefs = new Proxy({}, {
  get: () => ({ current: undefined }),
}) as SpaceCallbackRefs;

export function handleSpaceServerMessage(message: ServerMessage, context: SpaceMessageContext): void {
  const {
    syncModeRef,
    variantIdsRef,
    callbacks = emptySpaceCallbackRefs,
    sendMessage,
    markSynced,
    setAssets,
    setVariants,
    setLineage,
    setJobs,
    setPresence,
    setRotationSets,
    setRotationViews,
    setTileSets,
    setTilePositions,
    setError,
  } = context;
  const {
    onJobCompleteRef,
    onChatMessageRef,
    onChatResponseRef,
    onChatProgressRef,
    onGenerateStartedRef,
    onGenerateResultRef,
    onDescribeResponseRef,
    onCompareResponseRef,
    onApprovalCreatedRef,
    onApprovalUpdatedRef,
    onApprovalListRef,
    onAutoExecutedRef,
    onSessionStateRef,
    onChatHistoryRef,
    onPersistentChatMessageRef,
    onPersistentChatProgressRef,
    onSessionCreatedRef,
    onPlanUpdatedRef,
    onPlanArchivedRef,
    onStyleStateRef,
    onStyleUpdatedRef,
    onStyleDeletedRef,
    onBatchStartedRef,
    onBatchProgressRef,
    onBatchCompletedRef,
    onGenerationEstimateRef,
    onRotationStartedRef,
    onRotationStepCompletedRef,
    onRotationCompletedRef,
    onRotationFailedRef,
    onRotationCancelledRef,
    onTileSetStartedRef,
    onTileSetTileCompletedRef,
    onTileSetCompletedRef,
    onTileSetFailedRef,
    onTileSetCancelledRef,
    onGenerateErrorRef,
    onRefineErrorRef,
    onBatchErrorRef,
    onErrorRef,
  } = callbacks;

            switch (message.type) {
              case 'sync:state':
                syncModeRef.current = 'full';
                sharedSpaceSocketSession.syncMode = 'full';
                variantIdsRef.current = new Set(message.variants.map((variant) => variant.id));
                markSynced();
                setAssets(message.assets);
                setVariants(message.variants);
                setLineage(message.lineage || []);
                setPresence(message.presence || []);
                setRotationSets(message.rotationSets || []);
                setRotationViews(message.rotationViews || []);
                setTileSets(message.tileSets || []);
                setTilePositions(message.tilePositions || []);
                // Handle style included in sync:state
                if (message.style !== undefined) {
                  onStyleStateRef.current?.(message.style ?? null);
                }
                setError(null);
                break;

              case 'sync:overview':
                if (!shouldApplyOverviewSync(syncModeRef.current)) {
                  break;
                }
                syncModeRef.current = 'overview';
                sharedSpaceSocketSession.syncMode = 'overview';
                variantIdsRef.current = new Set(message.variants.map((variant) => variant.id));
                markSynced();
                setAssets(message.assets);
                setVariants(message.variants);
                setLineage([]);
                setPresence(message.presence || []);
                setRotationSets(message.rotationSets || []);
                setRotationViews(message.rotationViews || []);
                setTileSets(message.tileSets || []);
                setTilePositions(message.tilePositions || []);
                if (message.style !== undefined) {
                  onStyleStateRef.current?.(message.style ?? null);
                }
                setError(null);
                break;

              case 'asset:created':
                setAssets((prev) => [...prev, message.asset]);
                break;

              case 'asset:updated':
                setAssets((prev) =>
                  prev.map((asset) =>
                    asset.id === message.asset.id ? message.asset : asset
                  )
                );
                if (
                  syncModeRef.current === 'overview' &&
                  message.asset.active_variant_id &&
                  !variantIdsRef.current.has(message.asset.active_variant_id)
                ) {
                  sendMessage({ type: 'sync:overview' });
                }
                break;

              case 'asset:deleted':
                setAssets((prev) => prev.filter((asset) => asset.id !== message.assetId));
                break;

              case 'asset:forked':
                // Add the forked asset, variant, and lineage
                setAssets((prev) => [...prev, message.asset]);
                setVariants((prev) => {
                  if (prev.some(v => v.id === message.variant.id)) return prev;
                  const next = [...prev, message.variant];
                  variantIdsRef.current = new Set(next.map((variant) => variant.id));
                  return next;
                });
                setLineage((prev) => [...prev, message.lineage]);
                break;

              case 'variant:created':
                if (syncModeRef.current === 'overview') {
                  sendMessage({ type: 'sync:overview' });
                  break;
                }
                setVariants((prev) => {
                  // Avoid duplicates (variant may already exist from job:completed)
                  if (prev.some(v => v.id === message.variant.id)) {
                    variantIdsRef.current.add(message.variant.id);
                    return prev;
                  }
                  const next = [...prev, message.variant];
                  variantIdsRef.current = new Set(next.map((variant) => variant.id));
                  return next;
                });
                break;

              case 'variant:updated':
                setVariants((prev) =>
                  prev.map((variant) =>
                    variant.id === message.variant.id ? message.variant : variant
                  )
                );
                break;

              case 'variant:deleted':
                setVariants((prev) => {
                  const next = prev.filter((variant) => variant.id !== message.variantId);
                  variantIdsRef.current = new Set(next.map((variant) => variant.id));
                  return next;
                });
                if (syncModeRef.current === 'overview') {
                  sendMessage({ type: 'sync:overview' });
                }
                break;

              case 'lineage:created':
                setLineage((prev) => {
                  if (prev.some(l => l.id === message.lineage.id)) return prev;
                  return [...prev, message.lineage];
                });
                break;

              case 'lineage:severed':
                setLineage((prev) =>
                  prev.map((l) =>
                    l.id === message.lineageId ? { ...l, severed: true } : l
                  )
                );
                break;

              case 'job:progress':
                setJobs((prev) => {
                  const next = new Map(prev);
                  const existing = next.get(message.jobId);
                  if (existing) {
                    next.set(message.jobId, { ...existing, status: 'processing' });
                  } else {
                    next.set(message.jobId, { jobId: message.jobId, status: 'processing' });
                  }
                  return next;
                });
                break;

              case 'job:completed':
                if (syncModeRef.current === 'overview') {
                  sendMessage({ type: 'sync:overview' });
                } else {
                  setVariants((prev) => {
                    // Avoid duplicates (variant may already exist from variant:created)
                    if (prev.some(v => v.id === message.variant.id)) {
                      variantIdsRef.current.add(message.variant.id);
                      return prev;
                    }
                    const next = [...prev, message.variant];
                    variantIdsRef.current = new Set(next.map((variant) => variant.id));
                    return next;
                  });
                }
                setJobs((prev) => {
                  const next = new Map(prev);
                  const existing = next.get(message.jobId);
                  // Preserve original context (assetId, assetName, jobType, prompt) when marking complete
                  const completedJob: JobStatus = {
                    ...existing,
                    jobId: message.jobId,
                    status: 'completed',
                    variantId: message.variant.id,
                  };
                  next.set(message.jobId, completedJob);
                  // Notify callback if provided
                  onJobCompleteRef.current?.(completedJob, message.variant);
                  return next;
                });
                break;

              case 'job:failed':
                setJobs((prev) => {
                  const next = new Map(prev);
                  const existing = next.get(message.jobId);
                  // Preserve original context when marking failed
                  next.set(message.jobId, {
                    ...existing,
                    jobId: message.jobId,
                    status: 'failed',
                    error: message.error,
                  });
                  return next;
                });
                break;

              case 'chat:message':
                // Notify callback for real-time chat sync
                // Check if it's the new client format (has 'role' property)
                if ('role' in message.message) {
                  onPersistentChatMessageRef.current?.(message.message as ChatMessageClient);
                } else {
                  onChatMessageRef.current?.(message.message as ChatMessage);
                }
                break;

              case 'chat:history':
                // Notify callback with full chat history (WebSocket-based sync)
                onChatHistoryRef.current?.(message.messages, message.sessionId);
                break;

              case 'chat:session_created':
                // Notify callback when a new chat session is created
                onSessionCreatedRef.current?.(message.session);
                break;

              case 'presence:update':
                setPresence(message.presence);
                break;

              case 'error':
                setError(message.message);
                console.error('WebSocket error from server:', message.code, message.message);
                onErrorRef.current?.({ code: message.code, message: message.message });
                break;

              // Workflow response messages
              case 'chat:response':
                onChatResponseRef.current?.({
                  requestId: message.requestId,
                  success: message.success,
                  response: message.response,
                  error: message.error,
                  deferredActions: message.deferredActions,
                });
                break;

              case 'chat:progress':
                // Check if it's the new description phase format or old agentic format
                if ('phase' in message && message.phase === 'describing') {
                  onPersistentChatProgressRef.current?.({
                    requestId: message.requestId,
                    phase: message.phase,
                    variantId: message.variantId,
                    assetName: message.assetName,
                    status: message.status,
                    description: message.description,
                    index: message.index,
                    total: message.total,
                  });
                } else if ('toolName' in message) {
                  onChatProgressRef.current?.({
                    requestId: message.requestId,
                    toolName: message.toolName,
                    toolParams: message.toolParams,
                    status: message.status,
                    result: message.result,
                    error: message.error,
                  });
                }
                break;

              case 'generate:started':
                onGenerateStartedRef.current?.({
                  requestId: message.requestId,
                  jobId: message.jobId,
                  assetId: message.assetId,
                  assetName: message.assetName,
                });
                // Also track the job
                setJobs((prev) => {
                  const next = new Map(prev);
                  next.set(message.jobId, {
                    jobId: message.jobId,
                    status: 'pending',
                    assetId: message.assetId,
                    assetName: message.assetName,
                  });
                  return next;
                });
                break;

              case 'refine:started':
                // Mirror generate:started handling for refinements
                onGenerateStartedRef.current?.({
                  requestId: message.requestId,
                  jobId: message.jobId,
                  assetId: message.assetId,
                  assetName: message.assetName,
                });
                setJobs((prev) => {
                  const next = new Map(prev);
                  next.set(message.jobId, {
                    jobId: message.jobId,
                    status: 'pending',
                    assetId: message.assetId,
                    assetName: message.assetName,
                  });
                  return next;
                });
                break;

              case 'generate:result':
                onGenerateResultRef.current?.({
                  requestId: message.requestId,
                  jobId: message.jobId,
                  success: message.success,
                  variant: message.variant,
                  error: message.error,
                });
                // Update job status
                setJobs((prev) => {
                  const next = new Map(prev);
                  const existing = next.get(message.jobId);
                  if (message.success && message.variant) {
                    next.set(message.jobId, {
                      ...existing,
                      jobId: message.jobId,
                      status: 'completed',
                      variantId: message.variant.id,
                    });
                    // Notify job completion callback
                    onJobCompleteRef.current?.(
                      { ...existing, jobId: message.jobId, status: 'completed', variantId: message.variant.id },
                      message.variant
                    );
                  } else {
                    next.set(message.jobId, {
                      ...existing,
                      jobId: message.jobId,
                      status: 'failed',
                      error: message.error,
                    });
                  }
                  return next;
                });
                // Add variant to state if successful
                if (message.success && message.variant) {
                  if (syncModeRef.current === 'overview') {
                    sendMessage({ type: 'sync:overview' });
                  } else {
                    setVariants((prev) => {
                      if (prev.some(v => v.id === message.variant!.id)) return prev;
                      return [...prev, message.variant!];
                    });
                  }
                }
                break;

              case 'refine:result':
                // Handle refine result similar to generate:result
                onGenerateResultRef.current?.({
                  requestId: message.requestId,
                  jobId: message.jobId,
                  success: message.success,
                  variant: message.variant,
                  error: message.error,
                });
                // Update job status
                setJobs((prev) => {
                  const next = new Map(prev);
                  const existing = next.get(message.jobId);
                  if (message.success && message.variant) {
                    next.set(message.jobId, {
                      ...existing,
                      jobId: message.jobId,
                      status: 'completed',
                      variantId: message.variant.id,
                    });
                    onJobCompleteRef.current?.(
                      { ...existing, jobId: message.jobId, status: 'completed', variantId: message.variant.id },
                      message.variant
                    );
                  } else {
                    next.set(message.jobId, {
                      ...existing,
                      jobId: message.jobId,
                      status: 'failed',
                      error: message.error,
                    });
                  }
                  return next;
                });
                if (message.success && message.variant) {
                  if (syncModeRef.current === 'overview') {
                    sendMessage({ type: 'sync:overview' });
                  } else {
                    setVariants((prev) => {
                      if (prev.some(v => v.id === message.variant!.id)) return prev;
                      return [...prev, message.variant!];
                    });
                  }
                }
                break;

              // Vision (describe/compare) response messages
              case 'describe:response':
                onDescribeResponseRef.current?.({
                  requestId: message.requestId,
                  success: message.success,
                  description: message.description,
                  error: message.error,
                  usage: message.usage,
                });
                break;

              case 'compare:response':
                onCompareResponseRef.current?.({
                  requestId: message.requestId,
                  success: message.success,
                  comparison: message.comparison,
                  error: message.error,
                  usage: message.usage,
                });
                break;

              // Approval lifecycle messages
              case 'approval:created':
                onApprovalCreatedRef.current?.(message.approval);
                break;

              case 'approval:updated':
                onApprovalUpdatedRef.current?.(message.approval);
                break;

              case 'approval:deleted':
                // Approvals are not stored locally, just notify callback
                break;

              case 'approval:list':
                onApprovalListRef.current?.(message.approvals);
                break;

              // Auto-executed tool result
              case 'auto_executed':
                onAutoExecutedRef.current?.(message.autoExecuted);
                break;

              // Session state
              case 'session:state':
                onSessionStateRef.current?.(message.session);
                break;

              // SimplePlan messages
              case 'simple_plan:updated':
                onPlanUpdatedRef.current?.(message.plan);
                break;

              case 'simple_plan:archived':
                onPlanArchivedRef.current?.(message.planId);
                break;

              // Style messages
              case 'style:state':
                onStyleStateRef.current?.(message.style);
                break;

              case 'style:updated':
                onStyleUpdatedRef.current?.(message.style);
                break;

              case 'style:deleted':
                onStyleDeletedRef.current?.();
                break;

              // Batch messages
              case 'batch:started':
                onBatchStartedRef.current?.({
                  requestId: message.requestId,
                  batchId: message.batchId,
                  jobIds: message.jobIds,
                  assetIds: message.assetIds,
                  count: message.count,
                  mode: message.mode,
                });
                // Track all batch jobs
                setJobs((prev) => {
                  const next = new Map(prev);
                  for (const jobId of message.jobIds) {
                    next.set(jobId, { jobId, status: 'pending' });
                  }
                  return next;
                });
                break;

              case 'batch:progress':
                onBatchProgressRef.current?.({
                  batchId: message.batchId,
                  completedCount: message.completedCount,
                  failedCount: message.failedCount,
                  totalCount: message.totalCount,
                  variant: message.variant,
                });
                break;

              case 'batch:completed':
                onBatchCompletedRef.current?.({
                  batchId: message.batchId,
                  completedCount: message.completedCount,
                  failedCount: message.failedCount,
                  totalCount: message.totalCount,
                });
                break;

              case 'generation:estimate':
                onGenerationEstimateRef.current?.(message);
                break;

              // Generation/refine/batch error messages
              case 'generate:error':
                onGenerateErrorRef.current?.({
                  requestId: message.requestId,
                  error: message.error,
                  code: message.code,
                });
                break;

              case 'refine:error':
                onRefineErrorRef.current?.({
                  requestId: message.requestId,
                  error: message.error,
                  code: message.code,
                });
                break;

              case 'batch:error':
                onBatchErrorRef.current?.({
                  requestId: message.requestId,
                  error: message.error,
                  code: message.code,
                });
                break;

              // Rotation pipeline messages
              case 'rotation:started':
                setRotationSets((prev) => {
                  const existing = prev.find(rs => rs.id === message.rotationSetId);
                  if (existing) {
                    return prev.map(rs => rs.id === message.rotationSetId
                      ? { ...rs, status: 'generating' as const, total_steps: message.totalSteps }
                      : rs
                    );
                  }
                  // Add new set from broadcast data
                  return [...prev, {
                    id: message.rotationSetId,
                    asset_id: message.assetId,
                    source_variant_id: '',
                    config: '',
                    status: 'generating' as const,
                    current_step: 0,
                    total_steps: message.totalSteps,
                    error_message: null,
                    created_by: '',
                    created_at: Date.now(),
                    updated_at: Date.now(),
                  }];
                });
                onRotationStartedRef.current?.({
                  rotationSetId: message.rotationSetId,
                  assetId: message.assetId,
                  directions: message.directions,
                  totalSteps: message.totalSteps,
                });
                break;

              case 'rotation:step_completed':
                setRotationSets((prev) =>
                  prev.map(rs => rs.id === message.rotationSetId
                    ? { ...rs, current_step: message.step + 1 }
                    : rs
                  )
                );
                onRotationStepCompletedRef.current?.({
                  rotationSetId: message.rotationSetId,
                  direction: message.direction,
                  step: message.step,
                  total: message.total,
                  variantId: message.variantId,
                });
                break;

              case 'rotation:completed':
                setRotationSets((prev) =>
                  prev.map(rs => rs.id === message.rotationSetId
                    ? { ...rs, status: 'completed' as const }
                    : rs
                  )
                );
                setRotationViews((prev) => {
                  const existingIds = new Set(prev.map(rv => rv.id));
                  const newViews = message.views.filter(v => !existingIds.has(v.id));
                  return newViews.length > 0 ? [...prev, ...newViews] : prev;
                });
                onRotationCompletedRef.current?.({ rotationSetId: message.rotationSetId, views: message.views });
                break;

              case 'rotation:failed':
                setRotationSets((prev) =>
                  prev.map(rs => rs.id === message.rotationSetId
                    ? { ...rs, status: 'failed' as const, error_message: message.error }
                    : rs
                  )
                );
                onRotationFailedRef.current?.({
                  rotationSetId: message.rotationSetId,
                  error: message.error,
                  failedStep: message.failedStep,
                });
                break;

              case 'rotation:cancelled':
                setRotationSets((prev) =>
                  prev.map(rs => rs.id === message.rotationSetId
                    ? { ...rs, status: 'cancelled' as const }
                    : rs
                  )
                );
                onRotationCancelledRef.current?.(message.rotationSetId);
                break;

              // Tile set pipeline messages
              case 'tileset:started':
                setTileSets((prev) => {
                  const existing = prev.find(ts => ts.id === message.tileSetId);
                  if (existing) {
                    return prev.map(ts => ts.id === message.tileSetId
                      ? { ...ts, status: 'generating' as const, total_steps: message.totalTiles }
                      : ts
                    );
                  }
                  // Add new set from broadcast data
                  return [...prev, {
                    id: message.tileSetId,
                    asset_id: message.assetId,
                    tile_type: 'custom' as const,
                    grid_width: message.gridWidth,
                    grid_height: message.gridHeight,
                    status: 'generating' as const,
                    seed_variant_id: null,
                    config: '',
                    current_step: 0,
                    total_steps: message.totalTiles,
                    error_message: null,
                    created_by: '',
                    created_at: Date.now(),
                    updated_at: Date.now(),
                  }];
                });
                onTileSetStartedRef.current?.({
                  tileSetId: message.tileSetId,
                  assetId: message.assetId,
                  gridWidth: message.gridWidth,
                  gridHeight: message.gridHeight,
                  totalTiles: message.totalTiles,
                });
                break;

              case 'tileset:tile_completed':
                setTileSets((prev) =>
                  prev.map(ts => ts.id === message.tileSetId
                    ? { ...ts, current_step: message.step + 1 }
                    : ts
                  )
                );
                onTileSetTileCompletedRef.current?.({
                  tileSetId: message.tileSetId,
                  gridX: message.gridX,
                  gridY: message.gridY,
                  step: message.step,
                  total: message.total,
                  variantId: message.variantId,
                });
                break;

              case 'tileset:completed':
                setTileSets((prev) =>
                  prev.map(ts => ts.id === message.tileSetId
                    ? { ...ts, status: 'completed' as const }
                    : ts
                  )
                );
                setTilePositions((prev) => {
                  const existingIds = new Set(prev.map(tp => tp.id));
                  const newPositions = message.positions.filter(p => !existingIds.has(p.id));
                  return newPositions.length > 0 ? [...prev, ...newPositions] : prev;
                });
                onTileSetCompletedRef.current?.({ tileSetId: message.tileSetId, positions: message.positions });
                break;

              case 'tileset:failed':
                setTileSets((prev) =>
                  prev.map(ts => ts.id === message.tileSetId
                    ? { ...ts, status: 'failed' as const, error_message: message.error }
                    : ts
                  )
                );
                onTileSetFailedRef.current?.({
                  tileSetId: message.tileSetId,
                  error: message.error,
                  failedStep: message.failedStep,
                });
                break;

              case 'tileset:cancelled':
                setTileSets((prev) =>
                  prev.map(ts => ts.id === message.tileSetId
                    ? { ...ts, status: 'cancelled' as const }
                    : ts
                  )
                );
                onTileSetCancelledRef.current?.(message.tileSetId);
                break;

              default:
                console.warn('Unknown message type:', message);
            }
}
