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
} from './upload';
import type { ErrorResponse, MediaKind, UploadMediaResponse } from '../../api/types';

type LineageRelationType = 'derived' | 'refined' | 'forked';
type ActiveVariantBehavior = 'if-missing' | 'set-active' | 'keep';

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

type ImportResult =
  | { dryRun: true; records: Array<{ key: string; file: string; target: string; lineageInputs: number }> }
  | { dryRun: false; records: ImportResultRecord[] };

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

export async function handleImport(parsed: ParsedArgs): Promise<void> {
  try {
    await executeImport(parsed);
  } catch (error) {
    console.error(error instanceof Error ? `Error: ${error.message}` : 'Error: Import failed');
    printUsage();
    process.exitCode = 1;
  }
}

export async function executeImport(
  parsed: ParsedArgs,
  deps: ImportDeps = defaultDeps
): Promise<ImportResult> {
  const manifestPath = parsed.positionals[0] || parsed.options.manifest;
  if (!manifestPath || manifestPath === 'true') {
    throw new Error('Manifest path is required: makefx import <manifest.json>');
  }

  const ctx = await buildContext(parsed, deps);
  const records = await readManifest(manifestPath, deps);
  await validateLocalRecords(records, deps);
  const state = await fetchSpaceState(ctx, deps);
  validateSpaceReferences(records, state);
  const uploadOrder = buildUploadOrder(records);

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

  const result: ImportResult = { dryRun: false, records: imported };
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

async function readManifest(manifestPath: string, deps: ImportDeps): Promise<NormalizedRecord[]> {
  const manifestText = await deps.readFile(manifestPath, 'utf8');
  const manifestDir = path.dirname(path.resolve(manifestPath));
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch (error) {
    throw new Error(`Manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const rawRecords = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? ((parsed as { records?: unknown; files?: unknown }).records ?? (parsed as { files?: unknown }).files)
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
  return records;
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

  return {
    index,
    localKey: record.localKey ?? record.key ?? displayPath,
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
  };
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
}> {
  const assetsData = await fetchJson<{ assets: Asset[] }>(ctx, deps, `/api/spaces/${ctx.spaceId}/assets`);
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
  return { assets, variantsById };
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

async function fetchJson<T>(ctx: ImportContext, deps: ImportDeps, requestPath: string): Promise<T> {
  const response = await deps.fetch(`${ctx.baseUrl}${requestPath}`, {
    headers: { Authorization: `Bearer ${ctx.accessToken}` },
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
    return;
  }
  deps.print(`Imported ${result.records.length} records.`);
  for (const record of result.records) {
    deps.print(`  ${record.key}: asset ${record.assetId}, variant ${record.variantId}`);
  }
}

function printUsage(): void {
  console.log(`
Usage:
  makefx import <manifest.json> [--space <id>]
  makefx import <manifest.json> --dry-run [--json]

Manifest:
  Top-level array, or { "records": [...] }. Each record sets file plus either
  assetId for an existing asset or name for a new asset. Lineage entries use
  sourceVariantId or sourceFile with relationType derived, refined, or forked.
`);
}
