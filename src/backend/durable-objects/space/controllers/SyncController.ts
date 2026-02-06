/**
 * Sync Controller
 *
 * Handles full state synchronization for clients.
 * Provides initial state on connection and state queries via HTTP.
 */

import type { SpaceState } from '../repository/SpaceRepository';
import { BaseController, type ControllerContext } from './types';
import type { PresenceController } from './PresenceController';

export class SyncController extends BaseController {
  private readonly presenceCtrl: PresenceController;

  constructor(ctx: ControllerContext, presenceCtrl: PresenceController) {
    super(ctx);
    this.presenceCtrl = presenceCtrl;
  }

  /**
   * Handle sync:request WebSocket message
   * Sends full state (assets, variants, lineage) plus presence to the client
   */
  async handleSyncRequest(ws: WebSocket): Promise<void> {
    const state = await this.repo.getFullState();
    const presence = this.presenceCtrl.getPresenceData();

    this.send(ws, {
      type: 'sync:state',
      assets: state.assets,
      variants: state.variants,
      lineage: state.lineage,
      presence,
      rotationSets: state.rotationSets,
      rotationViews: state.rotationViews,
      tileSets: state.tileSets,
      tilePositions: state.tilePositions,
    });
  }

  /**
   * Handle GET /internal/state HTTP request
   * Returns full state for bot context or external queries
   */
  async httpGetState(): Promise<SpaceState> {
    return this.repo.getFullState();
  }
}
