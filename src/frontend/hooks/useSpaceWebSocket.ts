import { useEffect, useRef, useState, useCallback } from 'react';

// Asset and Variant types based on DO SQLite schema
export interface Asset {
  id: string;
  name: string;
  type: string;  // User-editable: character, item, scene, sprite-sheet, animation, style-sheet, reference, etc.
  tags: string;
  parent_asset_id: string | null;  // NULL = root asset, else nested under parent
  active_variant_id: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface Variant {
  id: string;
  asset_id: string;
  job_id: string | null;
  image_key: string;
  thumb_key?: string;  // Optional: falls back to image_key if not present
  recipe: string;
  starred: boolean;  // User marks important versions
  created_by: string;
  created_at: number;
}

/**
 * Get thumbnail URL for a variant, falling back to original image if no thumbnail exists
 */
export function getVariantThumbnailUrl(variant: Variant): string {
  const key = variant.thumb_key || variant.image_key;
  return `/api/images/${key}`;
}

export interface Lineage {
  id: string;
  parent_variant_id: string;
  child_variant_id: string;
  relation_type: 'derived' | 'composed' | 'spawned';
  severed: boolean;  // User can cut the historical link
  created_at: number;
}

export interface UserPresence {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  viewing?: string;  // Asset ID currently viewing, or null for catalog
  lastSeen: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  content: string;
  role: 'user' | 'assistant';
  createdAt: number;
}

// Bot response type from Claude
export interface BotResponse {
  type: 'advice' | 'action' | 'clarification' | 'rejection';
  message?: string;
  actions?: Array<{
    type: string;
    params: Record<string, unknown>;
    explanation?: string;
  }>;
}

// Forge context for chat requests
export interface ForgeContext {
  items: Array<{
    assetId: string;
    assetName: string;
    assetType: string;
    variantId?: string;
  }>;
  prompt?: string;
}

// Viewing context for chat requests
export interface ViewingContext {
  assetId?: string;
  variantId?: string;
}

// Chat request parameters
export interface ChatRequestParams {
  message: string;
  mode: 'advisor' | 'actor';
  forgeContext?: ForgeContext;
  viewingContext?: ViewingContext;
}

// Generate request parameters
export interface GenerateRequestParams {
  name: string;
  assetType: string;
  prompt?: string;
  referenceAssetIds?: string[];
  aspectRatio?: string;
  parentAssetId?: string;
}

// Refine request parameters
export interface RefineRequestParams {
  assetId: string;
  prompt: string;
  sourceVariantId?: string;
  referenceAssetIds?: string[];
  aspectRatio?: string;
}

/** Focus options for image description */
export type DescribeFocus = 'general' | 'style' | 'composition' | 'details' | 'compare';

// Describe image request parameters
export interface DescribeRequestParams {
  assetId: string;
  variantId: string;
  assetName: string;
  focus?: DescribeFocus;
  question?: string;
}

// Compare images request parameters
export interface CompareRequestParams {
  variantIds: string[];
  aspects?: string[];
}

// Chat response from workflow
export interface ChatResponseResult {
  requestId: string;
  success: boolean;
  response?: BotResponse;
  error?: string;
}

// Describe response from server
export interface DescribeResponseResult {
  requestId: string;
  success: boolean;
  description?: string;
  error?: string;
}

// Compare response from server
export interface CompareResponseResult {
  requestId: string;
  success: boolean;
  comparison?: string;
  error?: string;
}

// WebSocket connection parameters
export interface UseSpaceWebSocketParams {
  spaceId: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onJobComplete?: (job: JobStatus, variant: Variant) => void;
  onChatMessage?: (message: ChatMessage) => void;
  onChatResponse?: (response: ChatResponseResult) => void;
  onGenerateStarted?: (data: { requestId: string; jobId: string; assetId: string; assetName: string }) => void;
  onGenerateResult?: (data: { requestId: string; jobId: string; success: boolean; variant?: Variant; error?: string }) => void;
  onDescribeResponse?: (response: DescribeResponseResult) => void;
  onCompareResponse?: (response: CompareResponseResult) => void;
}

// Connection status
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

// Job status tracking with context
export interface JobStatus {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  variantId?: string;
  // Context for displaying meaningful job info
  assetId?: string;
  assetName?: string;
  // Job types:
  // - 'generate': Fresh AI generation (no references)
  // - 'derive': AI generation for new variant or new asset with single reference
  // - 'compose': AI generation combining multiple references
  // Note: 'fork' is synchronous copy, doesn't create a job
  jobType?: 'generate' | 'derive' | 'compose';
  prompt?: string;
}

// Job context for tracking (used when calling trackJob)
export interface JobContext {
  assetId?: string;
  assetName?: string;
  jobType?: 'generate' | 'derive' | 'compose';
  prompt?: string;
}

// Server message types based on ARCHITECTURE.md
type ServerMessage =
  | { type: 'sync:state'; assets: Asset[]; variants: Variant[]; lineage: Lineage[]; presence?: UserPresence[] }
  | { type: 'asset:created'; asset: Asset }
  | { type: 'asset:updated'; asset: Asset }
  | { type: 'asset:deleted'; assetId: string }
  | { type: 'asset:spawned'; asset: Asset; variant: Variant; lineage: Lineage }
  | { type: 'variant:created'; variant: Variant }
  | { type: 'variant:updated'; variant: Variant }
  | { type: 'variant:deleted'; variantId: string }
  | { type: 'lineage:created'; lineage: Lineage }
  | { type: 'lineage:severed'; lineageId: string }
  | { type: 'job:progress'; jobId: string; status: string }
  | { type: 'job:completed'; jobId: string; variant: Variant }
  | { type: 'job:failed'; jobId: string; error: string }
  | { type: 'chat:message'; message: ChatMessage }
  | { type: 'presence:update'; presence: UserPresence[] }
  | { type: 'error'; code: string; message: string }
  // Workflow response messages
  | { type: 'chat:response'; requestId: string; success: boolean; response?: BotResponse; error?: string }
  | { type: 'generate:started'; requestId: string; jobId: string; assetId: string; assetName: string }
  | { type: 'generate:result'; requestId: string; jobId: string; success: boolean; variant?: Variant; error?: string }
  | { type: 'refine:result'; requestId: string; jobId: string; success: boolean; variant?: Variant; error?: string }
  // Vision (describe/compare) response messages
  | { type: 'describe:response'; requestId: string; success: boolean; description?: string; error?: string }
  | { type: 'compare:response'; requestId: string; success: boolean; comparison?: string; error?: string };

// Predefined asset types (user can also create custom)
export const PREDEFINED_ASSET_TYPES = [
  'character',
  'item',
  'scene',
  'environment',
  'sprite-sheet',
  'animation',
  'style-sheet',
  'reference',
] as const;

export type PredefinedAssetType = typeof PREDEFINED_ASSET_TYPES[number];

interface AssetChanges {
  name?: string;
  type?: string;
  tags?: string[];
  parentAssetId?: string | null;
}

// Spawn params for creating new asset from variant
export interface SpawnParams {
  sourceVariantId: string;
  name: string;
  assetType: string;
  parentAssetId?: string;
}

// Return type
export interface UseSpaceWebSocketReturn {
  status: ConnectionStatus;
  error: string | null;
  assets: Asset[];
  variants: Variant[];
  lineage: Lineage[];
  jobs: Map<string, JobStatus>;
  presence: UserPresence[];
  sendMessage: (msg: object) => void;
  createAsset: (name: string, type: string, parentAssetId?: string) => void;
  updateAsset: (assetId: string, changes: AssetChanges) => void;
  deleteAsset: (assetId: string) => void;
  setActiveVariant: (assetId: string, variantId: string) => void;
  deleteVariant: (variantId: string) => void;
  spawnAsset: (params: SpawnParams) => void;
  starVariant: (variantId: string, starred: boolean) => void;
  severLineage: (lineageId: string) => void;
  requestSync: () => void;
  trackJob: (jobId: string, context?: JobContext) => void;
  clearJob: (jobId: string) => void;
  updatePresence: (viewing?: string) => void;
  sendChatMessage: (content: string) => void;
  // Workflow-triggering methods
  sendChatRequest: (params: ChatRequestParams) => string;  // Returns requestId
  sendGenerateRequest: (params: GenerateRequestParams) => string;  // Returns requestId
  sendRefineRequest: (params: RefineRequestParams) => string;  // Returns requestId
  sendDescribeRequest: (params: DescribeRequestParams) => string;  // Returns requestId
  sendCompareRequest: (params: CompareRequestParams) => string;  // Returns requestId
  // Helper methods for hierarchy navigation
  getChildren: (assetId: string) => Asset[];
  getAncestors: (assetId: string) => Asset[];
  getRootAssets: () => Asset[];
}

/**
 * WebSocket hook for real-time space updates
 * Manages connection state, asset/variant synchronization, and provides methods for mutations
 */
export function useSpaceWebSocket({
  spaceId,
  onConnect,
  onDisconnect,
  onJobComplete,
  onChatMessage,
  onChatResponse,
  onGenerateStarted,
  onGenerateResult,
  onDescribeResponse,
  onCompareResponse,
}: UseSpaceWebSocketParams): UseSpaceWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [lineage, setLineage] = useState<Lineage[]>([]);
  const [jobs, setJobs] = useState<Map<string, JobStatus>>(new Map());
  const [presence, setPresence] = useState<UserPresence[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const maxReconnectAttempts = 5;

  // Send a message through the WebSocket
  const sendMessage = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    } else {
      console.warn('WebSocket not connected, cannot send message:', msg);
    }
  }, []);

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

  // Spawn new asset from variant (copy operation with lineage)
  const spawnAsset = useCallback((params: SpawnParams) => {
    sendMessage({
      type: 'asset:spawn',
      sourceVariantId: params.sourceVariantId,
      name: params.name,
      assetType: params.assetType,
      parentAssetId: params.parentAssetId,
    });
  }, [sendMessage]);

  // Star/unstar a variant
  const starVariant = useCallback((variantId: string, starred: boolean) => {
    sendMessage({ type: 'variant:star', variantId, starred });
  }, [sendMessage]);

  // Sever lineage link (cut historical connection)
  const severLineage = useCallback((lineageId: string) => {
    sendMessage({ type: 'lineage:sever', lineageId });
  }, [sendMessage]);

  const requestSync = useCallback(() => {
    sendMessage({ type: 'sync:request' });
  }, [sendMessage]);

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
      prompt: params.prompt,
      referenceAssetIds: params.referenceAssetIds,
      aspectRatio: params.aspectRatio,
      parentAssetId: params.parentAssetId,
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
      prompt: params.prompt,
      sourceVariantId: params.sourceVariantId,
      referenceAssetIds: params.referenceAssetIds,
      aspectRatio: params.aspectRatio,
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
  }, []);

  const clearJob = useCallback((jobId: string) => {
    setJobs((prev) => {
      const next = new Map(prev);
      next.delete(jobId);
      return next;
    });
  }, []);

  // Store callbacks in refs to avoid dependency issues
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onJobCompleteRef = useRef(onJobComplete);
  const onChatMessageRef = useRef(onChatMessage);
  const onChatResponseRef = useRef(onChatResponse);
  const onGenerateStartedRef = useRef(onGenerateStarted);
  const onGenerateResultRef = useRef(onGenerateResult);
  const onDescribeResponseRef = useRef(onDescribeResponse);
  const onCompareResponseRef = useRef(onCompareResponse);

  // Update refs in useEffect to avoid accessing refs during render
  useEffect(() => {
    onConnectRef.current = onConnect;
    onDisconnectRef.current = onDisconnect;
    onJobCompleteRef.current = onJobComplete;
    onChatMessageRef.current = onChatMessage;
    onChatResponseRef.current = onChatResponse;
    onGenerateStartedRef.current = onGenerateStarted;
    onGenerateResultRef.current = onGenerateResult;
    onDescribeResponseRef.current = onDescribeResponse;
    onCompareResponseRef.current = onCompareResponse;
  });

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    if (!spaceId) return;

    let isMounted = true;

    const connect = () => {
      // Clear any pending reconnect timeout
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const url = `${protocol}//${host}/api/spaces/${spaceId}/ws`;

      setStatus('connecting');

      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isMounted) return;
          console.log('WebSocket connected to space:', spaceId);
          setStatus('connected');
          setError(null);
          reconnectAttempts.current = 0;
          onConnectRef.current?.();
        };

        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const message = JSON.parse(event.data) as ServerMessage;

            switch (message.type) {
              case 'sync:state':
                setAssets(message.assets);
                setVariants(message.variants);
                setLineage(message.lineage || []);
                setPresence(message.presence || []);
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
                break;

              case 'asset:deleted':
                setAssets((prev) => prev.filter((asset) => asset.id !== message.assetId));
                break;

              case 'asset:spawned':
                // Add the spawned asset, variant, and lineage
                setAssets((prev) => [...prev, message.asset]);
                setVariants((prev) => {
                  if (prev.some(v => v.id === message.variant.id)) return prev;
                  return [...prev, message.variant];
                });
                setLineage((prev) => [...prev, message.lineage]);
                break;

              case 'variant:created':
                setVariants((prev) => {
                  // Avoid duplicates (variant may already exist from job:completed)
                  if (prev.some(v => v.id === message.variant.id)) return prev;
                  return [...prev, message.variant];
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
                setVariants((prev) =>
                  prev.filter((variant) => variant.id !== message.variantId)
                );
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
                setVariants((prev) => {
                  // Avoid duplicates (variant may already exist from variant:created)
                  if (prev.some(v => v.id === message.variant.id)) return prev;
                  return [...prev, message.variant];
                });
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
                onChatMessageRef.current?.(message.message);
                break;

              case 'presence:update':
                setPresence(message.presence);
                break;

              case 'error':
                setError(message.message);
                console.error('WebSocket error from server:', message.code, message.message);
                break;

              // Workflow response messages
              case 'chat:response':
                onChatResponseRef.current?.({
                  requestId: message.requestId,
                  success: message.success,
                  response: message.response,
                  error: message.error,
                });
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
                  setVariants((prev) => {
                    if (prev.some(v => v.id === message.variant!.id)) return prev;
                    return [...prev, message.variant!];
                  });
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
                  setVariants((prev) => {
                    if (prev.some(v => v.id === message.variant!.id)) return prev;
                    return [...prev, message.variant!];
                  });
                }
                break;

              // Vision (describe/compare) response messages
              case 'describe:response':
                onDescribeResponseRef.current?.({
                  requestId: message.requestId,
                  success: message.success,
                  description: message.description,
                  error: message.error,
                });
                break;

              case 'compare:response':
                onCompareResponseRef.current?.({
                  requestId: message.requestId,
                  success: message.success,
                  comparison: message.comparison,
                  error: message.error,
                });
                break;

              default:
                console.warn('Unknown message type:', message);
            }
          } catch (err) {
            console.error('Error parsing WebSocket message:', err);
          }
        };

        ws.onerror = (event) => {
          if (!isMounted) return;
          console.error('WebSocket error:', event);
          setStatus('error');
          setError('WebSocket connection error');
        };

        ws.onclose = () => {
          if (!isMounted) return;
          console.log('WebSocket disconnected from space:', spaceId);
          setStatus('disconnected');
          onDisconnectRef.current?.();

          // Attempt to reconnect with exponential backoff
          if (reconnectAttempts.current < maxReconnectAttempts) {
            const backoffMs = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
            console.log(
              `Reconnecting in ${backoffMs}ms (attempt ${reconnectAttempts.current + 1}/${maxReconnectAttempts})`
            );

            reconnectTimeoutRef.current = window.setTimeout(() => {
              if (!isMounted) return;
              reconnectAttempts.current++;
              connect();
            }, backoffMs);
          } else {
            setStatus('error');
            setError(
              `Failed to reconnect after ${maxReconnectAttempts} attempts. Please refresh the page.`
            );
          }
        };
      } catch (err) {
        console.error('Error creating WebSocket:', err);
        setStatus('error');
        setError('Failed to create WebSocket connection');
      }
    };

    connect();

    return () => {
      isMounted = false;

      // Clear reconnect timeout
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      // Close WebSocket connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [spaceId]);

  return {
    status,
    error,
    assets,
    variants,
    lineage,
    jobs,
    presence,
    sendMessage,
    createAsset,
    updateAsset,
    deleteAsset,
    setActiveVariant,
    deleteVariant,
    spawnAsset,
    starVariant,
    severLineage,
    requestSync,
    trackJob,
    clearJob,
    updatePresence,
    sendChatMessage,
    sendChatRequest,
    sendGenerateRequest,
    sendRefineRequest,
    sendDescribeRequest,
    sendCompareRequest,
    getChildren,
    getAncestors,
    getRootAssets,
  };
}

export default useSpaceWebSocket;
