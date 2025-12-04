/**
 * Presence Controller
 *
 * Handles user presence tracking for real-time collaboration.
 * Owns the in-memory presence Map and manages staleness cleanup.
 */

import type { UserPresence, WebSocketMeta } from '../types';
import { BaseController, type ControllerContext } from './types';

/** Stale presence threshold (5 minutes) */
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

export class PresenceController extends BaseController {
  /** User presence state - userId -> presence data */
  private readonly presence: Map<string, UserPresence> = new Map();

  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  /**
   * Handle presence:update message from client
   * Updates the user's viewing state and broadcasts to all clients
   */
  handleUpdate(meta: WebSocketMeta, viewing: string | undefined): void {
    this.presence.set(meta.userId, {
      userId: meta.userId,
      viewing: viewing ?? null,
      lastSeen: Date.now(),
    });

    this.broadcast({
      type: 'presence:update',
      presence: Array.from(this.presence.values()),
    });
  }

  /**
   * Handle user disconnect
   * Removes presence and broadcasts update to remaining clients
   */
  handleDisconnect(meta: WebSocketMeta): void {
    if (this.presence.has(meta.userId)) {
      this.presence.delete(meta.userId);
      this.broadcast({
        type: 'presence:update',
        presence: Array.from(this.presence.values()),
      });
    }
  }

  /**
   * Get current presence data, filtering out stale entries
   * Used by SyncController for initial state sync
   */
  getPresenceData(): UserPresence[] {
    const now = Date.now();
    const activePresence: UserPresence[] = [];

    for (const [userId, presence] of this.presence.entries()) {
      if (now - presence.lastSeen < STALE_THRESHOLD_MS) {
        activePresence.push(presence);
      } else {
        // Clean up stale presence
        this.presence.delete(userId);
      }
    }

    return activePresence;
  }
}
