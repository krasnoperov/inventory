/**
 * Upload Command - Upload one media file to create variants
 *
 * Usage:
 *   makefx upload <file> --space <id> --asset <id>     Upload to existing asset
 *   makefx upload <file> --space <id> --name <name>    Upload as new asset
 *   makefx upload <file> --space <id> --name <name> --type <type>
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import { loadProjectConfig, type ProjectConfig } from '../lib/project-config';
import {
  loginCommandForEnvironment,
  resolveCommandEnvironment,
  resolveCommandSpace,
} from '../lib/command-context';
import type { ErrorResponse, UploadMediaResponse } from '../../api/types';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
  resolveMediaType,
} from '../lib/media-upload';

type LineageRelationType = 'derived' | 'refined' | 'forked';
type ActiveVariantBehavior = 'if-missing' | 'set-active' | 'keep';
type SpaceSubjectType = 'asset' | 'variant';
type SpaceRelationType =
  | 'appears_in'
  | 'background_for'
  | 'style_reference_for'
  | 'thumbnail_for'
  | 'alternate_of'
  | 'prop_in'
  | 'map_for'
  | 'part_of'
  | 'reference_for'
  | 'custom';

interface UploadResult {
  asset?: UploadMediaResponse['asset'];
  variant: UploadMediaResponse['variant'];
  lineage?: UploadMediaResponse['lineage'];
  organization?: {
    collectionItemIds: string[];
    relationIds: string[];
  };
}

interface UploadContext {
  spaceId: string;
  baseUrl: string;
  accessToken: string;
}

interface CollectionPlacementOption {
  collectionId?: string;
  collectionName?: string;
  role: string;
  subjectType: SpaceSubjectType;
  pinnedVariantId?: string | null;
}

interface ManualRelationOption {
  relationType: SpaceRelationType;
  object: {
    subjectType: SpaceSubjectType;
    assetId?: string;
    variantId?: string;
  };
  subjectType: SpaceSubjectType;
  label?: string;
  context?: string | Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface AssetSummary {
  id: string;
  media_kind?: string | null;
  active_variant_id?: string | null;
}

interface VariantSummary {
  id: string;
  asset_id: string;
  media_kind?: string | null;
}

interface SpaceCollectionSummary {
  id: string;
  name?: string | null;
}

interface UploadDeps {
  loadConfig: typeof loadStoredConfig;
  loadProjectConfig: () => Promise<ProjectConfig | null>;
  resolveBaseUrl: typeof resolveBaseUrl;
  fetch: typeof fetch;
  readFile: typeof readFile;
  stat: typeof stat;
  print: (message: string) => void;
}

const defaultDeps: UploadDeps = {
  loadConfig: loadStoredConfig,
  loadProjectConfig,
  resolveBaseUrl,
  fetch,
  readFile,
  stat,
  print: console.log,
};

class UploadUsageError extends Error {}

export async function handleUpload(parsed: ParsedArgs): Promise<void> {
  try {
    await executeUpload(parsed);
  } catch (error) {
    console.error(error instanceof Error ? `Error: ${error.message}` : 'Error: Upload failed');
    if (error instanceof UploadUsageError) {
      printUsage();
    }
    process.exitCode = 1;
  }
}

export async function executeUpload(
  parsed: ParsedArgs,
  deps: UploadDeps = defaultDeps
): Promise<UploadResult> {
  const filePath = parsed.positionals[0];
  if (!filePath) {
    throw new UploadUsageError('File path is required');
  }

  const projectConfig = await deps.loadProjectConfig();
  const env = resolveCommandEnvironment(parsed, projectConfig);
  const spaceId = resolveCommandSpace(parsed, projectConfig);
  const assetId = parsed.options.asset;
  const assetName = parsed.options.name;
  const assetType = parsed.options.type || 'character';
  const requestedMediaKind = parsed.options['media-kind'] || parsed.options.mediaKind;
  const prompt = parsed.options.prompt;
  const model = parsed.options.model;
  const provider = parsed.options.provider;
  const rawProviderMetadata = parsed.options['provider-metadata'] ?? parsed.options.providerMetadata ?? parsed.options.provider_metadata;
  const rawGenerationProvenance = parsed.options['generation-provenance'] ?? parsed.options.generationProvenance ?? parsed.options.generation_provenance;
  const rawSourceVariantIds = parsed.options['source-variants']
    ?? parsed.options.sourceVariants
    ?? parsed.options.sourceVariantIds
    ?? parsed.options['source-variant']
    ?? parsed.options.sourceVariantId
    ?? parsed.options.parentVariantId;
  const rawRelationType = parsed.options['relation-type'] ?? parsed.options.relationType;
  const rawActiveVariantBehavior = parsed.options['active-variant-behavior'] ?? parsed.options.activeVariantBehavior;
  const rawCollectionIds = parsed.options.collection ?? parsed.options.collections;
  const rawCollectionNames = parsed.options['collection-name'] ?? parsed.options.collectionName;
  const rawCollectionRole = parsed.options['collection-role'] ?? parsed.options.collectionRole;
  const rawCollectionSubject = parsed.options['collection-subject'] ?? parsed.options.collectionSubject;
  const rawCollectionPinnedVariant = parsed.options['collection-pinned-variant'] ?? parsed.options.collectionPinnedVariant;
  const rawManualRelation = parsed.options['manual-relation'] ?? parsed.options.manualRelation;
  const rawManualRelationSubject = parsed.options['manual-relation-subject'] ?? parsed.options.manualRelationSubject;
  const rawManualRelationLabel = parsed.options['manual-relation-label'] ?? parsed.options.manualRelationLabel;
  const rawManualRelationContext = parsed.options['manual-relation-context'] ?? parsed.options.manualRelationContext;
  const rawManualRelationMetadata = parsed.options['manual-relation-metadata'] ?? parsed.options.manualRelationMetadata;
  const jsonOutput = parsed.options.json === 'true';

  if (parsed.options['dry-run'] === 'true' || parsed.options.dryRun === 'true') {
    throw new UploadUsageError('--dry-run is not supported for direct file upload');
  }

  if (!spaceId) {
    throw new UploadUsageError('--space is required, or run: makefx init --space <id>');
  }

  if (!assetId && !assetName) {
    throw new UploadUsageError('Either --asset or --name is required');
  }

  const providerMetadata = parseJsonObjectOption(rawProviderMetadata, '--provider-metadata');
  const generationProvenance = parseJsonObjectOption(rawGenerationProvenance, '--generation-provenance');
  const sourceVariantIds = parseCsvOption(rawSourceVariantIds, '--source-variant');
  const relationType = normalizeRelationType(rawRelationType);
  const activeVariantBehavior = normalizeActiveVariantBehavior(rawActiveVariantBehavior);

  if (sourceVariantIds.length === 0 && (parsed.options['relation-type'] || parsed.options.relationType)) {
    throw new UploadUsageError('--relation-type requires --source-variant or --source-variants');
  }
  const collectionPlacements = parseCollectionPlacements({
    collectionIds: rawCollectionIds,
    collectionNames: rawCollectionNames,
    role: rawCollectionRole,
    subjectType: rawCollectionSubject,
    pinnedVariant: rawCollectionPinnedVariant,
  });
  const manualRelations = parseManualRelations({
    relations: rawManualRelation,
    subjectType: rawManualRelationSubject,
    label: rawManualRelationLabel,
    context: rawManualRelationContext,
    metadata: rawManualRelationMetadata,
  });

  // Validate file extension
  const ext = path.extname(filePath).toLowerCase();
  const mediaType = resolveMediaType(ext, requestedMediaKind);

  // Load config
  const config = await deps.loadConfig(env);
  if (!config) {
    throw new Error(`Not logged in to ${env} environment. Run: ${loginCommandForEnvironment(env)}`);
  }

  // Check token expiry
  if (config.token.expiresAt < Date.now()) {
    throw new Error(`Token expired for ${env} environment. Run: ${loginCommandForEnvironment(env)}`);
  }

  const baseUrl = deps.resolveBaseUrl(env);
  const accessToken = config.token.accessToken;
  const ctx: UploadContext = { spaceId, baseUrl, accessToken };

  // Disable SSL verification for local dev
  if (env === 'local') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  try {
    // Check file exists and size
    const fileStat = await deps.stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error(`"${filePath}" is not a file`);
    }

    if (fileStat.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`File too large (${(fileStat.size / 1024 / 1024).toFixed(2)}MB). Maximum size: ${MAX_FILE_SIZE_MB}MB`);
    }

    await preflightUploadOrganization(ctx, deps, {
      assetId,
      sourceVariantIds,
      collectionPlacements,
      manualRelations,
    });

    // Read file
    const fileBuffer = await deps.readFile(filePath);
    const fileName = path.basename(filePath);

    // Build FormData
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mediaType.mimeType });
    formData.append('file', blob, fileName);
    formData.append('mediaKind', mediaType.mediaKind);
    formData.append('activeVariantBehavior', activeVariantBehavior);

    if (assetId) {
      formData.append('assetId', assetId);
    } else {
      formData.append('assetName', assetName!);
      formData.append('assetType', assetType);
    }
    if (prompt) formData.append('prompt', prompt);
    if (model) formData.append('model', model);
    if (provider) formData.append('provider', provider);
    if (providerMetadata) formData.append('providerMetadata', JSON.stringify(providerMetadata));
    if (generationProvenance) formData.append('generationProvenance', JSON.stringify(generationProvenance));
    if (sourceVariantIds.length > 0) {
      formData.append('lineage', JSON.stringify(
        sourceVariantIds.map((parentVariantId) => ({ parentVariantId, relationType }))
      ));
    }

    if (!jsonOutput) {
      deps.print(`\nUploading "${fileName}" to space ${spaceId}...`);
      deps.print(`  Media kind: ${mediaType.mediaKind}`);
      if (assetId) {
        deps.print(`  Target asset: ${assetId}`);
      } else {
        deps.print(`  Creating asset: "${assetName}" (${assetType})`);
      }
      if (sourceVariantIds.length === 1) {
        deps.print(`  Source variant: ${sourceVariantIds[0]} (${relationType})`);
      } else if (sourceVariantIds.length > 1) {
        deps.print(`  Source variants: ${sourceVariantIds.join(', ')} (${relationType})`);
      }
    }

    // Upload
    const response = await deps.fetch(`${baseUrl}/api/spaces/${spaceId}/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
      body: formData,
    });

    const data = await response.json() as UploadMediaResponse | ErrorResponse;

    if (!response.ok) {
      throw new Error(`Upload failed: ${'error' in data ? data.error : response.statusText}`);
    }

    const upload = data as UploadMediaResponse;
    let organization: UploadResult['organization'] = {
      collectionItemIds: [],
      relationIds: [],
    };
    try {
      organization = await applyUploadOrganization(ctx, deps, upload, {
        collectionPlacements,
        manualRelations,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Upload created asset ${upload.variant.asset_id} and variant ${upload.variant.id}, but organization failed: ${message}`
      );
    }

    const result: UploadResult = {
      asset: upload.asset,
      variant: upload.variant,
      lineage: upload.lineage,
      organization,
    };

    if (jsonOutput) {
      deps.print(JSON.stringify(result, null, 2));
      return result;
    }

    deps.print('\nUpload successful!\n');

    if (upload.asset) {
      deps.print('New Asset:');
      deps.print(`  ID:   ${upload.asset.id}`);
      deps.print(`  Name: ${upload.asset.name}`);
      deps.print(`  Type: ${upload.asset.type}`);
      deps.print('');
    }

    deps.print('Variant:');
    deps.print(`  ID:       ${upload.variant.id}`);
    deps.print(`  Asset:    ${upload.variant.asset_id}`);
    deps.print(`  Status:   ${upload.variant.status}`);
    deps.print(`  Media:    ${upload.variant.media_kind || mediaType.mediaKind}`);
    deps.print(`  File:     ${upload.variant.media_key || upload.variant.image_key || '-'}`);
    if (upload.variant.image_key) deps.print(`  Image:    ${upload.variant.image_key}`);
    if (upload.variant.thumb_key) deps.print(`  Thumb:    ${upload.variant.thumb_key}`);
    if (upload.variant.media_mime_type) deps.print(`  MIME:     ${upload.variant.media_mime_type}`);
    if (organization.collectionItemIds.length > 0 || organization.relationIds.length > 0) {
      deps.print('\nOrganization:');
      if (organization.collectionItemIds.length > 0) {
        deps.print(`  Collection items: ${organization.collectionItemIds.join(', ')}`);
      }
      if (organization.relationIds.length > 0) {
        deps.print(`  Relations:        ${organization.relationIds.join(', ')}`);
      }
    }

    // Parse and show recipe
    if (upload.variant.recipe) {
      try {
        const recipe = JSON.parse(upload.variant.recipe);
        deps.print('\nRecipe:');
        deps.print(`  Operation: ${recipe.operation}`);
        deps.print(`  Original:  ${recipe.originalFilename}`);
        deps.print(`  Uploaded:  ${recipe.uploadedAt}`);
      } catch {
        // Ignore parse errors
      }
    }

    deps.print('\nTo inspect:');
    deps.print(`  makefx assets show ${upload.variant.asset_id} --space ${spaceId}`);

    return result;

  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    throw error;
  }
}

function parseJsonObjectOption(value: string | undefined, optionName: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new UploadUsageError(`${optionName} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UploadUsageError(`${optionName} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function parseJsonObjectOrStringOption(value: string | undefined, optionName: string): string | Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return value;
  return parseJsonObjectOption(value, optionName);
}

function normalizeRelationType(value: string | undefined): LineageRelationType {
  if (!value) return 'derived';
  if (value === 'derived' || value === 'refined' || value === 'forked') return value;
  throw new UploadUsageError('--relation-type must be derived, refined, or forked');
}

function normalizeActiveVariantBehavior(value: string | undefined): ActiveVariantBehavior {
  if (!value || value === 'if-missing' || value === 'if_missing') return 'if-missing';
  if (value === 'set-active' || value === 'set_active') return 'set-active';
  if (value === 'keep') return 'keep';
  throw new UploadUsageError('--active-variant-behavior must be if-missing, set-active, or keep');
}

function normalizeSpaceSubjectType(value: string | undefined, optionName: string, defaultValue: SpaceSubjectType): SpaceSubjectType {
  if (!value) return defaultValue;
  if (value === 'asset' || value === 'variant') return value;
  throw new UploadUsageError(`${optionName} must be asset or variant`);
}

function normalizeManualRelationType(value: string, optionName: string): SpaceRelationType {
  const valid: SpaceRelationType[] = [
    'appears_in',
    'background_for',
    'style_reference_for',
    'thumbnail_for',
    'alternate_of',
    'prop_in',
    'map_for',
    'part_of',
    'reference_for',
    'custom',
  ];
  if (valid.includes(value as SpaceRelationType)) return value as SpaceRelationType;
  throw new UploadUsageError(`${optionName} relation type is invalid`);
}

function parseCsvOption(value: string | undefined, optionName: string): string[] {
  if (!value) return [];
  if (value === 'true') {
    throw new UploadUsageError(`${optionName} requires a value`);
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseCollectionPlacements(input: {
  collectionIds?: string;
  collectionNames?: string;
  role?: string;
  subjectType?: string;
  pinnedVariant?: string;
}): CollectionPlacementOption[] {
  const collectionIds = parseCsvOption(input.collectionIds, '--collection');
  const collectionNames = parseCsvOption(input.collectionNames, '--collection-name');
  if (collectionIds.length === 0 && collectionNames.length === 0) return [];
  const subjectType = normalizeSpaceSubjectType(input.subjectType, '--collection-subject', 'asset');
  if (subjectType === 'variant' && input.pinnedVariant && input.pinnedVariant !== 'true') {
    throw new UploadUsageError('--collection-pinned-variant can only be used when --collection-subject is asset');
  }
  const pinnedVariantId = normalizeCollectionPinnedVariant(input.pinnedVariant);
  const placement = {
    role: input.role && input.role !== 'true' ? input.role : 'member',
    subjectType,
    pinnedVariantId,
  };
  return [
    ...collectionIds.map((collectionId) => ({
      ...placement,
      collectionId,
    })),
    ...collectionNames.map((collectionName) => ({
      ...placement,
      collectionName,
    })),
  ];
}

function normalizeCollectionPinnedVariant(value: string | undefined): string | null | undefined {
  if (!value || value === 'true' || value === 'uploaded') return undefined;
  if (value === 'none' || value === 'unpin') return null;
  return value;
}

function parseManualRelations(input: {
  relations?: string;
  subjectType?: string;
  label?: string;
  context?: string;
  metadata?: string;
}): ManualRelationOption[] {
  const relationSpecs = parseCsvOption(input.relations, '--manual-relation');
  if (relationSpecs.length === 0) return [];
  const subjectType = normalizeSpaceSubjectType(input.subjectType, '--manual-relation-subject', 'variant');
  const context = parseJsonObjectOrStringOption(input.context, '--manual-relation-context');
  const metadata = parseJsonObjectOption(input.metadata, '--manual-relation-metadata');

  return relationSpecs.map((spec) => {
    const parts = spec.split(':');
    if (parts.length !== 3) {
      throw new UploadUsageError('--manual-relation entries must use <relation-type>:asset:<asset-id> or <relation-type>:variant:<variant-id>');
    }
    const [relationTypeValue, objectTypeValue, objectId] = parts;
    const objectType = normalizeSpaceSubjectType(objectTypeValue, '--manual-relation object type', 'asset');
    if (!objectId) {
      throw new UploadUsageError('--manual-relation object id is required');
    }
    return {
      relationType: normalizeManualRelationType(relationTypeValue, '--manual-relation'),
      object: objectType === 'asset'
        ? { subjectType: 'asset', assetId: objectId }
        : { subjectType: 'variant', variantId: objectId },
      subjectType,
      label: input.label && input.label !== 'true' ? input.label : undefined,
      context,
      metadata,
    };
  });
}

async function preflightUploadOrganization(
  ctx: UploadContext,
  deps: Pick<UploadDeps, 'fetch'>,
  options: {
    assetId?: string;
    sourceVariantIds: string[];
    collectionPlacements: CollectionPlacementOption[];
    manualRelations: ManualRelationOption[];
  }
): Promise<void> {
  const needsCollections = options.collectionPlacements.length > 0;
  const needsAssetState =
    options.sourceVariantIds.length > 0 ||
    options.manualRelations.length > 0 ||
    options.collectionPlacements.some((placement) => placement.pinnedVariantId);

  const [collections, state] = await Promise.all([
    needsCollections ? fetchJson<{ collections: SpaceCollectionSummary[] }>(ctx, deps, `/api/spaces/${ctx.spaceId}/collections`) : undefined,
    needsAssetState ? fetchAssetState(ctx, deps) : undefined,
  ]);

  if (collections) {
    const collectionList = collections.collections ?? [];
    const collectionIds = new Set(collectionList.map((collection) => collection.id));
    for (const placement of options.collectionPlacements) {
      if (placement.collectionId && !collectionIds.has(placement.collectionId)) {
        throw new Error(`Collection not found: ${placement.collectionId}`);
      }
      if (!placement.collectionName) continue;
      const matches = collectionList.filter((collection) => collection.name === placement.collectionName);
      if (matches.length === 0) {
        throw new Error(`Collection not found by exact name: ${placement.collectionName}`);
      }
      if (matches.length > 1) {
        throw new Error(`Collection name is ambiguous: ${placement.collectionName}; use --collection <id>`);
      }
      placement.collectionId = matches[0].id;
    }
  }

  if (!state) return;

  for (const sourceVariantId of options.sourceVariantIds) {
    if (!state.variantsById.has(sourceVariantId)) {
      throw new Error(`Source variant not found in space: ${sourceVariantId}`);
    }
  }

  for (const placement of options.collectionPlacements) {
    if (!placement.pinnedVariantId) continue;
    const pinned = state.variantsById.get(placement.pinnedVariantId);
    if (!pinned) {
      throw new Error(`Collection pinned variant not found: ${placement.pinnedVariantId}`);
    }
    if (placement.subjectType === 'asset') {
      if (!options.assetId) {
        throw new Error('--collection-pinned-variant cannot reference an existing variant when creating a new asset');
      }
      if (pinned.asset_id !== options.assetId) {
        throw new Error('--collection-pinned-variant must reference a variant on the target asset');
      }
    }
  }

  for (const relation of options.manualRelations) {
    if (relation.object.subjectType === 'asset') {
      if (!relation.object.assetId || !state.assetsById.has(relation.object.assetId)) {
        throw new Error(`Manual relation object asset not found: ${relation.object.assetId ?? ''}`);
      }
    } else if (!relation.object.variantId || !state.variantsById.has(relation.object.variantId)) {
      throw new Error(`Manual relation object variant not found: ${relation.object.variantId ?? ''}`);
    }
  }
}

async function fetchAssetState(
  ctx: UploadContext,
  deps: Pick<UploadDeps, 'fetch'>
): Promise<{ assetsById: Map<string, AssetSummary>; variantsById: Map<string, VariantSummary> }> {
  const data = await fetchJson<{ assets: AssetSummary[] }>(ctx, deps, `/api/spaces/${ctx.spaceId}/assets`);
  const assets = data.assets ?? [];
  const variantsById = new Map<string, VariantSummary>();
  await Promise.all(assets.map(async (asset) => {
    const details = await fetchJson<{ variants?: VariantSummary[] }>(
      ctx,
      deps,
      `/api/spaces/${ctx.spaceId}/assets/${encodeURIComponent(asset.id)}`
    );
    for (const variant of details.variants ?? []) {
      variantsById.set(variant.id, variant);
    }
  }));
  return {
    assetsById: new Map(assets.map((asset) => [asset.id, asset])),
    variantsById,
  };
}

async function applyUploadOrganization(
  ctx: UploadContext,
  deps: Pick<UploadDeps, 'fetch'>,
  upload: UploadMediaResponse,
  options: {
    collectionPlacements: CollectionPlacementOption[];
    manualRelations: ManualRelationOption[];
  }
): Promise<{ collectionItemIds: string[]; relationIds: string[] }> {
  const collectionItemIds: string[] = [];
  const relationIds: string[] = [];
  const uploadedSubject = {
    assetId: upload.variant.asset_id,
    variantId: upload.variant.id,
  };

  for (const placement of options.collectionPlacements) {
    if (!placement.collectionId) {
      throw new Error(`Collection name was not resolved: ${placement.collectionName ?? ''}`);
    }
    const body = placement.subjectType === 'asset'
      ? {
        subjectType: 'asset',
        assetId: uploadedSubject.assetId,
        role: placement.role,
        pinnedVariantId: placement.pinnedVariantId === undefined ? uploadedSubject.variantId : placement.pinnedVariantId,
      }
      : {
        subjectType: 'variant',
        variantId: uploadedSubject.variantId,
        role: placement.role,
      };
    const created = await postJson<{ item: { id: string } }>(
      ctx,
      deps,
      `/api/spaces/${ctx.spaceId}/collections/${encodeURIComponent(placement.collectionId)}/items`,
      body
    );
    collectionItemIds.push(created.item.id);
  }

  for (const relation of options.manualRelations) {
    const created = await postJson<{ relation: { id: string } }>(ctx, deps, `/api/spaces/${ctx.spaceId}/relations`, {
      subject: relation.subjectType === 'asset'
        ? { subjectType: 'asset', assetId: uploadedSubject.assetId }
        : { subjectType: 'variant', variantId: uploadedSubject.variantId },
      object: relation.object,
      relationType: relation.relationType,
      label: relation.label,
      context: relation.context,
      metadata: relation.metadata,
    });
    relationIds.push(created.relation.id);
  }

  return { collectionItemIds, relationIds };
}

async function postJson<T>(
  ctx: UploadContext,
  deps: Pick<UploadDeps, 'fetch'>,
  requestPath: string,
  json: Record<string, unknown>
): Promise<T> {
  const response = await deps.fetch(`${ctx.baseUrl}${requestPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(stripUndefined(json)),
  });
  const data = await response.json().catch(() => ({})) as T & ErrorResponse;
  if (!response.ok) {
    throw new Error('error' in data ? data.error : `Request failed: ${response.status}`);
  }
  return data as T;
}

async function fetchJson<T>(
  ctx: UploadContext,
  deps: Pick<UploadDeps, 'fetch'>,
  requestPath: string
): Promise<T> {
  const response = await deps.fetch(`${ctx.baseUrl}${requestPath}`, {
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      Accept: 'application/json',
    },
  });
  const data = await response.json().catch(() => ({})) as T & ErrorResponse;
  if (!response.ok) {
    throw new Error('error' in data ? data.error : `Request failed: ${response.status}`);
  }
  return data as T;
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function printUsage(): void {
  console.log(`
Usage:
  makefx upload <file> --asset <id> [--space <id>]     Upload media to existing asset
  makefx upload <file> --name <name> [--space <id>]    Upload media as a new asset

Options:
  --space <id>      Target space ID; defaults from initialized project
  --asset <id>      Target asset ID (upload as new variant)
  --name <name>     New asset name (creates asset + variant)
  --type <type>     Asset type for new assets (default: character)
  --media-kind <k>  Optional explicit kind: image, audio, or video
  --prompt <text>   Prompt provenance for uploaded media
  --model <model>   Model provenance for uploaded media
  --provider <name> Provider provenance for uploaded media
  --provider-metadata <json>     Provider metadata JSON object
  --generation-provenance <json> Extra provenance JSON object
  --source-variant <ids>         Comma-separated source variants for upload lineage
  --source-variants <ids>        Alias for --source-variant
  --relation-type <type>         Lineage type: derived, refined, or forked (default: derived)
  --active-variant-behavior <b>  if-missing, set-active, or keep
  --collection <ids>             Comma-separated collection IDs for the uploaded asset or variant
  --collection-name <names>      Comma-separated exact collection names for lookup
  --collection-role <role>       Collection item role (default: member)
  --collection-subject <type>    Collection subject: asset or variant (default: asset)
  --collection-pinned-variant <id|uploaded|none>
                                 Pin an asset collection item to the uploaded variant by default
  --manual-relation <spec>       Comma-separated <type>:asset:<id> or <type>:variant:<id>
  --manual-relation-subject <type>
                                 Relation subject: uploaded asset or variant (default: variant)
  --manual-relation-label <text> Optional manual relation label
  --manual-relation-context <json|string>
                                 Optional manual relation context
  --manual-relation-metadata <json>
                                 Optional manual relation metadata object
  --json            Print machine-readable upload output with Space IDs
  --env <env>       Environment (production|stage|local)
  --local           Shortcut for --env local

Examples:
  makefx upload hero.png --space abc123 --name "Hero Character"
  makefx upload hero.png --space abc123 --name "Hero" --prompt "external render" --provider blender
  makefx upload paintover.png --space abc123 --asset def456 --source-variant var123 --relation-type refined
  makefx upload scene.png --space abc123 --name "Cocina" --type scene --source-variants anna,roman,bg
  makefx upload hero.png --space abc123 --name "Hero" --collection collection_cast --collection-role character
  makefx upload hero.png --space abc123 --name "Hero" --collection-name "Cast" --collection-role character
  makefx upload thumbnail.png --space abc123 --asset asset_thumb --manual-relation thumbnail_for:asset:asset_target
  makefx upload theme.mp3 --space abc123 --name "Theme Music" --type audio
  makefx upload cutscene.mp4 --space abc123 --name "Opening Cutscene" --type video
  makefx upload variant.jpg --space abc123 --asset def456
  makefx upload hero.png --space abc123 --name "Hero" --json
`);
}
