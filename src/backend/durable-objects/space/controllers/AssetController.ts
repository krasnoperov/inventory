/**
 * Asset Controller
 *
 * Handles asset CRUD operations, forking, and hierarchy management.
 * Assets are the primary containers for variants in the inventory system.
 */

import type { Asset, Variant, Lineage, MediaKind, WebSocketMeta } from '../types';
import { wouldCreateCycle, getAncestorChain } from '../asset/hierarchy';
import { INCREMENT_REF_SQL, getVariantImageKeys } from '../variant/imageRefs';
import { BaseController, type ControllerContext, NotFoundError, ValidationError } from './types';
import { loggers } from '../../../../shared/logger';
import { DEFAULT_MEDIA_KIND } from '../../../../shared/websocket-types';
import {
  parsePlatformUsageUserId,
  trackDeletedStorageUsage,
} from '../../../platform/platformUsage';

const log = loggers.spaceDO;

export class AssetController extends BaseController {
  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  // ==========================================================================
  // WebSocket Handlers
  // ==========================================================================

  /**
   * Handle asset:create WebSocket message
   */
  async handleCreate(
    ws: WebSocket,
    meta: WebSocketMeta,
    name: string,
    assetType: string,
    parentAssetId?: string,
    mediaKind?: MediaKind
  ): Promise<void> {
    this.requireEditor(meta);

    const asset = await this.createAsset({
      name,
      type: assetType,
      mediaKind,
      parentAssetId,
      createdBy: meta.userId,
    });

    this.broadcast({ type: 'asset:created', asset });
  }

  /**
   * Handle asset:update WebSocket message
   */
  async handleUpdate(
    ws: WebSocket,
    meta: WebSocketMeta,
    assetId: string,
    changes: { name?: string; tags?: string[]; type?: string; parentAssetId?: string | null }
  ): Promise<void> {
    this.requireEditor(meta);

    // If changing parent, validate no cycle would be created
    if (changes.parentAssetId !== undefined) {
      const wouldCycle = await this.checkWouldCreateCycle(assetId, changes.parentAssetId);
      if (wouldCycle) {
        throw new ValidationError('Cannot set parent: would create circular hierarchy');
      }
    }

    // Map parentAssetId to parent_asset_id for database
    const dbChanges: { name?: string; tags?: string[]; type?: string; parent_asset_id?: string | null } = {
      name: changes.name,
      tags: changes.tags,
      type: changes.type,
      parent_asset_id: changes.parentAssetId,
    };

    const asset = await this.repo.updateAsset(assetId, dbChanges);
    if (!asset) {
      throw new NotFoundError('Asset not found');
    }

    this.broadcast({ type: 'asset:updated', asset });
  }

  /**
   * Handle asset:delete WebSocket message
   */
  async handleDelete(ws: WebSocket, meta: WebSocketMeta, assetId: string): Promise<void> {
    this.requireOwner(meta);

    // Get child assets before deletion - they will be reparented to root
    const childAssets = await this.repo.getAssetsByParent(assetId);
    const variants = await this.repo.getVariantsByAsset(assetId);
    const variantByImageKey = new Map<string, Variant>();
    for (const variant of variants) {
      for (const key of getVariantImageKeys(variant)) {
        if (!variantByImageKey.has(key)) {
          variantByImageKey.set(key, variant);
        }
      }
    }

    const deletedImageRefs = await this.repo.deleteAsset(assetId);
    if (Array.isArray(deletedImageRefs)) {
      for (const deletedImageRef of deletedImageRefs) {
        const variant = variantByImageKey.get(deletedImageRef.imageKey);
        try {
          await trackDeletedStorageUsage(this.env.DB, {
            spaceId: this.spaceId,
            userId: parsePlatformUsageUserId(meta.userId),
            assetId,
            variantId: variant?.id ?? null,
            mediaKind: variant?.media_kind ?? null,
            artifactKey: deletedImageRef.imageKey,
            sizeBytes: deletedImageRef.sizeBytes,
          });
        } catch (error) {
          log.warn('Failed to track asset deleted storage usage', {
            spaceId: this.spaceId,
            assetId,
            imageKey: deletedImageRef.imageKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    this.broadcast({ type: 'asset:deleted', assetId });

    // Broadcast updates for reparented children (now at root level)
    for (const child of childAssets) {
      const updatedChild = await this.repo.getAssetById(child.id);
      if (updatedChild) {
        this.broadcast({ type: 'asset:updated', asset: updatedChild });
      }
    }
  }

  /**
   * Handle asset:setActive WebSocket message
   */
  async handleSetActive(
    ws: WebSocket,
    meta: WebSocketMeta,
    assetId: string,
    variantId: string
  ): Promise<void> {
    this.requireEditor(meta);

    const asset = await this.repo.updateAsset(assetId, { active_variant_id: variantId });
    if (!asset) {
      throw new NotFoundError('Asset not found');
    }

    this.broadcast({ type: 'asset:updated', asset });
  }

  /**
   * Handle asset:fork WebSocket message
   * Creates a new asset from an existing asset or variant.
   * If sourceAssetId is provided, resolves to its active variant.
   * If sourceVariantId is provided, uses it directly.
   */
  async handleFork(
    ws: WebSocket,
    meta: WebSocketMeta,
    sourceAssetId: string | undefined,
    sourceVariantId: string | undefined,
    name: string,
    assetType: string,
    parentAssetId?: string,
    mediaKind?: MediaKind
  ): Promise<void> {
    this.requireEditor(meta);

    // Resolve to variant ID - either directly provided or via asset's active variant
    let resolvedVariantId: string;
    if (sourceVariantId) {
      resolvedVariantId = sourceVariantId;
    } else if (sourceAssetId) {
      const sourceAsset = await this.repo.getAssetById(sourceAssetId);
      if (!sourceAsset) {
        throw new NotFoundError('Source asset not found');
      }
      if (!sourceAsset.active_variant_id) {
        throw new NotFoundError('Source asset has no active variant');
      }
      resolvedVariantId = sourceAsset.active_variant_id;
    } else {
      throw new ValidationError('Either sourceAssetId or sourceVariantId must be provided');
    }

    const result = await this.forkAsset({
      sourceVariantId: resolvedVariantId,
      name,
      type: assetType,
      mediaKind,
      parentAssetId,
      createdBy: meta.userId,
    });

    if (!result) {
      throw new NotFoundError('Source variant not found');
    }

    this.broadcast({
      type: 'asset:forked',
      asset: result.asset,
      variant: result.variant,
      lineage: result.lineage,
    });
  }

  // ==========================================================================
  // HTTP Handlers
  // ==========================================================================

  /**
   * Handle POST /internal/create-asset HTTP request
   */
  async httpCreate(data: {
    id?: string;
    name: string;
    type: string;
    mediaKind?: MediaKind;
    parentAssetId?: string;
    createdBy: string;
  }): Promise<Asset> {
    const asset = await this.createAsset(data);
    this.broadcast({ type: 'asset:created', asset });
    return asset;
  }

  /**
   * Handle GET /internal/asset/:assetId HTTP request
   * Returns asset with its variants and lineage
   */
  async httpGetDetails(assetId: string): Promise<{
    asset: Asset;
    variants: Variant[];
    lineage: Lineage[];
  }> {
    const asset = await this.repo.getAssetById(assetId);
    if (!asset) {
      throw new NotFoundError('Asset not found');
    }

    const variants = await this.repo.getVariantsByAsset(assetId);
    const variantIds = variants.map((v) => v.id);
    const lineage = await this.repo.getLineageForVariants(variantIds);

    // Debug: Log lineage fetch results
    log.info('httpGetDetails lineage', {
      assetId,
      variantIds,
      lineageCount: lineage.length,
      lineageRecords: lineage.map(l => ({
        id: l.id,
        parent: l.parent_variant_id,
        child: l.child_variant_id,
        type: l.relation_type,
      })),
    });

    return { asset, variants, lineage };
  }

  /**
   * Handle GET /internal/asset/:assetId/children HTTP request
   */
  async httpGetChildren(assetId: string): Promise<Asset[]> {
    return this.repo.getAssetsByParent(assetId);
  }

  /**
   * Handle GET /internal/asset/:assetId/ancestors HTTP request
   * Returns ancestors in root-first order (for breadcrumbs)
   */
  async httpGetAncestors(assetId: string): Promise<Asset[]> {
    return getAncestorChain<Asset>(
      assetId,
      (id) => this.repo.getAssetById(id),
      (asset) => asset.parent_asset_id
    );
  }

  /**
   * Handle PATCH /internal/asset/:assetId/parent HTTP request
   */
  async httpReparent(assetId: string, parentAssetId: string | null): Promise<Asset> {
    // Check for circular reference
    if (parentAssetId) {
      const wouldCycle = await this.checkWouldCreateCycle(assetId, parentAssetId);
      if (wouldCycle) {
        throw new ValidationError('Cannot create circular reference');
      }
    }

    const asset = await this.repo.updateAsset(assetId, { parent_asset_id: parentAssetId });
    if (!asset) {
      throw new NotFoundError('Asset not found');
    }

    this.broadcast({ type: 'asset:updated', asset });
    return asset;
  }

  /**
   * Handle POST /internal/fork HTTP request
   */
  async httpFork(data: {
    sourceVariantId: string;
    name: string;
    type: string;
    mediaKind?: MediaKind;
    parentAssetId?: string;
    createdBy: string;
  }): Promise<{ asset: Asset; variant: Variant; lineage: Lineage }> {
    const result = await this.forkAsset(data);
    if (!result) {
      throw new NotFoundError('Source variant not found');
    }

    this.broadcast({
      type: 'asset:forked',
      asset: result.asset,
      variant: result.variant,
      lineage: result.lineage,
    });

    return result;
  }

  /**
   * Handle POST /internal/set-active HTTP request
   */
  async httpSetActive(assetId: string, variantId: string): Promise<Asset> {
    const asset = await this.repo.updateAsset(assetId, { active_variant_id: variantId });
    if (!asset) {
      throw new NotFoundError('Asset not found');
    }

    this.broadcast({ type: 'asset:updated', asset });
    return asset;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Create a new asset
   */
  private async createAsset(data: {
    id?: string;
    name: string;
    type: string;
    mediaKind?: MediaKind;
    parentAssetId?: string;
    createdBy: string;
  }): Promise<Asset> {
    return this.repo.createAsset({
      id: data.id || crypto.randomUUID(),
      name: data.name,
      type: data.type,
      mediaKind: data.mediaKind,
      tags: [],
      parentAssetId: data.parentAssetId,
      createdBy: data.createdBy,
    });
  }

  /**
   * Check if setting newParentId as parent would create a cycle
   */
  private async checkWouldCreateCycle(assetId: string, newParentId: string | null): Promise<boolean> {
    return wouldCreateCycle(assetId, newParentId, async (id) => {
      const result = await this.sql.exec('SELECT parent_asset_id FROM assets WHERE id = ?', id);
      const row = result.toArray()[0] as { parent_asset_id: string | null } | undefined;
      return row?.parent_asset_id ?? null;
    });
  }

  /**
   * Fork a new asset from an existing variant.
   * Creates a copy of the variant in a new asset with 'forked' lineage.
   */
  private async forkAsset(data: {
    sourceVariantId: string;
    name: string;
    type: string;
    mediaKind?: MediaKind;
    parentAssetId?: string;
    createdBy: string;
  }): Promise<{ asset: Asset; variant: Variant; lineage: Lineage } | null> {
    // Get source variant
    const sourceVariant = await this.repo.getVariantById(data.sourceVariantId);
    if (!sourceVariant) return null;
    const sourceMediaKind = sourceVariant.media_kind ?? DEFAULT_MEDIA_KIND;
    if (data.mediaKind && data.mediaKind !== sourceMediaKind) {
      throw new ValidationError(
        `Cannot fork ${sourceMediaKind} variant into ${data.mediaKind} asset`
      );
    }

    const now = Date.now();

    // Auto-set parentAssetId from source variant's asset if not explicitly provided
    // This ensures forked assets show their relationship on the Space page
    const effectiveParentAssetId = data.parentAssetId ?? sourceVariant.asset_id;

    // Create new asset
    const asset = await this.createAsset({
      name: data.name,
      type: data.type,
      mediaKind: data.mediaKind ?? sourceMediaKind,
      parentAssetId: effectiveParentAssetId,
      createdBy: data.createdBy,
    });

    // Create new variant (copy of source - forked variants are immediately complete)
    const newVariantId = crypto.randomUUID();
    const variant: Variant = {
      id: newVariantId,
      asset_id: asset.id,
      media_kind: sourceMediaKind,
      workflow_id: null, // Forked variants have no workflow
      status: 'completed', // Forked variants are immediately complete
      error_message: null,
      image_key: sourceVariant.image_key,
      thumb_key: sourceVariant.thumb_key,
      media_key: sourceVariant.media_key ?? sourceVariant.image_key,
      media_mime_type: sourceVariant.media_mime_type,
      media_size_bytes: sourceVariant.media_size_bytes,
      media_width: sourceVariant.media_width,
      media_height: sourceVariant.media_height,
      media_duration_ms: sourceVariant.media_duration_ms,
      transcript_key: sourceVariant.transcript_key,
      transcript_mime_type: sourceVariant.transcript_mime_type,
      transcript_size_bytes: sourceVariant.transcript_size_bytes,
      word_timings_key: sourceVariant.word_timings_key,
      word_timings_mime_type: sourceVariant.word_timings_mime_type,
      word_timings_size_bytes: sourceVariant.word_timings_size_bytes,
      render_metadata_key: sourceVariant.render_metadata_key,
      render_metadata_mime_type: sourceVariant.render_metadata_mime_type,
      render_metadata_size_bytes: sourceVariant.render_metadata_size_bytes,
      generation_provenance: sourceVariant.generation_provenance ?? sourceVariant.recipe,
      provider_metadata: sourceVariant.provider_metadata,
      recipe: sourceVariant.recipe,
      starred: false,
      created_by: data.createdBy,
      created_at: now,
      updated_at: now,
      plan_step_id: null, // Forked variants are not created by plan steps
      description: null, // No cached description for forked variants
      batch_id: null, // Forked variants are not part of a batch
      quality_rating: null,
      rated_at: null,
    };

    await this.sql.exec(
      `INSERT INTO variants (id, asset_id, media_kind, workflow_id, status, error_message, image_key, thumb_key, media_key, media_mime_type, media_size_bytes, media_width, media_height, media_duration_ms, transcript_key, transcript_mime_type, transcript_size_bytes, word_timings_key, word_timings_mime_type, word_timings_size_bytes, render_metadata_key, render_metadata_mime_type, render_metadata_size_bytes, generation_provenance, provider_metadata, recipe, starred, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      variant.id,
      variant.asset_id,
      variant.media_kind,
      variant.workflow_id,
      variant.status,
      variant.error_message,
      variant.image_key,
      variant.thumb_key,
      variant.media_key,
      variant.media_mime_type,
      variant.media_size_bytes,
      variant.media_width,
      variant.media_height,
      variant.media_duration_ms,
      variant.transcript_key,
      variant.transcript_mime_type,
      variant.transcript_size_bytes,
      variant.word_timings_key,
      variant.word_timings_mime_type,
      variant.word_timings_size_bytes,
      variant.render_metadata_key,
      variant.render_metadata_mime_type,
      variant.render_metadata_size_bytes,
      variant.generation_provenance,
      variant.provider_metadata,
      variant.recipe,
      variant.starred ? 1 : 0,
      variant.created_by,
      variant.created_at,
      variant.updated_at
    );

    // Increment refs for copied artifacts (reuses existing media).
    for (const key of getVariantImageKeys(variant)) {
      await this.sql.exec(INCREMENT_REF_SQL, key);
    }

    // Create forked lineage
    const lineage = await this.repo.createLineage({
      id: crypto.randomUUID(),
      parentVariantId: data.sourceVariantId,
      childVariantId: newVariantId,
      relationType: 'forked',
    });

    // Set the forked variant as active
    await this.repo.updateAsset(asset.id, { active_variant_id: newVariantId });
    asset.active_variant_id = newVariantId;

    return { asset, variant, lineage };
  }
}
