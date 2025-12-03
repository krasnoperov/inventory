/**
 * Variant Controller
 *
 * Handles variant operations including deletion, starring, and applying new variants.
 * Manages image reference counting to ensure proper R2 cleanup.
 */

import type { Asset, Variant, WebSocketMeta } from '../types';
import {
  INCREMENT_REF_SQL,
  DECREMENT_REF_SQL,
  DELETE_REF_SQL,
  getVariantImageKeys,
} from '../variant/imageRefs';
import { BaseController, type ControllerContext, NotFoundError } from './types';

export class VariantController extends BaseController {
  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  // ==========================================================================
  // WebSocket Handlers
  // ==========================================================================

  /**
   * Handle variant:delete WebSocket message
   */
  async handleDelete(ws: WebSocket, meta: WebSocketMeta, variantId: string): Promise<void> {
    this.requireOwner(meta);

    await this.deleteVariant(variantId);
    this.broadcast({ type: 'variant:deleted', variantId });
  }

  /**
   * Handle variant:star WebSocket message
   */
  async handleStar(
    ws: WebSocket,
    meta: WebSocketMeta,
    variantId: string,
    starred: boolean
  ): Promise<void> {
    this.requireEditor(meta);

    const variant = await this.repo.updateVariantStarred(variantId, starred);
    if (!variant) {
      throw new NotFoundError('Variant not found');
    }

    this.broadcast({ type: 'variant:updated', variant });
  }

  // ==========================================================================
  // HTTP Handlers
  // ==========================================================================

  /**
   * Handle POST /internal/apply-variant HTTP request
   * Idempotently applies a variant from a workflow job.
   */
  async httpApplyVariant(data: {
    jobId: string;
    variantId: string;
    assetId: string;
    imageKey: string;
    thumbKey: string;
    recipe: string;
    createdBy: string;
    parentVariantIds?: string[];
    relationType?: 'created' | 'refined' | 'combined';
  }): Promise<{ created: boolean; variant: Variant }> {
    return this.applyVariant(data);
  }

  /**
   * Handle PATCH /internal/variant/:variantId/star HTTP request
   */
  async httpStar(variantId: string, starred: boolean): Promise<Variant> {
    const variant = await this.repo.updateVariantStarred(variantId, starred);
    if (!variant) {
      throw new NotFoundError('Variant not found');
    }

    this.broadcast({ type: 'variant:updated', variant });
    return variant;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Apply a variant from a workflow job (idempotent).
   * Handles ref counting, lineage creation, and auto-active-variant.
   *
   * Note: This creates completed variants directly. In future, placeholders
   * will be created upfront and this will be replaced by httpCompleteVariant.
   */
  private async applyVariant(data: {
    jobId: string;
    variantId: string;
    assetId: string;
    imageKey: string;
    thumbKey: string;
    recipe: string;
    createdBy: string;
    parentVariantIds?: string[];
    relationType?: 'created' | 'refined' | 'combined';
  }): Promise<{ created: boolean; variant: Variant }> {
    // Check if variant already exists (idempotency via workflowId/jobId)
    const existing = await this.repo.getVariantByWorkflowId(data.jobId);
    if (existing) {
      return { created: false, variant: existing };
    }

    const now = Date.now();

    const variant: Variant = {
      id: data.variantId,
      asset_id: data.assetId,
      workflow_id: data.jobId,
      status: 'completed', // Variants created via workflow are immediately complete
      error_message: null,
      image_key: data.imageKey,
      thumb_key: data.thumbKey,
      recipe: data.recipe,
      starred: false,
      created_by: data.createdBy,
      created_at: now,
      updated_at: now,
    };

    // Insert variant
    await this.sql.exec(
      `INSERT INTO variants (id, asset_id, workflow_id, status, error_message, image_key, thumb_key, recipe, starred, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      variant.id,
      variant.asset_id,
      variant.workflow_id,
      variant.status,
      variant.error_message,
      variant.image_key,
      variant.thumb_key,
      variant.recipe,
      0, // starred = false
      variant.created_by,
      variant.created_at,
      variant.updated_at
    );

    // Increment refs for all images
    const imageKeys = getVariantImageKeys(variant);
    for (const key of imageKeys) {
      await this.sql.exec(INCREMENT_REF_SQL, key);
    }

    // Create lineage records if parent variants specified
    if (data.parentVariantIds && data.parentVariantIds.length > 0) {
      const relationType = data.relationType || 'refined';
      for (const parentId of data.parentVariantIds) {
        const lineage = await this.repo.createLineage({
          id: crypto.randomUUID(),
          parentVariantId: parentId,
          childVariantId: variant.id,
          relationType,
        });
        this.broadcast({ type: 'lineage:created', lineage });
      }
    }

    // If this is the first variant for the asset, set it as active
    const assetResult = await this.sql.exec(
      'SELECT active_variant_id FROM assets WHERE id = ?',
      variant.asset_id
    );
    const assetRow = assetResult.toArray()[0] as { active_variant_id: string | null } | undefined;

    if (assetRow && !assetRow.active_variant_id) {
      const updatedAsset = await this.repo.updateAsset(variant.asset_id, {
        active_variant_id: variant.id,
      });
      if (updatedAsset) {
        this.broadcast({ type: 'asset:updated', asset: updatedAsset });
      }
    } else {
      // Broadcast asset update so clients see the new variant count
      const currentAsset = await this.repo.getAssetById(variant.asset_id);
      if (currentAsset) {
        this.broadcast({ type: 'asset:updated', asset: currentAsset });
      }
    }

    // Broadcast variant creation
    this.broadcast({ type: 'variant:created', variant });

    return { created: true, variant };
  }

  /**
   * Delete a variant and decrement image refs.
   * Images with 0 refs are deleted from R2.
   */
  private async deleteVariant(variantId: string): Promise<void> {
    const variant = await this.repo.getVariantById(variantId);
    if (!variant) return;

    // Decrement refs for all images
    const imageKeys = getVariantImageKeys(variant);
    for (const key of imageKeys) {
      await this.decrementRef(key);
    }

    // Delete variant
    await this.sql.exec('DELETE FROM variants WHERE id = ?', variantId);
  }

  /**
   * Decrement image ref and delete from R2 if ref count reaches 0
   */
  private async decrementRef(imageKey: string): Promise<void> {
    const result = await this.sql.exec(DECREMENT_REF_SQL, imageKey);
    const row = result.toArray()[0] as { ref_count: number } | undefined;

    if (row && row.ref_count <= 0) {
      // Delete from R2
      try {
        await this.env.IMAGES.delete(imageKey);
      } catch (error) {
        console.error('Failed to delete image from R2:', error);
      }

      // Delete ref record
      await this.sql.exec(DELETE_REF_SQL, imageKey);
    }
  }
}
