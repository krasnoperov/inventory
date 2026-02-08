/**
 * Tile Controller
 *
 * Handles seamless tile map generation.
 * Creates a sequential pipeline spiraling from center outward,
 * where each tile's completion triggers the next via the completion hook.
 */

import type {
  TileType,
  Variant,
  WebSocketMeta,
} from '../types';
import type { GenerationWorkflowInput } from '../../../workflows/types';
import { BaseController, type ControllerContext, NotFoundError, ValidationError } from './types';
import { INCREMENT_REF_SQL } from '../variant/imageRefs';
import { capRefs, getStyleImageKeys } from '../generation/refLimits';
import { getSpiralOrder } from '../generation/spiralOrder';
import { PromptBuilder, NEGATIVE_PROMPTS } from '../generation/PromptBuilder';
import { sliceGridCell } from '../generation/gridSlice';
import {
  getBaseUrl,
  getImageDimensions,
  getExtensionForMimeType,
  type ImageMimeType,
} from '../../../utils/image-utils';
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
      generationMode?: 'sequential' | 'single-shot';
    }
  ): Promise<void> {
    this.requireEditor(meta);

    // Route to single-shot mode if requested
    if (msg.generationMode === 'single-shot') {
      return this.handleSingleShotTileSet(ws, meta, msg);
    }

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
      aspectRatio: msg.aspectRatio || '1:1',
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
   * Called after each tile completes or fails via the completion/failure hook.
   * Skips failed positions and continues to the next one.
   */
  async advanceTileSet(tileSetId: string): Promise<void> {
    const set = await this.repo.getTileSetById(tileSetId);
    if (!set) return;
    if (set.status === 'cancelled') return;

    const config = JSON.parse(set.config) as {
      prompt: string;
      aspectRatio?: string;
      disableStyle?: boolean;
      spiralOrder: [number, number][];
    };

    // Get all positions (completed + failed + generating)
    const allPositions = await this.repo.getTilePositionsBySet(tileSetId);
    const occupiedSet = new Set(allPositions.map(p => `${p.grid_x},${p.grid_y}`));
    const completedCount = allPositions.filter(p => {
      // A position is "done" if it exists and its variant is completed, or it is marked failed
      return p.status === 'completed' || p.status === 'failed';
    }).length;

    // All positions accounted for (completed or failed)?
    if (completedCount >= set.total_steps) {
      await this.repo.updateTileSetStatus(tileSetId, 'completed');
      this.broadcast({
        type: 'tileset:completed',
        tileSetId,
        positions: allPositions,
      });
      log.info('Tile set pipeline completed', { tileSetId, totalTiles: completedCount });
      return;
    }

    // Find next unoccupied position in spiral order (skip occupied = completed, failed, generating)
    const nextPos = config.spiralOrder.find(([x, y]) => !occupiedSet.has(`${x},${y}`));
    if (!nextPos) {
      // All positions occupied — check if we're just waiting for generating ones
      const generatingCount = allPositions.filter(p => p.status === 'pending' || p.status === 'generating').length;
      if (generatingCount === 0) {
        await this.repo.updateTileSetStatus(tileSetId, 'completed');
        this.broadcast({ type: 'tileset:completed', tileSetId, positions: allPositions });
      }
      return;
    }

    const [nextX, nextY] = nextPos;

    // Generate tile at next position
    await this.generateTileAtPosition(tileSetId, nextX, nextY, set.created_by);

    // Update step counter
    await this.repo.updateTileSetStep(tileSetId, completedCount);
  }

  /**
   * Handle tileset:retry_tile WebSocket message.
   * Retries generation for a single failed tile position.
   */
  async handleRetryTile(
    ws: WebSocket,
    meta: WebSocketMeta,
    msg: { type: 'tileset:retry_tile'; tileSetId: string; gridX: number; gridY: number }
  ): Promise<void> {
    this.requireEditor(meta);

    const set = await this.repo.getTileSetById(msg.tileSetId);
    if (!set) throw new NotFoundError('Tile set not found');

    const pos = await this.repo.getTilePositionAt(msg.tileSetId, msg.gridX, msg.gridY);
    if (!pos) throw new NotFoundError('Tile position not found');
    if (pos.status !== 'failed') throw new ValidationError('Can only retry failed tiles');

    // Delete the old failed position entry so a new one can be created
    await this.sql.exec(`DELETE FROM tile_positions WHERE id = ?`, pos.id);

    // Also delete the failed variant
    await this.sql.exec(`DELETE FROM variants WHERE id = ?`, pos.variant_id);
    this.broadcast({ type: 'variant:deleted', variantId: pos.variant_id });

    // Generate a new tile at this position
    await this.generateTileAtPosition(msg.tileSetId, msg.gridX, msg.gridY, meta.userId);

    log.info('Retrying failed tile', {
      tileSetId: msg.tileSetId,
      gridX: msg.gridX,
      gridY: msg.gridY,
    });
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
    const builder = new PromptBuilder();
    if (styleDescription) {
      builder.withStyle(styleDescription);
    }
    builder
      .withTileContext(adjacents, set.tile_type as TileType)
      .withTheme(config.prompt);
    const prompt = builder.build();

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

  /**
   * Handle single-shot tile set generation.
   * Generates the entire grid as one image, then slices into individual tiles.
   */
  async handleSingleShotTileSet(
    ws: WebSocket,
    meta: WebSocketMeta,
    msg: {
      type: 'tileset:request';
      requestId: string;
      tileType: TileType;
      gridWidth: number;
      gridHeight: number;
      prompt: string;
      aspectRatio?: string;
      disableStyle?: boolean;
    }
  ): Promise<void> {
    this.requireEditor(meta);

    if (msg.gridWidth < 2 || msg.gridWidth > 5 || msg.gridHeight < 2 || msg.gridHeight > 5) {
      throw new ValidationError('Grid size must be between 2 and 5');
    }

    const totalTiles = msg.gridWidth * msg.gridHeight;
    const cellSize = 256; // Default cell size for single-shot grid

    // Create parent asset
    const tileAssetId = crypto.randomUUID();
    const promptSummary = msg.prompt.length > 40 ? msg.prompt.slice(0, 40) + '...' : msg.prompt;
    const tileAsset = await this.repo.createAsset({
      id: tileAssetId,
      name: `${promptSummary} — Tile Set (single-shot)`,
      type: 'tile-set',
      tags: [],
      createdBy: meta.userId,
    });
    this.broadcast({ type: 'asset:created', asset: tileAsset });

    // Create tile_sets record
    const tileSetId = crypto.randomUUID();
    const configJson = JSON.stringify({
      prompt: msg.prompt,
      aspectRatio: msg.aspectRatio || '1:1',
      disableStyle: msg.disableStyle,
      generationMode: 'single-shot',
      cellSize,
    });

    await this.repo.createTileSet({
      id: tileSetId,
      assetId: tileAssetId,
      tileType: msg.tileType,
      gridWidth: msg.gridWidth,
      gridHeight: msg.gridHeight,
      config: configJson,
      totalSteps: totalTiles,
      createdBy: meta.userId,
    });

    this.broadcast({
      type: 'tileset:started',
      requestId: msg.requestId,
      tileSetId,
      assetId: tileAssetId,
      gridWidth: msg.gridWidth,
      gridHeight: msg.gridHeight,
      totalTiles,
    });

    // Build single-shot prompt
    const canvasW = msg.gridWidth * cellSize;
    const canvasH = msg.gridHeight * cellSize;

    const { styleKeys, styleDescription } = await getStyleImageKeys(this.repo, msg.disableStyle);

    const builder = new PromptBuilder();
    if (styleDescription) {
      builder.withStyle(styleDescription);
    }

    const gridPrompt = [
      `A seamless ${msg.tileType} tile set grid for an isometric game.`,
      `Canvas: ${canvasW}px wide x ${canvasH}px tall.`,
      `Grid: ${msg.gridHeight} rows x ${msg.gridWidth} columns. Each tile: ${cellSize}x${cellSize}px.`,
      `Theme: ${msg.prompt}`,
      `CRITICAL: All tiles must seamlessly connect at their edges.`,
      `Consistent isometric perspective. Clean pixel boundaries between cells.`,
      NEGATIVE_PROMPTS.tiles,
    ].join('\n');

    builder.withTheme(gridPrompt);
    const prompt = builder.build();

    // Create a single placeholder variant for the grid image
    const variantId = crypto.randomUUID();
    const recipe = JSON.stringify({
      prompt,
      assetType: 'tile-set',
      aspectRatio: msg.aspectRatio || '1:1',
      sourceImageKeys: styleKeys,
      operation: 'generate',
      generationMode: 'single-shot',
      gridWidth: msg.gridWidth,
      gridHeight: msg.gridHeight,
      cellSize,
    });

    const variant = await this.repo.createPlaceholderVariant({
      id: variantId,
      assetId: tileAssetId,
      recipe,
      createdBy: meta.userId,
    });
    this.broadcast({ type: 'variant:created', variant });

    // Trigger workflow for the single grid image
    if (this.env.GENERATION_WORKFLOW) {
      try {
        const workflowInput: GenerationWorkflowInput = {
          requestId: msg.requestId,
          jobId: variantId,
          spaceId: this.spaceId,
          userId: meta.userId,
          prompt,
          assetId: tileAssetId,
          assetName: `Grid — ${msg.gridWidth}x${msg.gridHeight}`,
          assetType: 'tile-set',
          aspectRatio: msg.aspectRatio || '1:1',
          sourceImageKeys: styleKeys.length > 0 ? styleKeys : undefined,
          operation: 'generate',
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
        log.error('Failed to create single-shot tile workflow', { tileSetId, error: String(err) });
        await this.repo.failTileSet(tileSetId, `Workflow creation failed: ${String(err)}`);
        this.broadcast({ type: 'tileset:failed', tileSetId, error: String(err), failedStep: 0 });
      }
    }

    log.info('Single-shot tile set started', {
      spaceId: this.spaceId,
      tileSetId,
      gridSize: `${msg.gridWidth}x${msg.gridHeight}`,
      totalTiles,
    });
  }

  /**
   * Handle tileset:refine_edges WebSocket message.
   * Post-processing pass that refines tile edges for seamless blending.
   */
  async handleRefineEdges(
    ws: WebSocket,
    meta: WebSocketMeta,
    msg: { type: 'tileset:refine_edges'; tileSetId: string }
  ): Promise<void> {
    this.requireEditor(meta);

    const set = await this.repo.getTileSetById(msg.tileSetId);
    if (!set) throw new NotFoundError('Tile set not found');
    if (set.status !== 'completed') throw new ValidationError('Tile set must be completed before refining edges');

    const positions = await this.repo.getTilePositionsBySet(msg.tileSetId);

    // Refine each non-edge-only tile (tiles with at least one adjacent neighbor)
    for (const pos of positions) {
      await this.refineSingleTileEdge(msg.tileSetId, pos.grid_x, pos.grid_y, meta.userId);
    }

    log.info('Edge refinement started for all tiles', { tileSetId: msg.tileSetId, tileCount: positions.length });
  }

  /**
   * Handle tileset:refine_tile WebSocket message.
   * Refines edges of a single tile.
   */
  async handleRefineTile(
    ws: WebSocket,
    meta: WebSocketMeta,
    msg: { type: 'tileset:refine_tile'; tileSetId: string; gridX: number; gridY: number }
  ): Promise<void> {
    this.requireEditor(meta);

    const set = await this.repo.getTileSetById(msg.tileSetId);
    if (!set) throw new NotFoundError('Tile set not found');

    await this.refineSingleTileEdge(msg.tileSetId, msg.gridX, msg.gridY, meta.userId);
  }

  /**
   * Refine a single tile's edges by composing it with adjacent tiles.
   */
  private async refineSingleTileEdge(
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

    // Get the tile variant
    const pos = await this.repo.getTilePositionAt(tileSetId, gridX, gridY);
    if (!pos) return;

    const tileVariant = await this.repo.getVariantById(pos.variant_id);
    if (!tileVariant?.image_key) return;

    // Get adjacent completed tiles
    const adjacents = await this.repo.getAdjacentTiles(tileSetId, gridX, gridY);
    if (adjacents.length === 0) return; // No neighbors to blend with

    const { styleKeys, styleDescription } = await getStyleImageKeys(this.repo, config.disableStyle);

    // Build compose prompt with tile + adjacents
    const allKeys = [tileVariant.image_key, ...adjacents.map(a => a.image_key)];
    const cappedKeys = capRefs(styleKeys, allKeys, tileVariant.image_key);

    const refLabels = adjacents.map((a, i) => `Image ${i + 2}: adjacent tile to the ${a.direction}`).join('\n');
    const prompt = [
      `Image 1: the tile to refine`,
      refLabels,
      `Refine Image 1 so its edges seamlessly match the adjacent tiles.`,
      `Blend colors, textures, and features at the boundaries.`,
      `Keep the interior of the tile unchanged.`,
      styleDescription ? `[Style: ${styleDescription}]` : '',
    ].filter(Boolean).join('\n');

    // Create placeholder variant for refined tile
    const variantId = crypto.randomUUID();
    const recipe = JSON.stringify({
      prompt,
      assetType: 'tile-set',
      aspectRatio: config.aspectRatio || '1:1',
      sourceImageKeys: [...styleKeys, ...cappedKeys],
      operation: 'refine',
    });

    const variant = await this.repo.createPlaceholderVariant({
      id: variantId,
      assetId: set.asset_id,
      recipe,
      createdBy: userId,
    });
    this.broadcast({ type: 'variant:created', variant });

    // Update tile position to point to new variant
    await this.sql.exec(
      `UPDATE tile_positions SET variant_id = ? WHERE id = ?`,
      variantId,
      pos.id
    );

    // Trigger workflow
    if (this.env.GENERATION_WORKFLOW) {
      try {
        const workflowInput: GenerationWorkflowInput = {
          requestId: crypto.randomUUID(),
          jobId: variantId,
          spaceId: this.spaceId,
          userId,
          prompt,
          assetId: set.asset_id,
          assetName: `Tile (${gridX},${gridY}) — refined`,
          assetType: 'tile-set',
          aspectRatio: config.aspectRatio || '1:1',
          sourceImageKeys: [...styleKeys, ...cappedKeys],
          operation: 'refine',
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
        log.error('Failed to create edge refinement workflow', {
          tileSetId,
          gridX,
          gridY,
          error: String(err),
        });
      }
    }
  }

  /**
   * Slice a completed single-shot grid image into individual tile variants.
   * Called from the GenerationController completion hook when a single-shot
   * grid variant finishes generating.
   */
  async sliceSingleShotGrid(variant: Variant): Promise<void> {
    if (!variant.image_key) return;

    const recipe = JSON.parse(variant.recipe);
    const { gridWidth, gridHeight } = recipe;
    if (!gridWidth || !gridHeight) return;

    const tileSet = await this.repo.getTileSetByAssetId(variant.asset_id);
    if (!tileSet) return;

    const isLocal = !this.env.ENVIRONMENT || this.env.ENVIRONMENT === 'local' || this.env.ENVIRONMENT === 'development';

    // Get actual image dimensions for accurate slicing
    let imageWidth: number;
    let imageHeight: number;

    if (!isLocal && this.env.IMAGES) {
      const imageObj = await this.env.IMAGES.get(variant.image_key);
      if (!imageObj) {
        log.error('Grid image not found in R2', { variantId: variant.id, imageKey: variant.image_key });
        return;
      }
      const buffer = new Uint8Array(await imageObj.arrayBuffer());
      const dims = getImageDimensions(buffer);
      if (!dims) {
        log.error('Cannot determine grid image dimensions', { variantId: variant.id });
        return;
      }
      imageWidth = dims.width;
      imageHeight = dims.height;
    } else {
      // Local dev: assume prompted dimensions
      const cellSize = recipe.cellSize || 256;
      imageWidth = gridWidth * cellSize;
      imageHeight = gridHeight * cellSize;
    }

    const baseUrl = getBaseUrl(this.env);

    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth; col++) {
        const cellVariantId = crypto.randomUUID();
        let cellImageKey: string;
        let cellThumbKey: string;

        if (isLocal) {
          // Local dev: all cells reference the grid image (frontend uses CSS background-position)
          cellImageKey = variant.image_key;
          cellThumbKey = variant.thumb_key || variant.image_key;
          await this.sql.exec(INCREMENT_REF_SQL, cellImageKey);
          if (variant.thumb_key) await this.sql.exec(INCREMENT_REF_SQL, variant.thumb_key);
        } else {
          // Production: slice the grid image using CF Image Resizing
          const gridImageUrl = `${baseUrl}/api/images/${variant.image_key}`;
          const { buffer, mimeType } = await sliceGridCell(
            gridImageUrl, col, row, gridWidth, gridHeight, imageWidth, imageHeight
          );

          const ext = getExtensionForMimeType(mimeType as ImageMimeType);
          cellImageKey = `images/${this.spaceId}/${cellVariantId}.${ext}`;
          cellThumbKey = cellImageKey; // Cell is small enough to be its own thumbnail

          await this.env.IMAGES!.put(cellImageKey, buffer, {
            httpMetadata: { contentType: mimeType },
          });
        }

        // Create completed variant for this cell
        const cellRecipe = JSON.stringify({
          ...recipe,
          slicedFromGrid: true,
          gridCol: col,
          gridRow: row,
          gridVariantId: variant.id,
        });

        await this.repo.createPlaceholderVariant({
          id: cellVariantId,
          assetId: tileSet.asset_id,
          recipe: cellRecipe,
          createdBy: tileSet.created_by,
        });

        const completedVariant = await this.repo.completeVariant(cellVariantId, cellImageKey, cellThumbKey);
        if (completedVariant) {
          this.broadcast({ type: 'variant:created', variant: completedVariant });
        }

        // Create tile position
        await this.repo.createTilePosition({
          id: crypto.randomUUID(),
          tileSetId: tileSet.id,
          variantId: cellVariantId,
          gridX: col,
          gridY: row,
        });

        // Mark position as completed
        const pos = await this.repo.getTilePositionAt(tileSet.id, col, row);
        if (pos) {
          await this.repo.updateTilePositionStatus(pos.id, 'completed');
        }

        this.broadcast({
          type: 'tileset:tile_completed',
          tileSetId: tileSet.id,
          variantId: cellVariantId,
          gridX: col,
          gridY: row,
          step: row * gridWidth + col + 1,
          total: tileSet.total_steps,
        });
      }
    }

    // Mark tile set as completed
    await this.repo.updateTileSetStatus(tileSet.id, 'completed');
    const allPositions = await this.repo.getTilePositionsBySet(tileSet.id);
    this.broadcast({
      type: 'tileset:completed',
      tileSetId: tileSet.id,
      positions: allPositions,
    });

    log.info('Single-shot tile grid sliced', {
      tileSetId: tileSet.id,
      gridSize: `${gridWidth}x${gridHeight}`,
      totalCells: gridWidth * gridHeight,
    });
  }
}
