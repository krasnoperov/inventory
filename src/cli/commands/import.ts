import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { ParsedArgs, StoredConfig } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import { loadProjectConfig, type ProjectConfig } from '../lib/project-config';
import {
  loginCommandForEnvironment,
  resolveCommandEnvironment,
  resolveCommandSpace,
} from '../lib/command-context';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
  resolveMediaType,
} from '../lib/media-upload';
import type { ErrorResponse, MediaKind, UploadMediaResponse } from '../../api/types';

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
type CompositionItemRole =
  | 'output'
  | 'background'
  | 'character'
  | 'prop'
  | 'style_ref'
  | 'overlay'
  | 'map'
  | 'thumbnail'
  | 'custom';
type CompositionStatus = 'draft' | 'final';
type PinnedVariantBehavior = 'imported' | 'none';

interface ManifestLineageInput {
  sourceVariantId?: string;
  parentVariantId?: string;
  sourceFile?: string;
  relationType?: string;
}

interface ManifestRecord {
  key?: string;
  localKey?: string;
  file?: string;
  path?: string;
  name?: string;
  assetName?: string;
  assetType?: string;
  type?: string;
  assetId?: string;
  targetAssetId?: string;
  mediaKind?: string;
  activeVariantBehavior?: string;
  prompt?: string;
  model?: string;
  provider?: string;
  providerMetadata?: Record<string, unknown>;
  provider_metadata?: Record<string, unknown>;
  generationProvenance?: Record<string, unknown>;
  generation_provenance?: Record<string, unknown>;
  lineage?: ManifestLineageInput[];
  collections?: ManifestCollectionItemInput[];
  collectionItems?: ManifestCollectionItemInput[];
  relations?: ManifestRelationInput[];
  compositionItems?: ManifestCompositionItemInput[];
  styleCollections?: Array<string | ManifestStyleCollectionInput>;
}

interface NormalizedLineageInput {
  relationType: LineageRelationType;
  sourceVariantId?: string;
  sourceFile?: string;
}

interface NormalizedRecord {
  index: number;
  localKey: string;
  filePath: string;
  displayPath: string;
  fileName: string;
  assetName?: string;
  assetType: string;
  assetId?: string;
  mediaKind: MediaKind;
  mimeType: string;
  activeVariantBehavior: ActiveVariantBehavior;
  prompt?: string;
  model?: string;
  provider?: string;
  providerMetadata?: Record<string, unknown>;
  generationProvenance: Record<string, unknown>;
  lineage: NormalizedLineageInput[];
  collectionItems: NormalizedCollectionItemInput[];
  relations: NormalizedRelationInput[];
  compositionItems: NormalizedCompositionItemInput[];
  styleCollections: NormalizedStyleCollectionInput[];
}

interface ManifestCollectionInput {
  id?: string;
  name?: string;
  collection?: string;
  collectionName?: string;
  description?: string | null;
  sortIndex?: number;
  create?: boolean;
  createIfMissing?: boolean;
}

interface ManifestStyleCollectionInput extends ManifestCollectionInput {
  refs?: string[];
  records?: string[];
}

interface ManifestCollectionItemInput {
  id?: string;
  collection?: string;
  collectionName?: string;
  collectionId?: string;
  role?: string;
  subjectType?: string;
  assetId?: string;
  variantId?: string;
  recordKey?: string;
  sourceFile?: string;
  pinnedVariantId?: string | null;
  pinnedVariantBehavior?: string;
  sortIndex?: number;
}

interface ManifestSubjectInput {
  subjectType?: string;
  type?: string;
  assetId?: string;
  variantId?: string;
  recordKey?: string;
  sourceFile?: string;
}

interface ManifestRelationInput {
  id?: string;
  subject?: ManifestSubjectInput;
  object?: ManifestSubjectInput;
  subjectType?: string;
  subjectAssetId?: string;
  subjectVariantId?: string;
  objectType?: string;
  objectAssetId?: string;
  objectVariantId?: string;
  target?: ManifestSubjectInput;
  relationType?: string;
  label?: string | null;
  context?: string | Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  sortIndex?: number;
}

interface ManifestCompositionInput {
  id?: string;
  name?: string;
  composition?: string;
  compositionName?: string;
  description?: string | null;
  status?: string;
  output?: ManifestSubjectInput;
  outputAssetId?: string | null;
  outputVariantId?: string | null;
  outputRecordKey?: string;
  metadata?: Record<string, unknown>;
  sortIndex?: number;
  create?: boolean;
  createIfMissing?: boolean;
}

interface ManifestCompositionItemInput {
  id?: string;
  composition?: string;
  compositionName?: string;
  compositionId?: string;
  role?: string;
  label?: string | null;
  assetId?: string | null;
  variantId?: string;
  recordKey?: string;
  sourceFile?: string;
  metadata?: Record<string, unknown>;
  sortIndex?: number;
}

interface ManifestStylePresetInput {
  id?: string;
  name?: string;
  presetName?: string;
  description?: string | null;
  prompt?: string;
  stylePrompt?: string;
  collection?: string;
  collectionName?: string;
  collectionId?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
  default?: boolean;
  create?: boolean;
  update?: boolean;
  upsert?: boolean;
}

interface ManifestRoot {
  records?: unknown;
  files?: unknown;
  collections?: unknown;
  styleCollections?: unknown;
  compositions?: unknown;
  collectionItems?: unknown;
  relations?: unknown;
  compositionItems?: unknown;
  stylePresets?: unknown;
}

interface NormalizedCollectionInput {
  key: string;
  name: string;
  description?: string | null;
  sortIndex?: number;
  create: boolean;
}

interface NormalizedStyleCollectionInput extends NormalizedCollectionInput {
  refs: string[];
}

interface NormalizedCollectionItemInput {
  id?: string;
  collectionName: string;
  role: string;
  subjectType: SpaceSubjectType;
  assetId?: string;
  variantId?: string;
  recordKey?: string;
  pinnedVariantId?: string | null;
  pinnedVariantBehavior: PinnedVariantBehavior;
  sortIndex?: number;
}

interface NormalizedSubjectInput {
  subjectType: SpaceSubjectType;
  assetId?: string;
  variantId?: string;
  recordKey?: string;
}

interface NormalizedRelationInput {
  id?: string;
  subject: NormalizedSubjectInput;
  object: NormalizedSubjectInput;
  relationType: SpaceRelationType;
  label?: string | null;
  context?: string | Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  sortIndex?: number;
}

interface NormalizedCompositionInput {
  key: string;
  name: string;
  description?: string | null;
  status?: CompositionStatus;
  output?: NormalizedSubjectInput;
  metadata?: Record<string, unknown>;
  sortIndex?: number;
  create: boolean;
}

interface NormalizedCompositionItemInput {
  id?: string;
  compositionName: string;
  role: CompositionItemRole;
  label?: string | null;
  assetId?: string | null;
  variantId?: string;
  recordKey?: string;
  metadata?: Record<string, unknown>;
  sortIndex?: number;
}

interface NormalizedStylePresetInput {
  id?: string;
  name: string;
  description?: string | null;
  stylePrompt?: string;
  collectionName?: string;
  collectionId?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
  action: 'create' | 'update' | 'upsert';
}

interface ImportManifest {
  records: NormalizedRecord[];
  collections: NormalizedCollectionInput[];
  styleCollections: NormalizedStyleCollectionInput[];
  collectionItems: NormalizedCollectionItemInput[];
  relations: NormalizedRelationInput[];
  compositions: NormalizedCompositionInput[];
  compositionItems: NormalizedCompositionItemInput[];
  stylePresets: NormalizedStylePresetInput[];
}

interface Asset {
  id: string;
  name: string;
  type?: string | null;
  media_kind?: MediaKind;
  active_variant_id?: string | null;
}

interface Variant {
  id: string;
  asset_id: string;
  media_kind?: MediaKind;
}

interface SpaceCollection {
  id: string;
  name: string;
}

interface CollectionItem {
  id: string;
}

interface SpaceRelation {
  id: string;
}

interface Composition {
  id: string;
  name: string;
}

interface CompositionItem {
  id: string;
}

interface StylePreset {
  id: string;
  name: string;
}

interface ImportContext {
  env: string;
  spaceId: string;
  baseUrl: string;
  accessToken: string;
}

interface ImportResultRecord {
  key: string;
  file: string;
  assetId: string;
  variantId: string;
  lineageIds: string[];
}

export type ImportResult =
  | {
      dryRun: true;
      records: Array<{ key: string; file: string; target: string; lineageInputs: number }>;
      collections: Array<{ name: string; create: boolean }>;
      collectionItems: number;
      relations: number;
      compositions: Array<{ name: string; create: boolean }>;
      compositionItems: number;
      stylePresets: Array<{ name: string; action: string }>;
    }
  | {
      dryRun: false;
      records: ImportResultRecord[];
      collectionIds: string[];
      collectionItemIds: string[];
      relationIds: string[];
      compositionIds: string[];
      compositionItemIds: string[];
      stylePresetIds: string[];
    };

interface ImportDeps {
  loadConfig: (env: string) => Promise<StoredConfig | null>;
  loadProjectConfig: () => Promise<ProjectConfig | null>;
  resolveBaseUrl: (env: string) => string;
  fetch: typeof fetch;
  readFile: typeof readFile;
  stat: typeof stat;
  print: (message: string) => void;
}

const defaultDeps: ImportDeps = {
  loadConfig: loadStoredConfig,
  loadProjectConfig,
  resolveBaseUrl,
  fetch,
  readFile,
  stat,
  print: console.log,
};

export async function executeImport(
  parsed: ParsedArgs,
  deps: ImportDeps = defaultDeps
): Promise<ImportResult> {
  const manifestPath = parsed.positionals[0] || parsed.options.manifest;
  if (!manifestPath || manifestPath === 'true') {
    throw new Error('Manifest path is required: makefx upload <manifest.json>');
  }

  const ctx = await buildContext(parsed, deps);
  const manifest = await readManifest(manifestPath, deps);
  await validateLocalRecords(manifest.records, deps);
  const state = await fetchSpaceState(ctx, deps);
  const plan = validateManifestPlan(manifest, state);
  const uploadOrder = buildUploadOrder(manifest.records);

  const dryRun = parsed.options['dry-run'] === 'true' || parsed.options.dryRun === 'true';
  if (dryRun) {
    const result: ImportResult = {
      dryRun: true,
      records: uploadOrder.map((record) => ({
        key: record.localKey,
        file: record.displayPath,
        target: record.assetId ?? `new:${record.assetName}`,
        lineageInputs: record.lineage.length,
      })),
      collections: plan.collections.map((collection) => ({
        name: collection.name,
        create: collection.create,
      })),
      collectionItems: plan.collectionItems.length,
      relations: plan.relations.length,
      compositions: plan.compositions.map((composition) => ({
        name: composition.name,
        create: composition.create,
      })),
      compositionItems: plan.compositionItems.length,
      stylePresets: plan.stylePresets.map((preset) => ({
        name: preset.name,
        action: preset.action,
      })),
    };
    printResult(result, parsed, deps);
    return result;
  }

  const uploadedByKey = new Map<string, { assetId: string; variantId: string }>();
  const imported: ImportResultRecord[] = [];
  const jsonOutput = parsed.options.json === 'true';
  for (const record of uploadOrder) {
    const lineage = record.lineage.map((input) => ({
      parentVariantId: input.sourceVariantId ?? uploadedByKey.get(input.sourceFile!)?.variantId,
      relationType: input.relationType,
    }));
    const unresolved = lineage.find((input) => !input.parentVariantId);
    if (unresolved) {
      throw new Error(`Could not resolve same-batch lineage for ${record.localKey}`);
    }

    const response = await uploadRecord(
      ctx,
      deps,
      record,
      lineage as Array<{
        parentVariantId: string;
        relationType: LineageRelationType;
      }>,
      { quiet: jsonOutput }
    );
    uploadedByKey.set(record.localKey, {
      assetId: response.variant.asset_id,
      variantId: response.variant.id,
    });
    imported.push({
      key: record.localKey,
      file: record.displayPath,
      assetId: response.variant.asset_id,
      variantId: response.variant.id,
      lineageIds: (response.lineage ?? []).map((lineageRecord) => lineageRecord.id),
    });
  }

  const organizationResult = await applyOrganizationPlan(ctx, deps, plan, uploadedByKey);

  const result: ImportResult = {
    dryRun: false,
    records: imported,
    ...organizationResult,
  };
  printResult(result, parsed, deps);
  return result;
}

async function buildContext(parsed: ParsedArgs, deps: ImportDeps): Promise<ImportContext> {
  const projectConfig = await deps.loadProjectConfig();
  const env = resolveCommandEnvironment(parsed, projectConfig);
  const spaceId = resolveCommandSpace(parsed, projectConfig);
  if (!spaceId) {
    throw new Error('--space is required, or run: makefx init --space <id>');
  }

  const config = await deps.loadConfig(env);
  if (!config) {
    throw new Error(`Not logged in to ${env} environment. Run: ${loginCommandForEnvironment(env)}`);
  }
  if (config.token.expiresAt < Date.now()) {
    throw new Error(`Token expired for ${env} environment. Run: ${loginCommandForEnvironment(env)}`);
  }
  if (env === 'local') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  return {
    env,
    spaceId,
    baseUrl: deps.resolveBaseUrl(env),
    accessToken: config.token.accessToken,
  };
}

async function readManifest(manifestPath: string, deps: ImportDeps): Promise<ImportManifest> {
  const manifestText = await deps.readFile(manifestPath, 'utf8');
  const manifestDir = path.dirname(path.resolve(manifestPath));
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch (error) {
    throw new Error(`Manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const root = Array.isArray(parsed) ? {} : parsed as ManifestRoot;
  const rawRecords = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? (root.records ?? root.files)
      : null;
  if (!Array.isArray(rawRecords)) {
    throw new Error('Manifest must be an array or contain a records/files array');
  }

  const records = rawRecords.map((raw, index) => normalizeRecord(raw, index, manifestDir));
  const keys = new Set<string>();
  for (const record of records) {
    if (keys.has(record.localKey)) {
      throw new Error(`Duplicate local key in manifest: ${record.localKey}`);
    }
    keys.add(record.localKey);
  }
  return {
    records,
    collections: normalizeCollections(readArray(root.collections, 'collections'), false),
    styleCollections: normalizeStyleCollections(readArray(root.styleCollections, 'styleCollections')),
    collectionItems: [
      ...records.flatMap((record) => record.collectionItems),
      ...normalizeCollectionItems(readArray(root.collectionItems, 'collectionItems'), 'collectionItems'),
    ],
    relations: [
      ...records.flatMap((record) => record.relations),
      ...normalizeRelations(readArray(root.relations, 'relations'), 'relations'),
    ],
    compositions: normalizeCompositions(readArray(root.compositions, 'compositions')),
    compositionItems: [
      ...records.flatMap((record) => record.compositionItems),
      ...normalizeCompositionItems(readArray(root.compositionItems, 'compositionItems'), 'compositionItems'),
    ],
    stylePresets: normalizeStylePresets(readArray(root.stylePresets, 'stylePresets')),
  };
}

function normalizeRecord(raw: unknown, index: number, manifestDir: string): NormalizedRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Record ${index + 1} must be an object`);
  }
  const record = raw as ManifestRecord;
  const displayPath = record.file ?? record.path;
  if (!displayPath) {
    throw new Error(`Record ${index + 1} is missing file`);
  }
  const filePath = path.resolve(manifestDir, displayPath);
  const ext = path.extname(filePath).toLowerCase();
  const mediaType = resolveMediaType(ext, record.mediaKind);
  const assetId = record.assetId ?? record.targetAssetId;
  const assetName = record.assetName ?? record.name;
  if (assetId && assetName) {
    throw new Error(`Record ${index + 1} must set either assetId or name, not both`);
  }
  if (!assetId && !assetName) {
    throw new Error(`Record ${index + 1} must set assetId for an existing asset or name for a new asset`);
  }

  const lineage = normalizeLineage(record.lineage ?? [], index);
  const activeVariantBehavior = normalizeActiveBehavior(record.activeVariantBehavior, index);
  const providerMetadata = record.providerMetadata ?? record.provider_metadata;
  const generationProvenance = record.generationProvenance ?? record.generation_provenance ?? {};

  validateObjectField(providerMetadata, `Record ${index + 1} providerMetadata`);
  validateObjectField(generationProvenance, `Record ${index + 1} generationProvenance`);
  const localKey = record.localKey ?? record.key ?? displayPath;

  return {
    index,
    localKey,
    filePath,
    displayPath,
    fileName: path.basename(filePath),
    assetName,
    assetType: record.assetType ?? record.type ?? 'character',
    assetId,
    mediaKind: mediaType.mediaKind,
    mimeType: mediaType.mimeType,
    activeVariantBehavior,
    prompt: record.prompt,
    model: record.model,
    provider: record.provider,
    providerMetadata,
    generationProvenance,
    lineage,
    collectionItems: normalizeCollectionItems([
      ...readArray(record.collections, `Record ${index + 1} collections`),
      ...readArray(record.collectionItems, `Record ${index + 1} collectionItems`),
    ], `Record ${index + 1} collections`, localKey),
    relations: normalizeRelations(readArray(record.relations, `Record ${index + 1} relations`), `Record ${index + 1} relations`, localKey),
    compositionItems: normalizeCompositionItems(
      readArray(record.compositionItems, `Record ${index + 1} compositionItems`),
      `Record ${index + 1} compositionItems`,
      localKey
    ),
    styleCollections: normalizeStyleCollections(
      readArray(record.styleCollections, `Record ${index + 1} styleCollections`),
      localKey
    ),
  };
}

function readArray(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function normalizeLineage(inputs: ManifestLineageInput[], recordIndex: number): NormalizedLineageInput[] {
  if (!Array.isArray(inputs)) {
    throw new Error(`Record ${recordIndex + 1} lineage must be an array`);
  }
  return inputs.map((input, index) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error(`Record ${recordIndex + 1} lineage[${index}] must be an object`);
    }
    const sourceVariantId = input.sourceVariantId ?? input.parentVariantId;
    if ((sourceVariantId && input.sourceFile) || (!sourceVariantId && !input.sourceFile)) {
      throw new Error(`Record ${recordIndex + 1} lineage[${index}] must set exactly one of sourceVariantId or sourceFile`);
    }
    if (input.relationType !== 'derived' && input.relationType !== 'refined' && input.relationType !== 'forked') {
      throw new Error(`Record ${recordIndex + 1} lineage[${index}] relationType must be derived, refined, or forked`);
    }
    return {
      relationType: input.relationType,
      ...(sourceVariantId ? { sourceVariantId } : { sourceFile: input.sourceFile! }),
    };
  });
}

function normalizeCollections(inputs: unknown[], styleOnly: boolean): NormalizedCollectionInput[] {
  return inputs.map((input, index) => {
    const collection = requireObject<ManifestCollectionInput>(input, `collections[${index}]`);
    const name = collection.name ?? collection.collectionName ?? collection.collection;
    if (!name || typeof name !== 'string') {
      throw new Error(`collections[${index}] name is required`);
    }
    if (collection.description !== undefined && collection.description !== null && typeof collection.description !== 'string') {
      throw new Error(`collections[${index}] description must be a string or null`);
    }
    validateSortIndex(collection.sortIndex, `collections[${index}] sortIndex`);
    return {
      key: collection.id ?? name,
      name,
      description: collection.description,
      sortIndex: collection.sortIndex,
      create: styleOnly || collection.create === true || collection.createIfMissing === true,
    };
  });
}

function normalizeStyleCollections(inputs: unknown[], recordKey?: string): NormalizedStyleCollectionInput[] {
  return inputs.map((input, index) => {
    if (typeof input === 'string') {
      return {
        key: input,
        name: input,
        create: false,
        refs: recordKey ? [recordKey] : [],
      };
    }
    const collection = requireObject<ManifestStyleCollectionInput>(input, labelFor('styleCollections', index, recordKey));
    const name = collection.name ?? collection.collectionName ?? collection.collection;
    if (!name || typeof name !== 'string') {
      throw new Error(`${labelFor('styleCollections', index, recordKey)} name is required`);
    }
    validateSortIndex(collection.sortIndex, `${labelFor('styleCollections', index, recordKey)} sortIndex`);
    const refs = [
      ...(collection.refs ?? []),
      ...(collection.records ?? []),
      ...(recordKey ? [recordKey] : []),
    ];
    if (!refs.every((ref) => typeof ref === 'string' && ref.trim())) {
      throw new Error(`${labelFor('styleCollections', index, recordKey)} refs must be strings`);
    }
    return {
      key: collection.id ?? name,
      name,
      description: collection.description,
      sortIndex: collection.sortIndex,
      create: collection.create === true || collection.createIfMissing === true,
      refs,
    };
  });
}

function normalizeCollectionItems(
  inputs: unknown[],
  label: string,
  defaultRecordKey?: string
): NormalizedCollectionItemInput[] {
  return inputs.map((input, index) => {
    const item = requireObject<ManifestCollectionItemInput>(input, `${label}[${index}]`);
    const collectionName = item.collectionName ?? item.collection ?? item.collectionId;
    if (!collectionName || typeof collectionName !== 'string') {
      throw new Error(`${label}[${index}] collection is required`);
    }
    if (item.role !== undefined && typeof item.role !== 'string') {
      throw new Error(`${label}[${index}] role must be a string`);
    }
    const subjectType = normalizeSubjectType(item.subjectType ?? (item.variantId ? 'variant' : 'asset'), `${label}[${index}] subjectType`);
    const recordKey = item.recordKey ?? item.sourceFile ?? defaultRecordKey;
    validateSortIndex(item.sortIndex, `${label}[${index}] sortIndex`);
    if (item.pinnedVariantId !== undefined && item.pinnedVariantId !== null && typeof item.pinnedVariantId !== 'string') {
      throw new Error(`${label}[${index}] pinnedVariantId must be a string or null`);
    }
    return {
      id: item.id,
      collectionName,
      role: item.role ?? 'member',
      subjectType,
      assetId: item.assetId,
      variantId: item.variantId,
      recordKey,
      pinnedVariantId: item.pinnedVariantId,
      pinnedVariantBehavior: normalizePinnedVariantBehavior(item.pinnedVariantBehavior, `${label}[${index}] pinnedVariantBehavior`),
      sortIndex: item.sortIndex,
    };
  });
}

function normalizeRelations(
  inputs: unknown[],
  label: string,
  defaultSubjectRecordKey?: string
): NormalizedRelationInput[] {
  return inputs.map((input, index) => {
    const relation = requireObject<ManifestRelationInput>(input, `${label}[${index}]`);
    const subject = relation.subject
      ? normalizeSubject(relation.subject, `${label}[${index}] subject`)
      : normalizeSubject({
        subjectType: relation.subjectType,
        assetId: relation.subjectAssetId,
        variantId: relation.subjectVariantId,
        recordKey: defaultSubjectRecordKey,
      }, `${label}[${index}] subject`);
    const objectInput = relation.object ?? relation.target ?? {
      subjectType: relation.objectType,
      assetId: relation.objectAssetId,
      variantId: relation.objectVariantId,
    };
    const object = normalizeSubject(objectInput, `${label}[${index}] object`);
    const relationType = normalizeRelationType(relation.relationType, `${label}[${index}] relationType`);
    validateObjectField(relation.metadata, `${label}[${index}] metadata`);
    validateSortIndex(relation.sortIndex, `${label}[${index}] sortIndex`);
    if (relation.label !== undefined && relation.label !== null && typeof relation.label !== 'string') {
      throw new Error(`${label}[${index}] label must be a string or null`);
    }
    if (
      relation.context !== undefined &&
      relation.context !== null &&
      typeof relation.context !== 'string' &&
      (typeof relation.context !== 'object' || Array.isArray(relation.context))
    ) {
      throw new Error(`${label}[${index}] context must be a string, object, or null`);
    }
    return {
      id: relation.id,
      subject,
      object,
      relationType,
      label: relation.label,
      context: relation.context,
      metadata: relation.metadata,
      sortIndex: relation.sortIndex,
    };
  });
}

function normalizeCompositions(inputs: unknown[]): NormalizedCompositionInput[] {
  return inputs.map((input, index) => {
    const composition = requireObject<ManifestCompositionInput>(input, `compositions[${index}]`);
    const name = composition.name ?? composition.compositionName ?? composition.composition;
    if (!name || typeof name !== 'string') {
      throw new Error(`compositions[${index}] name is required`);
    }
    if (composition.description !== undefined && composition.description !== null && typeof composition.description !== 'string') {
      throw new Error(`compositions[${index}] description must be a string or null`);
    }
    validateObjectField(composition.metadata, `compositions[${index}] metadata`);
    validateSortIndex(composition.sortIndex, `compositions[${index}] sortIndex`);
    const output = composition.output
      ? normalizeSubject(composition.output, `compositions[${index}] output`)
      : composition.outputRecordKey || composition.outputAssetId || composition.outputVariantId
        ? normalizeSubject({
          subjectType: composition.outputVariantId || composition.outputRecordKey ? 'variant' : 'asset',
          assetId: composition.outputAssetId ?? undefined,
          variantId: composition.outputVariantId ?? undefined,
          recordKey: composition.outputRecordKey,
        }, `compositions[${index}] output`)
        : undefined;
    return {
      key: composition.id ?? name,
      name,
      description: composition.description,
      status: normalizeCompositionStatus(composition.status, `compositions[${index}] status`),
      output,
      metadata: composition.metadata,
      sortIndex: composition.sortIndex,
      create: composition.create === true || composition.createIfMissing === true,
    };
  });
}

function normalizeCompositionItems(
  inputs: unknown[],
  label: string,
  defaultRecordKey?: string
): NormalizedCompositionItemInput[] {
  return inputs.map((input, index) => {
    const item = requireObject<ManifestCompositionItemInput>(input, `${label}[${index}]`);
    const compositionName = item.compositionName ?? item.composition ?? item.compositionId;
    if (!compositionName || typeof compositionName !== 'string') {
      throw new Error(`${label}[${index}] composition is required`);
    }
    const role = normalizeCompositionItemRole(item.role, `${label}[${index}] role`);
    validateObjectField(item.metadata, `${label}[${index}] metadata`);
    validateSortIndex(item.sortIndex, `${label}[${index}] sortIndex`);
    if (item.label !== undefined && item.label !== null && typeof item.label !== 'string') {
      throw new Error(`${label}[${index}] label must be a string or null`);
    }
    return {
      id: item.id,
      compositionName,
      role,
      label: item.label,
      assetId: item.assetId,
      variantId: item.variantId,
      recordKey: item.recordKey ?? item.sourceFile ?? defaultRecordKey,
      metadata: item.metadata,
      sortIndex: item.sortIndex,
    };
  });
}

function normalizeStylePresets(inputs: unknown[]): NormalizedStylePresetInput[] {
  return inputs.map((input, index) => {
    const preset = requireObject<ManifestStylePresetInput>(input, `stylePresets[${index}]`);
    const name = preset.name ?? preset.presetName;
    if (!name || typeof name !== 'string') {
      throw new Error(`stylePresets[${index}] name is required`);
    }
    const stylePrompt = preset.stylePrompt ?? preset.prompt;
    if (stylePrompt !== undefined && typeof stylePrompt !== 'string') {
      throw new Error(`stylePresets[${index}] stylePrompt must be a string`);
    }
    if (preset.description !== undefined && preset.description !== null && typeof preset.description !== 'string') {
      throw new Error(`stylePresets[${index}] description must be a string or null`);
    }
    const requestedActions = [preset.create, preset.update, preset.upsert].filter((value) => value === true).length;
    if (requestedActions !== 1) {
      throw new Error(`stylePresets[${index}] must set exactly one of create, update, or upsert`);
    }
    return {
      id: preset.id,
      name,
      description: preset.description,
      stylePrompt,
      collectionName: preset.collectionName ?? preset.collection ?? undefined,
      collectionId: preset.collectionId,
      enabled: preset.enabled,
      isDefault: preset.isDefault ?? preset.default,
      action: preset.create ? 'create' : preset.update ? 'update' : 'upsert',
    };
  });
}

function normalizeSubject(input: ManifestSubjectInput, label: string): NormalizedSubjectInput {
  const subjectType = normalizeSubjectType(input.subjectType ?? input.type ?? (input.assetId ? 'asset' : 'variant'), `${label} subjectType`);
  const recordKey = input.recordKey ?? input.sourceFile;
  if (subjectType === 'asset' && input.variantId && !recordKey && !input.assetId) {
    throw new Error(`${label} asset subject must use assetId or recordKey`);
  }
  if (subjectType === 'variant' && input.assetId && !input.variantId && !recordKey) {
    throw new Error(`${label} variant subject must use variantId or recordKey`);
  }
  return {
    subjectType,
    assetId: input.assetId,
    variantId: input.variantId,
    recordKey,
  };
}

function normalizeSubjectType(value: string | undefined, label: string): SpaceSubjectType {
  if (value === 'asset' || value === 'variant') return value;
  throw new Error(`${label} must be asset or variant`);
}

function normalizeRelationType(value: string | undefined, label: string): SpaceRelationType {
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
  throw new Error(`${label} is invalid`);
}

function normalizeCompositionItemRole(value: string | undefined, label: string): CompositionItemRole {
  const valid: CompositionItemRole[] = ['output', 'background', 'character', 'prop', 'style_ref', 'overlay', 'map', 'thumbnail', 'custom'];
  if (valid.includes(value as CompositionItemRole)) return value as CompositionItemRole;
  throw new Error(`${label} is invalid`);
}

function normalizeCompositionStatus(value: string | undefined, label: string): CompositionStatus | undefined {
  if (value === undefined) return undefined;
  if (value === 'draft' || value === 'final') return value;
  throw new Error(`${label} must be draft or final`);
}

function normalizePinnedVariantBehavior(value: string | undefined, label: string): PinnedVariantBehavior {
  if (!value || value === 'imported') return 'imported';
  if (value === 'none' || value === 'unpin') return 'none';
  throw new Error(`${label} must be imported or none`);
}

function requireObject<T>(value: unknown, label: string): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as T;
}

function validateSortIndex(value: unknown, label: string): void {
  if (value !== undefined && !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
}

function labelFor(section: string, index: number, recordKey?: string): string {
  return recordKey ? `Record ${recordKey} ${section}[${index}]` : `${section}[${index}]`;
}

function normalizeActiveBehavior(value: string | undefined, recordIndex: number): ActiveVariantBehavior {
  if (!value || value === 'if-missing' || value === 'if_missing') return 'if-missing';
  if (value === 'set-active' || value === 'set_active') return 'set-active';
  if (value === 'keep') return 'keep';
  throw new Error(`Record ${recordIndex + 1} activeVariantBehavior must be if-missing, set-active, or keep`);
}

function validateObjectField(value: unknown, label: string): asserts value is Record<string, unknown> | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

async function validateLocalRecords(records: NormalizedRecord[], deps: ImportDeps): Promise<void> {
  for (const record of records) {
    let fileStat;
    try {
      fileStat = await deps.stat(record.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`File not found for ${record.localKey}: ${record.displayPath}`);
      }
      throw error;
    }
    if (!fileStat.isFile()) {
      throw new Error(`Manifest file is not a file for ${record.localKey}: ${record.displayPath}`);
    }
    if (fileStat.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`File too large for ${record.localKey} (${(fileStat.size / 1024 / 1024).toFixed(2)}MB). Maximum size: ${MAX_FILE_SIZE_MB}MB`);
    }
  }
}

async function fetchSpaceState(ctx: ImportContext, deps: ImportDeps): Promise<{
  assets: Asset[];
  variantsById: Map<string, Variant>;
  collections: SpaceCollection[];
  compositions: Composition[];
  stylePresets: StylePreset[];
}> {
  const [assetsData, collectionsData, compositionsData, stylePresetsData] = await Promise.all([
    fetchJson<{ assets: Asset[] }>(ctx, deps, `/api/spaces/${ctx.spaceId}/assets`),
    fetchJson<{ collections: SpaceCollection[] }>(ctx, deps, `/api/spaces/${ctx.spaceId}/collections`),
    fetchJson<{ compositions: Composition[] }>(ctx, deps, `/api/spaces/${ctx.spaceId}/compositions`),
    fetchJson<{ presets: StylePreset[] }>(ctx, deps, `/api/spaces/${ctx.spaceId}/style-presets`),
  ]);
  const assets = assetsData.assets ?? [];
  const variantsById = new Map<string, Variant>();
  for (const asset of assets) {
    const details = await fetchJson<{ variants?: Variant[] }>(
      ctx,
      deps,
      `/api/spaces/${ctx.spaceId}/assets/${encodeURIComponent(asset.id)}`
    );
    for (const variant of details.variants ?? []) {
      variantsById.set(variant.id, variant);
    }
  }
  return {
    assets,
    variantsById,
    collections: collectionsData.collections ?? [],
    compositions: compositionsData.compositions ?? [],
    stylePresets: stylePresetsData.presets ?? [],
  };
}

function validateSpaceReferences(
  records: NormalizedRecord[],
  state: { assets: Asset[]; variantsById: Map<string, Variant> }
): void {
  const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));
  const recordsByKey = new Map(records.map((record) => [record.localKey, record]));
  for (const record of records) {
    if (record.assetId) {
      const asset = assetsById.get(record.assetId);
      if (!asset) {
        throw new Error(`Target asset not found for ${record.localKey}: ${record.assetId}`);
      }
      if (asset.media_kind && asset.media_kind !== record.mediaKind) {
        throw new Error(`Target asset ${record.assetId} is ${asset.media_kind}, but ${record.localKey} is ${record.mediaKind}`);
      }
    }
    for (const lineage of record.lineage) {
      if (lineage.sourceVariantId && !state.variantsById.has(lineage.sourceVariantId)) {
        throw new Error(`Source variant not found in space for ${record.localKey}: ${lineage.sourceVariantId}`);
      }
      if (lineage.sourceFile) {
        const sourceRecord = recordsByKey.get(lineage.sourceFile);
        if (!sourceRecord) {
          throw new Error(`Source file key not found for ${record.localKey}: ${lineage.sourceFile}`);
        }
        if (sourceRecord.localKey === record.localKey) {
          throw new Error(`Record ${record.localKey} cannot use itself as a lineage source`);
        }
      }
    }
  }
}

function validateManifestPlan(
  manifest: ImportManifest,
  state: {
    assets: Asset[];
    variantsById: Map<string, Variant>;
    collections: SpaceCollection[];
    compositions: Composition[];
    stylePresets: StylePreset[];
  }
): ImportManifest {
  validateSpaceReferences(manifest.records, state);
  const recordsByKey = new Map(manifest.records.map((record) => [record.localKey, record]));
  const collectionsByName = new Map(state.collections.map((collection) => [collection.name, collection]));
  const compositionsByName = new Map(state.compositions.map((composition) => [composition.name, composition]));
  const stylePresetsByName = new Map(state.stylePresets.map((preset) => [preset.name, preset]));
  const stylePresetsById = new Map(state.stylePresets.map((preset) => [preset.id, preset]));

  const collections = dedupeCollections([
    ...manifest.collections,
    ...manifest.styleCollections,
    ...manifest.records.flatMap((record) => record.styleCollections),
  ]);
  const collectionItems = [
    ...manifest.collectionItems,
    ...manifest.styleCollections.flatMap((collection) => styleCollectionItems(collection)),
    ...manifest.records.flatMap((record) => record.styleCollections.flatMap((collection) => styleCollectionItems(collection))),
  ];
  const compositions = dedupeCompositions(manifest.compositions);
  const compositionItems = manifest.compositionItems;

  for (const collection of collections) {
    if (!collectionsByName.has(collection.name) && !collection.create) {
      throw new Error(`Collection not found: ${collection.name}. Add it to manifest collections with create: true.`);
    }
  }
  for (const item of collectionItems) {
    if (!collectionsByName.has(item.collectionName) && !collections.some((collection) => collection.name === item.collectionName && collection.create)) {
      throw new Error(`Collection not found for collection item: ${item.collectionName}`);
    }
    validateCollectionSubject(item, recordsByKey, state);
  }

  for (const relation of manifest.relations) {
    validateSubjectReference(relation.subject, recordsByKey, state, 'Relation subject');
    validateSubjectReference(relation.object, recordsByKey, state, 'Relation object');
  }

  for (const composition of compositions) {
    if (!compositionsByName.has(composition.name) && !composition.create) {
      throw new Error(`Composition not found: ${composition.name}. Add it to manifest compositions with create: true.`);
    }
    if (composition.output) {
      validateSubjectReference(composition.output, recordsByKey, state, `Composition ${composition.name} output`);
      if (composition.output.subjectType !== 'variant') {
        throw new Error(`Composition ${composition.name} output must reference a variant`);
      }
    }
  }
  for (const item of compositionItems) {
    if (!compositionsByName.has(item.compositionName) && !compositions.some((composition) => composition.name === item.compositionName && composition.create)) {
      throw new Error(`Composition not found for composition item: ${item.compositionName}`);
    }
    if (item.recordKey) {
      if (!recordsByKey.has(item.recordKey)) {
        throw new Error(`Composition item references unknown same-batch record: ${item.recordKey}`);
      }
    } else if (!item.variantId) {
      throw new Error(`Composition item for ${item.compositionName} must set variantId or recordKey`);
    } else if (!state.variantsById.has(item.variantId)) {
      throw new Error(`Composition item references unknown variant: ${item.variantId}`);
    }
    if (item.assetId && !state.assets.some((asset) => asset.id === item.assetId)) {
      throw new Error(`Composition item references unknown asset: ${item.assetId}`);
    }
  }

  for (const preset of manifest.stylePresets) {
    const existingPresetById = preset.id ? stylePresetsById.get(preset.id) : undefined;
    const existingPresetByName = stylePresetsByName.get(preset.name);
    const existingPreset = preset.id
      ? existingPresetById
      : existingPresetByName;
    const createConflict = preset.id
      ? existingPresetById ?? existingPresetByName
      : existingPresetByName;
    if (preset.action === 'create' && createConflict) {
      throw new Error(`Style preset already exists: ${preset.name}`);
    }
    if (preset.action === 'update' && !existingPreset) {
      throw new Error(`Style preset not found for update: ${preset.id ?? preset.name}`);
    }
    if (preset.collectionName) {
      const willCreate = collections.some((collection) => collection.name === preset.collectionName && collection.create);
      if (!collectionsByName.has(preset.collectionName) && !willCreate) {
        throw new Error(`Style preset ${preset.name} references missing collection: ${preset.collectionName}`);
      }
    }
  }

  return {
    ...manifest,
    collections,
    collectionItems,
    compositions,
    compositionItems,
  };
}

function dedupeCollections(collections: NormalizedCollectionInput[]): NormalizedCollectionInput[] {
  const byName = new Map<string, NormalizedCollectionInput>();
  for (const collection of collections) {
    const existing = byName.get(collection.name);
    byName.set(collection.name, {
      key: collection.key,
      name: collection.name,
      description: collection.description ?? existing?.description,
      sortIndex: collection.sortIndex ?? existing?.sortIndex,
      create: Boolean(existing?.create || collection.create),
    });
  }
  return [...byName.values()];
}

function dedupeCompositions(compositions: NormalizedCompositionInput[]): NormalizedCompositionInput[] {
  const byName = new Map<string, NormalizedCompositionInput>();
  for (const composition of compositions) {
    const existing = byName.get(composition.name);
    byName.set(composition.name, {
      ...existing,
      ...composition,
      create: Boolean(existing?.create || composition.create),
    });
  }
  return [...byName.values()];
}

function styleCollectionItems(collection: NormalizedStyleCollectionInput): NormalizedCollectionItemInput[] {
  return collection.refs.map((recordKey, index) => ({
    collectionName: collection.name,
    role: 'style_ref',
    subjectType: 'asset',
    recordKey,
    pinnedVariantBehavior: 'imported',
    sortIndex: index,
  }));
}

function validateCollectionSubject(
  item: NormalizedCollectionItemInput,
  recordsByKey: Map<string, NormalizedRecord>,
  state: { assets: Asset[]; variantsById: Map<string, Variant> }
): void {
  if (item.recordKey) {
    if (!recordsByKey.has(item.recordKey)) {
      throw new Error(`Collection item references unknown same-batch record: ${item.recordKey}`);
    }
    return;
  }
  if (item.subjectType === 'asset') {
    if (!item.assetId) throw new Error(`Collection item for ${item.collectionName} must set assetId or recordKey`);
    if (!state.assets.some((asset) => asset.id === item.assetId)) {
      throw new Error(`Collection item references unknown asset: ${item.assetId}`);
    }
    if (item.pinnedVariantId && !state.variantsById.has(item.pinnedVariantId)) {
      throw new Error(`Collection item references unknown pinned variant: ${item.pinnedVariantId}`);
    }
    return;
  }
  if (!item.variantId) throw new Error(`Collection item for ${item.collectionName} must set variantId or recordKey`);
  if (!state.variantsById.has(item.variantId)) {
    throw new Error(`Collection item references unknown variant: ${item.variantId}`);
  }
}

function validateSubjectReference(
  subject: NormalizedSubjectInput,
  recordsByKey: Map<string, NormalizedRecord>,
  state: { assets: Asset[]; variantsById: Map<string, Variant> },
  label: string
): void {
  if (subject.recordKey) {
    if (!recordsByKey.has(subject.recordKey)) {
      throw new Error(`${label} references unknown same-batch record: ${subject.recordKey}`);
    }
    return;
  }
  if (subject.subjectType === 'asset') {
    if (!subject.assetId) throw new Error(`${label} must set assetId or recordKey`);
    if (!state.assets.some((asset) => asset.id === subject.assetId)) {
      throw new Error(`${label} references unknown asset: ${subject.assetId}`);
    }
    return;
  }
  if (!subject.variantId) throw new Error(`${label} must set variantId or recordKey`);
  if (!state.variantsById.has(subject.variantId)) {
    throw new Error(`${label} references unknown variant: ${subject.variantId}`);
  }
}

function buildUploadOrder(records: NormalizedRecord[]): NormalizedRecord[] {
  const pending = new Map(records.map((record) => [record.localKey, record]));
  const uploaded = new Set<string>();
  const order: NormalizedRecord[] = [];
  while (pending.size > 0) {
    let progressed = false;
    for (const [key, record] of pending) {
      const ready = record.lineage.every((lineage) => !lineage.sourceFile || uploaded.has(lineage.sourceFile));
      if (!ready) continue;
      order.push(record);
      uploaded.add(key);
      pending.delete(key);
      progressed = true;
    }
    if (!progressed) {
      throw new Error(`Same-batch lineage contains a cycle or unresolved dependency: ${[...pending.keys()].join(', ')}`);
    }
  }
  return order;
}

async function uploadRecord(
  ctx: ImportContext,
  deps: ImportDeps,
  record: NormalizedRecord,
  lineage: Array<{ parentVariantId: string; relationType: LineageRelationType }>,
  options: { quiet: boolean }
): Promise<UploadMediaResponse> {
  const fileBuffer = await deps.readFile(record.filePath);
  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer], { type: record.mimeType }), record.fileName);
  formData.append('operation', 'import');
  formData.append('mediaKind', record.mediaKind);
  formData.append('assetType', record.assetType);
  formData.append('activeVariantBehavior', record.activeVariantBehavior);
  formData.append('generationProvenance', JSON.stringify(record.generationProvenance));
  if (record.assetId) {
    formData.append('assetId', record.assetId);
  } else {
    formData.append('assetName', record.assetName!);
  }
  if (record.prompt) formData.append('prompt', record.prompt);
  if (record.model) formData.append('model', record.model);
  if (record.provider) formData.append('provider', record.provider);
  if (record.providerMetadata) formData.append('providerMetadata', JSON.stringify(record.providerMetadata));
  if (lineage.length > 0) formData.append('lineage', JSON.stringify(lineage));

  if (!options.quiet) {
    deps.print(`Importing ${record.displayPath}...`);
  }
  const response = await deps.fetch(`${ctx.baseUrl}/api/spaces/${ctx.spaceId}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.accessToken}` },
    body: formData,
  });
  const data = await response.json() as UploadMediaResponse | ErrorResponse;
  if (!response.ok) {
    throw new Error(`Import failed for ${record.localKey}: ${'error' in data ? data.error : response.statusText}`);
  }
  return data as UploadMediaResponse;
}

async function applyOrganizationPlan(
  ctx: ImportContext,
  deps: ImportDeps,
  plan: ImportManifest,
  uploadedByKey: Map<string, { assetId: string; variantId: string }>
): Promise<Omit<Extract<ImportResult, { dryRun: false }>, 'dryRun' | 'records'>> {
  const collectionIds: string[] = [];
  const collectionItemIds: string[] = [];
  const relationIds: string[] = [];
  const compositionIds: string[] = [];
  const compositionItemIds: string[] = [];
  const stylePresetIds: string[] = [];

  const collections = await fetchJson<{ collections: SpaceCollection[] }>(ctx, deps, `/api/spaces/${ctx.spaceId}/collections`);
  const collectionsByName = new Map((collections.collections ?? []).map((collection) => [collection.name, collection]));
  for (const collection of plan.collections) {
    if (!collectionsByName.has(collection.name) && collection.create) {
      const created = await postJson<{ collection: SpaceCollection }>(ctx, deps, `/api/spaces/${ctx.spaceId}/collections`, {
        name: collection.name,
        description: collection.description,
        sortIndex: collection.sortIndex,
      });
      collectionsByName.set(created.collection.name, created.collection);
      collectionIds.push(created.collection.id);
    }
  }

  for (const item of plan.collectionItems) {
    const collection = collectionsByName.get(item.collectionName);
    if (!collection) throw new Error(`Collection not found during import: ${item.collectionName}`);
    const created = await postJson<{ item: CollectionItem }>(
      ctx,
      deps,
      `/api/spaces/${ctx.spaceId}/collections/${encodeURIComponent(collection.id)}/items`,
      resolveCollectionItemRequest(item, uploadedByKey)
    );
    collectionItemIds.push(created.item.id);
  }

  for (const relation of plan.relations) {
    const created = await postJson<{ relation: SpaceRelation }>(ctx, deps, `/api/spaces/${ctx.spaceId}/relations`, {
      id: relation.id,
      subject: resolveSubject(relation.subject, uploadedByKey),
      object: resolveSubject(relation.object, uploadedByKey),
      relationType: relation.relationType,
      label: relation.label,
      context: relation.context,
      metadata: relation.metadata,
      sortIndex: relation.sortIndex,
    });
    relationIds.push(created.relation.id);
  }

  const compositions = await fetchJson<{ compositions: Composition[] }>(ctx, deps, `/api/spaces/${ctx.spaceId}/compositions`);
  const compositionsByName = new Map((compositions.compositions ?? []).map((composition) => [composition.name, composition]));
  for (const composition of plan.compositions) {
    if (!compositionsByName.has(composition.name) && composition.create) {
      const output = composition.output ? resolveSubject(composition.output, uploadedByKey) : undefined;
      const created = await postJson<{ composition: Composition }>(ctx, deps, `/api/spaces/${ctx.spaceId}/compositions`, {
        name: composition.name,
        description: composition.description,
        status: composition.status,
        outputAssetId: output?.assetId,
        outputVariantId: output?.variantId,
        metadata: composition.metadata,
        sortIndex: composition.sortIndex,
      });
      compositionsByName.set(created.composition.name, created.composition);
      compositionIds.push(created.composition.id);
    }
  }

  for (const item of plan.compositionItems) {
    const composition = compositionsByName.get(item.compositionName);
    if (!composition) throw new Error(`Composition not found during import: ${item.compositionName}`);
    const created = await postJson<{ item: CompositionItem }>(
      ctx,
      deps,
      `/api/spaces/${ctx.spaceId}/compositions/${encodeURIComponent(composition.id)}/items`,
      resolveCompositionItemRequest(item, uploadedByKey)
    );
    compositionItemIds.push(created.item.id);
  }

  const presets = await fetchJson<{ presets: StylePreset[] }>(ctx, deps, `/api/spaces/${ctx.spaceId}/style-presets`);
  const presetsByName = new Map((presets.presets ?? []).map((preset) => [preset.name, preset]));
  const presetsById = new Map((presets.presets ?? []).map((preset) => [preset.id, preset]));
  for (const preset of plan.stylePresets) {
    const collectionId = preset.collectionId === null
      ? null
      : preset.collectionId ?? (preset.collectionName ? collectionsByName.get(preset.collectionName)?.id : undefined);
    if (preset.collectionName && collectionId === undefined) {
      throw new Error(`Style preset ${preset.name} references missing collection during import: ${preset.collectionName}`);
    }
    const request = {
      id: preset.id,
      name: preset.name,
      description: preset.description,
      stylePrompt: preset.stylePrompt,
      collectionId,
      enabled: preset.enabled,
      isDefault: preset.isDefault,
    };
    const existing = preset.id
      ? presetsById.get(preset.id)
      : presetsByName.get(preset.name);
    if (preset.action === 'update' || (preset.action === 'upsert' && existing)) {
      const updated = await patchJson<{ preset: StylePreset }>(
        ctx,
        deps,
        `/api/spaces/${ctx.spaceId}/style-presets/${encodeURIComponent(existing!.id)}`,
        request
      );
      stylePresetIds.push(updated.preset.id);
      presetsByName.set(updated.preset.name, updated.preset);
      presetsById.set(updated.preset.id, updated.preset);
    } else {
      const created = await postJson<{ preset: StylePreset }>(ctx, deps, `/api/spaces/${ctx.spaceId}/style-presets`, request);
      stylePresetIds.push(created.preset.id);
      presetsByName.set(created.preset.name, created.preset);
      presetsById.set(created.preset.id, created.preset);
    }
  }

  return {
    collectionIds,
    collectionItemIds,
    relationIds,
    compositionIds,
    compositionItemIds,
    stylePresetIds,
  };
}

function resolveCollectionItemRequest(
  item: NormalizedCollectionItemInput,
  uploadedByKey: Map<string, { assetId: string; variantId: string }>
): Record<string, unknown> {
  const subject = item.recordKey
    ? resolveSubject({ subjectType: item.subjectType, recordKey: item.recordKey }, uploadedByKey)
    : {
      subjectType: item.subjectType,
      assetId: item.assetId,
      variantId: item.variantId,
    };
  return {
    id: item.id,
    ...subject,
    role: item.role,
    pinnedVariantId: item.pinnedVariantBehavior === 'none'
      ? item.pinnedVariantId ?? null
      : item.pinnedVariantId ?? (item.recordKey ? uploadedByKey.get(item.recordKey)!.variantId : undefined),
    sortIndex: item.sortIndex,
  };
}

function resolveCompositionItemRequest(
  item: NormalizedCompositionItemInput,
  uploadedByKey: Map<string, { assetId: string; variantId: string }>
): Record<string, unknown> {
  const uploaded = item.recordKey ? uploadedByKey.get(item.recordKey) : undefined;
  if (item.recordKey && !uploaded) {
    throw new Error(`Could not resolve same-batch composition item: ${item.recordKey}`);
  }
  return {
    id: item.id,
    role: item.role,
    label: item.label,
    assetId: item.assetId ?? uploaded?.assetId,
    variantId: item.variantId ?? uploaded!.variantId,
    metadata: item.metadata,
    sortIndex: item.sortIndex,
  };
}

function resolveSubject(
  subject: NormalizedSubjectInput,
  uploadedByKey: Map<string, { assetId: string; variantId: string }>
): { subjectType: SpaceSubjectType; assetId?: string; variantId?: string } {
  if (!subject.recordKey) {
    return {
      subjectType: subject.subjectType,
      assetId: subject.assetId,
      variantId: subject.variantId,
    };
  }
  const uploaded = uploadedByKey.get(subject.recordKey);
  if (!uploaded) {
    throw new Error(`Could not resolve same-batch reference: ${subject.recordKey}`);
  }
  return subject.subjectType === 'asset'
    ? { subjectType: 'asset', assetId: uploaded.assetId }
    : { subjectType: 'variant', variantId: uploaded.variantId };
}

async function postJson<T>(
  ctx: ImportContext,
  deps: ImportDeps,
  requestPath: string,
  json: Record<string, unknown>
): Promise<T> {
  return sendJson<T>(ctx, deps, 'POST', requestPath, json);
}

async function patchJson<T>(
  ctx: ImportContext,
  deps: ImportDeps,
  requestPath: string,
  json: Record<string, unknown>
): Promise<T> {
  return sendJson<T>(ctx, deps, 'PATCH', requestPath, json);
}

async function sendJson<T>(
  ctx: ImportContext,
  deps: ImportDeps,
  method: 'POST' | 'PATCH',
  requestPath: string,
  json: Record<string, unknown>
): Promise<T> {
  const response = await deps.fetch(`${ctx.baseUrl}${requestPath}`, {
    method,
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

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

async function fetchJson<T>(ctx: ImportContext, deps: ImportDeps, requestPath: string): Promise<T> {
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
  return data;
}

function printResult(result: ImportResult, parsed: ParsedArgs, deps: Pick<ImportDeps, 'print'>): void {
  if (parsed.options.json === 'true') {
    deps.print(JSON.stringify(result, null, 2));
    return;
  }
  if (result.dryRun) {
    deps.print(`Dry run passed for ${result.records.length} import records.`);
    const organizationCount =
      result.collections.length +
      result.collectionItems +
      result.relations +
      result.compositions.length +
      result.compositionItems +
      result.stylePresets.length;
    if (organizationCount > 0) {
      deps.print(`  Organization changes: ${organizationCount}`);
    }
    return;
  }
  deps.print(`Imported ${result.records.length} records.`);
  for (const record of result.records) {
    deps.print(`  ${record.key}: asset ${record.assetId}, variant ${record.variantId}`);
  }
  const organizationCount =
    result.collectionIds.length +
    result.collectionItemIds.length +
    result.relationIds.length +
    result.compositionIds.length +
    result.compositionItemIds.length +
    result.stylePresetIds.length;
  if (organizationCount > 0) {
    deps.print(`  Organization records: ${organizationCount}`);
  }
}
