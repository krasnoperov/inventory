/**
 * Variant Controller
 *
 * Handles variant operations including deletion, starring, and applying new variants.
 * Manages image reference counting to ensure proper R2 cleanup.
 */

import type { Asset, Lineage, MediaKind, Variant, WebSocketMeta } from '../types';
import {
  INCREMENT_REF_SQL,
  DECREMENT_REF_SQL,
  DELETE_REF_SQL,
  getVariantImageKeys,
} from '../variant/imageRefs';
import { BaseController, type ControllerContext, NotFoundError, ValidationError } from './types';
import { loggers } from '../../../../shared/logger';
import { DEFAULT_MEDIA_KIND } from '../../../../shared/websocket-types';
import { serializeGenerationProvenance } from '../repository/SpaceRepository';
import {
  parsePlatformUsageUserId,
  trackDeletedStorageUsage,
  trackVariantStorageUsage,
} from '../../../platform/platformUsage';

const log = loggers.variantController;
type UploadActiveVariantBehavior = 'if_missing' | 'set_active' | 'keep';
type UploadLineageInput = {
  parentVariantId: string;
  relationType: 'derived' | 'refined' | 'forked';
};

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

    const organizationBefore = await this.getOrganizationSnapshot();
    await this.deleteVariant(variantId, parsePlatformUsageUserId(meta.userId));
    const organizationAfter = await this.getOrganizationSnapshot();
    this.broadcast({ type: 'variant:deleted', variantId });
    await this.broadcastOrganizationCascadeChanges(organizationBefore, organizationAfter);
  }

  /**
   * Handle variant:rate WebSocket message (approve/reject for quality curation)
   */
  async handleRate(
    ws: WebSocket,
    meta: WebSocketMeta,
    variantId: string,
    rating: 'approved' | 'rejected'
  ): Promise<void> {
    this.requireEditor(meta);

    const variant = await this.repo.updateVariantRating(variantId, rating);
    if (!variant) {
      throw new NotFoundError('Variant not found');
    }

    this.broadcast({ type: 'variant:updated', variant });
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
    jobId: string | null;
    variantId: string;
    assetId: string;
    imageKey: string | null;
    thumbKey: string | null;
    mediaKey?: string | null;
    mediaMimeType?: string | null;
    mediaSizeBytes?: number | null;
    mediaWidth?: number | null;
    mediaHeight?: number | null;
    mediaDurationMs?: number | null;
    transcriptKey?: string | null;
    transcriptMimeType?: string | null;
    transcriptSizeBytes?: number | null;
    wordTimingsKey?: string | null;
    wordTimingsMimeType?: string | null;
    wordTimingsSizeBytes?: number | null;
    renderMetadataKey?: string | null;
    renderMetadataMimeType?: string | null;
    renderMetadataSizeBytes?: number | null;
    recipe: string;
    createdBy: string;
    mediaKind?: MediaKind;
    parentVariantIds?: string[];
    relationType?: 'derived' | 'refined';
    generationProvenance?: Record<string, unknown> | string | null;
    providerMetadata?: Record<string, unknown> | string | null;
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
    mediaKind?: MediaKind;
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
      this.assertVariantMediaKindMatchesAsset(existingAsset, data.mediaKind);
      asset = existingAsset;
    } else if (data.assetName) {
      // Create new asset for the upload
      const newAssetId = crypto.randomUUID();
      asset = await this.repo.createAsset({
        id: newAssetId,
        name: data.assetName,
        type: data.assetType || 'character',
        mediaKind: data.mediaKind,
        tags: [],
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
      media_kind: data.mediaKind ?? asset.media_kind ?? DEFAULT_MEDIA_KIND,
      workflow_id: null, // No workflow for uploads
      status: 'uploading',
      error_message: null,
      image_key: null, // Will be set when upload completes
      thumb_key: null,
      media_key: null,
      media_mime_type: null,
      media_size_bytes: null,
      media_width: null,
      media_height: null,
      media_duration_ms: null,
      transcript_key: null,
      transcript_mime_type: null,
      transcript_size_bytes: null,
      word_timings_key: null,
      word_timings_mime_type: null,
      word_timings_size_bytes: null,
      render_metadata_key: null,
      render_metadata_mime_type: null,
      render_metadata_size_bytes: null,
      generation_provenance: serializeGenerationProvenance(data.recipe, 'upload'),
      provider_metadata: null,
      recipe: data.recipe,
      starred: false,
      created_by: data.createdBy,
      created_at: now,
      updated_at: now,
      plan_step_id: null,
      description: null, // No cached description for uploaded variants
      batch_id: null,
      quality_rating: null,
      rated_at: null,
    };

    // Insert placeholder variant
    await this.sql.exec(
      `INSERT INTO variants (id, asset_id, media_kind, workflow_id, status, error_message, image_key, thumb_key, generation_provenance, provider_metadata, recipe, starred, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      variant.id,
      variant.asset_id,
      variant.media_kind,
      variant.workflow_id,
      variant.status,
      variant.error_message,
      variant.image_key,
      variant.thumb_key,
      variant.generation_provenance,
      variant.provider_metadata,
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
    imageKey: string | null;
    thumbKey: string | null;
    mediaKey?: string | null;
    mediaMimeType?: string | null;
    mediaSizeBytes?: number | null;
    mediaWidth?: number | null;
    mediaHeight?: number | null;
    mediaDurationMs?: number | null;
    transcriptKey?: string | null;
    transcriptMimeType?: string | null;
    transcriptSizeBytes?: number | null;
    wordTimingsKey?: string | null;
    wordTimingsMimeType?: string | null;
    wordTimingsSizeBytes?: number | null;
    renderMetadataKey?: string | null;
    renderMetadataMimeType?: string | null;
    renderMetadataSizeBytes?: number | null;
    providerMetadata?: Record<string, unknown> | string | null;
    activeVariantBehavior?: UploadActiveVariantBehavior;
    lineage?: UploadLineageInput[];
  }): Promise<{ variant: Variant; lineage?: Lineage[] }> {
    const now = Date.now();

    // Get the variant
    const existing = await this.repo.getVariantById(data.variantId);
    if (!existing) {
      throw new NotFoundError('Variant not found');
    }

    if (existing.status !== 'uploading') {
      throw new NotFoundError(`Variant is not uploading (status: ${existing.status})`);
    }
    if (hasAudioSidecarKeys(data) && existing.media_kind !== 'audio') {
      throw new ValidationError('Audio sidecars can only be attached to audio variants');
    }
    const lineageInputs = data.lineage ?? [];
    for (const lineageInput of lineageInputs) {
      if (
        lineageInput.relationType !== 'derived' &&
        lineageInput.relationType !== 'refined' &&
        lineageInput.relationType !== 'forked'
      ) {
        throw new ValidationError('Lineage relationType must be derived, refined, or forked');
      }
      const parent = await this.repo.getVariantById(lineageInput.parentVariantId);
      if (!parent) {
        throw new NotFoundError(`Lineage parent variant not found: ${lineageInput.parentVariantId}`);
      }
    }

    // Update variant with image keys and completed status
    await this.sql.exec(
      `UPDATE variants SET status = 'completed', image_key = ?, thumb_key = ?, media_key = ?, media_mime_type = ?, media_size_bytes = ?, media_width = ?, media_height = ?, media_duration_ms = ?, transcript_key = ?, transcript_mime_type = ?, transcript_size_bytes = ?, word_timings_key = ?, word_timings_mime_type = ?, word_timings_size_bytes = ?, render_metadata_key = ?, render_metadata_mime_type = ?, render_metadata_size_bytes = ?, provider_metadata = ?, updated_at = ? WHERE id = ?`,
      data.imageKey,
      data.thumbKey,
      data.mediaKey ?? data.imageKey,
      data.mediaMimeType ?? null,
      data.mediaSizeBytes ?? null,
      data.mediaWidth ?? null,
      data.mediaHeight ?? null,
      data.mediaDurationMs ?? null,
      data.transcriptKey ?? null,
      data.transcriptMimeType ?? null,
      data.transcriptSizeBytes ?? null,
      data.wordTimingsKey ?? null,
      data.wordTimingsMimeType ?? null,
      data.wordTimingsSizeBytes ?? null,
      data.renderMetadataKey ?? null,
      data.renderMetadataMimeType ?? null,
      data.renderMetadataSizeBytes ?? null,
      serializeProviderMetadata(data.providerMetadata),
      now,
      data.variantId
    );

    const variant: Variant = {
      ...existing,
      status: 'completed',
      image_key: data.imageKey,
      thumb_key: data.thumbKey,
      media_key: data.mediaKey ?? data.imageKey,
      media_mime_type: data.mediaMimeType ?? null,
      media_size_bytes: data.mediaSizeBytes ?? null,
      media_width: data.mediaWidth ?? null,
      media_height: data.mediaHeight ?? null,
      media_duration_ms: data.mediaDurationMs ?? null,
      transcript_key: data.transcriptKey ?? null,
      transcript_mime_type: data.transcriptMimeType ?? null,
      transcript_size_bytes: data.transcriptSizeBytes ?? null,
      word_timings_key: data.wordTimingsKey ?? null,
      word_timings_mime_type: data.wordTimingsMimeType ?? null,
      word_timings_size_bytes: data.wordTimingsSizeBytes ?? null,
      render_metadata_key: data.renderMetadataKey ?? null,
      render_metadata_mime_type: data.renderMetadataMimeType ?? null,
      render_metadata_size_bytes: data.renderMetadataSizeBytes ?? null,
      provider_metadata: serializeProviderMetadata(data.providerMetadata),
      updated_at: now,
    };

    // Increment refs for all stored artifact keys.
    const imageKeys = getVariantImageKeys(variant);
    for (const key of imageKeys) {
      await this.sql.exec(INCREMENT_REF_SQL, key);
    }

    await this.trackStoredVariant(variant, 'uploaded');

    const lineage: Lineage[] = [];
    for (const lineageInput of lineageInputs) {
      const created = await this.repo.createLineage({
        id: crypto.randomUUID(),
        parentVariantId: lineageInput.parentVariantId,
        childVariantId: variant.id,
        relationType: lineageInput.relationType,
      });
      lineage.push(created);
      this.broadcast({ type: 'lineage:created', lineage: created });
    }

    // Set as active according to upload/import policy.
    const asset = await this.repo.getAssetById(variant.asset_id);
    const activeBehavior = data.activeVariantBehavior ?? 'if_missing';
    if (
      asset &&
      activeBehavior !== 'keep' &&
      (activeBehavior === 'set_active' || !asset.active_variant_id)
    ) {
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

    return {
      variant,
      ...(lineage.length > 0 ? { lineage } : {}),
    };
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
    jobId: string | null;
    variantId: string;
    assetId: string;
    imageKey: string | null;
    thumbKey: string | null;
    mediaKey?: string | null;
    mediaMimeType?: string | null;
    mediaSizeBytes?: number | null;
    mediaWidth?: number | null;
    mediaHeight?: number | null;
    mediaDurationMs?: number | null;
    transcriptKey?: string | null;
    transcriptMimeType?: string | null;
    transcriptSizeBytes?: number | null;
    wordTimingsKey?: string | null;
    wordTimingsMimeType?: string | null;
    wordTimingsSizeBytes?: number | null;
    renderMetadataKey?: string | null;
    renderMetadataMimeType?: string | null;
    renderMetadataSizeBytes?: number | null;
    recipe: string;
    createdBy: string;
    mediaKind?: MediaKind;
    parentVariantIds?: string[];
    relationType?: 'derived' | 'refined';
    generationProvenance?: Record<string, unknown> | string | null;
    providerMetadata?: Record<string, unknown> | string | null;
  }): Promise<{ created: boolean; variant: Variant }> {
    // Check if variant already exists (idempotency via workflowId/jobId)
    const existing = data.jobId ? await this.repo.getVariantByWorkflowId(data.jobId) : null;
    if (existing) {
      return { created: false, variant: existing };
    }

    const asset = await this.repo.getAssetById(data.assetId);
    if (!asset) {
      throw new NotFoundError('Asset not found');
    }
    const mediaKind = this.assertVariantMediaKindMatchesAsset(asset, data.mediaKind);

    const now = Date.now();

    const variant: Variant = {
      id: data.variantId,
      asset_id: data.assetId,
      media_kind: mediaKind,
      workflow_id: data.jobId,
      status: 'completed', // Variants created via workflow are immediately complete
      error_message: null,
      image_key: data.imageKey,
      thumb_key: data.thumbKey,
      media_key: data.mediaKey ?? data.imageKey,
      media_mime_type: data.mediaMimeType ?? null,
      media_size_bytes: data.mediaSizeBytes ?? null,
      media_width: data.mediaWidth ?? null,
      media_height: data.mediaHeight ?? null,
      media_duration_ms: data.mediaDurationMs ?? null,
      transcript_key: data.transcriptKey ?? null,
      transcript_mime_type: data.transcriptMimeType ?? null,
      transcript_size_bytes: data.transcriptSizeBytes ?? null,
      word_timings_key: data.wordTimingsKey ?? null,
      word_timings_mime_type: data.wordTimingsMimeType ?? null,
      word_timings_size_bytes: data.wordTimingsSizeBytes ?? null,
      render_metadata_key: data.renderMetadataKey ?? null,
      render_metadata_mime_type: data.renderMetadataMimeType ?? null,
      render_metadata_size_bytes: data.renderMetadataSizeBytes ?? null,
      generation_provenance: data.generationProvenance === undefined
        ? serializeGenerationProvenance(data.recipe, data.relationType ?? 'derive')
        : serializeProviderMetadata(data.generationProvenance),
      provider_metadata: serializeProviderMetadata(data.providerMetadata),
      recipe: data.recipe,
      starred: false,
      created_by: data.createdBy,
      created_at: now,
      updated_at: now,
      plan_step_id: null, // This variant is not created by a plan step
      description: null, // No cached description for generated variants
      batch_id: null,
      quality_rating: null,
      rated_at: null,
    };

    // Insert variant
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

    await this.trackStoredVariant(variant, 'applied');

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
  private async deleteVariant(variantId: string, deletedByUserId: number | null): Promise<void> {
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
      const deletion = await this.decrementRef(key);
      if (deletion.deleted && deletion.sizeBytes > 0) {
        try {
          await trackDeletedStorageUsage(this.env.DB, {
            spaceId: this.spaceId,
            userId: deletedByUserId,
            assetId: variant.asset_id,
            variantId: variant.id,
            mediaKind: variant.media_kind,
            artifactKey: key,
            sizeBytes: deletion.sizeBytes,
          });
        } catch (error) {
          log.warn('Failed to track deleted storage usage', {
            spaceId: this.spaceId,
            variantId,
            imageKey: key,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Delete variant
    await this.sql.exec('DELETE FROM variants WHERE id = ?', variantId);
  }

  /**
   * Decrement image ref and delete from R2 if ref count reaches 0
   */
  private async decrementRef(imageKey: string): Promise<{ deleted: boolean; sizeBytes: number }> {
    const result = await this.sql.exec(DECREMENT_REF_SQL, imageKey);
    const row = result.toArray()[0] as { ref_count: number } | undefined;

    if (row && row.ref_count <= 0) {
      let sizeBytes = 0;
      try {
        const object = await this.env.IMAGES.head(imageKey);
        sizeBytes = object?.size ?? 0;
      } catch (error) {
        log.warn('Failed to read R2 object size before delete', {
          imageKey,
          spaceId: this.spaceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Delete from R2
      let deleteSucceeded = false;
      try {
        await this.env.IMAGES.delete(imageKey);
        deleteSucceeded = true;
      } catch (error) {
        log.error('Failed to delete image from R2', {
          imageKey,
          spaceId: this.spaceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Delete ref record
      await this.sql.exec(DELETE_REF_SQL, imageKey);
      return { deleted: deleteSucceeded, sizeBytes };
    }

    return { deleted: false, sizeBytes: 0 };
  }

  private async trackStoredVariant(
    variant: Variant,
    reason: 'uploaded' | 'applied'
  ): Promise<void> {
    try {
      await trackVariantStorageUsage(this.env.DB, this.env.IMAGES, {
        spaceId: this.spaceId,
        variant,
        reason,
      });
    } catch (error) {
      log.warn('Failed to track stored variant usage', {
        spaceId: this.spaceId,
        variantId: variant.id,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private assertVariantMediaKindMatchesAsset(
    asset: Asset,
    requestedMediaKind?: MediaKind
  ): MediaKind {
    const assetMediaKind = asset.media_kind ?? DEFAULT_MEDIA_KIND;
    if (requestedMediaKind && requestedMediaKind !== assetMediaKind) {
      throw new ValidationError(
        `Cannot create ${requestedMediaKind} variant for ${assetMediaKind} asset`
      );
    }
    return assetMediaKind;
  }
}

function hasAudioSidecarKeys(data: {
  transcriptKey?: string | null;
  wordTimingsKey?: string | null;
  renderMetadataKey?: string | null;
}): boolean {
  return Boolean(data.transcriptKey || data.wordTimingsKey || data.renderMetadataKey);
}

function serializeProviderMetadata(
  metadata: Record<string, unknown> | string | null | undefined
): string | null {
  if (metadata === undefined || metadata === null) return null;
  if (typeof metadata === 'string') return metadata;
  return JSON.stringify(metadata);
}
