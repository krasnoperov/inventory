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
import { INCREMENT_REF_SQL, getVariantImageKeys } from '../variant/imageRefs';
import {
  capRefs,
  resolveStyleReferences,
  withoutStyleReferenceImages,
  type ResolvedStyleReferences,
} from '../generation/refLimits';
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
import { DEFAULT_MEDIA_KIND } from '../../../../shared/websocket-types';
import { DEFAULT_IMAGE_MODEL_ID } from '../../../../shared/imageGenerationOptions';
import { immutableMediaHttpMetadata } from '../../../media/r2-metadata';

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
      stylePresetId?: string;
      styleVariantIds?: string[];
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

    let seedVariant: Variant | null = null;
    if (msg.seedVariantId) {
      seedVariant = await this.repo.getVariantById(msg.seedVariantId);
      if (!seedVariant || seedVariant.status !== 'completed' || !seedVariant.image_key) {
        throw new ValidationError('Seed variant must be completed with an image');
      }
    }
    const tileMediaKind = seedVariant?.media_kind ?? DEFAULT_MEDIA_KIND;

    // Create parent asset for the tile set
    const tileAssetId = crypto.randomUUID();
    const promptSummary = msg.prompt.length > 40 ? msg.prompt.slice(0, 40) + '...' : msg.prompt;
    const tileAsset = await this.repo.createAsset({
      id: tileAssetId,
      name: `${promptSummary} — Tile Set`,
      type: 'tile-set',
      mediaKind: tileMediaKind,
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
      stylePresetId: msg.stylePresetId,
      styleVariantIds: msg.styleVariantIds,
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
      const seed = seedVariant;
      if (!seed) {
        throw new ValidationError('Seed variant must be completed with an image');
      }

      const forkedVariantId = crypto.randomUUID();
      const now = Date.now();
      await this.sql.exec(
        `INSERT INTO variants (id, asset_id, media_kind, workflow_id, status, error_message, image_key, thumb_key, media_key, media_mime_type, media_size_bytes, media_width, media_height, media_duration_ms, transcript_key, transcript_mime_type, transcript_size_bytes, word_timings_key, word_timings_mime_type, word_timings_size_bytes, render_metadata_key, render_metadata_mime_type, render_metadata_size_bytes, generation_provenance, provider_metadata, recipe, starred, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        forkedVariantId,
        tileAssetId,
        tileMediaKind,
        null,
        'completed',
        null,
        seed.image_key,
        seed.thumb_key,
        seed.media_key ?? seed.image_key,
        seed.media_mime_type,
        seed.media_size_bytes,
        seed.media_width,
        seed.media_height,
        seed.media_duration_ms,
        seed.transcript_key,
        seed.transcript_mime_type,
        seed.transcript_size_bytes,
        seed.word_timings_key,
        seed.word_timings_mime_type,
        seed.word_timings_size_bytes,
        seed.render_metadata_key,
        seed.render_metadata_mime_type,
        seed.render_metadata_size_bytes,
        seed.generation_provenance ?? seed.recipe,
        seed.provider_metadata,
        seed.recipe,
        0,
        meta.userId,
        now,
        now
      );

      for (const key of getVariantImageKeys(seed)) {
        await this.sql.exec(INCREMENT_REF_SQL, key);
      }

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
      stylePresetId?: string;
      styleVariantIds?: string[];
    };

    // Get adjacent completed tiles
    const adjacents = await this.repo.getAdjacentTiles(tileSetId, gridX, gridY);

    // Collect adjacent image keys
    const adjacentKeys = adjacents.map(a => a.image_key);
    let style = await resolveStyleReferences(this.repo, {
      disableStyle: config.disableStyle,
      stylePresetId: config.stylePresetId,
      styleVariantIds: config.styleVariantIds,
    });
    if (style.styleKeys.length + adjacentKeys.length > 14) {
      style = withoutStyleReferenceImages(style);
    }
    const cappedKeys = capRefs(style.styleKeys, adjacentKeys, adjacentKeys[0] || '');

    // Build adjacency-aware prompt
    const builder = new PromptBuilder();
    if (style.styleDescription) {
      builder.withStyle(style.styleDescription);
    }
    builder
      .withTileContext(adjacents, set.tile_type as TileType)
      .withTheme(config.prompt);
    const prompt = builder.build();
    const asset = await this.repo.getAssetById(set.asset_id);
    const mediaKind = asset?.media_kind ?? DEFAULT_MEDIA_KIND;
    const model = mediaKind === 'image' ? DEFAULT_IMAGE_MODEL_ID : undefined;

    // Create placeholder variant
    const variantId = crypto.randomUUID();
    const recipe = JSON.stringify({
      prompt,
      assetType: 'tile-set',
      mediaKind,
      model,
      aspectRatio: config.aspectRatio || '1:1',
      sourceImageKeys: [...style.styleKeys, ...cappedKeys],
      styleImageKeys: style.styleKeys.length ? style.styleKeys : undefined,
      ...this.getStyleRecipeFields(style),
      operation: adjacents.length > 0 || style.styleKeys.length > 0 ? 'derive' : 'generate',
    });

    const variant = await this.repo.createPlaceholderVariant({
      id: variantId,
      assetId: set.asset_id,
      mediaKind,
      recipe,
      createdBy: userId,
    });
    this.broadcast({ type: 'variant:created', variant });
    await this.createStyleReferenceRelations(style, variantId, userId);

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
          mediaKind,
          model,
          aspectRatio: config.aspectRatio || '1:1',
          sourceImageKeys: [...style.styleKeys, ...cappedKeys].length > 0 ? [...style.styleKeys, ...cappedKeys] : undefined,
          styleImageKeys: style.styleKeys.length ? style.styleKeys : undefined,
          ...this.getStyleWorkflowFields(style),
          operation: adjacents.length > 0 || style.styleKeys.length > 0 ? 'derive' : 'generate',
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
      stylePresetId?: string;
      styleVariantIds?: string[];
    }
  ): Promise<void> {
    this.requireEditor(meta);

    if (msg.gridWidth < 2 || msg.gridWidth > 5 || msg.gridHeight < 2 || msg.gridHeight > 5) {
      throw new ValidationError('Grid size must be between 2 and 5');
    }

    const totalTiles = msg.gridWidth * msg.gridHeight;
    const cellSize = 256; // Default cell size for single-shot grid
    const mediaKind = DEFAULT_MEDIA_KIND;

    // Create parent asset
    const tileAssetId = crypto.randomUUID();
    const promptSummary = msg.prompt.length > 40 ? msg.prompt.slice(0, 40) + '...' : msg.prompt;
    const tileAsset = await this.repo.createAsset({
      id: tileAssetId,
      name: `${promptSummary} — Tile Set (single-shot)`,
      type: 'tile-set',
      mediaKind,
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
      stylePresetId: msg.stylePresetId,
      styleVariantIds: msg.styleVariantIds,
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

    let style = await resolveStyleReferences(this.repo, {
      disableStyle: msg.disableStyle,
      stylePresetId: msg.stylePresetId,
      styleVariantIds: msg.styleVariantIds,
    });
    if (style.styleKeys.length > 14) {
      style = withoutStyleReferenceImages(style);
    }

    const builder = new PromptBuilder();
    if (style.styleDescription) {
      builder.withStyle(style.styleDescription);
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
    const model = mediaKind === 'image' ? DEFAULT_IMAGE_MODEL_ID : undefined;

    // Create a single placeholder variant for the grid image
    const variantId = crypto.randomUUID();
    const recipe = JSON.stringify({
      prompt,
      assetType: 'tile-set',
      mediaKind,
      model,
      aspectRatio: msg.aspectRatio || '1:1',
      sourceImageKeys: style.styleKeys,
      styleImageKeys: style.styleKeys.length ? style.styleKeys : undefined,
      ...this.getStyleRecipeFields(style),
      operation: style.styleKeys.length > 0 ? 'derive' : 'generate',
      generationMode: 'single-shot',
      gridWidth: msg.gridWidth,
      gridHeight: msg.gridHeight,
      cellSize,
    });

    const variant = await this.repo.createPlaceholderVariant({
      id: variantId,
      assetId: tileAssetId,
      mediaKind,
      recipe,
      createdBy: meta.userId,
    });
    this.broadcast({ type: 'variant:created', variant });
    await this.createStyleReferenceRelations(style, variantId, meta.userId);

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
          mediaKind,
          model,
          aspectRatio: msg.aspectRatio || '1:1',
          sourceImageKeys: style.styleKeys.length > 0 ? style.styleKeys : undefined,
          styleImageKeys: style.styleKeys.length ? style.styleKeys : undefined,
          ...this.getStyleWorkflowFields(style),
          operation: style.styleKeys.length > 0 ? 'derive' : 'generate',
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
      stylePresetId?: string;
      styleVariantIds?: string[];
    };

    // Get the tile variant
    const pos = await this.repo.getTilePositionAt(tileSetId, gridX, gridY);
    if (!pos) return;

    const tileVariant = await this.repo.getVariantById(pos.variant_id);
    if (!tileVariant?.image_key) return;

    // Get adjacent completed tiles
    const adjacents = await this.repo.getAdjacentTiles(tileSetId, gridX, gridY);
    if (adjacents.length === 0) return; // No neighbors to blend with

    // Build compose prompt with tile + adjacents
    const allKeys = [tileVariant.image_key, ...adjacents.map(a => a.image_key)];
    let style = await resolveStyleReferences(this.repo, {
      disableStyle: config.disableStyle,
      stylePresetId: config.stylePresetId,
      styleVariantIds: config.styleVariantIds,
    });
    if (style.styleKeys.length + allKeys.length > 14) {
      style = withoutStyleReferenceImages(style);
    }
    const cappedKeys = capRefs(style.styleKeys, allKeys, tileVariant.image_key);

    const refLabels = adjacents.map((a, i) => `Image ${i + 2}: adjacent tile to the ${a.direction}`).join('\n');
    const prompt = [
      `Image 1: the tile to refine`,
      refLabels,
      `Refine Image 1 so its edges seamlessly match the adjacent tiles.`,
      `Blend colors, textures, and features at the boundaries.`,
      `Keep the interior of the tile unchanged.`,
      style.styleDescription ? `[Style: ${style.styleDescription}]` : '',
    ].filter(Boolean).join('\n');

    // Create placeholder variant for refined tile
    const variantId = crypto.randomUUID();
    const asset = await this.repo.getAssetById(set.asset_id);
    const mediaKind = asset?.media_kind ?? DEFAULT_MEDIA_KIND;
    const model = mediaKind === 'image' ? DEFAULT_IMAGE_MODEL_ID : undefined;
    const recipe = JSON.stringify({
      prompt,
      assetType: 'tile-set',
      mediaKind,
      model,
      aspectRatio: config.aspectRatio || '1:1',
      sourceImageKeys: [...style.styleKeys, ...cappedKeys],
      styleImageKeys: style.styleKeys.length ? style.styleKeys : undefined,
      ...this.getStyleRecipeFields(style),
      operation: 'refine',
    });

    const variant = await this.repo.createPlaceholderVariant({
      id: variantId,
      assetId: set.asset_id,
      mediaKind,
      recipe,
      createdBy: userId,
    });
    this.broadcast({ type: 'variant:created', variant });
    await this.createStyleReferenceRelations(style, variantId, userId);

    // Update tile position to point to new variant
    await this.sql.exec(
      `UPDATE tile_positions SET variant_id = ? WHERE id = ? AND deleted_at IS NULL`,
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
          mediaKind,
          model,
          aspectRatio: config.aspectRatio || '1:1',
          sourceImageKeys: [...style.styleKeys, ...cappedKeys],
          styleImageKeys: style.styleKeys.length ? style.styleKeys : undefined,
          ...this.getStyleWorkflowFields(style),
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
        let cellMimeType: string | null = variant.media_mime_type;
        let cellSizeBytes: number | null = variant.media_size_bytes;
        let cellWidth: number | null = variant.media_width;
        let cellHeight: number | null = variant.media_height;

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
          const dimensions = getImageDimensions(new Uint8Array(buffer));

          const ext = getExtensionForMimeType(mimeType as ImageMimeType);
          cellImageKey = `images/${this.spaceId}/${cellVariantId}.${ext}`;
          cellThumbKey = cellImageKey; // Cell is small enough to be its own thumbnail
          cellMimeType = mimeType;
          cellSizeBytes = buffer.byteLength;
          cellWidth = dimensions?.width ?? null;
          cellHeight = dimensions?.height ?? null;

          await this.env.IMAGES!.put(cellImageKey, buffer, {
            httpMetadata: immutableMediaHttpMetadata(cellImageKey, mimeType),
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
          mediaKind: (await this.repo.getAssetById(tileSet.asset_id))?.media_kind ?? DEFAULT_MEDIA_KIND,
          recipe: cellRecipe,
          createdBy: tileSet.created_by,
        });

        const completedVariant = await this.repo.completeVariant(cellVariantId, cellImageKey, cellThumbKey, {
          mediaKey: cellImageKey,
          mimeType: cellMimeType,
          sizeBytes: cellSizeBytes,
          width: cellWidth,
          height: cellHeight,
          providerMetadata: variant.provider_metadata,
        });
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

  private getStyleRecipeFields(style: ResolvedStyleReferences): Record<string, unknown> {
    if (!style.stylePresetId && style.styleReferenceVariantIds.length === 0 && !style.styleOverride) return {};
    return {
      stylePresetId: style.stylePresetId,
      styleCollectionId: style.styleCollectionId ?? undefined,
      styleReferenceVariantIds: style.styleReferenceVariantIds,
      styleReferenceImageKeys: style.styleReferenceImageKeys,
      stylePrompt: style.stylePrompt,
      styleOverride: style.styleOverride || undefined,
    };
  }

  private getStyleWorkflowFields(style: ResolvedStyleReferences): Partial<GenerationWorkflowInput> {
    return {
      stylePresetId: style.stylePresetId,
      styleCollectionId: style.styleCollectionId ?? undefined,
      styleReferenceVariantIds: style.styleReferenceVariantIds,
      styleReferenceImageKeys: style.styleReferenceImageKeys,
      stylePrompt: style.stylePrompt,
    };
  }

  private async createStyleReferenceRelations(
    style: ResolvedStyleReferences,
    childVariantId: string,
    createdBy: string
  ): Promise<void> {
    for (let index = 0; index < style.styleReferenceVariantIds.length; index++) {
      await this.repo.createRelation({
        id: crypto.randomUUID(),
        subject: { subjectType: 'variant', variantId: style.styleReferenceVariantIds[index] },
        object: { subjectType: 'variant', variantId: childVariantId },
        relationType: 'style_reference_for',
        context: JSON.stringify({
          role: 'style_reference',
          stylePresetId: style.stylePresetId,
          styleCollectionId: style.styleCollectionId,
          styleImageKey: style.styleReferenceImageKeys[index],
        }),
        sortIndex: index,
        createdBy,
      });
    }
  }
}
