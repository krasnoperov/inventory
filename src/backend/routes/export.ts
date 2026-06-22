import { Hono } from 'hono';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { AppContext } from './types';
import { authMiddleware } from '../middleware/auth-middleware';
import { MemberDAO } from '../../dao/member-dao';
import { DEFAULT_MEDIA_KIND, type MediaKind } from '../../shared/websocket-types';
import {
  CompositionItemRoleSchema,
  CompositionStatusSchema,
  MediaKindSchema,
  SpaceRelationTypeSchema,
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
  stylePresets?: ExportStylePreset[];
  relations?: ExportRelation[];
  compositions?: ExportComposition[];
  compositionItems?: ExportCompositionItem[];
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

interface ExportStylePreset {
  id: string;
  name: string;
  description: string | null;
  stylePrompt: string;
  collectionId: string | null;
  enabled: boolean;
  isDefault: boolean;
}

interface ExportRelation {
  id: string;
  subjectType: ExportSubjectType;
  subjectAssetId: string | null;
  subjectVariantId: string | null;
  objectType: ExportSubjectType;
  objectAssetId: string | null;
  objectVariantId: string | null;
  relationType: string;
  label: string | null;
  context: string | null;
  metadata: unknown;
  sortIndex: number;
}

interface ExportComposition {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'final';
  outputAssetId: string | null;
  outputVariantId: string | null;
  metadata: unknown;
  sortIndex: number;
}

interface ExportCompositionItem {
  id: string;
  compositionId: string;
  role: string;
  label: string | null;
  assetId: string | null;
  variantId: string;
  metadata: unknown;
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

function parseMetadataObject(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value === 'string') {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error(`${label} must be a JSON object`);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`${label} must be an object`);
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
    stylePresetIdMap: Map<string, string>;
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
    if (key === 'stylePresetId' && typeof raw === 'string') {
      result[key] = maps.stylePresetIdMap.get(raw) ?? raw;
    } else if ((key === 'styleCollectionId' || key === 'collectionId') && typeof raw === 'string') {
      result[key] = maps.collectionIdMap.get(raw) ?? raw;
    } else if ((key === 'sourceVariantId' || key === 'variantId') && typeof raw === 'string') {
      result[key] = maps.variantIdMap.get(raw) ?? raw;
    } else if (key === 'assetId' && typeof raw === 'string') {
      result[key] = maps.assetIdMap.get(raw) ?? raw;
    } else if (
      key === 'parentVariantIds' ||
      key === 'sourceVariantIds' ||
      key === 'styleReferenceVariantIds'
    ) {
      result[key] = mapStringArrayIds(raw, maps.variantIdMap);
    } else if (
      key === 'sourceImageKeys' ||
      key === 'styleImageKeys' ||
      key === 'styleReferenceImageKeys'
    ) {
      result[key] = mapStringArrayIds(raw, maps.imageKeyMap);
    } else if ((key === 'styleImageKey' || key === 'imageKey' || key === 'mediaKey') && typeof raw === 'string') {
      result[key] = maps.imageKeyMap.get(raw) ?? raw;
    } else {
      result[key] = remapImportJsonValue(raw, maps);
    }
  }
  return result;
}

function remapImportJsonishValue(
  value: unknown,
  maps: Parameters<typeof remapImportJsonValue>[1]
): unknown {
  if (typeof value !== 'string') {
    return remapImportJsonValue(value, maps);
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    const remapped = remapImportJsonValue(parsed, maps);
    return JSON.stringify(remapped) === JSON.stringify(parsed) ? value : remapped;
  } catch {
    return value;
  }
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

function optionalNullableStringOrJsonField(value: unknown, label: string): string | null {
  if (value === undefined || value === null || typeof value === 'string') return null;
  return typeof value === 'object' ? null : `${label} must be a string, object, or null`;
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
  const compositionIds = new Set(optionalArray(manifest.compositions).map((composition) => composition.id));

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
  for (const preset of optionalArray(manifest.stylePresets)) {
    if (!preset.collectionId) continue;
    if (!collectionIds.has(preset.collectionId)) return `Style preset ${preset.id} references unknown collection: ${preset.collectionId}`;
    const nonStyleItem = optionalArray(manifest.collectionItems).find(
      (item) => item.collectionId === preset.collectionId && item.role !== 'style_ref'
    );
    if (nonStyleItem) {
      return `Style preset ${preset.id} collectionId must reference a style_ref-only collection`;
    }
  }
  for (const relation of optionalArray(manifest.relations)) {
    const subjectError = hasSubject(
      relation.subjectType,
      relation.subjectAssetId,
      relation.subjectVariantId,
      `Relation ${relation.id} subject`
    );
    if (subjectError) return subjectError;
    const objectError = hasSubject(
      relation.objectType,
      relation.objectAssetId,
      relation.objectVariantId,
      `Relation ${relation.id} object`
    );
    if (objectError) return objectError;
  }
  for (const composition of optionalArray(manifest.compositions)) {
    const assetError = hasAsset(composition.outputAssetId, `Composition ${composition.id} outputAssetId`);
    if (assetError) return assetError;
    const variantError = hasVariant(composition.outputVariantId, `Composition ${composition.id} outputVariantId`);
    if (variantError) return variantError;
    if (
      composition.outputAssetId &&
      composition.outputVariantId &&
      variantAssetIds.get(composition.outputVariantId) !== composition.outputAssetId
    ) {
      return `Composition ${composition.id} outputVariantId must belong to outputAssetId`;
    }
  }
  for (const item of optionalArray(manifest.compositionItems)) {
    if (!compositionIds.has(item.compositionId)) return `Composition item ${item.id} references unknown composition: ${item.compositionId}`;
    const assetError = hasAsset(item.assetId, `Composition item ${item.id} assetId`);
    if (assetError) return assetError;
    if (!item.variantId) return `Composition item ${item.id} is missing variantId`;
    const variantError = hasVariant(item.variantId, `Composition item ${item.id} variantId`);
    if (variantError) return variantError;
    if (item.assetId && variantAssetIds.get(item.variantId) !== item.assetId) {
      return `Composition item ${item.id} assetId must match the variant asset`;
    }
  }
  return null;
}

function validateManifestOrganizationFields(manifest: ExportManifest): string | null {
  const rawManifest = manifest as {
    collections?: unknown;
    collectionItems?: unknown;
    stylePresets?: unknown;
    relations?: unknown;
    compositions?: unknown;
    compositionItems?: unknown;
  };
  const optionalSections: Array<[unknown, string]> = [
    [rawManifest.collections, 'collections'],
    [rawManifest.collectionItems, 'collectionItems'],
    [rawManifest.stylePresets, 'stylePresets'],
    [rawManifest.relations, 'relations'],
    [rawManifest.compositions, 'compositions'],
    [rawManifest.compositionItems, 'compositionItems'],
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

  for (const preset of optionalArray(manifest.stylePresets)) {
    const idError = requiredStringField(preset.id, 'Style preset id');
    if (idError) return idError;
    const nameError = requiredStringField(preset.name, `Style preset ${preset.id} name`);
    if (nameError) return nameError;
    const descriptionError = optionalNullableStringField(preset.description, `Style preset ${preset.id} description`);
    if (descriptionError) return descriptionError;
    if (typeof preset.stylePrompt !== 'string') return `Style preset ${preset.id} stylePrompt must be a string`;
    const collectionIdError = optionalNullableStringField(preset.collectionId, `Style preset ${preset.id} collectionId`);
    if (collectionIdError) return collectionIdError;
    if (typeof preset.enabled !== 'boolean') return `Style preset ${preset.id} enabled must be a boolean`;
    if (typeof preset.isDefault !== 'boolean') return `Style preset ${preset.id} isDefault must be a boolean`;
    if (preset.isDefault && !preset.enabled) return `Style preset ${preset.id} cannot be default while disabled`;
  }

  for (const relation of optionalArray(manifest.relations)) {
    const idError = requiredStringField(relation.id, 'Relation id');
    if (idError) return idError;
    const labelError = optionalNullableStringField(relation.label, `Relation ${relation.id} label`);
    if (labelError) return labelError;
    const contextError = optionalNullableStringOrJsonField(relation.context, `Relation ${relation.id} context`);
    if (contextError) return contextError;
    const sortIndexError = integerField(relation.sortIndex, `Relation ${relation.id} sortIndex`);
    if (sortIndexError) return sortIndexError;
  }

  for (const composition of optionalArray(manifest.compositions)) {
    const idError = requiredStringField(composition.id, 'Composition id');
    if (idError) return idError;
    const nameError = requiredStringField(composition.name, `Composition ${composition.id} name`);
    if (nameError) return nameError;
    const descriptionError = optionalNullableStringField(composition.description, `Composition ${composition.id} description`);
    if (descriptionError) return descriptionError;
    const sortIndexError = integerField(composition.sortIndex, `Composition ${composition.id} sortIndex`);
    if (sortIndexError) return sortIndexError;
  }

  for (const item of optionalArray(manifest.compositionItems)) {
    const idError = requiredStringField(item.id, 'Composition item id');
    if (idError) return idError;
    const compositionIdError = requiredStringField(item.compositionId, `Composition item ${item.id} compositionId`);
    if (compositionIdError) return compositionIdError;
    const labelError = optionalNullableStringField(item.label, `Composition item ${item.id} label`);
    if (labelError) return labelError;
    const sortIndexError = integerField(item.sortIndex, `Composition item ${item.id} sortIndex`);
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
  const hasRelationType = (value: unknown, label: string) =>
    SpaceRelationTypeSchema.safeParse(value).success ? null : `${label} relationType is invalid`;
  const hasCompositionStatus = (value: unknown, label: string) =>
    CompositionStatusSchema.safeParse(value).success ? null : `${label} status must be draft or final`;
  const hasCompositionRole = (value: unknown, label: string) =>
    CompositionItemRoleSchema.safeParse(value).success ? null : `${label} role is invalid`;

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
  for (const relation of optionalArray(manifest.relations)) {
    const subjectError = hasSubjectType(relation.subjectType, `Relation ${relation.id} subject`);
    if (subjectError) return subjectError;
    const objectError = hasSubjectType(relation.objectType, `Relation ${relation.id} object`);
    if (objectError) return objectError;
    const relationTypeError = hasRelationType(relation.relationType, `Relation ${relation.id}`);
    if (relationTypeError) return relationTypeError;
  }
  for (const composition of optionalArray(manifest.compositions)) {
    const error = hasCompositionStatus(composition.status, `Composition ${composition.id}`);
    if (error) return error;
  }
  for (const item of optionalArray(manifest.compositionItems)) {
    const error = hasCompositionRole(item.role, `Composition item ${item.id}`);
    if (error) return error;
  }
  return null;
}

function validateManifestMetadata(manifest: ExportManifest): string | null {
  try {
    for (const relation of optionalArray(manifest.relations)) {
      parseMetadataObject(relation.metadata, `Relation ${relation.id} metadata`);
    }
    for (const composition of optionalArray(manifest.compositions)) {
      parseMetadataObject(composition.metadata, `Composition ${composition.id} metadata`);
    }
    for (const item of optionalArray(manifest.compositionItems)) {
      parseMetadataObject(item.metadata, `Composition item ${item.id} metadata`);
    }
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid metadata';
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
    stylePresets?: Array<{
      id: string;
      name: string;
      description: string | null;
      style_prompt: string;
      collection_id: string | null;
      enabled: boolean | number;
      is_default: boolean | number;
    }>;
    relations?: Array<{
      id: string;
      subject_type: ExportSubjectType;
      subject_asset_id: string | null;
      subject_variant_id: string | null;
      object_type: ExportSubjectType;
      object_asset_id: string | null;
      object_variant_id: string | null;
      relation_type: string;
      label?: string | null;
      context: string | null;
      metadata?: string;
      sort_index: number;
    }>;
    compositions?: Array<{
      id: string;
      name: string;
      description: string | null;
      status: 'draft' | 'final';
      output_asset_id: string | null;
      output_variant_id: string | null;
      metadata: string;
      sort_index: number;
    }>;
    compositionItems?: Array<{
      id: string;
      composition_id: string;
      role: string;
      label?: string | null;
      asset_id: string | null;
      variant_id: string;
      metadata: string;
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
    stylePresets: [],
    relations: [],
    compositions: [],
    compositionItems: [],
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
  manifest.stylePresets = (state.stylePresets || []).map(preset => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    stylePrompt: preset.style_prompt,
    collectionId: preset.collection_id,
    enabled: Boolean(preset.enabled),
    isDefault: Boolean(preset.is_default),
  }));
  manifest.relations = (state.relations || [])
    .filter(relation =>
      subjectExported(relation.subject_type, relation.subject_asset_id, relation.subject_variant_id) &&
      subjectExported(relation.object_type, relation.object_asset_id, relation.object_variant_id)
    )
    .map(relation => ({
      id: relation.id,
      subjectType: relation.subject_type,
      subjectAssetId: relation.subject_asset_id,
      subjectVariantId: relation.subject_variant_id,
      objectType: relation.object_type,
      objectAssetId: relation.object_asset_id,
      objectVariantId: relation.object_variant_id,
      relationType: relation.relation_type,
      label: relation.label ?? null,
      context: relation.context,
      metadata: parseJsonForManifest(relation.metadata),
      sortIndex: relation.sort_index,
    }));
  manifest.compositions = (state.compositions || []).map(composition => {
    const outputVariantId = composition.output_variant_id && exportedVariantIds.has(composition.output_variant_id)
      ? composition.output_variant_id
      : null;
    const outputAssetId = outputVariantId
      ? exportedVariantAssetIds.get(outputVariantId) ?? null
      : composition.output_asset_id && exportedAssetIds.has(composition.output_asset_id)
        ? composition.output_asset_id
        : null;
    return {
      id: composition.id,
      name: composition.name,
      description: composition.description,
      status: composition.status,
      outputAssetId,
      outputVariantId,
      metadata: parseJsonForManifest(composition.metadata),
      sortIndex: composition.sort_index,
    };
  });
  manifest.compositionItems = (state.compositionItems || [])
    .filter(item => exportedVariantIds.has(item.variant_id))
    .map(item => ({
      id: item.id,
      compositionId: item.composition_id,
      role: item.role,
      label: item.label ?? null,
      assetId: exportedVariantAssetIds.get(item.variant_id) ?? null,
      variantId: item.variant_id,
      metadata: parseJsonForManifest(item.metadata),
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
  const manifestMetadataError = validateManifestMetadata(manifest);
  if (manifestMetadataError) {
    return c.json({ error: `Invalid export manifest: ${manifestMetadataError}` }, 400);
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
  const stylePresetIdMap = new Map<string, string>();
  const imageKeyMap = new Map<string, string>();
  const variantMediaKeys = new Map<string, { mediaKey: string; imageKey: string | null; thumbKey: string | null }>();
  const relationIdMap = new Map<string, string>();
  const compositionIdMap = new Map<string, string>();
  const compositionItemIdMap = new Map<string, string>();

  const importedAssets: string[] = [];
  const importedVariants: string[] = [];
  const importedCollections: string[] = [];
  const importedCollectionItems: string[] = [];
  const importedStylePresets: string[] = [];
  const importedRelations: string[] = [];
  const importedCompositions: string[] = [];
  const importedCompositionItems: string[] = [];

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
  for (const preset of optionalArray(manifest.stylePresets)) {
    stylePresetIdMap.set(preset.id, crypto.randomUUID());
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
            stylePresetIdMap,
            imageKeyMap,
          })),
          generationProvenance: remapImportJsonValue(variant.generation_provenance, {
            assetIdMap,
            variantIdMap,
            collectionIdMap,
            stylePresetIdMap,
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

  for (const preset of optionalArray(manifest.stylePresets)) {
    const newPresetId = stylePresetIdMap.get(preset.id)!;
    const response = await doStub.fetch(new Request('http://do/internal/style-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: newPresetId,
        name: preset.name,
        description: preset.description,
        stylePrompt: preset.stylePrompt,
        collectionId: requireMappedId(collectionIdMap, preset.collectionId, `Style preset ${preset.id} collectionId`),
        enabled: preset.enabled,
        isDefault: preset.isDefault,
        createdBy: userId,
      }),
    }));
    if (!response.ok) return c.json({ error: 'Failed to import style preset' }, response.status as 400 | 500);
    importedStylePresets.push(newPresetId);
  }

  for (const relation of optionalArray(manifest.relations)) {
    const newRelationId = crypto.randomUUID();
    relationIdMap.set(relation.id, newRelationId);
    const response = await doStub.fetch(new Request('http://do/internal/relations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: newRelationId,
        subject: subjectInput(
          relation.subjectType,
          relation.subjectAssetId,
          relation.subjectVariantId,
          assetIdMap,
          variantIdMap,
          `Relation ${relation.id} subject`
        ),
        object: subjectInput(
          relation.objectType,
          relation.objectAssetId,
          relation.objectVariantId,
          assetIdMap,
          variantIdMap,
          `Relation ${relation.id} object`
        ),
        relationType: relation.relationType,
        label: relation.label ?? null,
        context: remapImportJsonishValue(relation.context, {
          assetIdMap,
          variantIdMap,
          collectionIdMap,
          stylePresetIdMap,
          imageKeyMap,
        }),
        metadata: remapImportJsonValue(parseMetadataObject(relation.metadata, `Relation ${relation.id} metadata`), {
          assetIdMap,
          variantIdMap,
          collectionIdMap,
          stylePresetIdMap,
          imageKeyMap,
        }),
        sortIndex: relation.sortIndex,
        createdBy: userId,
      }),
    }));
    if (!response.ok) return c.json({ error: 'Failed to import relation' }, response.status as 400 | 500);
    importedRelations.push(newRelationId);
  }

  for (const composition of optionalArray(manifest.compositions)) {
    const newCompositionId = crypto.randomUUID();
    compositionIdMap.set(composition.id, newCompositionId);
    const response = await doStub.fetch(new Request('http://do/internal/compositions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: newCompositionId,
        name: composition.name,
        description: composition.description,
        status: composition.status,
        outputAssetId: requireMappedId(assetIdMap, composition.outputAssetId, `Composition ${composition.id} outputAssetId`),
        outputVariantId: requireMappedId(variantIdMap, composition.outputVariantId, `Composition ${composition.id} outputVariantId`),
        metadata: parseMetadataObject(composition.metadata, `Composition ${composition.id} metadata`),
        sortIndex: composition.sortIndex,
        createdBy: userId,
      }),
    }));
    if (!response.ok) return c.json({ error: 'Failed to import composition' }, response.status as 400 | 500);
    importedCompositions.push(newCompositionId);
  }

  for (const item of optionalArray(manifest.compositionItems)) {
    const newItemId = crypto.randomUUID();
    compositionItemIdMap.set(item.id, newItemId);
    const newCompositionId = requireMappedId(compositionIdMap, item.compositionId, `Composition item ${item.id} compositionId`)!;
    const response = await doStub.fetch(new Request(`http://do/internal/compositions/${newCompositionId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: newItemId,
        role: item.role,
        label: item.label ?? null,
        assetId: requireMappedId(assetIdMap, item.assetId, `Composition item ${item.id} assetId`),
        variantId: requireMappedId(variantIdMap, item.variantId, `Composition item ${item.id} variantId`),
        metadata: parseMetadataObject(item.metadata, `Composition item ${item.id} metadata`),
        sortIndex: item.sortIndex,
        createdBy: userId,
      }),
    }));
    if (!response.ok) return c.json({ error: 'Failed to import composition item' }, response.status as 400 | 500);
    importedCompositionItems.push(newItemId);
  }

  return c.json({
    success: true,
    imported: {
      assets: importedAssets.length,
      variants: importedVariants.length,
      lineage: lineageImported,
      collections: importedCollections.length,
      collectionItems: importedCollectionItems.length,
      stylePresets: importedStylePresets.length,
      relations: importedRelations.length,
      compositions: importedCompositions.length,
      compositionItems: importedCompositionItems.length,
    },
  });
});
