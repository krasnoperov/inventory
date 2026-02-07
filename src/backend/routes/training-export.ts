import { Hono } from 'hono';
import { zipSync, strToU8 } from 'fflate';
import type { AppContext } from './types';
import { authMiddleware } from '../middleware/auth-middleware';
import { MemberDAO } from '../../dao/member-dao';

/**
 * Training Data Export Route
 *
 * Exports approved variant pairs (input context + output image) for fine-tuning.
 * Produces a ZIP with manifest.json describing each training pair.
 */

interface TrainingPair {
  id: string;
  input: string;       // path within ZIP
  output: string;      // path within ZIP
  instruction: string; // path within ZIP
  pipeline: 'tile' | 'rotation';
  metadata: Record<string, unknown>;
}

interface TrainingManifest {
  format: 'image-edit-pairs-v1';
  model_target: 'qwen/image-edit';
  exportedAt: string;
  spaceId: string;
  pairs: TrainingPair[];
}

export const trainingExportRoutes = new Hono<AppContext>();

trainingExportRoutes.use('*', authMiddleware);

// GET /api/spaces/:id/training-data?pipeline=tiles|rotations|all
trainingExportRoutes.get('/api/spaces/:id/training-data', async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;
  const spaceId = c.req.param('id');
  const pipeline = c.req.query('pipeline') || 'all';

  // Verify user is member of space
  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }

  if (!env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  // Get full state from DO
  const doId = env.SPACES_DO.idFromName(spaceId);
  const doStub = env.SPACES_DO.get(doId);
  const stateResponse = await doStub.fetch(new Request('http://do/internal/state'));
  if (!stateResponse.ok) {
    return c.json({ error: 'Failed to get space state' }, 500);
  }

  const state = await stateResponse.json() as {
    assets: Array<{ id: string; name: string; type: string }>;
    variants: Array<{
      id: string;
      asset_id: string;
      image_key: string | null;
      thumb_key: string | null;
      recipe: string;
      status: string;
      quality_rating: string | null;
    }>;
    tileSets: Array<{
      id: string;
      asset_id: string;
      tile_type: string;
      grid_width: number;
      grid_height: number;
      status: string;
      config: string;
    }>;
    tilePositions: Array<{
      id: string;
      tile_set_id: string;
      variant_id: string;
      grid_x: number;
      grid_y: number;
    }>;
    rotationSets: Array<{
      id: string;
      asset_id: string;
      source_variant_id: string;
      config: string;
      status: string;
    }>;
    rotationViews: Array<{
      id: string;
      rotation_set_id: string;
      variant_id: string;
      direction: string;
      step_index: number;
    }>;
  };

  // Filter to approved variants only
  const approvedVariants = state.variants.filter(
    (v) => v.quality_rating === 'approved' && v.image_key
  );
  const approvedIds = new Set(approvedVariants.map((v) => v.id));

  if (approvedVariants.length === 0) {
    return c.json({ error: 'No approved variants to export' }, 404);
  }

  const zipFiles: { [filename: string]: Uint8Array } = {};
  const pairs: TrainingPair[] = [];
  let pairIndex = 0;

  // --- Tile training pairs ---
  if (pipeline === 'tiles' || pipeline === 'all') {
    for (const tileSet of state.tileSets) {
      if (tileSet.status !== 'completed') continue;

      const positions = state.tilePositions.filter(
        (tp) => tp.tile_set_id === tileSet.id
      );

      for (const pos of positions) {
        if (!approvedIds.has(pos.variant_id)) continue;

        const variant = approvedVariants.find((v) => v.id === pos.variant_id);
        if (!variant?.image_key) continue;

        pairIndex++;
        const padded = String(pairIndex).padStart(3, '0');

        // Fetch output image from R2
        const outputImage = await env.IMAGES.get(variant.image_key);
        if (!outputImage) continue;

        // Collect adjacent tiles as input context
        const adjacentDirs = [
          { dx: 0, dy: -1, label: 'N' },
          { dx: 1, dy: 0, label: 'E' },
          { dx: 0, dy: 1, label: 'S' },
          { dx: -1, dy: 0, label: 'W' },
        ];

        const adjacentInfo: Array<{ label: string; file: string }> = [];
        for (const dir of adjacentDirs) {
          const adj = positions.find(
            (p) => p.grid_x === pos.grid_x + dir.dx && p.grid_y === pos.grid_y + dir.dy
          );
          if (!adj) continue;
          const adjVariant = state.variants.find((v) => v.id === adj.variant_id);
          if (!adjVariant?.image_key || adjVariant.status !== 'completed') continue;

          const adjImage = await env.IMAGES.get(adjVariant.image_key);
          if (!adjImage) continue;

          const adjFile = `inputs/pair_${padded}_adj_${dir.label}.png`;
          zipFiles[adjFile] = new Uint8Array(await adjImage.arrayBuffer());
          adjacentInfo.push({ label: dir.label, file: adjFile });
        }

        // If no adjacent context, use a placeholder description
        const inputFile = adjacentInfo.length > 0
          ? adjacentInfo[0].file  // Primary input is the first adjacent tile
          : `inputs/pair_${padded}_context.txt`;

        if (adjacentInfo.length === 0) {
          zipFiles[inputFile] = strToU8('No adjacent tile context available');
        }

        // Output image
        const outputFile = `outputs/pair_${padded}_output.png`;
        zipFiles[outputFile] = new Uint8Array(await outputImage.arrayBuffer());

        // Prompt/instruction
        let instruction = '';
        try {
          const recipe = JSON.parse(variant.recipe);
          instruction = recipe.prompt || recipe.description || '';
        } catch { /* ignore */ }

        const promptFile = `prompts/pair_${padded}.txt`;
        zipFiles[promptFile] = strToU8(instruction);

        pairs.push({
          id: `pair_${padded}`,
          input: inputFile,
          output: outputFile,
          instruction: promptFile,
          pipeline: 'tile',
          metadata: {
            tile_type: tileSet.tile_type,
            grid_pos: [pos.grid_x, pos.grid_y],
            adjacent_count: adjacentInfo.length,
            adjacent_files: adjacentInfo,
            source_variant_id: null,
            output_variant_id: variant.id,
            tile_set_id: tileSet.id,
          },
        });
      }
    }
  }

  // --- Rotation training pairs ---
  if (pipeline === 'rotations' || pipeline === 'all') {
    for (const rotSet of state.rotationSets) {
      if (rotSet.status !== 'completed') continue;

      const views = state.rotationViews.filter(
        (rv) => rv.rotation_set_id === rotSet.id
      );

      // Find the source variant (the original reference image)
      const sourceVariant = state.variants.find(
        (v) => v.id === rotSet.source_variant_id
      );

      for (const view of views) {
        if (!approvedIds.has(view.variant_id)) continue;

        const variant = approvedVariants.find((v) => v.id === view.variant_id);
        if (!variant?.image_key) continue;

        pairIndex++;
        const padded = String(pairIndex).padStart(3, '0');

        // Input: the source/front view image
        let inputFile = `inputs/pair_${padded}_source.png`;
        if (sourceVariant?.image_key) {
          const sourceImage = await env.IMAGES.get(sourceVariant.image_key);
          if (sourceImage) {
            zipFiles[inputFile] = new Uint8Array(await sourceImage.arrayBuffer());
          } else {
            inputFile = `inputs/pair_${padded}_context.txt`;
            zipFiles[inputFile] = strToU8('Source image not available');
          }
        } else {
          inputFile = `inputs/pair_${padded}_context.txt`;
          zipFiles[inputFile] = strToU8('Source image not available');
        }

        // Output image
        const outputFile = `outputs/pair_${padded}_output.png`;
        const outputImage = await env.IMAGES.get(variant.image_key);
        if (!outputImage) continue;
        zipFiles[outputFile] = new Uint8Array(await outputImage.arrayBuffer());

        // Prompt/instruction
        let instruction = '';
        try {
          const recipe = JSON.parse(variant.recipe);
          instruction = recipe.prompt || recipe.description || '';
        } catch { /* ignore */ }

        const promptFile = `prompts/pair_${padded}.txt`;
        zipFiles[promptFile] = strToU8(instruction);

        let configType = '';
        try {
          const parsed = JSON.parse(rotSet.config);
          configType = parsed.type || '';
        } catch { /* ignore */ }

        pairs.push({
          id: `pair_${padded}`,
          input: inputFile,
          output: outputFile,
          instruction: promptFile,
          pipeline: 'rotation',
          metadata: {
            direction: view.direction,
            step_index: view.step_index,
            rotation_config: configType,
            source_variant_id: rotSet.source_variant_id,
            output_variant_id: variant.id,
            rotation_set_id: rotSet.id,
          },
        });
      }
    }
  }

  if (pairs.length === 0) {
    return c.json({ error: 'No approved training pairs found for the selected pipeline' }, 404);
  }

  // Create manifest
  const manifest: TrainingManifest = {
    format: 'image-edit-pairs-v1',
    model_target: 'qwen/image-edit',
    exportedAt: new Date().toISOString(),
    spaceId,
    pairs,
  };

  zipFiles['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

  // Create ZIP
  const zipBuffer = zipSync(zipFiles, { level: 6 });

  const filename = `training-data-${pipeline}-${new Date().toISOString().split('T')[0]}.zip`;
  return new Response(zipBuffer.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});
