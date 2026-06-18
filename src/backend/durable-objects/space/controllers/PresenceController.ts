/**
 * Presence Controller
 *
 * Handles user presence tracking for real-time collaboration.
 * Owns in-memory client session presence and manages staleness cleanup.
 */

import type { ClientSessionPresence, UserPresence, WebSocketMeta } from '../types';
import { BaseController, type ControllerContext } from './types';

/** Stale presence threshold (5 minutes) */
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

export class PresenceController extends BaseController {
  /** Client session presence state - clientSessionId -> presence data */
  private readonly sessions: Map<string, ClientSessionPresence> = new Map();

  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  /**
   * Handle presence:update message from client
   * Updates the user's viewing state and broadcasts to all clients
   */
  handleUpdate(meta: WebSocketMeta, viewing: string | undefined): void {
    const clientSessionId = this.getClientSessionId(meta);

    this.sessions.set(clientSessionId, {
      clientSessionId,
      userId: meta.userId,
      viewing: viewing ?? null,
      lastSeen: Date.now(),
    });

    this.broadcastPresence();
  }

  /**
   * Handle client session disconnect
   * Removes only the closing WebSocket session and broadcasts aggregate user presence
   */
  handleDisconnect(meta: WebSocketMeta): void {
    if (this.sessions.delete(this.getClientSessionId(meta))) {
      this.broadcastPresence();
    }
  }

  /**
   * Get current presence data, filtering out stale entries
   * Used by SyncController for initial state sync
   */
  getPresenceData(): UserPresence[] {
    const now = Date.now();

    for (const [clientSessionId, presence] of this.sessions.entries()) {
      if (now - presence.lastSeen >= STALE_THRESHOLD_MS) {
        this.sessions.delete(clientSessionId);
      }
    }

    return this.aggregateUserPresence(Array.from(this.sessions.values()));
  }

  private getClientSessionId(meta: WebSocketMeta): string {
    return meta.clientSessionId ?? meta.userId;
  }

  private broadcastPresence(): void {
    this.broadcast({
      type: 'presence:update',
      presence: this.getPresenceData(),
    });
  }

  private aggregateUserPresence(sessions: ClientSessionPresence[]): UserPresence[] {
    const byUser = new Map<string, UserPresence>();

    for (const session of sessions) {
      const existing = byUser.get(session.userId);
      if (!existing || session.lastSeen >= existing.lastSeen) {
        byUser.set(session.userId, {
          userId: session.userId,
          viewing: session.viewing,
          lastSeen: session.lastSeen,
        });
      }
    }

    return Array.from(byUser.values());
  }
}
