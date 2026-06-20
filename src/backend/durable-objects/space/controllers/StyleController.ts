/**
 * Style Controller
 *
 * Handles style anchoring CRUD operations for a space.
 * Each space can have one active style with description + reference images.
 */

import type { Asset, CollectionItem, SpaceCollection, Variant, WebSocketMeta } from '../types';
import { BaseController, ValidationError } from './types';

interface LegacyStyleBackfillSyncSnapshot {
  assets: Asset[];
  variants: Variant[];
  collections: SpaceCollection[];
  collectionItems: CollectionItem[];
}

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
      await this.backfillLegacySpaceStyleAndBroadcastChanges();
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
      await this.backfillLegacySpaceStyleAndBroadcastChanges();
      this.broadcast({ type: 'style:updated', style });
    }
  }

  private async backfillLegacySpaceStyleAndBroadcastChanges(): Promise<void> {
    const before = await this.getLegacyStyleBackfillSyncSnapshot();
    await this.repo.backfillLegacySpaceStyle();
    const after = await this.getLegacyStyleBackfillSyncSnapshot();
    this.broadcastLegacyStyleBackfillChanges(before, after);
  }

  private async getLegacyStyleBackfillSyncSnapshot(): Promise<LegacyStyleBackfillSyncSnapshot> {
    const [assets, variants, collections, collectionItems] = await Promise.all([
      this.repo.getAllAssets(),
      this.repo.getAllVariants(),
      this.repo.listCollections(),
      this.repo.listAllCollectionItems(),
    ]);
    return { assets, variants, collections, collectionItems };
  }

  private broadcastLegacyStyleBackfillChanges(
    before: LegacyStyleBackfillSyncSnapshot,
    after: LegacyStyleBackfillSyncSnapshot
  ): void {
    this.broadcastCreatedAndUpdatedAssets(before.assets, after.assets);
    this.broadcastCreatedAndUpdatedVariants(before.variants, after.variants);
    this.broadcastCreatedAndUpdatedCollections(before.collections, after.collections);
    this.broadcastCollectionItemChanges(before.collectionItems, after.collectionItems);
  }

  private broadcastCreatedAndUpdatedAssets(before: Asset[], after: Asset[]): void {
    const beforeById = new Map(before.map((asset) => [asset.id, asset]));
    for (const asset of after) {
      const previous = beforeById.get(asset.id);
      if (!previous) {
        this.broadcast({ type: 'asset:created', asset });
      } else if (JSON.stringify(previous) !== JSON.stringify(asset)) {
        this.broadcast({ type: 'asset:updated', asset });
      }
    }
  }

  private broadcastCreatedAndUpdatedVariants(before: Variant[], after: Variant[]): void {
    const beforeById = new Map(before.map((variant) => [variant.id, variant]));
    for (const variant of after) {
      const previous = beforeById.get(variant.id);
      if (!previous) {
        this.broadcast({ type: 'variant:created', variant });
      } else if (JSON.stringify(previous) !== JSON.stringify(variant)) {
        this.broadcast({ type: 'variant:updated', variant });
      }
    }
  }

  private broadcastCreatedAndUpdatedCollections(before: SpaceCollection[], after: SpaceCollection[]): void {
    const beforeById = new Map(before.map((collection) => [collection.id, collection]));
    for (const collection of after) {
      const previous = beforeById.get(collection.id);
      if (!previous) {
        this.broadcast({ type: 'collection:created', collection });
      } else if (JSON.stringify(previous) !== JSON.stringify(collection)) {
        this.broadcast({ type: 'collection:updated', collection });
      }
    }
  }

  private broadcastCollectionItemChanges(before: CollectionItem[], after: CollectionItem[]): void {
    const afterById = new Map(after.map((item) => [item.id, item]));
    const beforeById = new Map(before.map((item) => [item.id, item]));

    for (const item of before) {
      if (!afterById.has(item.id)) {
        this.broadcast({ type: 'collection_item:deleted', collectionId: item.collection_id, itemId: item.id });
      }
    }

    for (const item of after) {
      const previous = beforeById.get(item.id);
      if (!previous) {
        this.broadcast({ type: 'collection_item:created', item });
      } else if (JSON.stringify(previous) !== JSON.stringify(item)) {
        this.broadcast({ type: 'collection_item:updated', item });
      }
    }
  }
}
