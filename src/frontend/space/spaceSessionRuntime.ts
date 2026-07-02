import type { ServerMessage } from './protocol';
import { handleSpaceServerMessage } from './handleSpaceServerMessage';
import {
  getCachedSpaceStateSnapshot,
  persistSpaceStateSnapshot,
  shouldPersistSpaceStateSnapshot,
} from './spaceSnapshots';
import {
  MAX_RECONNECT_ATTEMPTS,
  SHARED_SPACE_SOCKET_RELEASE_DELAY_MS,
  clearSharedSocketCloseTimeout,
  clearSharedSocketReconnectTimeout,
  closeSharedSpaceSocket,
  sharedSpaceSocketSession,
  shouldReuseSharedSpaceSocket,
} from './spaceSocketSession';
import { useSpaceSessionStore } from './spaceStore';
import type { SpaceCallbackRefs } from './useSpaceCallbackRefs';

interface SpaceViewRegistration {
  spaceId: string;
  syncMode?: 'full' | 'overview';
  requestChatHistoryOnConnect?: boolean;
  callbacks: SpaceCallbackRefs;
}

const syncModeRef: { current: 'full' | 'overview' | null } = { current: null };
const variantIdsRef: { current: Set<string> } = { current: new Set() };

let openedSpaceId: string | null = null;
let openLeaseCount = 0;
let storeUnsubscribe: (() => void) | null = null;
let activeView: SpaceViewRegistration | null = null;
let needsViewRefresh = false;

function getSpaceWebSocketUrl(spaceId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/spaces/${spaceId}/ws`;
}

function sendSpaceSessionMessage(msg: object): void {
  if (
    sharedSpaceSocketSession.spaceId === openedSpaceId &&
    sharedSpaceSocketSession.ws?.readyState === WebSocket.OPEN
  ) {
    sharedSpaceSocketSession.ws.send(JSON.stringify(msg));
  } else {
    console.warn('WebSocket not connected, cannot send message:', msg);
  }
}

function isCurrentRuntimeSpace(spaceId: string): boolean {
  return openedSpaceId === spaceId && useSpaceSessionStore.getState().stateSpaceId === spaceId;
}

function requestViewSync(view: SpaceViewRegistration, force = false): void {
  if (view.syncMode === 'full' && (force || syncModeRef.current !== 'full')) {
    syncModeRef.current = 'full';
    sharedSpaceSocketSession.syncMode = 'full';
    sendSpaceSessionMessage({ type: 'sync:request' });
  } else if (view.syncMode === 'overview' && syncModeRef.current !== 'full') {
    if (!force && syncModeRef.current === 'overview') return;
    syncModeRef.current = 'overview';
    sharedSpaceSocketSession.syncMode = 'overview';
    sendSpaceSessionMessage({ type: 'sync:overview' });
  }
}

function applyConnectedViewOptions(view: SpaceViewRegistration, forceSync = false): void {
  requestViewSync(view, forceSync);
  needsViewRefresh = false;

  if (view.requestChatHistoryOnConnect) {
    sendSpaceSessionMessage({ type: 'chat:history' });
  }

  const sessionUpdate = view.callbacks.sessionUpdateOnConnectRef.current;
  if (sessionUpdate) {
    sendSpaceSessionMessage({ type: 'session:update', ...sessionUpdate });
  }

  view.callbacks.onConnectRef.current?.();
}

function getStoreActions() {
  const store = useSpaceSessionStore.getState();
  return {
    markSynced: store.markSynced,
    setStatus: store.setStatus,
    setError: store.setError,
    setAssets: store.setAssets,
    setVariants: store.setVariants,
    setLineage: store.setLineage,
    setCollections: store.setCollections,
    setCollectionItems: store.setCollectionItems,
    setJobs: store.setJobs,
    setPresence: store.setPresence,
  };
}

function attachSpaceSocketHandlers(spaceId: string, ws: WebSocket): void {
  ws.onopen = () => {
    if (!isCurrentRuntimeSpace(spaceId)) return;
    console.log('WebSocket connected to space:', spaceId);
    const { setStatus, setError } = getStoreActions();
    setStatus('connected');
    setError(null);
    sharedSpaceSocketSession.reconnectAttempts = 0;
    if (activeView?.spaceId === spaceId) {
      applyConnectedViewOptions(activeView);
    }
  };

  ws.onmessage = (event) => {
    if (!isCurrentRuntimeSpace(spaceId)) return;
    const view = activeView?.spaceId === spaceId ? activeView : null;
    if (!view) {
      needsViewRefresh = true;
    }
    try {
      const message = JSON.parse(event.data) as ServerMessage;
      handleSpaceServerMessage(message, {
        syncModeRef,
        variantIdsRef,
        callbacks: view?.callbacks,
        sendMessage: sendSpaceSessionMessage,
        ...getStoreActions(),
      });
    } catch (err) {
      console.error('Error parsing WebSocket message:', err);
    }
  };

  ws.onerror = (event) => {
    if (!isCurrentRuntimeSpace(spaceId)) return;
    console.error('WebSocket error:', event);
    const { setStatus, setError } = getStoreActions();
    setStatus('error');
    setError('WebSocket connection error');
  };

  ws.onclose = () => {
    if (!isCurrentRuntimeSpace(spaceId)) return;
    if (sharedSpaceSocketSession.intentionalClose) {
      sharedSpaceSocketSession.intentionalClose = false;
      return;
    }

    console.log('WebSocket disconnected from space:', spaceId);
    const { setStatus, setError } = getStoreActions();
    setStatus('disconnected');
    activeView?.callbacks.onDisconnectRef.current?.();

    if (sharedSpaceSocketSession.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const backoffMs = Math.min(1000 * Math.pow(2, sharedSpaceSocketSession.reconnectAttempts), 30000);
      console.log(
        `Reconnecting in ${backoffMs}ms (attempt ${sharedSpaceSocketSession.reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`
      );

      sharedSpaceSocketSession.reconnectTimeout = window.setTimeout(() => {
        if (!isCurrentRuntimeSpace(spaceId)) return;
        sharedSpaceSocketSession.reconnectAttempts++;
        connectSpaceSocket(spaceId);
      }, backoffMs);
    } else {
      setStatus('error');
      setError(`Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts. Please refresh the page.`);
    }
  };
}

function connectSpaceSocket(spaceId: string): void {
  clearSharedSocketReconnectTimeout();
  clearSharedSocketCloseTimeout();

  const existingWs = shouldReuseSharedSpaceSocket(
    sharedSpaceSocketSession.spaceId,
    spaceId,
    sharedSpaceSocketSession.ws?.readyState ?? null
  )
    ? sharedSpaceSocketSession.ws
    : null;

  if (existingWs) {
    attachSpaceSocketHandlers(spaceId, existingWs);
    syncModeRef.current = sharedSpaceSocketSession.syncMode;
    if (existingWs.readyState === WebSocket.OPEN) {
      const { setStatus, setError } = getStoreActions();
      setStatus('connected');
      setError(null);
      window.queueMicrotask(() => {
        if (openedSpaceId === spaceId && activeView?.spaceId === spaceId) {
          applyConnectedViewOptions(activeView);
        }
      });
    } else {
      getStoreActions().setStatus('connecting');
    }
    return;
  }

  if (sharedSpaceSocketSession.spaceId && sharedSpaceSocketSession.spaceId !== spaceId) {
    closeSharedSpaceSocket();
  }

  getStoreActions().setStatus('connecting');

  try {
    syncModeRef.current = null;
    const ws = new WebSocket(getSpaceWebSocketUrl(spaceId));
    sharedSpaceSocketSession.spaceId = spaceId;
    sharedSpaceSocketSession.ws = ws;
    sharedSpaceSocketSession.syncMode = null;
    sharedSpaceSocketSession.intentionalClose = false;
    attachSpaceSocketHandlers(spaceId, ws);
  } catch (err) {
    console.error('Error creating WebSocket:', err);
    const { setStatus, setError } = getStoreActions();
    setStatus('error');
    setError('Failed to create WebSocket connection');
  }
}

function startSnapshotPersistence(spaceId: string): void {
  storeUnsubscribe?.();
  storeUnsubscribe = useSpaceSessionStore.subscribe((state) => {
    if (!shouldPersistSpaceStateSnapshot(spaceId, state.stateSpaceId, state.hasSynced)) return;
    variantIdsRef.current = new Set(state.variants.map((variant) => variant.id));
    persistSpaceStateSnapshot({
      spaceId,
      assets: state.assets,
      variants: state.variants,
      lineage: state.lineage,
      collections: state.collections,
      collectionItems: state.collectionItems,
      presence: state.presence,
      syncMode: syncModeRef.current,
    });
  });
}

export function prepareSpaceSession(spaceId: string): void {
  if (!spaceId || useSpaceSessionStore.getState().stateSpaceId === spaceId) return;
  const cached = getCachedSpaceStateSnapshot(spaceId);
  syncModeRef.current = null;
  variantIdsRef.current = new Set(cached?.variants.map((variant) => variant.id) ?? []);
  useSpaceSessionStore.getState().hydrateFromSnapshot(spaceId, cached);
}

export function openSpaceSession(spaceId: string): () => void {
  if (!spaceId) return () => {};

  prepareSpaceSession(spaceId);
  openLeaseCount++;

  if (openedSpaceId !== spaceId) {
    if (openedSpaceId) {
      closeSharedSpaceSocket();
    }
    openedSpaceId = spaceId;
    startSnapshotPersistence(spaceId);
  }

  connectSpaceSocket(spaceId);

  return () => {
    openLeaseCount = Math.max(0, openLeaseCount - 1);
    if (openLeaseCount > 0) return;

    clearSharedSocketCloseTimeout();
    sharedSpaceSocketSession.closeTimeout = window.setTimeout(() => {
      if (openedSpaceId === spaceId && openLeaseCount === 0) {
        storeUnsubscribe?.();
        storeUnsubscribe = null;
        activeView = null;
        openedSpaceId = null;
        closeSharedSpaceSocket();
      }
    }, SHARED_SPACE_SOCKET_RELEASE_DELAY_MS);
  };
}

export function registerSpaceView(view: SpaceViewRegistration): () => void {
  activeView = view;
  if (
    view.spaceId &&
    sharedSpaceSocketSession.spaceId === view.spaceId &&
    sharedSpaceSocketSession.ws?.readyState === WebSocket.OPEN
  ) {
    applyConnectedViewOptions(view, needsViewRefresh);
  }

  return () => {
    if (activeView === view) {
      activeView = null;
    }
  };
}

export function getSpaceSessionSyncModeRef(): { current: 'full' | 'overview' | null } {
  return syncModeRef;
}

export function getOpenedSpaceSessionForTests(): {
  openedSpaceId: string | null;
  openLeaseCount: number;
  hasActiveView: boolean;
} {
  return {
    openedSpaceId,
    openLeaseCount,
    hasActiveView: activeView !== null,
  };
}
