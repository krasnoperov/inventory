export interface SharedSpaceSocketSession {
  spaceId: string | null;
  ws: WebSocket | null;
  syncMode: 'full' | 'overview' | null;
  closeTimeout: number | null;
  reconnectTimeout: number | null;
  reconnectAttempts: number;
  intentionalClose: boolean;
}

export const sharedSpaceSocketSession: SharedSpaceSocketSession = {
  spaceId: null,
  ws: null,
  syncMode: null,
  closeTimeout: null,
  reconnectTimeout: null,
  reconnectAttempts: 0,
  intentionalClose: false,
};

export const SHARED_SPACE_SOCKET_RELEASE_DELAY_MS = 1500;
export const MAX_RECONNECT_ATTEMPTS = 5;
export const WEB_SOCKET_CLOSING = 2;
export const WEB_SOCKET_CLOSED = 3;

export function clearSharedSocketCloseTimeout(): void {
  if (sharedSpaceSocketSession.closeTimeout !== null) {
    clearTimeout(sharedSpaceSocketSession.closeTimeout);
    sharedSpaceSocketSession.closeTimeout = null;
  }
}

export function clearSharedSocketReconnectTimeout(): void {
  if (sharedSpaceSocketSession.reconnectTimeout !== null) {
    clearTimeout(sharedSpaceSocketSession.reconnectTimeout);
    sharedSpaceSocketSession.reconnectTimeout = null;
  }
}

export function closeSharedSpaceSocket(): void {
  clearSharedSocketCloseTimeout();
  clearSharedSocketReconnectTimeout();
  const ws = sharedSpaceSocketSession.ws;
  sharedSpaceSocketSession.intentionalClose = true;
  sharedSpaceSocketSession.ws = null;
  sharedSpaceSocketSession.spaceId = null;
  sharedSpaceSocketSession.syncMode = null;
  sharedSpaceSocketSession.reconnectAttempts = 0;
  if (ws && ws.readyState !== WEB_SOCKET_CLOSED && ws.readyState !== WEB_SOCKET_CLOSING) {
    ws.close();
  }
}

export function shouldReuseSharedSpaceSocket(
  currentSpaceId: string | null,
  requestedSpaceId: string,
  readyState: number | null
): boolean {
  return (
    currentSpaceId === requestedSpaceId &&
    readyState !== null &&
    readyState !== WEB_SOCKET_CLOSED &&
    readyState !== WEB_SOCKET_CLOSING
  );
}

export function shouldApplyOverviewSync(currentSyncMode: 'full' | 'overview' | null): boolean {
  return currentSyncMode !== 'full';
}

export function getInitialSyncModeForSpace(
  requestedSpaceId: string,
  sessionSpaceId: string | null,
  sessionSyncMode: 'full' | 'overview' | null,
  readyState: number | null
): 'full' | 'overview' | null {
  return shouldReuseSharedSpaceSocket(sessionSpaceId, requestedSpaceId, readyState)
    ? sessionSyncMode
    : null;
}

export function getSharedSpaceSocketSessionForTests(): Pick<
  SharedSpaceSocketSession,
  'spaceId' | 'syncMode' | 'reconnectAttempts'
> {
  return {
    spaceId: sharedSpaceSocketSession.spaceId,
    syncMode: sharedSpaceSocketSession.syncMode,
    reconnectAttempts: sharedSpaceSocketSession.reconnectAttempts,
  };
}

export function resetSharedSpaceSocketSessionForTests(): void {
  closeSharedSpaceSocket();
}

export function shouldReuseSharedSpaceSocketForTests(
  currentSpaceId: string | null,
  requestedSpaceId: string,
  readyState: number | null
): boolean {
  return shouldReuseSharedSpaceSocket(currentSpaceId, requestedSpaceId, readyState);
}

export function shouldApplyOverviewSyncForTests(currentSyncMode: 'full' | 'overview' | null): boolean {
  return shouldApplyOverviewSync(currentSyncMode);
}

export function getInitialSyncModeForSpaceForTests(
  requestedSpaceId: string,
  sessionSpaceId: string | null,
  sessionSyncMode: 'full' | 'overview' | null,
  readyState: number | null
): 'full' | 'overview' | null {
  return getInitialSyncModeForSpace(requestedSpaceId, sessionSpaceId, sessionSyncMode, readyState);
}
