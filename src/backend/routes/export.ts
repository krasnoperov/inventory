import { Hono } from 'hono';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { AppContext } from './types';
import { authMiddleware } from '../middleware/auth-middleware';
import { MemberDAO } from '../../dao/member-dao';
import { DEFAULT_MEDIA_KIND, type MediaKind } from '../../shared/websocket-types';
import {
  MediaKindSchema,
  SpaceSubjectTypeSchema,
} from '../../shared/api/schemas';
import { immutableMediaHttpMetadata } from '../media/r2-metadata';

// Type definitions for export format
interface ExportManifest {
  version: '1.0';
  exportedAt: string;
  spaceId: string;
  spaceName: string;
  assets: ExportAsset[];
  lineage: ExportLineage[];
  collections?: ExportCollection[];
  collectionItems?: ExportCollectionItem[];
}

interface ExportAsset {
  id: string;
  name: string;
  type: string;
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
  generation_provenance?: unknown;
  provider_metadata?: unknown;
  createdAt: number;
}

interface ExportLineage {
  id?: string;
  parentVariantId: string;
  childVariantId: string;
  relationType: 'derived' | 'refined' | 'forked';
  severed?: boolean;
}

type ExportSubjectType = 'asset' | 'variant';

interface ExportCollection {
  id: string;
  name: string;
  description: string | null;
  sortIndex: number;
}

interface ExportCollectionItem {
  id: string;
  collectionId: string;
  subjectType: ExportSubjectType;
  assetId: string | null;
  variantId: string | null;
  role: string;
  pinnedVariantId: string | null;
  sortIndex: number;
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

function parseJsonForManifest(value: string | null | undefined): unknown {
  if (value === undefined || value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function requireMappedId(map: Map<string, string>, id: string | null | undefined, label: string): string | null {
  if (!id) return null;
  const mapped = map.get(id);
  if (!mapped) {
    throw new Error(`${label} references unknown ID: ${id}`);
  }
  return mapped;
}

function mapStringArrayIds(value: unknown, map: Map<string, string>): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((id) => typeof id === 'string' ? map.get(id) ?? id : id);
}

function remapImportJsonValue(
  value: unknown,
  maps: {
    assetIdMap: Map<string, string>;
    variantIdMap: Map<string, string>;
    collectionIdMap: Map<string, string>;
    imageKeyMap: Map<string, string>;
  }
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => remapImportJsonValue(item, maps));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'collectionId' && typeof raw === 'string') {
      result[key] = maps.collectionIdMap.get(raw) ?? raw;
    } else if ((key === 'sourceVariantId' || key === 'variantId') && typeof raw === 'string') {
      result[key] = maps.variantIdMap.get(raw) ?? raw;
    } else if (key === 'assetId' && typeof raw === 'string') {
      result[key] = maps.assetIdMap.get(raw) ?? raw;
    } else if (
      key === 'parentVariantIds' ||
      key === 'sourceVariantIds'
    ) {
      result[key] = mapStringArrayIds(raw, maps.variantIdMap);
    } else if (
      key === 'sourceImageKeys'
    ) {
      result[key] = mapStringArrayIds(raw, maps.imageKeyMap);
    } else if ((key === 'imageKey' || key === 'mediaKey') && typeof raw === 'string') {
      result[key] = maps.imageKeyMap.get(raw) ?? raw;
    } else {
      result[key] = remapImportJsonValue(raw, maps);
    }
  }
  return result;
}

function subjectInput(
  subjectType: ExportSubjectType,
  assetId: string | null | undefined,
  variantId: string | null | undefined,
  assetIdMap: Map<string, string>,
  variantIdMap: Map<string, string>,
  label: string
): { subjectType: ExportSubjectType; assetId?: string; variantId?: string } {
  if (subjectType === 'asset') {
    return { subjectType, assetId: requireMappedId(assetIdMap, assetId, label) ?? undefined };
  }
  return { subjectType, variantId: requireMappedId(variantIdMap, variantId, label) ?? undefined };
}

function optionalArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function getVariantImportMediaFile(variant: ExportVariant): string | null {
  return variant.mediaFile ?? variant.imageFile ?? null;
}

function getVariantImportMediaKeys(spaceId: string, variantId: string, variant: ExportVariant, mediaKind: MediaKind): {
  mediaKey: string;
  imageKey: string | null;
  thumbKey: string | null;
} {
  const mediaFile = getVariantImportMediaFile(variant);
  const mediaExt = getMediaImportExtension(mediaFile, mediaKind);
  const mediaKey = mediaKind === 'image'
    ? `images/${spaceId}/${variantId}.${mediaExt}`
    : `media/${spaceId}/${variantId}.${mediaExt}`;
  return {
    mediaKey,
    imageKey: mediaKind === 'image' ? mediaKey : null,
    thumbKey: mediaKind === 'image' ? `images/${spaceId}/${variantId}_thumb.png` : null,
  };
}

function requiredStringField(value: unknown, label: string): string | null {
  return typeof value === 'string' && value.trim() ? null : `${label} is required`;
}

function optionalNullableStringField(value: unknown, label: string): string | null {
  return value === undefined || value === null || typeof value === 'string'
    ? null
    : `${label} must be a string or null`;
}

function integerField(value: unknown, label: string): string | null {
  return Number.isInteger(value) ? null : `${label} must be an integer`;
}

function validateOptionalArraySection(value: unknown, label: string): string | null {
  return value === undefined || Array.isArray(value) ? null : `${label} must be an array`;
}

function validateManifestReferences(manifest: ExportManifest): string | null {
  const assetIds = new Set(manifest.assets.map((asset) => asset.id));
  const variantIds = new Set(manifest.assets.flatMap((asset) => asset.variants.map((variant) => variant.id)));
  const variantAssetIds = new Map(
    manifest.assets.flatMap((asset) => asset.variants.map((variant) => [variant.id, asset.id] as const))
  );
  const collectionIds = new Set(optionalArray(manifest.collections).map((collection) => collection.id));

  const hasAsset = (id: string | null | undefined, label: string) =>
    !id || assetIds.has(id) ? null : `${label} references unknown asset: ${id}`;
  const hasVariant = (id: string | null | undefined, label: string) =>
    !id || variantIds.has(id) ? null : `${label} references unknown variant: ${id}`;
  const hasSubject = (
    subjectType: ExportSubjectType,
    assetId: string | null | undefined,
    variantId: string | null | undefined,
    label: string
  ) => {
    if (subjectType === 'asset') {
      if (!assetId) return `${label} is missing assetId`;
      return hasAsset(assetId, label);
    }
    if (!variantId) return `${label} is missing variantId`;
    return hasVariant(variantId, label);
  };

  for (const asset of manifest.assets) {
    for (const variant of asset.variants) {
      if (variant.assetId && variant.assetId !== asset.id) {
        return `Variant ${variant.id} assetId must match asset ${asset.id}`;
      }
    }
    const error = hasVariant(asset.activeVariantId, `Asset ${asset.id} activeVariantId`);
    if (error) return error;
    if (asset.activeVariantId && variantAssetIds.get(asset.activeVariantId) !== asset.id) {
      return `Asset ${asset.id} activeVariantId must reference a variant on the asset`;
    }
  }
  for (const lineage of manifest.lineage ?? []) {
    const parentError = hasVariant(lineage.parentVariantId, 'Lineage parentVariantId');
    if (parentError) return parentError;
    const childError = hasVariant(lineage.childVariantId, 'Lineage childVariantId');
    if (childError) return childError;
  }
  for (const item of optionalArray(manifest.collectionItems)) {
    if (!collectionIds.has(item.collectionId)) return `Collection item ${item.id} references unknown collection: ${item.collectionId}`;
    const subjectError = hasSubject(item.subjectType, item.assetId, item.variantId, `Collection item ${item.id}`);
    if (subjectError) return subjectError;
    const pinnedError = hasVariant(item.pinnedVariantId, `Collection item ${item.id} pinnedVariantId`);
    if (pinnedError) return pinnedError;
    if (
      item.subjectType === 'asset' &&
      item.assetId &&
      item.pinnedVariantId &&
      variantAssetIds.get(item.pinnedVariantId) !== item.assetId
    ) {
      return `Collection item ${item.id} pinnedVariantId must reference a variant on the asset subject`;
    }
  }
  return null;
}

function validateManifestOrganizationFields(manifest: ExportManifest): string | null {
  const rawManifest = manifest as {
    collections?: unknown;
    collectionItems?: unknown;
  };
  const optionalSections: Array<[unknown, string]> = [
    [rawManifest.collections, 'collections'],
    [rawManifest.collectionItems, 'collectionItems'],
  ];
  for (const [value, label] of optionalSections) {
    const error = validateOptionalArraySection(value, label);
    if (error) return error;
  }

  for (const collection of optionalArray(manifest.collections)) {
    const idError = requiredStringField(collection.id, 'Collection id');
    if (idError) return idError;
    const nameError = requiredStringField(collection.name, `Collection ${collection.id} name`);
    if (nameError) return nameError;
    const descriptionError = optionalNullableStringField(collection.description, `Collection ${collection.id} description`);
    if (descriptionError) return descriptionError;
    const sortIndexError = integerField(collection.sortIndex, `Collection ${collection.id} sortIndex`);
    if (sortIndexError) return sortIndexError;
  }

  for (const item of optionalArray(manifest.collectionItems)) {
    const idError = requiredStringField(item.id, 'Collection item id');
    if (idError) return idError;
    const collectionIdError = requiredStringField(item.collectionId, `Collection item ${item.id} collectionId`);
    if (collectionIdError) return collectionIdError;
    const roleError = requiredStringField(item.role, `Collection item ${item.id} role`);
    if (roleError) return roleError;
    const sortIndexError = integerField(item.sortIndex, `Collection item ${item.id} sortIndex`);
    if (sortIndexError) return sortIndexError;
  }

  return null;
}

function validateManifestVocabulary(manifest: ExportManifest): string | null {
  const hasMediaKind = (value: unknown, label: string) =>
    value === undefined || value === null || MediaKindSchema.safeParse(value).success
      ? null
      : `${label} mediaKind must be image, audio, or video`;
  const hasSubjectType = (value: unknown, label: string) =>
    SpaceSubjectTypeSchema.safeParse(value).success ? null : `${label} subjectType must be asset or variant`;
  const hasLineageRelationType = (value: unknown, label: string) =>
    value === 'derived' || value === 'refined' || value === 'forked'
      ? null
      : `${label} relationType must be derived, refined, or forked`;
  for (const asset of manifest.assets) {
    const assetMediaKindError = hasMediaKind(asset.mediaKind, `Asset ${asset.id}`);
    if (assetMediaKindError) return assetMediaKindError;
    const assetMediaKind = asset.mediaKind ?? DEFAULT_MEDIA_KIND;
    for (const variant of asset.variants) {
      const variantMediaKindError = hasMediaKind(variant.mediaKind, `Variant ${variant.id}`);
      if (variantMediaKindError) return variantMediaKindError;
      const variantMediaKind = variant.mediaKind ?? assetMediaKind;
      if (variantMediaKind !== assetMediaKind) {
        return `Variant ${variant.id} mediaKind must match asset ${asset.id} mediaKind: ${assetMediaKind}`;
      }
    }
  }
  for (const lineage of manifest.lineage ?? []) {
    const error = hasLineageRelationType(lineage.relationType, 'Lineage');
    if (error) return error;
  }
  for (const item of optionalArray(manifest.collectionItems)) {
    const error = hasSubjectType(item.subjectType, `Collection item ${item.id}`);
    if (error) return error;
  }
  return null;
}

function validateManifestMediaFiles(manifest: ExportManifest, unzipped: Record<string, Uint8Array>): string | null {
  for (const asset of manifest.assets) {
    for (const variant of asset.variants) {
      const mediaFile = getVariantImportMediaFile(variant);
      if (!mediaFile || !unzipped[mediaFile]) {
        return `missing media for variant ${variant.id}`;
      }
    }
  }
  return null;
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
      type: string;
      media_kind?: MediaKind;
      tags: string;
      active_variant_id: string | null;
      created_at: number;
    }>;
    variants: Array<{
      id: string;
      asset_id: string;
      media_kind?: MediaKind;
      status?: string;
      image_key: string | null;
      thumb_key: string | null;
      media_key?: string | null;
      media_mime_type?: string | null;
      media_size_bytes?: number | null;
      media_width?: number | null;
      media_height?: number | null;
      media_duration_ms?: number | null;
      generation_provenance?: string | null;
      provider_metadata?: string | null;
      recipe: string;
      created_at: number;
    }>;
    lineage?: Array<{
      id?: string;
      parent_variant_id: string;
      child_variant_id: string;
      relation_type: string;
      severed?: boolean | number;
    }>;
    collections?: Array<{
      id: string;
      name: string;
      description: string | null;
      sort_index: number;
    }>;
    collectionItems?: Array<{
      id: string;
      collection_id: string;
      subject_type: ExportSubjectType;
      asset_id: string | null;
      variant_id: string | null;
      role: string;
      pinned_variant_id: string | null;
      sort_index: number;
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
    lineage: [],
    collections: [],
    collectionItems: [],
  };

  const exportedAssetIds = new Set<string>();
  const exportedVariantIds = new Set<string>();
  const exportedVariantAssetIds = new Map<string, string>();

  // Process each asset
  for (const asset of state.assets) {
    const assetVariants = state.variants.filter(v => v.asset_id === asset.id);
    const exportAsset: ExportAsset = {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      mediaKind: asset.media_kind ?? DEFAULT_MEDIA_KIND,
      tags: JSON.parse(asset.tags || '[]'),
      activeVariantId: null,
      createdAt: asset.created_at,
      variants: [],
    };

    // Process each variant
    for (const variant of assetVariants) {
      if (variant.status && variant.status !== 'completed') {
        continue;
      }
      const mediaKind = variant.media_kind ?? asset.media_kind ?? DEFAULT_MEDIA_KIND;
      const canonicalMediaKey = variant.media_key ?? variant.image_key ?? null;
      if (!canonicalMediaKey) {
        return c.json({ error: `Cannot export space: missing media key for variant ${variant.id}` }, 409);
      }

      const mediaObject = await env.IMAGES.get(canonicalMediaKey);
      if (!mediaObject) {
        return c.json({ error: `Cannot export space: missing media object for variant ${variant.id}` }, 409);
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
        generation_provenance: parseJsonForManifest(variant.generation_provenance),
        provider_metadata: parseJsonForManifest(variant.provider_metadata),
        createdAt: variant.created_at,
      });
    }

    if (exportAsset.variants.length === 0) {
      continue;
    }

    exportAsset.activeVariantId = asset.active_variant_id && exportAsset.variants.some((variant) => variant.id === asset.active_variant_id)
      ? asset.active_variant_id
      : null;
    manifest.assets.push(exportAsset);
    exportedAssetIds.add(asset.id);
    for (const variant of exportAsset.variants) {
      exportedVariantIds.add(variant.id);
      exportedVariantAssetIds.set(variant.id, asset.id);
    }
  }

  const subjectExported = (
    subjectType: ExportSubjectType,
    assetId: string | null,
    variantId: string | null
  ) => subjectType === 'asset'
    ? Boolean(assetId && exportedAssetIds.has(assetId))
    : Boolean(variantId && exportedVariantIds.has(variantId));

  manifest.lineage = (state.lineage || [])
    .filter(l => exportedVariantIds.has(l.parent_variant_id) && exportedVariantIds.has(l.child_variant_id))
    .map(l => ({
      id: l.id,
      parentVariantId: l.parent_variant_id,
      childVariantId: l.child_variant_id,
      relationType: l.relation_type as ExportLineage['relationType'],
      severed: Boolean(l.severed),
    }));
  manifest.collections = (state.collections || []).map(collection => ({
    id: collection.id,
    name: collection.name,
    description: collection.description,
    sortIndex: collection.sort_index,
  }));
  manifest.collectionItems = (state.collectionItems || [])
    .filter(item => subjectExported(item.subject_type, item.asset_id, item.variant_id))
    .map(item => ({
      id: item.id,
      collectionId: item.collection_id,
      subjectType: item.subject_type,
      assetId: item.asset_id,
      variantId: item.variant_id,
      role: item.role,
      pinnedVariantId: item.pinned_variant_id && exportedVariantIds.has(item.pinned_variant_id)
        ? item.pinned_variant_id
        : null,
      sortIndex: item.sort_index,
    }));
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

  const manifestFieldError = validateManifestOrganizationFields(manifest);
  if (manifestFieldError) {
    return c.json({ error: `Invalid export manifest: ${manifestFieldError}` }, 400);
  }
  const manifestVocabularyError = validateManifestVocabulary(manifest);
  if (manifestVocabularyError) {
    return c.json({ error: `Invalid export manifest: ${manifestVocabularyError}` }, 400);
  }
  const manifestReferenceError = validateManifestReferences(manifest);
  if (manifestReferenceError) {
    return c.json({ error: `Invalid export manifest: ${manifestReferenceError}` }, 400);
  }
  const manifestMediaError = validateManifestMediaFiles(manifest, unzipped);
  if (manifestMediaError) {
    return c.json({ error: `Invalid export file: ${manifestMediaError}` }, 400);
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
  const collectionIdMap = new Map<string, string>();
  const collectionItemIdMap = new Map<string, string>();
  const imageKeyMap = new Map<string, string>();
  const variantMediaKeys = new Map<string, { mediaKey: string; imageKey: string | null; thumbKey: string | null }>();

  const importedAssets: string[] = [];
  const importedVariants: string[] = [];
  const importedCollections: string[] = [];
  const importedCollectionItems: string[] = [];

  for (const asset of manifest.assets) {
    assetIdMap.set(asset.id, crypto.randomUUID());
    for (const variant of asset.variants) {
      const newVariantId = crypto.randomUUID();
      const mediaKind = variant.mediaKind ?? asset.mediaKind ?? DEFAULT_MEDIA_KIND;
      const keys = getVariantImportMediaKeys(spaceId, newVariantId, variant, mediaKind);
      variantIdMap.set(variant.id, newVariantId);
      variantMediaKeys.set(variant.id, keys);
      if (variant.mediaKey) imageKeyMap.set(variant.mediaKey, keys.mediaKey);
      const mediaFile = getVariantImportMediaFile(variant);
      if (mediaFile) imageKeyMap.set(mediaFile, keys.mediaKey);
    }
  }
  for (const collection of optionalArray(manifest.collections)) {
    collectionIdMap.set(collection.id, crypto.randomUUID());
  }
  // Import each asset
  for (const asset of manifest.assets) {
    // Create new asset
    const newAssetId = assetIdMap.get(asset.id)!;

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
      const mediaFile = getVariantImportMediaFile(variant)!;
      const mediaData = unzipped[mediaFile];

      const imageData = variant.imageFile ? unzipped[variant.imageFile] : undefined;
      const thumbData = variant.thumbFile ? unzipped[variant.thumbFile] : undefined;
      const newVariantId = variantIdMap.get(variant.id)!;
      const keys = variantMediaKeys.get(variant.id)!;

      // Upload media to R2
      const { mediaKey, imageKey, thumbKey } = keys;
      const mediaMimeType = variant.mediaMimeType ?? (mediaKind === 'video' ? 'video/mp4' : mediaKind === 'audio' ? 'audio/mpeg' : 'image/png');

      await env.IMAGES.put(mediaKey, mediaData, {
        httpMetadata: immutableMediaHttpMetadata(mediaKey, mediaMimeType),
      });

      if (thumbKey && thumbData) {
        await env.IMAGES.put(thumbKey, thumbData, {
          httpMetadata: immutableMediaHttpMetadata(thumbKey, 'image/png'),
        });
      } else if (thumbKey) {
        // Use main image as thumb if no thumb
        await env.IMAGES.put(thumbKey, imageData ?? mediaData, {
          httpMetadata: immutableMediaHttpMetadata(thumbKey, 'image/png'),
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
          recipe: JSON.stringify(remapImportJsonValue(variant.recipe ?? { type: 'import' }, {
            assetIdMap,
            variantIdMap,
            collectionIdMap,
            imageKeyMap,
          })),
          generationProvenance: remapImportJsonValue(variant.generation_provenance, {
            assetIdMap,
            variantIdMap,
            collectionIdMap,
            imageKeyMap,
          }),
          providerMetadata: variant.provider_metadata,
          createdBy: userId,
        }),
      }));

      if (!applyResponse.ok) {
        const error = await applyResponse.json().catch(() => ({})) as { error?: string };
        return c.json({ error: error.error || 'Failed to import variant' }, applyResponse.status as 400 | 500);
      }
      importedVariants.push(newVariantId);
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

    if (!newParentId || !newChildId) {
      return c.json({ error: `Invalid export manifest: lineage references a variant that was not imported` }, 400);
    }

    // Space ZIP import is a data portability path. It remaps immutable lineage
    // from the source Space; do not use it as a casual lineage editing surface.
    const lineageResponse = await doStub.fetch(new Request('http://do/internal/add-lineage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentVariantId: newParentId,
        childVariantId: newChildId,
        relationType: lineage.relationType,
        severed: lineage.severed ?? false,
      }),
    }));
    if (!lineageResponse.ok) {
      const error = await lineageResponse.json().catch(() => ({})) as { error?: string };
      return c.json({ error: error.error || 'Failed to import lineage' }, lineageResponse.status as 400 | 500);
    }
    lineageImported++;
  }

  for (const collection of optionalArray(manifest.collections)) {
    const newCollectionId = collectionIdMap.get(collection.id)!;
    const response = await doStub.fetch(new Request('http://do/internal/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: newCollectionId,
        name: collection.name,
        description: collection.description,
        sortIndex: collection.sortIndex,
        createdBy: userId,
      }),
    }));
    if (!response.ok) return c.json({ error: 'Failed to import collection' }, response.status as 400 | 500);
    importedCollections.push(newCollectionId);
  }

  for (const item of optionalArray(manifest.collectionItems)) {
    const newItemId = crypto.randomUUID();
    collectionItemIdMap.set(item.id, newItemId);
    const newCollectionId = requireMappedId(collectionIdMap, item.collectionId, `Collection item ${item.id} collectionId`)!;
    const response = await doStub.fetch(new Request(`http://do/internal/collections/${newCollectionId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: newItemId,
        ...subjectInput(item.subjectType, item.assetId, item.variantId, assetIdMap, variantIdMap, `Collection item ${item.id}`),
        role: item.role,
        pinnedVariantId: requireMappedId(variantIdMap, item.pinnedVariantId, `Collection item ${item.id} pinnedVariantId`),
        sortIndex: item.sortIndex,
        createdBy: userId,
      }),
    }));
    if (!response.ok) return c.json({ error: 'Failed to import collection item' }, response.status as 400 | 500);
    importedCollectionItems.push(newItemId);
  }

  return c.json({
    success: true,
    imported: {
      assets: importedAssets.length,
      variants: importedVariants.length,
      lineage: lineageImported,
      collections: importedCollections.length,
      collectionItems: importedCollectionItems.length,
    },
  });
});
