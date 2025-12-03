import { Hono } from 'hono';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { AppContext } from './types';
import { authMiddleware } from '../middleware/auth-middleware';
import { MemberDAO } from '../../dao/member-dao';

// Type definitions for export format
interface ExportManifest {
  version: '1.0';
  exportedAt: string;
  spaceId: string;
  spaceName: string;
  assets: ExportAsset[];
  lineage: ExportLineage[];
}

interface ExportAsset {
  id: string;
  name: string;
  type: 'character' | 'item' | 'scene' | 'composite';
  tags: string[];
  activeVariantId: string | null;
  createdAt: number;
  variants: ExportVariant[];
}

interface ExportVariant {
  id: string;
  assetId: string;
  imageFile: string; // filename in ZIP
  thumbFile: string; // filename in ZIP
  recipe: Record<string, unknown> | null;
  createdAt: number;
}

interface ExportLineage {
  parentVariantId: string;
  childVariantId: string;
  relationType: 'derived' | 'refined' | 'forked';
}

export const exportRoutes = new Hono<AppContext>();

// All export routes require authentication
exportRoutes.use('*', authMiddleware);

// GET /api/spaces/:id/export - Export all assets as ZIP
exportRoutes.get('/api/spaces/:id/export', async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;

  const spaceId = c.req.param('id');

  // Verify user is member of space
  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }

  // Get space info
  if (!env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  const doId = env.SPACES_DO.idFromName(spaceId);
  const doStub = env.SPACES_DO.get(doId);

  // Get full state from DO
  const stateResponse = await doStub.fetch(new Request('http://do/internal/state'));
  if (!stateResponse.ok) {
    return c.json({ error: 'Failed to get space state' }, 500);
  }

  const state = await stateResponse.json() as {
    assets: Array<{
      id: string;
      name: string;
      type: 'character' | 'item' | 'scene' | 'composite';
      tags: string;
      active_variant_id: string | null;
      created_at: number;
    }>;
    variants: Array<{
      id: string;
      asset_id: string;
      image_key: string;
      thumb_key: string;
      recipe: string;
      created_at: number;
    }>;
    lineage?: Array<{
      parent_variant_id: string;
      child_variant_id: string;
      relation_type: string;
    }>;
  };

  // Prepare ZIP contents
  const zipFiles: { [filename: string]: Uint8Array } = {};

  // Build manifest
  const manifest: ExportManifest = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    spaceId,
    spaceName: 'Space', // Could fetch from space table if needed
    assets: [],
    lineage: (state.lineage || []).map(l => ({
      parentVariantId: l.parent_variant_id,
      childVariantId: l.child_variant_id,
      relationType: l.relation_type as ExportLineage['relationType'],
    })),
  };

  // Process each asset
  for (const asset of state.assets) {
    const assetVariants = state.variants.filter(v => v.asset_id === asset.id);
    const exportAsset: ExportAsset = {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      tags: JSON.parse(asset.tags || '[]'),
      activeVariantId: asset.active_variant_id,
      createdAt: asset.created_at,
      variants: [],
    };

    // Process each variant
    for (const variant of assetVariants) {
      // Fetch image from R2
      const imageObject = await env.IMAGES.get(variant.image_key);
      const thumbObject = await env.IMAGES.get(variant.thumb_key);

      if (!imageObject) {
        console.warn(`Image not found: ${variant.image_key}`);
        continue;
      }

      // Generate filenames
      const imageExt = variant.image_key.split('.').pop() || 'png';
      const imageFile = `images/${asset.name.replace(/[^a-zA-Z0-9]/g, '_')}/${variant.id}.${imageExt}`;
      const thumbFile = `images/${asset.name.replace(/[^a-zA-Z0-9]/g, '_')}/${variant.id}_thumb.${imageExt}`;

      // Add to ZIP
      zipFiles[imageFile] = new Uint8Array(await imageObject.arrayBuffer());
      if (thumbObject) {
        zipFiles[thumbFile] = new Uint8Array(await thumbObject.arrayBuffer());
      }

      // Parse recipe
      let recipe: Record<string, unknown> | null = null;
      try {
        recipe = JSON.parse(variant.recipe);
      } catch {
        // Invalid recipe JSON
      }

      exportAsset.variants.push({
        id: variant.id,
        assetId: asset.id,
        imageFile,
        thumbFile,
        recipe,
        createdAt: variant.created_at,
      });
    }

    manifest.assets.push(exportAsset);
  }

  // Add manifest to ZIP
  zipFiles['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

  // Create ZIP
  const zipBuffer = zipSync(zipFiles, { level: 6 });

  // Return ZIP file
  const filename = `space-export-${new Date().toISOString().split('T')[0]}.zip`;
  return new Response(zipBuffer.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

// POST /api/spaces/:id/import - Import assets from ZIP
exportRoutes.post('/api/spaces/:id/import', async (c) => {
  const userId = String(c.get('userId')!);
  const memberDAO = c.get('container').get(MemberDAO);
  const env = c.env;

  const spaceId = c.req.param('id');

  // Verify user is member with edit permissions
  const member = await memberDAO.getMember(spaceId, userId);
  if (!member) {
    return c.json({ error: 'Access denied' }, 403);
  }

  if (member.role !== 'editor' && member.role !== 'owner') {
    return c.json({ error: 'Editor or owner role required' }, 403);
  }

  // Get ZIP file from request
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return c.json({ error: 'No file provided' }, 400);
  }

  // Read and unzip
  const zipBuffer = new Uint8Array(await file.arrayBuffer());
  const unzipped = unzipSync(zipBuffer);

  // Read manifest
  const manifestData = unzipped['manifest.json'];
  if (!manifestData) {
    return c.json({ error: 'Invalid export file: missing manifest.json' }, 400);
  }

  const manifest = JSON.parse(strFromU8(manifestData)) as ExportManifest;

  if (manifest.version !== '1.0') {
    return c.json({ error: `Unsupported export version: ${manifest.version}` }, 400);
  }

  // Get DO stub
  if (!env.SPACES_DO) {
    return c.json({ error: 'Asset storage not available' }, 503);
  }

  const doId = env.SPACES_DO.idFromName(spaceId);
  const doStub = env.SPACES_DO.get(doId);

  // Track ID mappings (old -> new) for lineage reconstruction
  const variantIdMap = new Map<string, string>();
  const assetIdMap = new Map<string, string>();

  const importedAssets: string[] = [];
  const importedVariants: string[] = [];

  // Import each asset
  for (const asset of manifest.assets) {
    // Create new asset
    const newAssetId = crypto.randomUUID();
    assetIdMap.set(asset.id, newAssetId);

    const createAssetResponse = await doStub.fetch(new Request('http://do/internal/create-asset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: newAssetId,
        name: asset.name,
        type: asset.type,
        createdBy: userId,
      }),
    }));

    if (!createAssetResponse.ok) {
      console.error(`Failed to create asset: ${asset.name}`);
      continue;
    }

    importedAssets.push(newAssetId);

    // Import variants
    for (const variant of asset.variants) {
      const imageData = unzipped[variant.imageFile];
      if (!imageData) {
        console.warn(`Image not found in ZIP: ${variant.imageFile}`);
        continue;
      }

      const thumbData = unzipped[variant.thumbFile];
      const newVariantId = crypto.randomUUID();
      variantIdMap.set(variant.id, newVariantId);

      // Upload images to R2
      const imageKey = `images/${spaceId}/${newVariantId}.png`;
      const thumbKey = `images/${spaceId}/${newVariantId}_thumb.png`;

      await env.IMAGES.put(imageKey, imageData, {
        httpMetadata: { contentType: 'image/png' },
      });

      if (thumbData) {
        await env.IMAGES.put(thumbKey, thumbData, {
          httpMetadata: { contentType: 'image/png' },
        });
      } else {
        // Use main image as thumb if no thumb
        await env.IMAGES.put(thumbKey, imageData, {
          httpMetadata: { contentType: 'image/png' },
        });
      }

      // Apply variant to DO
      const applyResponse = await doStub.fetch(new Request('http://do/internal/apply-variant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: null, // No job for imports
          variantId: newVariantId,
          assetId: newAssetId,
          imageKey,
          thumbKey,
          recipe: JSON.stringify({
            type: 'import',
            originalRecipe: variant.recipe,
            importedAt: new Date().toISOString(),
          }),
          createdBy: userId,
        }),
      }));

      if (applyResponse.ok) {
        importedVariants.push(newVariantId);
      }
    }

    // Set active variant if it was specified
    if (asset.activeVariantId && variantIdMap.has(asset.activeVariantId)) {
      const newActiveId = variantIdMap.get(asset.activeVariantId)!;
      await doStub.fetch(new Request('http://do/internal/set-active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: newAssetId,
          variantId: newActiveId,
        }),
      }));
    }
  }

  // Import lineage relationships
  let lineageImported = 0;
  for (const lineage of manifest.lineage) {
    const newParentId = variantIdMap.get(lineage.parentVariantId);
    const newChildId = variantIdMap.get(lineage.childVariantId);

    if (newParentId && newChildId) {
      // Add lineage via DO
      await doStub.fetch(new Request('http://do/internal/add-lineage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentVariantId: newParentId,
          childVariantId: newChildId,
          relationType: lineage.relationType,
        }),
      }));
      lineageImported++;
    }
  }

  return c.json({
    success: true,
    imported: {
      assets: importedAssets.length,
      variants: importedVariants.length,
      lineage: lineageImported,
    },
  });
});
