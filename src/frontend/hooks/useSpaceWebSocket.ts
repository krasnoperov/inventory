import { useEffect, useRef, useState, useCallback } from 'react';

// Asset and Variant types based on DO SQLite schema
export interface Asset {
  id: string;
  name: string;
  type: 'character' | 'item' | 'scene' | 'composite';
  tags: string;
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
  created_by: string;
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

// Server message types based on ARCHITECTURE.md
type ServerMessage =
  | { type: 'sync:state'; assets: Asset[]; variants: Variant[] }
  | { type: 'asset:created'; asset: Asset }
  | { type: 'asset:updated'; asset: Asset }
  | { type: 'asset:deleted'; assetId: string }
  | { type: 'variant:created'; variant: Variant }
  | { type: 'variant:deleted'; variantId: string }
  | { type: 'error'; code: string; message: string };

// Client message types based on ARCHITECTURE.md
type AssetType = 'character' | 'item' | 'scene' | 'composite';

interface AssetChanges {
  name?: string;
  tags?: string[];
}

// Return type
export interface UseSpaceWebSocketReturn {
  status: ConnectionStatus;
  error: string | null;
  assets: Asset[];
  variants: Variant[];
  sendMessage: (msg: object) => void;
  createAsset: (name: string, type: AssetType) => void;
  updateAsset: (assetId: string, changes: AssetChanges) => void;
  deleteAsset: (assetId: string) => void;
  setActiveVariant: (assetId: string, variantId: string) => void;
  deleteVariant: (variantId: string) => void;
  requestSync: () => void;
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
  const createAsset = useCallback((name: string, type: AssetType) => {
    sendMessage({ type: 'asset:create', name, assetType: type });
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

  const requestSync = useCallback(() => {
    sendMessage({ type: 'sync:request' });
  }, [sendMessage]);

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

              case 'variant:created':
                setVariants((prev) => [...prev, message.variant]);
                break;

              case 'variant:deleted':
                setVariants((prev) =>
                  prev.filter((variant) => variant.id !== message.variantId)
                );
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
    sendMessage,
    createAsset,
    updateAsset,
    deleteAsset,
    setActiveVariant,
    deleteVariant,
    requestSync,
  };
}

export default useSpaceWebSocket;
