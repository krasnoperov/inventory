/**
 * Style Controller
 *
 * Handles style anchoring CRUD operations for a space.
 * Each space can have one active style with description + reference images.
 */

import type { WebSocketMeta } from '../types';
import { BaseController, ValidationError } from './types';

export class StyleController extends BaseController {

  /**
   * Handle style:get — fetch current style, send to caller
   */
  async handleGetStyle(ws: WebSocket): Promise<void> {
    const style = await this.repo.getActiveStyle();
    this.send(ws, { type: 'style:state', style });
  }

  /**
   * Handle style:set — create or update the space style
   */
  async handleSetStyle(
    ws: WebSocket,
    meta: WebSocketMeta,
    data: { name?: string; description: string; imageKeys: string[]; enabled?: boolean }
  ): Promise<void> {
    this.requireEditor(meta);

    // Validate image key count
    if (data.imageKeys.length > 5) {
      throw new ValidationError('Style can have at most 5 reference images');
    }

    const existing = await this.repo.getActiveStyle();

    let style;
    if (existing) {
      // Update existing style
      style = await this.repo.updateStyle(existing.id, {
        name: data.name,
        description: data.description,
        imageKeys: data.imageKeys,
        enabled: data.enabled,
      });
    } else {
      // Create new style
      style = await this.repo.createStyle({
        id: crypto.randomUUID(),
        name: data.name,
        description: data.description,
        imageKeys: data.imageKeys,
        enabled: data.enabled,
        createdBy: meta.userId,
      });
    }

    if (style) {
      this.broadcast({ type: 'style:updated', style });
    }
  }

  /**
   * Handle style:delete — remove the space style
   */
  async handleDeleteStyle(ws: WebSocket, meta: WebSocketMeta): Promise<void> {
    this.requireEditor(meta);

    const existing = await this.repo.getActiveStyle();
    if (existing) {
      await this.repo.deleteStyle(existing.id);
    }

    this.broadcast({ type: 'style:deleted' });
  }

  /**
   * Handle style:toggle — enable/disable the style
   */
  async handleToggleStyle(ws: WebSocket, meta: WebSocketMeta, enabled: boolean): Promise<void> {
    this.requireEditor(meta);

    const existing = await this.repo.getActiveStyle();
    if (!existing) {
      throw new ValidationError('No style configured');
    }

    const style = await this.repo.toggleStyle(existing.id, enabled);
    if (style) {
      this.broadcast({ type: 'style:updated', style });
    }
  }
}
