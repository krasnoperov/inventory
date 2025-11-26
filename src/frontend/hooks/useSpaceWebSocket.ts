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
  thumb_key: string;
  recipe: string;
  starred: boolean;  // User marks important versions
  created_by: string;
  created_at: number;
}

export interface Lineage {
  id: string;
  parent_variant_id: string;
  child_variant_id: string;
  relation_type: 'derived' | 'composed' | 'spawned';
  severed: boolean;  // User can cut the historical link
  created_at: number;
}

// WebSocket connection parameters
export interface UseSpaceWebSocketParams {
  spaceId: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
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
  jobType?: 'generate' | 'edit' | 'compose' | 'reference';
  prompt?: string;
}

// Job context for tracking (used when calling trackJob)
export interface JobContext {
  assetId?: string;
  assetName?: string;
  jobType?: 'generate' | 'edit' | 'compose' | 'reference';
  prompt?: string;
}

// Server message types based on ARCHITECTURE.md
type ServerMessage =
  | { type: 'sync:state'; assets: Asset[]; variants: Variant[]; lineage: Lineage[] }
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
  | { type: 'error'; code: string; message: string };

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
}: UseSpaceWebSocketParams): UseSpaceWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [lineage, setLineage] = useState<Lineage[]>([]);
  const [jobs, setJobs] = useState<Map<string, JobStatus>>(new Map());

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
  onConnectRef.current = onConnect;
  onDisconnectRef.current = onDisconnect;

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
                  next.set(message.jobId, {
                    jobId: message.jobId,
                    status: 'completed',
                    variantId: message.variant.id,
                  });
                  return next;
                });
                break;

              case 'job:failed':
                setJobs((prev) => {
                  const next = new Map(prev);
                  next.set(message.jobId, {
                    jobId: message.jobId,
                    status: 'failed',
                    error: message.error,
                  });
                  return next;
                });
                break;

              case 'error':
                setError(message.message);
                console.error('WebSocket error from server:', message.code, message.message);
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
    getChildren,
    getAncestors,
    getRootAssets,
  };
}

export default useSpaceWebSocket;
