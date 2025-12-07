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
import { loggers } from '../../../../shared/logger';

const log = loggers.variantController;

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
    relationType?: 'derived' | 'refined';
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

  /**
   * Handle GET /internal/variant/:variantId HTTP request
   * Returns variant with associated asset info for vision operations.
   */
  async httpGetById(variantId: string): Promise<Variant & { asset_name?: string }> {
    const variant = await this.repo.getVariantById(variantId);
    if (!variant) {
      throw new NotFoundError('Variant not found');
    }

    // Get associated asset name for vision context
    const asset = await this.repo.getAssetById(variant.asset_id);
    return {
      ...variant,
      asset_name: asset?.name,
    };
  }

  /**
   * Handle POST /internal/upload-placeholder HTTP request
   * Creates a placeholder variant with status='uploading' before R2 upload starts.
   * This allows all connected clients to see the upload in progress.
   */
  async httpCreateUploadPlaceholder(data: {
    variantId: string;
    assetId?: string;
    // For new asset creation
    assetName?: string;
    assetType?: string;
    parentAssetId?: string | null;
    recipe: string;
    createdBy: string;
  }): Promise<{ variant: Variant; asset?: Asset; assetId: string }> {
    const now = Date.now();
    let asset: Asset;
    let createdNewAsset = false;

    if (data.assetId) {
      // Adding variant to existing asset
      const existingAsset = await this.repo.getAssetById(data.assetId);
      if (!existingAsset) {
        throw new NotFoundError('Asset not found');
      }
      asset = existingAsset;
    } else if (data.assetName) {
      // Create new asset for the upload
      const newAssetId = crypto.randomUUID();
      asset = await this.repo.createAsset({
        id: newAssetId,
        name: data.assetName,
        type: data.assetType || 'character',
        tags: [],
        parentAssetId: data.parentAssetId || null,
        createdBy: data.createdBy,
      });
      createdNewAsset = true;
      this.broadcast({ type: 'asset:created', asset });
    } else {
      throw new NotFoundError('Either assetId or assetName is required');
    }

    const variant: Variant = {
      id: data.variantId,
      asset_id: asset.id,
      workflow_id: null, // No workflow for uploads
      status: 'uploading',
      error_message: null,
      image_key: null, // Will be set when upload completes
      thumb_key: null,
      recipe: data.recipe,
      starred: false,
      created_by: data.createdBy,
      created_at: now,
      updated_at: now,
      plan_step_id: null,
      description: null, // No cached description for uploaded variants
    };

    // Insert placeholder variant
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

    // Broadcast variant creation so all clients see "Uploading" state
    this.broadcast({ type: 'variant:created', variant });

    log.info('Upload placeholder created', {
      spaceId: this.spaceId,
      variantId: variant.id,
      assetId: asset.id,
      newAsset: createdNewAsset,
    });

    return { variant, asset: createdNewAsset ? asset : undefined, assetId: asset.id };
  }

  /**
   * Handle POST /internal/complete-upload HTTP request
   * Completes an uploading variant with image keys after R2 upload succeeds.
   */
  async httpCompleteUpload(data: {
    variantId: string;
    imageKey: string;
    thumbKey: string;
  }): Promise<{ variant: Variant }> {
    const now = Date.now();

    // Get the variant
    const existing = await this.repo.getVariantById(data.variantId);
    if (!existing) {
      throw new NotFoundError('Variant not found');
    }

    if (existing.status !== 'uploading') {
      throw new NotFoundError(`Variant is not uploading (status: ${existing.status})`);
    }

    // Update variant with image keys and completed status
    await this.sql.exec(
      `UPDATE variants SET status = 'completed', image_key = ?, thumb_key = ?, updated_at = ? WHERE id = ?`,
      data.imageKey,
      data.thumbKey,
      now,
      data.variantId
    );

    const variant: Variant = {
      ...existing,
      status: 'completed',
      image_key: data.imageKey,
      thumb_key: data.thumbKey,
      updated_at: now,
    };

    // Increment refs for images
    await this.sql.exec(INCREMENT_REF_SQL, data.imageKey);
    await this.sql.exec(INCREMENT_REF_SQL, data.thumbKey);

    // Set as active variant if asset has none
    const asset = await this.repo.getAssetById(variant.asset_id);
    if (asset && !asset.active_variant_id) {
      const updatedAsset = await this.repo.updateAsset(variant.asset_id, {
        active_variant_id: variant.id,
      });
      if (updatedAsset) {
        this.broadcast({ type: 'asset:updated', asset: updatedAsset });
      }
    } else if (asset) {
      // Broadcast asset update so clients see the new variant count
      this.broadcast({ type: 'asset:updated', asset });
    }

    // Broadcast variant update
    this.broadcast({ type: 'variant:updated', variant });

    log.info('Upload completed', {
      spaceId: this.spaceId,
      variantId: variant.id,
      assetId: variant.asset_id,
    });

    return { variant };
  }

  /**
   * Handle POST /internal/fail-upload HTTP request
   * Marks an uploading variant as failed if R2 upload fails.
   */
  async httpFailUpload(data: {
    variantId: string;
    error: string;
  }): Promise<{ variant: Variant }> {
    const now = Date.now();

    // Get the variant
    const existing = await this.repo.getVariantById(data.variantId);
    if (!existing) {
      throw new NotFoundError('Variant not found');
    }

    // Update variant to failed status
    await this.sql.exec(
      `UPDATE variants SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`,
      data.error,
      now,
      data.variantId
    );

    const variant: Variant = {
      ...existing,
      status: 'failed',
      error_message: data.error,
      updated_at: now,
    };

    // Broadcast variant update
    this.broadcast({ type: 'variant:updated', variant });

    log.info('Upload failed', {
      spaceId: this.spaceId,
      variantId: variant.id,
      error: data.error,
    });

    return { variant };
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
    relationType?: 'derived' | 'refined';
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
      plan_step_id: null, // This variant is not created by a plan step
      description: null, // No cached description for generated variants
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
   * If the variant is the active variant, reassign to another variant or NULL.
   */
  private async deleteVariant(variantId: string): Promise<void> {
    const variant = await this.repo.getVariantById(variantId);
    if (!variant) return;

    // Check if this variant is the active variant for its asset
    const asset = await this.repo.getAssetById(variant.asset_id);
    if (asset && asset.active_variant_id === variantId) {
      // Find another variant to set as active (prefer completed variants)
      const otherVariants = await this.repo.getVariantsByAsset(variant.asset_id);
      const candidates = otherVariants.filter((v) => v.id !== variantId);
      const newActiveVariant =
        candidates.find((v) => v.status === 'completed') ?? candidates[0];

      // Update asset's active variant (to another variant or NULL)
      const updatedAsset = await this.repo.updateAsset(variant.asset_id, {
        active_variant_id: newActiveVariant?.id ?? null,
      });
      if (updatedAsset) {
        this.broadcast({ type: 'asset:updated', asset: updatedAsset });
      }
    }

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
        log.error('Failed to delete image from R2', {
          imageKey,
          spaceId: this.spaceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Delete ref record
      await this.sql.exec(DELETE_REF_SQL, imageKey);
    }
  }
}
