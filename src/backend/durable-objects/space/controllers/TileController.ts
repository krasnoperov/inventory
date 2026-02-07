/**
 * Tile Controller
 *
 * Handles seamless tile map generation.
 * Creates a sequential pipeline spiraling from center outward,
 * where each tile's completion triggers the next via the completion hook.
 */

import type {
  TileType,
  TilePosition,
  WebSocketMeta,
} from '../types';
import type { GenerationWorkflowInput } from '../../../workflows/types';
import { BaseController, type ControllerContext, NotFoundError, ValidationError } from './types';
import { INCREMENT_REF_SQL } from '../variant/imageRefs';
import { capRefs, getStyleImageKeys } from '../generation/refLimits';
import { getSpiralOrder } from '../generation/spiralOrder';
import { loggers } from '../../../../shared/logger';

const log = loggers.tileController;

export class TileController extends BaseController {
  constructor(ctx: ControllerContext) {
    super(ctx);
  }

  /**
   * Handle tileset:request WebSocket message.
   * Creates a parent asset and starts sequential tile generation from center outward.
   */
  async handleTileSetRequest(
    ws: WebSocket,
    meta: WebSocketMeta,
    msg: {
      type: 'tileset:request';
      requestId: string;
      tileType: TileType;
      gridWidth: number;
      gridHeight: number;
      prompt: string;
      seedVariantId?: string;
      aspectRatio?: string;
      disableStyle?: boolean;
    }
  ): Promise<void> {
    this.requireEditor(meta);

    // Validate grid size
    if (msg.gridWidth < 2 || msg.gridWidth > 5 || msg.gridHeight < 2 || msg.gridHeight > 5) {
      throw new ValidationError('Grid size must be between 2 and 5');
    }

    const validTileTypes: TileType[] = ['terrain', 'building', 'decoration', 'custom'];
    if (!validTileTypes.includes(msg.tileType)) {
      throw new ValidationError(`Invalid tile type: ${msg.tileType}`);
    }

    const spiralOrder = getSpiralOrder(msg.gridWidth, msg.gridHeight);
    const totalTiles = msg.gridWidth * msg.gridHeight;

    // Create parent asset for the tile set
    const tileAssetId = crypto.randomUUID();
    const promptSummary = msg.prompt.length > 40 ? msg.prompt.slice(0, 40) + '...' : msg.prompt;
    const tileAsset = await this.repo.createAsset({
      id: tileAssetId,
      name: `${promptSummary} — Tile Set`,
      type: 'tile-set',
      tags: [],
      createdBy: meta.userId,
    });
    this.broadcast({ type: 'asset:created', asset: tileAsset });

    // Create tile_sets record
    const tileSetId = crypto.randomUUID();
    const configJson = JSON.stringify({
      prompt: msg.prompt,
      aspectRatio: msg.aspectRatio,
      disableStyle: msg.disableStyle,
      spiralOrder,
    });

    await this.repo.createTileSet({
      id: tileSetId,
      assetId: tileAssetId,
      tileType: msg.tileType,
      gridWidth: msg.gridWidth,
      gridHeight: msg.gridHeight,
      seedVariantId: msg.seedVariantId,
      config: configJson,
      totalSteps: totalTiles,
      createdBy: meta.userId,
    });

    // Broadcast tileset:started
    this.broadcast({
      type: 'tileset:started',
      requestId: msg.requestId,
      tileSetId,
      assetId: tileAssetId,
      gridWidth: msg.gridWidth,
      gridHeight: msg.gridHeight,
      totalTiles,
    });

    const [centerX, centerY] = spiralOrder[0];

    if (msg.seedVariantId) {
      // Fork seed variant to center position
      const seedVariant = await this.repo.getVariantById(msg.seedVariantId);
      if (!seedVariant || seedVariant.status !== 'completed' || !seedVariant.image_key) {
        throw new ValidationError('Seed variant must be completed with an image');
      }

      const forkedVariantId = crypto.randomUUID();
      const now = Date.now();
      await this.sql.exec(
        `INSERT INTO variants (id, asset_id, workflow_id, status, error_message, image_key, thumb_key, recipe, starred, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        forkedVariantId,
        tileAssetId,
        null,
        'completed',
        null,
        seedVariant.image_key,
        seedVariant.thumb_key,
        seedVariant.recipe,
        0,
        meta.userId,
        now,
        now
      );

      if (seedVariant.image_key) await this.sql.exec(INCREMENT_REF_SQL, seedVariant.image_key);
      if (seedVariant.thumb_key) await this.sql.exec(INCREMENT_REF_SQL, seedVariant.thumb_key);

      // Create forked lineage
      const lineage = await this.repo.createLineage({
        id: crypto.randomUUID(),
        parentVariantId: msg.seedVariantId,
        childVariantId: forkedVariantId,
        relationType: 'forked',
      });

      const forkedVariant = await this.repo.getVariantById(forkedVariantId);
      if (forkedVariant) {
        this.broadcast({ type: 'variant:created', variant: forkedVariant });
        this.broadcast({ type: 'lineage:created', lineage });
      }

      // Register at center position
      await this.repo.createTilePosition({
        id: crypto.randomUUID(),
        tileSetId,
        variantId: forkedVariantId,
        gridX: centerX,
        gridY: centerY,
      });

      // Advance to next tile
      await this.advanceTileSet(tileSetId);
    } else {
      // No seed — generate center tile from scratch
      await this.generateTileAtPosition(tileSetId, centerX, centerY, meta.userId);
    }

    log.info('Tile set pipeline started', {
      spaceId: this.spaceId,
      tileSetId,
      tileType: msg.tileType,
      gridSize: `${msg.gridWidth}x${msg.gridHeight}`,
      totalTiles,
      hasSeed: !!msg.seedVariantId,
    });
  }

  /**
   * Advance the tile set pipeline to the next position.
   * Called after each tile completes via the completion hook.
   */
  async advanceTileSet(tileSetId: string): Promise<void> {
    const set = await this.repo.getTileSetById(tileSetId);
    if (!set) return;
    if (set.status === 'cancelled' || set.status === 'failed') return;

    const config = JSON.parse(set.config) as {
      prompt: string;
      aspectRatio?: string;
      disableStyle?: boolean;
      spiralOrder: [number, number][];
    };

    // Count completed positions
    const completedPositions = await this.repo.getTilePositionsBySet(tileSetId);
    const completedSet = new Set(completedPositions.map(p => `${p.grid_x},${p.grid_y}`));
    const completedCount = completedPositions.length;

    // All tiles done?
    if (completedCount >= set.total_steps) {
      await this.repo.updateTileSetStatus(tileSetId, 'completed');
      const allPositions = await this.repo.getTilePositionsBySet(tileSetId);
      this.broadcast({
        type: 'tileset:completed',
        tileSetId,
        positions: allPositions,
      });
      log.info('Tile set pipeline completed', { tileSetId, totalTiles: completedCount });
      return;
    }

    // Find next unoccupied position in spiral order
    const nextPos = config.spiralOrder.find(([x, y]) => !completedSet.has(`${x},${y}`));
    if (!nextPos) {
      // Shouldn't happen, but handle gracefully
      await this.repo.updateTileSetStatus(tileSetId, 'completed');
      return;
    }

    const [nextX, nextY] = nextPos;

    // Generate tile at next position
    await this.generateTileAtPosition(tileSetId, nextX, nextY, set.created_by);

    // Update step counter
    await this.repo.updateTileSetStep(tileSetId, completedCount);
  }

  /**
   * Generate a tile at a specific grid position.
   */
  private async generateTileAtPosition(
    tileSetId: string,
    gridX: number,
    gridY: number,
    userId: string
  ): Promise<void> {
    const set = await this.repo.getTileSetById(tileSetId);
    if (!set) return;

    const config = JSON.parse(set.config) as {
      prompt: string;
      aspectRatio?: string;
      disableStyle?: boolean;
    };

    // Get adjacent completed tiles
    const adjacents = await this.repo.getAdjacentTiles(tileSetId, gridX, gridY);

    // Get style refs (no-op until Tier 1)
    const { styleKeys, styleDescription } = await getStyleImageKeys(this.repo, config.disableStyle);

    // Collect adjacent image keys
    const adjacentKeys = adjacents.map(a => a.image_key);
    const cappedKeys = capRefs(styleKeys, adjacentKeys, adjacentKeys[0] || '');

    // Build adjacency-aware prompt
    let prompt = '';
    if (styleDescription) {
      prompt += `[Style: ${styleDescription}]\n\n`;
    }
    prompt += `Create an isometric ${set.tile_type} game tile for a seamless tile map.\n`;
    prompt += `Theme: ${config.prompt}\n\n`;

    if (adjacents.length > 0) {
      prompt += `The following reference images are adjacent tiles that this new tile must connect to seamlessly:\n`;
      for (let i = 0; i < adjacents.length; i++) {
        prompt += `Image ${i + 1}: tile to the ${adjacents[i].direction}\n`;
      }
      prompt += `\nCRITICAL: The edges facing these adjacent tiles must match perfectly — same ground level, same terrain features, same color palette at the boundary. The transition should be invisible.\n\n`;
    } else {
      prompt += `This is the seed tile. It should have edges that are designed to be extended in all four cardinal directions.\n\n`;
    }

    prompt += `- Consistent isometric perspective (standard 2:1 ratio)\n`;
    prompt += `- Clean edges suitable for seamless tiling\n`;
    prompt += `- ${set.tile_type}-appropriate content`;

    // Create placeholder variant
    const variantId = crypto.randomUUID();
    const recipe = JSON.stringify({
      prompt,
      assetType: 'tile-set',
      aspectRatio: config.aspectRatio || '1:1',
      sourceImageKeys: [...styleKeys, ...cappedKeys],
      operation: 'derive',
    });

    const variant = await this.repo.createPlaceholderVariant({
      id: variantId,
      assetId: set.asset_id,
      recipe,
      createdBy: userId,
    });
    this.broadcast({ type: 'variant:created', variant });

    // Register tile position
    await this.repo.createTilePosition({
      id: crypto.randomUUID(),
      tileSetId,
      variantId,
      gridX,
      gridY,
    });

    // Trigger GenerationWorkflow
    if (this.env.GENERATION_WORKFLOW) {
      try {
        const workflowInput: GenerationWorkflowInput = {
          requestId: crypto.randomUUID(),
          jobId: variantId,
          spaceId: this.spaceId,
          userId,
          prompt,
          assetId: set.asset_id,
          assetName: `Tile (${gridX},${gridY})`,
          assetType: 'tile-set',
          aspectRatio: config.aspectRatio || '1:1',
          sourceImageKeys: cappedKeys.length > 0 ? [...styleKeys, ...cappedKeys] : undefined,
          operation: adjacents.length > 0 ? 'derive' : 'generate',
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
        log.error('Failed to create tile workflow', { tileSetId, variantId, gridX, gridY, error: String(err) });
        await this.repo.failTileSet(tileSetId, `Workflow creation failed: ${String(err)}`);
        this.broadcast({ type: 'tileset:failed', tileSetId, error: String(err), failedStep: (await this.repo.getTilePositionsBySet(tileSetId)).length });
        return;
      }
    }

    // Broadcast tile progress
    this.broadcast({
      type: 'tileset:tile_completed',
      tileSetId,
      variantId,
      gridX,
      gridY,
      step: (await this.repo.getTilePositionsBySet(tileSetId)).length,
      total: set.total_steps,
    });

    log.info('Tile step triggered', {
      tileSetId,
      gridX,
      gridY,
      variantId,
      adjacentCount: adjacents.length,
    });
  }

  /**
   * Handle tileset:cancel WebSocket message.
   */
  async handleTileSetCancel(
    ws: WebSocket,
    meta: WebSocketMeta,
    tileSetId: string
  ): Promise<void> {
    this.requireEditor(meta);

    const set = await this.repo.getTileSetById(tileSetId);
    if (!set) {
      throw new NotFoundError('Tile set not found');
    }

    await this.repo.cancelTileSet(tileSetId);
    this.broadcast({ type: 'tileset:cancelled', tileSetId });

    log.info('Tile set pipeline cancelled', { tileSetId });
  }
}
