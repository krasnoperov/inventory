/**
 * Rotation Controller
 *
 * Handles multi-directional character sprite generation.
 * Creates a sequential pipeline where each view's completion triggers the next
 * via the GenerationController's httpCompleteVariant() hook.
 */

import type {
  RotationConfig,
  Variant,
  WebSocketMeta,
} from '../types';
import { ROTATION_DIRECTIONS } from '../types';
import type { GenerationWorkflowInput } from '../../../workflows/types';
import { BaseController, type ControllerContext, NotFoundError, ValidationError } from './types';
import { INCREMENT_REF_SQL } from '../variant/imageRefs';
import { capRefs, getStyleImageKeys } from '../generation/refLimits';
import { PromptBuilder, ROTATION_CAMERA_SPECS, NEGATIVE_PROMPTS } from '../generation/PromptBuilder';
import { ROTATION_GRID_LAYOUTS, sliceGridCell } from '../generation/gridSlice';
import {
  getBaseUrl,
  getImageDimensions,
  getExtensionForMimeType,
  type ImageMimeType,
} from '../../../utils/image-utils';
import { loggers } from '../../../../shared/logger';

const log = loggers.rotationController;

export class RotationController extends BaseController {
  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  /**
   * Handle rotation:request WebSocket message.
   * Creates a child asset, forks source variant, and starts sequential generation.
   */
  async handleRotationRequest(
    ws: WebSocket,
    meta: WebSocketMeta,
    msg: {
      type: 'rotation:request';
      requestId: string;
      sourceVariantId: string;
      config: RotationConfig;
      subjectDescription?: string;
      aspectRatio?: string;
      disableStyle?: boolean;
      generationMode?: 'sequential' | 'single-shot';
    }
  ): Promise<void> {
    this.requireEditor(meta);

    // Route to single-shot mode if requested
    if (msg.generationMode === 'single-shot') {
      return this.handleSingleShotRotation(ws, meta, msg);
    }

    // Validate source variant exists and is completed
    const sourceVariant = await this.repo.getVariantById(msg.sourceVariantId);
    if (!sourceVariant) {
      throw new NotFoundError('Source variant not found');
    }
    if (sourceVariant.status !== 'completed' || !sourceVariant.image_key) {
      throw new ValidationError('Source variant must be completed with an image');
    }

    // Get source asset for naming
    const sourceAsset = await this.repo.getAssetById(sourceVariant.asset_id);
    if (!sourceAsset) {
      throw new NotFoundError('Source asset not found');
    }

    const directions = ROTATION_DIRECTIONS[msg.config];
    if (!directions) {
      throw new ValidationError(`Invalid rotation config: ${msg.config}`);
    }

    // Create child asset for the rotation set
    const rotationAssetId = crypto.randomUUID();
    const rotationAsset = await this.repo.createAsset({
      id: rotationAssetId,
      name: `${sourceAsset.name} — Rotation`,
      type: sourceAsset.type,
      tags: [],
      parentAssetId: sourceAsset.id,
      createdBy: meta.userId,
    });
    this.broadcast({ type: 'asset:created', asset: rotationAsset });

    // Fork source variant into rotation asset (copy image, increment refs)
    const forkedVariantId = crypto.randomUUID();
    const now = Date.now();
    await this.sql.exec(
      `INSERT INTO variants (id, asset_id, workflow_id, status, error_message, image_key, thumb_key, recipe, starred, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      forkedVariantId,
      rotationAssetId,
      null,
      'completed',
      null,
      sourceVariant.image_key,
      sourceVariant.thumb_key,
      sourceVariant.recipe,
      0,
      meta.userId,
      now,
      now
    );

    // Increment refs for copied images
    if (sourceVariant.image_key) await this.sql.exec(INCREMENT_REF_SQL, sourceVariant.image_key);
    if (sourceVariant.thumb_key) await this.sql.exec(INCREMENT_REF_SQL, sourceVariant.thumb_key);

    // Create forked lineage
    const lineage = await this.repo.createLineage({
      id: crypto.randomUUID(),
      parentVariantId: msg.sourceVariantId,
      childVariantId: forkedVariantId,
      relationType: 'forked',
    });

    // Set as active variant
    await this.repo.updateAsset(rotationAssetId, { active_variant_id: forkedVariantId });
    rotationAsset.active_variant_id = forkedVariantId;

    const forkedVariant = await this.repo.getVariantById(forkedVariantId);
    if (forkedVariant) {
      this.broadcast({ type: 'variant:created', variant: forkedVariant });
      this.broadcast({ type: 'asset:updated', asset: rotationAsset });
      this.broadcast({ type: 'lineage:created', lineage });
    }

    // Create rotation_sets record
    const rotationSetId = crypto.randomUUID();
    const configJson = JSON.stringify({
      type: msg.config,
      subjectDescription: msg.subjectDescription,
      aspectRatio: msg.aspectRatio,
      disableStyle: msg.disableStyle,
    });

    await this.repo.createRotationSet({
      id: rotationSetId,
      assetId: rotationAssetId,
      sourceVariantId: msg.sourceVariantId,
      config: configJson,
      totalSteps: directions.length,
      createdBy: meta.userId,
    });

    // Register forked variant as first rotation view (direction[0])
    await this.repo.createRotationView({
      id: crypto.randomUUID(),
      rotationSetId,
      variantId: forkedVariantId,
      direction: directions[0],
      stepIndex: 0,
    });

    // Broadcast rotation:started
    this.broadcast({
      type: 'rotation:started',
      requestId: msg.requestId,
      rotationSetId,
      assetId: rotationAssetId,
      totalSteps: directions.length,
      directions,
    });

    log.info('Rotation pipeline started', {
      spaceId: this.spaceId,
      rotationSetId,
      config: msg.config,
      totalSteps: directions.length,
    });

    // Advance to generate next view (step 1)
    await this.advanceRotation(rotationSetId);
  }

  /**
   * Advance the rotation pipeline to the next step.
   * Called after each view completes via the completion hook.
   */
  async advanceRotation(rotationSetId: string): Promise<void> {
    const set = await this.repo.getRotationSetById(rotationSetId);
    if (!set) return;
    if (set.status === 'cancelled' || set.status === 'failed') return;

    const config = JSON.parse(set.config) as {
      type: RotationConfig;
      subjectDescription?: string;
      aspectRatio?: string;
      disableStyle?: boolean;
    };
    const directions = ROTATION_DIRECTIONS[config.type];

    // Count completed views
    const completedViews = await this.repo.getCompletedRotationViews(rotationSetId);
    const currentStep = completedViews.length;

    // All steps done?
    if (currentStep >= set.total_steps) {
      await this.repo.updateRotationSetStatus(rotationSetId, 'completed');
      const allViews = await this.repo.getRotationViewsBySet(rotationSetId);
      this.broadcast({
        type: 'rotation:completed',
        rotationSetId,
        views: allViews,
      });
      log.info('Rotation pipeline completed', { rotationSetId, totalViews: currentStep });
      return;
    }

    const direction = directions[currentStep];

    // Collect image keys from all completed views
    const viewImageKeys = completedViews.map(v => v.image_key);

    // Get style refs (no-op until Tier 1)
    const { styleKeys, styleDescription } = await getStyleImageKeys(this.repo, config.disableStyle);

    // Cap refs to fit Gemini limit
    // Pin both the source image and the front/first generated view
    const sourceKey = completedViews[0]?.image_key || '';
    const masterKey = completedViews.length > 1 ? completedViews[0].image_key : undefined;
    const cappedKeys = capRefs(styleKeys, viewImageKeys, sourceKey, 14, masterKey);

    // Build directional prompt
    const subject = config.subjectDescription
      || (await this.repo.getVariantById(set.source_variant_id))?.description
      || (await this.repo.getAssetById(set.asset_id))?.name
      || 'the subject';

    const builder = new PromptBuilder();
    if (styleDescription) {
      builder.withStyle(styleDescription);
    }
    builder.withRotationContext(completedViews, direction, subject);
    const prompt = builder.build();

    // Create placeholder variant
    const variantId = crypto.randomUUID();
    const recipe = JSON.stringify({
      prompt,
      assetType: (await this.repo.getAssetById(set.asset_id))?.type || 'character',
      aspectRatio: config.aspectRatio,
      sourceImageKeys: [...styleKeys, ...cappedKeys],
      operation: 'derive',
    });

    const variant = await this.repo.createPlaceholderVariant({
      id: variantId,
      assetId: set.asset_id,
      recipe,
      createdBy: set.created_by,
    });
    this.broadcast({ type: 'variant:created', variant });

    // Register as rotation_view
    await this.repo.createRotationView({
      id: crypto.randomUUID(),
      rotationSetId,
      variantId,
      direction,
      stepIndex: currentStep,
    });

    // Trigger GenerationWorkflow
    if (this.env.GENERATION_WORKFLOW) {
      try {
        const workflowInput: GenerationWorkflowInput = {
          requestId: crypto.randomUUID(),
          jobId: variantId,
          spaceId: this.spaceId,
          userId: set.created_by,
          prompt,
          assetId: set.asset_id,
          assetName: `${subject} — ${direction}`,
          assetType: (await this.repo.getAssetById(set.asset_id))?.type || 'character',
          aspectRatio: config.aspectRatio,
          sourceImageKeys: [...styleKeys, ...cappedKeys],
          operation: 'derive',
        };

        const instance = await this.env.GENERATION_WORKFLOW.create({
          id: variantId,
          params: workflowInput,
        });

        const updatedVariant = await this.repo.updateVariantWorkflow(variantId, instance.id, 'processing');
        if (updatedVariant) {
          this.broadcast({ type: 'variant:updated', variant: updatedVariant });
        }
      } catch (err) {
        log.error('Failed to create rotation workflow', { rotationSetId, variantId, error: String(err) });
        await this.repo.failRotationSet(rotationSetId, `Workflow creation failed: ${String(err)}`);
        this.broadcast({ type: 'rotation:failed', rotationSetId, error: String(err), failedStep: currentStep });
        return;
      }
    }

    // Update step counter
    await this.repo.updateRotationSetStep(rotationSetId, currentStep);

    // Broadcast step progress
    this.broadcast({
      type: 'rotation:step_completed',
      rotationSetId,
      direction,
      variantId,
      step: currentStep,
      total: set.total_steps,
    });

    log.info('Rotation step triggered', {
      rotationSetId,
      step: currentStep,
      direction,
      variantId,
    });
  }

  /**
   * Handle rotation:cancel WebSocket message.
   */
  async handleRotationCancel(
    ws: WebSocket,
    meta: WebSocketMeta,
    rotationSetId: string
  ): Promise<void> {
    this.requireEditor(meta);

    const set = await this.repo.getRotationSetById(rotationSetId);
    if (!set) {
      throw new NotFoundError('Rotation set not found');
    }

    await this.repo.cancelRotationSet(rotationSetId);
    this.broadcast({ type: 'rotation:cancelled', rotationSetId });

    log.info('Rotation pipeline cancelled', { rotationSetId });
  }

  /**
   * Handle single-shot rotation generation.
   * Generates all views as a single sprite sheet image, then slices.
   */
  private async handleSingleShotRotation(
    ws: WebSocket,
    meta: WebSocketMeta,
    msg: {
      type: 'rotation:request';
      requestId: string;
      sourceVariantId: string;
      config: RotationConfig;
      subjectDescription?: string;
      aspectRatio?: string;
      disableStyle?: boolean;
    }
  ): Promise<void> {
    // Validate source variant
    const sourceVariant = await this.repo.getVariantById(msg.sourceVariantId);
    if (!sourceVariant || sourceVariant.status !== 'completed' || !sourceVariant.image_key) {
      throw new ValidationError('Source variant must be completed with an image');
    }

    const sourceAsset = await this.repo.getAssetById(sourceVariant.asset_id);
    if (!sourceAsset) throw new NotFoundError('Source asset not found');

    const directions = ROTATION_DIRECTIONS[msg.config];
    if (!directions) throw new ValidationError(`Invalid rotation config: ${msg.config}`);

    const layout = ROTATION_GRID_LAYOUTS[msg.config];
    if (!layout) throw new ValidationError(`No grid layout for config: ${msg.config}`);

    const cellSize = 256;
    const canvasW = layout.cols * cellSize;
    const canvasH = layout.rows * cellSize;

    // Create child asset
    const rotationAssetId = crypto.randomUUID();
    const rotationAsset = await this.repo.createAsset({
      id: rotationAssetId,
      name: `${sourceAsset.name} — Rotation (single-shot)`,
      type: sourceAsset.type,
      tags: [],
      parentAssetId: sourceAsset.id,
      createdBy: meta.userId,
    });
    this.broadcast({ type: 'asset:created', asset: rotationAsset });

    // Fork source variant
    const forkedVariantId = crypto.randomUUID();
    const now = Date.now();
    await this.sql.exec(
      `INSERT INTO variants (id, asset_id, workflow_id, status, error_message, image_key, thumb_key, recipe, starred, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      forkedVariantId, rotationAssetId, null, 'completed', null,
      sourceVariant.image_key, sourceVariant.thumb_key, sourceVariant.recipe,
      0, meta.userId, now, now
    );

    if (sourceVariant.image_key) await this.sql.exec(INCREMENT_REF_SQL, sourceVariant.image_key);
    if (sourceVariant.thumb_key) await this.sql.exec(INCREMENT_REF_SQL, sourceVariant.thumb_key);

    const lineage = await this.repo.createLineage({
      id: crypto.randomUUID(),
      parentVariantId: msg.sourceVariantId,
      childVariantId: forkedVariantId,
      relationType: 'forked',
    });

    await this.repo.updateAsset(rotationAssetId, { active_variant_id: forkedVariantId });
    rotationAsset.active_variant_id = forkedVariantId;

    const forkedVariant = await this.repo.getVariantById(forkedVariantId);
    if (forkedVariant) {
      this.broadcast({ type: 'variant:created', variant: forkedVariant });
      this.broadcast({ type: 'asset:updated', asset: rotationAsset });
      this.broadcast({ type: 'lineage:created', lineage });
    }

    // Create rotation set
    const rotationSetId = crypto.randomUUID();
    const subject = msg.subjectDescription || sourceVariant.description || sourceAsset.name || 'the subject';
    const configJson = JSON.stringify({
      type: msg.config,
      subjectDescription: msg.subjectDescription,
      aspectRatio: msg.aspectRatio,
      disableStyle: msg.disableStyle,
      generationMode: 'single-shot',
      cellSize,
    });

    await this.repo.createRotationSet({
      id: rotationSetId,
      assetId: rotationAssetId,
      sourceVariantId: msg.sourceVariantId,
      config: configJson,
      totalSteps: directions.length,
      createdBy: meta.userId,
    });

    this.broadcast({
      type: 'rotation:started',
      requestId: msg.requestId,
      rotationSetId,
      assetId: rotationAssetId,
      totalSteps: directions.length,
      directions,
    });

    // Build sprite sheet prompt
    const { styleKeys, styleDescription } = await getStyleImageKeys(this.repo, msg.disableStyle);

    const directionDescs = layout.directions.map((dir, i) => {
      const col = i % layout.cols;
      const row = Math.floor(i / layout.cols);
      const spec = ROTATION_CAMERA_SPECS[dir] || dir;
      return `Cell (row ${row + 1}, col ${col + 1}): ${dir} view — ${spec}`;
    }).join('\n');

    const promptParts = [
      `A multi-view character reference sheet of ${subject}.`,
      `Canvas: ${canvasW}px wide x ${canvasH}px tall.`,
      `Grid: ${layout.rows} row(s) x ${layout.cols} columns. Each view: ${cellSize}x${cellSize}px.`,
      `Background: Plain solid color.`,
      `Direction rule:`,
      directionDescs,
      `The reference image shows the character. Generate the EXACT SAME character from each specified angle.`,
      `CRITICAL: IDENTICAL design, proportions, colors, clothing across ALL views.`,
      styleDescription ? `[Style: ${styleDescription}]` : '',
      NEGATIVE_PROMPTS.characters,
    ].filter(Boolean).join('\n');

    const prompt = promptParts;

    // Create placeholder variant for the sprite sheet
    const variantId = crypto.randomUUID();
    const recipe = JSON.stringify({
      prompt,
      assetType: sourceAsset.type || 'character',
      aspectRatio: msg.aspectRatio,
      sourceImageKeys: [sourceVariant.image_key, ...styleKeys],
      operation: 'derive',
      generationMode: 'single-shot',
      gridLayout: layout,
      cellSize,
    });

    const variant = await this.repo.createPlaceholderVariant({
      id: variantId,
      assetId: rotationAssetId,
      recipe,
      createdBy: meta.userId,
    });
    this.broadcast({ type: 'variant:created', variant });

    // Trigger workflow
    if (this.env.GENERATION_WORKFLOW) {
      try {
        const workflowInput: GenerationWorkflowInput = {
          requestId: msg.requestId,
          jobId: variantId,
          spaceId: this.spaceId,
          userId: meta.userId,
          prompt,
          assetId: rotationAssetId,
          assetName: `${subject} — Sprite Sheet`,
          assetType: sourceAsset.type || 'character',
          aspectRatio: msg.aspectRatio,
          sourceImageKeys: [sourceVariant.image_key, ...styleKeys],
          operation: 'derive',
        };

        const instance = await this.env.GENERATION_WORKFLOW.create({
          id: variantId,
          params: workflowInput,
        });

        const updatedVariant = await this.repo.updateVariantWorkflow(variantId, instance.id, 'processing');
        if (updatedVariant) {
          this.broadcast({ type: 'variant:updated', variant: updatedVariant });
        }
      } catch (err) {
        log.error('Failed to create single-shot rotation workflow', { rotationSetId, error: String(err) });
        await this.repo.failRotationSet(rotationSetId, `Workflow creation failed: ${String(err)}`);
        this.broadcast({ type: 'rotation:failed', rotationSetId, error: String(err), failedStep: 0 });
      }
    }

    log.info('Single-shot rotation started', {
      spaceId: this.spaceId,
      rotationSetId,
      config: msg.config,
      totalSteps: directions.length,
    });
  }

  /**
   * Slice a completed single-shot sprite sheet into individual rotation view variants.
   * Called from the GenerationController completion hook when a single-shot
   * sheet variant finishes generating.
   */
  async sliceSingleShotSheet(variant: Variant): Promise<void> {
    if (!variant.image_key) return;

    const recipe = JSON.parse(variant.recipe);
    const layout = recipe.gridLayout as { rows: number; cols: number; directions: string[] } | undefined;
    if (!layout) return;

    const rotationSet = await this.repo.getRotationSetByAssetId(variant.asset_id);
    if (!rotationSet) return;

    const isLocal = !this.env.ENVIRONMENT || this.env.ENVIRONMENT === 'local' || this.env.ENVIRONMENT === 'development';

    // Get actual image dimensions for accurate slicing
    let imageWidth: number;
    let imageHeight: number;

    if (!isLocal && this.env.IMAGES) {
      const imageObj = await this.env.IMAGES.get(variant.image_key);
      if (!imageObj) {
        log.error('Sheet image not found in R2', { variantId: variant.id, imageKey: variant.image_key });
        return;
      }
      const buffer = new Uint8Array(await imageObj.arrayBuffer());
      const dims = getImageDimensions(buffer);
      if (!dims) {
        log.error('Cannot determine sheet image dimensions', { variantId: variant.id });
        return;
      }
      imageWidth = dims.width;
      imageHeight = dims.height;
    } else {
      const cellSize = recipe.cellSize || 256;
      imageWidth = layout.cols * cellSize;
      imageHeight = layout.rows * cellSize;
    }

    const baseUrl = getBaseUrl(this.env);

    for (let i = 0; i < layout.directions.length; i++) {
      const direction = layout.directions[i];
      const col = i % layout.cols;
      const row = Math.floor(i / layout.cols);

      const cellVariantId = crypto.randomUUID();
      let cellImageKey: string;
      let cellThumbKey: string;

      if (isLocal) {
        // Local dev: all cells reference the sheet image (frontend uses CSS)
        cellImageKey = variant.image_key;
        cellThumbKey = variant.thumb_key || variant.image_key;
        await this.sql.exec(INCREMENT_REF_SQL, cellImageKey);
        if (variant.thumb_key) await this.sql.exec(INCREMENT_REF_SQL, variant.thumb_key);
      } else {
        // Production: slice using CF Image Resizing
        const sheetImageUrl = `${baseUrl}/api/images/${variant.image_key}`;
        const { buffer, mimeType } = await sliceGridCell(
          sheetImageUrl, col, row, layout.cols, layout.rows, imageWidth, imageHeight
        );

        const ext = getExtensionForMimeType(mimeType as ImageMimeType);
        cellImageKey = `images/${this.spaceId}/${cellVariantId}.${ext}`;
        cellThumbKey = cellImageKey;

        await this.env.IMAGES!.put(cellImageKey, buffer, {
          httpMetadata: { contentType: mimeType },
        });
      }

      // Create completed variant for this view
      const cellRecipe = JSON.stringify({
        ...recipe,
        slicedFromSheet: true,
        direction,
        gridCol: col,
        gridRow: row,
        sheetVariantId: variant.id,
      });

      await this.repo.createPlaceholderVariant({
        id: cellVariantId,
        assetId: rotationSet.asset_id,
        recipe: cellRecipe,
        createdBy: rotationSet.created_by,
      });

      const completedVariant = await this.repo.completeVariant(cellVariantId, cellImageKey, cellThumbKey);
      if (completedVariant) {
        this.broadcast({ type: 'variant:created', variant: completedVariant });
      }

      // Register as rotation view (step 0..N-1, since no pre-registered forked view in single-shot)
      await this.repo.createRotationView({
        id: crypto.randomUUID(),
        rotationSetId: rotationSet.id,
        variantId: cellVariantId,
        direction,
        stepIndex: i,
      });

      this.broadcast({
        type: 'rotation:step_completed',
        rotationSetId: rotationSet.id,
        direction,
        variantId: cellVariantId,
        step: i,
        total: rotationSet.total_steps,
      });
    }

    // Mark rotation set as completed
    await this.repo.updateRotationSetStatus(rotationSet.id, 'completed');
    const allViews = await this.repo.getRotationViewsBySet(rotationSet.id);
    this.broadcast({
      type: 'rotation:completed',
      rotationSetId: rotationSet.id,
      views: allViews,
    });

    log.info('Single-shot rotation sheet sliced', {
      rotationSetId: rotationSet.id,
      totalViews: layout.directions.length,
    });
  }
}
