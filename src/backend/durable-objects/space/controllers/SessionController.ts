/**
 * Session Controller
 *
 * Handles user session context for stateless CLI and cross-client sync.
 * Stores per-user viewing context and forge tray state.
 */

import type { UserSession, WebSocketMeta } from '../types';
import { BaseController, type ControllerContext } from './types';

export class SessionController extends BaseController {
  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  // ==========================================================================
  // WebSocket Handlers
  // ==========================================================================

  /**
   * Handle session:get - Get current user's session context
   */
  async handleGet(ws: WebSocket, meta: WebSocketMeta): Promise<void> {
    const session = await this.repo.getUserSession(meta.userId);

    // If no session exists, create a default one
    const sessionData = session ?? await this.repo.upsertUserSession({
      userId: meta.userId,
    });

    this.send(ws, { type: 'session:state', session: sessionData });
  }

  /**
   * Handle session:update - Update user's session context
   */
  async handleUpdate(
    ws: WebSocket,
    meta: WebSocketMeta,
    updates: {
      viewingAssetId?: string | null;
      viewingVariantId?: string | null;
      forgeContext?: string | null;
    }
  ): Promise<UserSession> {
    // Get existing session or create new
    const existing = await this.repo.getUserSession(meta.userId);

    const session = await this.repo.upsertUserSession({
      userId: meta.userId,
      viewingAssetId: updates.viewingAssetId ?? existing?.viewing_asset_id,
      viewingVariantId: updates.viewingVariantId ?? existing?.viewing_variant_id,
      forgeContext: updates.forgeContext ?? existing?.forge_context,
    });

    // Send updated session back to client
    this.send(ws, { type: 'session:state', session });

    return session;
  }

  // ==========================================================================
  // HTTP Handlers (Internal API)
  // ==========================================================================

  /**
   * Get user session by user ID
   */
  async httpGetSession(userId: string): Promise<UserSession | null> {
    return this.repo.getUserSession(userId);
  }

  /**
   * Update or create user session
   */
  async httpUpsertSession(data: {
    userId: string;
    viewingAssetId?: string | null;
    viewingVariantId?: string | null;
    forgeContext?: string | null;
  }): Promise<UserSession> {
    return this.repo.upsertUserSession(data);
  }

  /**
   * Update user's last seen timestamp (called on WebSocket activity)
   */
  async updateLastSeen(userId: string): Promise<void> {
    await this.repo.updateUserLastSeen(userId);
  }
}
