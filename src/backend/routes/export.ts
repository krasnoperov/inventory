import { Hono } from 'hono';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { AppContext } from './types';
import { authMiddleware } from '../middleware/auth-middleware';
import { MemberDAO } from '../../dao/member-dao';
import { DEFAULT_MEDIA_KIND, type MediaKind } from '../../shared/websocket-types';

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
  mediaKind?: MediaKind;
  tags: string[];
  activeVariantId: string | null;
  createdAt: number;
  variants: ExportVariant[];
}

interface ExportVariant {
  id: string;
  assetId: string;
  mediaKind?: MediaKind;
  mediaKey?: string | null;
  mediaMimeType?: string | null;
  mediaSizeBytes?: number | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  mediaDurationMs?: number | null;
  mediaFile?: string | null; // canonical media filename in ZIP
  imageFile?: string | null; // legacy image filename in ZIP
  thumbFile?: string | null; // legacy thumbnail filename in ZIP
  recipe: Record<string, unknown> | null;
  createdAt: number;
}

interface ExportLineage {
  parentVariantId: string;
  childVariantId: string;
  relationType: 'derived' | 'refined' | 'forked';
}

export const exportRoutes = new Hono<AppContext>();

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '_');
}

function getExtension(key: string, fallback: string): string {
  return key.split('.').pop() || fallback;
}

function getMediaImportExtension(file: string | null | undefined, mediaKind: MediaKind): string {
  if (file) return getExtension(file, mediaKind === 'image' ? 'png' : mediaKind === 'audio' ? 'mp3' : 'mp4');
  if (mediaKind === 'audio') return 'mp3';
  if (mediaKind === 'video') return 'mp4';
  return 'png';
}

// All export routes require authentication
exportRoutes.use('/api/spaces/*', authMiddleware);

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
      media_kind?: MediaKind;
      tags: string;
      active_variant_id: string | null;
      created_at: number;
    }>;
    variants: Array<{
      id: string;
      asset_id: string;
      media_kind?: MediaKind;
      image_key: string | null;
      thumb_key: string | null;
      media_key?: string | null;
      media_mime_type?: string | null;
      media_size_bytes?: number | null;
      media_width?: number | null;
      media_height?: number | null;
      media_duration_ms?: number | null;
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
      mediaKind: asset.media_kind ?? DEFAULT_MEDIA_KIND,
      tags: JSON.parse(asset.tags || '[]'),
      activeVariantId: asset.active_variant_id,
      createdAt: asset.created_at,
      variants: [],
    };

    // Process each variant
    for (const variant of assetVariants) {
      const mediaKind = variant.media_kind ?? asset.media_kind ?? DEFAULT_MEDIA_KIND;
      const canonicalMediaKey = variant.media_key ?? variant.image_key ?? null;
      if (!canonicalMediaKey) {
        console.warn(`Media not found for variant: ${variant.id}`);
        continue;
      }

      const mediaObject = await env.IMAGES.get(canonicalMediaKey);
      if (!mediaObject) {
        console.warn(`Media not found: ${canonicalMediaKey}`);
        continue;
      }

      // Generate filenames
      const assetPath = sanitizePathSegment(asset.name);
      const mediaExt = getExtension(canonicalMediaKey, mediaKind === 'image' ? 'png' : mediaKind === 'audio' ? 'mp3' : 'mp4');
      const mediaFile = `${mediaKind === 'image' ? 'images' : 'media'}/${assetPath}/${variant.id}.${mediaExt}`;
      const imageExt = variant.image_key ? getExtension(variant.image_key, 'png') : 'png';
      const imageFile = variant.image_key ? `images/${assetPath}/${variant.id}.${imageExt}` : null;
      const thumbFile = variant.thumb_key ? `images/${assetPath}/${variant.id}_thumb.${imageExt}` : null;

      // Add to ZIP
      zipFiles[mediaFile] = new Uint8Array(await mediaObject.arrayBuffer());
      if (imageFile && imageFile !== mediaFile && variant.image_key) {
        const imageObject = await env.IMAGES.get(variant.image_key);
        if (imageObject) {
          zipFiles[imageFile] = new Uint8Array(await imageObject.arrayBuffer());
        }
      }
      if (thumbFile && variant.thumb_key) {
        const thumbObject = await env.IMAGES.get(variant.thumb_key);
        if (thumbObject) {
          zipFiles[thumbFile] = new Uint8Array(await thumbObject.arrayBuffer());
        }
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
        mediaKind,
        mediaKey: canonicalMediaKey,
        mediaMimeType: variant.media_mime_type ?? null,
        mediaSizeBytes: variant.media_size_bytes ?? null,
        mediaWidth: variant.media_width ?? null,
        mediaHeight: variant.media_height ?? null,
        mediaDurationMs: variant.media_duration_ms ?? null,
        mediaFile,
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
        mediaKind: asset.mediaKind ?? DEFAULT_MEDIA_KIND,
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
      const mediaKind = variant.mediaKind ?? asset.mediaKind ?? DEFAULT_MEDIA_KIND;
      const mediaFile = variant.mediaFile ?? variant.imageFile ?? null;
      const mediaData = mediaFile ? unzipped[mediaFile] : undefined;
      if (!mediaData) {
        console.warn(`Media not found in ZIP: ${mediaFile ?? '(missing media file)'}`);
        continue;
      }

      const imageData = variant.imageFile ? unzipped[variant.imageFile] : undefined;
      const thumbData = variant.thumbFile ? unzipped[variant.thumbFile] : undefined;
      const newVariantId = crypto.randomUUID();
      variantIdMap.set(variant.id, newVariantId);

      // Upload media to R2
      const mediaExt = getMediaImportExtension(mediaFile, mediaKind);
      const mediaKey = mediaKind === 'image'
        ? `images/${spaceId}/${newVariantId}.${mediaExt}`
        : `media/${spaceId}/${newVariantId}.${mediaExt}`;
      const imageKey = mediaKind === 'image' ? mediaKey : null;
      const thumbKey = mediaKind === 'image' ? `images/${spaceId}/${newVariantId}_thumb.png` : null;
      const mediaMimeType = variant.mediaMimeType ?? (mediaKind === 'video' ? 'video/mp4' : mediaKind === 'audio' ? 'audio/mpeg' : 'image/png');

      await env.IMAGES.put(mediaKey, mediaData, {
        httpMetadata: { contentType: mediaMimeType },
      });

      if (thumbKey && thumbData) {
        await env.IMAGES.put(thumbKey, thumbData, {
          httpMetadata: { contentType: 'image/png' },
        });
      } else if (thumbKey) {
        // Use main image as thumb if no thumb
        await env.IMAGES.put(thumbKey, imageData ?? mediaData, {
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
          mediaKind,
          mediaKey,
          mediaMimeType: variant.mediaMimeType ?? null,
          mediaSizeBytes: variant.mediaSizeBytes,
          mediaWidth: variant.mediaWidth,
          mediaHeight: variant.mediaHeight,
          mediaDurationMs: variant.mediaDurationMs,
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
