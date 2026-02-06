/**
 * Rotation Controller
 *
 * Handles multi-directional character sprite generation.
 * Creates a sequential pipeline where each view's completion triggers the next
 * via the GenerationController's httpCompleteVariant() hook.
 */

import type {
  RotationConfig,
  RotationView,
  WebSocketMeta,
} from '../types';
import { ROTATION_DIRECTIONS } from '../types';
import type { GenerationWorkflowInput } from '../../../workflows/types';
import { BaseController, type ControllerContext, NotFoundError, ValidationError } from './types';
import { INCREMENT_REF_SQL } from '../variant/imageRefs';
import { capRefs, getStyleImageKeys } from '../generation/refLimits';
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
    }
  ): Promise<void> {
    this.requireEditor(meta);

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
    const sourceKey = completedViews[0]?.image_key || '';
    const cappedKeys = capRefs(styleKeys, viewImageKeys, sourceKey);

    // Build directional prompt
    const subject = config.subjectDescription
      || (await this.repo.getVariantById(set.source_variant_id))?.description
      || (await this.repo.getAssetById(set.asset_id))?.name
      || 'the subject';

    let prompt = '';
    if (styleDescription) {
      prompt += `[Style: ${styleDescription}]\n\n`;
    }
    prompt += `You are creating a consistent multi-view character reference sheet.\n`;
    prompt += `The reference images show the same subject from previously generated angles.\n`;
    for (let i = 0; i < completedViews.length; i++) {
      prompt += `Image ${i + 1}: ${subject} ${completedViews[i].direction} view\n`;
    }
    prompt += `\nGenerate: Show the EXACT SAME ${subject} from the ${direction} view.\n`;
    prompt += `- Maintain identical design, proportions, colors, clothing, and style\n`;
    prompt += `- Keep the same level of detail and artistic rendering\n`;
    prompt += `- Neutral standing/display pose\n`;
    prompt += `- Plain background\n`;
    prompt += `- Match the exact art style of all reference images`;

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
}
