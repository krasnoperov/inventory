import process from 'node:process';
import type { ParsedArgs, StoredConfig } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import { loadProjectConfig, type ProjectConfig } from '../lib/project-config';
import {
  loginCommandForEnvironment,
  resolveCommandEnvironment,
  resolveCommandSpace,
} from '../lib/command-context';
import { truncate } from '../lib/utils';
import { apiFetch } from '../../shared/api/client';
import type {
  CollectionItem,
  SpaceCollection,
  UpsertCollectionItemRequest,
  UpsertCollectionRequest,
} from '../../shared/api/schemas';

interface StyleReferenceCollection extends SpaceCollection {
  reference_count: number;
  preset_count: number;
}

interface StylePreset {
  id: string;
  name: string;
  description: string | null;
  style_prompt: string;
  collection_id: string | null;
  enabled: boolean | number;
  is_default: boolean | number;
  created_by: string;
  created_at: number;
  updated_at: number;
  collection_name: string | null;
  reference_count: number;
  style_reference_variant_ids: string[];
  style_reference_image_keys: string[];
}

interface StylePresetEnvelope {
  success: true;
  preset: StylePreset;
}

interface StylePresetRequest {
  id?: string;
  name?: string;
  description?: string | null;
  stylePrompt?: string;
  collectionId?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
}

interface CreateStylePresetRequest extends StylePresetRequest {
  name: string;
}

interface AssetSummary {
  id: string;
  name: string;
  type?: string | null;
  media_kind?: string | null;
  active_variant_id: string | null;
}

type StylesResult =
  | { type: 'references'; references: StyleReferenceItem[] }
  | { type: 'collections'; collections: StyleReferenceCollection[] }
  | { type: 'collection'; collection: SpaceCollection; items?: CollectionItem[] }
  | { type: 'presets'; presets: StylePreset[] }
  | { type: 'preset'; preset: StylePreset }
  | { type: 'delete-preset'; presetId: string };

interface StylesDeps {
  loadConfig: (env: string) => Promise<StoredConfig | null>;
  loadProjectConfig: () => Promise<ProjectConfig | null>;
  resolveBaseUrl: (env: string) => string;
  fetch: typeof fetch;
  print: (message: string) => void;
}

interface StylesContext {
  env: string;
  spaceId: string;
  baseUrl: string;
  accessToken: string;
}

interface StyleReferenceItem {
  collectionId: string;
  collectionName: string;
  item: CollectionItem;
}

const defaultDeps: StylesDeps = {
  loadConfig: loadStoredConfig,
  loadProjectConfig,
  resolveBaseUrl,
  fetch,
  print: console.log,
};

export async function handleStyles(parsed: ParsedArgs): Promise<void> {
  try {
    await executeStyles(parsed);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    printUsage();
    process.exitCode = 1;
  }
}

export async function executeStyles(
  parsed: ParsedArgs,
  deps: StylesDeps = defaultDeps
): Promise<StylesResult> {
  const namespace = parsed.positionals[0] || 'presets';
  if (namespace === 'references' || namespace === 'refs') {
    return executeReferences(parsed, deps);
  }
  if (namespace === 'collections' || namespace === 'collection') {
    return executeCollections(parsed, deps);
  }
  if (namespace === 'presets' || namespace === 'preset') {
    return executePresets(parsed, deps);
  }
  throw new Error(`Unknown styles command: ${namespace}`);
}

async function executeReferences(parsed: ParsedArgs, deps: StylesDeps): Promise<StylesResult> {
  const ctx = await buildContext(parsed, deps);
  const collectionFilter = readOption(parsed, 'collection', 'collectionId') || parsed.positionals[1];
  const collections = await listStyleReferenceCollections(ctx, deps);
  const selected = collectionFilter
    ? collections.filter((collection) => collection.id === collectionFilter || collection.name === collectionFilter)
    : collections;
  if (collectionFilter && selected.length === 0) {
    throw new Error(`Style reference collection not found: ${collectionFilter}`);
  }

  const references: StyleReferenceItem[] = [];
  for (const collection of selected) {
    const items = await listCollectionItems(ctx, deps, collection.id);
    for (const item of items.filter((candidate) => candidate.role === 'style_ref')) {
      references.push({ collectionId: collection.id, collectionName: collection.name, item });
    }
  }

  if (parsed.options.json === 'true') {
    deps.print(JSON.stringify(references, null, 2));
  } else {
    printReferences(references, deps.print);
  }
  return { type: 'references', references };
}

async function executeCollections(parsed: ParsedArgs, deps: StylesDeps): Promise<StylesResult> {
  const ctx = await buildContext(parsed, deps);
  const action = parsed.positionals[1] || 'list';

  if (action === 'list') {
    const collections = await listStyleReferenceCollections(ctx, deps);
    if (parsed.options.json === 'true') {
      deps.print(JSON.stringify(collections, null, 2));
    } else {
      printCollections(collections, deps.print);
    }
    return { type: 'collections', collections };
  }

  if (action === 'create') {
    const name = parsed.positionals[2] || readRequiredOption(parsed, 'name', 'name');
    const collection = await createCollection(ctx, deps, {
      id: readOption(parsed, 'id', 'id'),
      name,
      description: nullableOption(parsed, 'description', 'description'),
    });
    const items = await upsertStyleReferenceItems(ctx, deps, collection.id, parsed, false);
    printCollectionMutation('Created', collection, items, deps.print, parsed.options.json === 'true');
    return { type: 'collection', collection, items };
  }

  if (action === 'update') {
    const collectionId = parsed.positionals[2] || readRequiredOption(parsed, 'id', 'id');
    const changes: Partial<UpsertCollectionRequest> = {};
    const name = readOption(parsed, 'name', 'name');
    const description = nullableOption(parsed, 'description', 'description');
    if (name !== undefined) changes.name = name;
    if (description !== undefined) changes.description = description;

    let collection: SpaceCollection | undefined;
    if (Object.keys(changes).length > 0) {
      collection = await updateCollection(ctx, deps, collectionId, changes);
    }

    const hasRefs = hasReferenceOptions(parsed);
    const items = hasRefs
      ? await upsertStyleReferenceItems(ctx, deps, collectionId, parsed, parsed.options.append !== 'true')
      : undefined;
    if (!collection) {
      collection = (await listCollections(ctx, deps)).find((candidate) => candidate.id === collectionId);
    }
    if (!collection) {
      throw new Error(`Collection not found: ${collectionId}`);
    }
    printCollectionMutation('Updated', collection, items, deps.print, parsed.options.json === 'true');
    return { type: 'collection', collection, items };
  }

  throw new Error(`Unknown styles collections command: ${action}`);
}

async function executePresets(parsed: ParsedArgs, deps: StylesDeps): Promise<StylesResult> {
  const ctx = await buildContext(parsed, deps);
  const action = parsed.positionals[1] || 'list';

  if (action === 'list') {
    const presets = await listStylePresets(ctx, deps);
    if (parsed.options.json === 'true') {
      deps.print(JSON.stringify(presets, null, 2));
    } else {
      printPresets(presets, deps.print);
    }
    return { type: 'presets', presets };
  }

  if (action === 'create') {
    const name = parsed.positionals[2] || readRequiredOption(parsed, 'name', 'name');
    const response = await createStylePreset(ctx, deps, {
      id: readOption(parsed, 'id', 'id'),
      name,
      description: nullableOption(parsed, 'description', 'description'),
      stylePrompt: readOption(parsed, 'prompt', 'stylePrompt') ?? '',
      collectionId: nullableOption(parsed, 'collection', 'collectionId'),
      enabled: parsed.options.disable === 'true' ? false : true,
      isDefault: parsed.options.default === 'true',
    });
    printPresetMutation('Created', response.preset, deps.print, parsed.options.json === 'true');
    return { type: 'preset', preset: response.preset as StylePreset };
  }

  if (action === 'update') {
    const presetId = parsed.positionals[2] || readRequiredOption(parsed, 'id', 'id');
    const response = await updateStylePreset(ctx, deps, presetId, buildPresetUpdate(parsed));
    printPresetMutation('Updated', response.preset, deps.print, parsed.options.json === 'true');
    return { type: 'preset', preset: response.preset as StylePreset };
  }

  if (action === 'enable' || action === 'disable') {
    const presetId = parsed.positionals[2] || readRequiredOption(parsed, 'id', 'id');
    const response = await updateStylePreset(ctx, deps, presetId, { enabled: action === 'enable' });
    printPresetMutation(action === 'enable' ? 'Enabled' : 'Disabled', response.preset, deps.print, parsed.options.json === 'true');
    return { type: 'preset', preset: response.preset as StylePreset };
  }

  if (action === 'delete' || action === 'remove') {
    const presetId = parsed.positionals[2] || readRequiredOption(parsed, 'id', 'id');
    await deleteStylePreset(ctx, deps, presetId);
    if (parsed.options.json === 'true') {
      deps.print(JSON.stringify({ success: true, presetId }, null, 2));
    } else {
      deps.print(`Deleted style preset ${presetId}`);
    }
    return { type: 'delete-preset', presetId };
  }

  throw new Error(`Unknown styles presets command: ${action}`);
}

async function buildContext(parsed: ParsedArgs, deps: StylesDeps): Promise<StylesContext> {
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

async function listAssets(ctx: StylesContext, deps: Pick<StylesDeps, 'fetch'>): Promise<AssetSummary[]> {
  const response = await apiFetch('GET /api/spaces/:id/assets', {
    baseUrl: ctx.baseUrl,
    fetch: deps.fetch,
    params: { id: ctx.spaceId },
    headers: authHeaders(ctx),
  });
  return response.assets as AssetSummary[];
}

async function listCollections(ctx: StylesContext, deps: Pick<StylesDeps, 'fetch'>): Promise<SpaceCollection[]> {
  const response = await apiFetch('GET /api/spaces/:id/collections', {
    baseUrl: ctx.baseUrl,
    fetch: deps.fetch,
    params: { id: ctx.spaceId },
    headers: authHeaders(ctx),
  });
  return response.collections;
}

async function listStyleReferenceCollections(
  ctx: StylesContext,
  deps: Pick<StylesDeps, 'fetch'>
): Promise<StyleReferenceCollection[]> {
  const response = await apiFetch('GET /api/spaces/:id/style-reference-collections', {
    baseUrl: ctx.baseUrl,
    fetch: deps.fetch,
    params: { id: ctx.spaceId },
    headers: authHeaders(ctx),
  });
  return response.collections as StyleReferenceCollection[];
}

async function listCollectionItems(
  ctx: StylesContext,
  deps: Pick<StylesDeps, 'fetch'>,
  collectionId: string
): Promise<CollectionItem[]> {
  const response = await apiFetch('GET /api/spaces/:id/collections/:collectionId/items', {
    baseUrl: ctx.baseUrl,
    fetch: deps.fetch,
    params: { id: ctx.spaceId, collectionId },
    headers: authHeaders(ctx),
  });
  return response.items;
}

async function createCollection(
  ctx: StylesContext,
  deps: Pick<StylesDeps, 'fetch'>,
  json: UpsertCollectionRequest
): Promise<SpaceCollection> {
  const response = await apiFetch('POST /api/spaces/:id/collections', {
    baseUrl: ctx.baseUrl,
    fetch: deps.fetch,
    params: { id: ctx.spaceId },
    json,
    headers: authHeaders(ctx),
  });
  return response.collection;
}

async function updateCollection(
  ctx: StylesContext,
  deps: Pick<StylesDeps, 'fetch'>,
  collectionId: string,
  json: Partial<UpsertCollectionRequest>
): Promise<SpaceCollection> {
  const response = await apiFetch('PATCH /api/spaces/:id/collections/:collectionId', {
    baseUrl: ctx.baseUrl,
    fetch: deps.fetch,
    params: { id: ctx.spaceId, collectionId },
    json,
    headers: authHeaders(ctx),
  });
  return response.collection;
}

async function createCollectionItem(
  ctx: StylesContext,
  deps: Pick<StylesDeps, 'fetch'>,
  collectionId: string,
  json: UpsertCollectionItemRequest
): Promise<CollectionItem> {
  const response = await apiFetch('POST /api/spaces/:id/collections/:collectionId/items', {
    baseUrl: ctx.baseUrl,
    fetch: deps.fetch,
    params: { id: ctx.spaceId, collectionId },
    json,
    headers: authHeaders(ctx),
  });
  return response.item;
}

async function deleteCollectionItem(
  ctx: StylesContext,
  deps: Pick<StylesDeps, 'fetch'>,
  collectionId: string,
  itemId: string
): Promise<void> {
  await apiFetch('DELETE /api/spaces/:id/collections/:collectionId/items/:itemId', {
    baseUrl: ctx.baseUrl,
    fetch: deps.fetch,
    params: { id: ctx.spaceId, collectionId, itemId },
    headers: authHeaders(ctx),
  });
}

async function listStylePresets(ctx: StylesContext, deps: Pick<StylesDeps, 'fetch'>): Promise<StylePreset[]> {
  const response = await apiFetch('GET /api/spaces/:id/style-presets', {
    baseUrl: ctx.baseUrl,
    fetch: deps.fetch,
    params: { id: ctx.spaceId },
    headers: authHeaders(ctx),
  });
  return response.presets as StylePreset[];
}

async function createStylePreset(
  ctx: StylesContext,
  deps: Pick<StylesDeps, 'fetch'>,
  json: CreateStylePresetRequest
): Promise<StylePresetEnvelope> {
  return apiFetch('POST /api/spaces/:id/style-presets', {
    baseUrl: ctx.baseUrl,
    fetch: deps.fetch,
    params: { id: ctx.spaceId },
    json,
    headers: authHeaders(ctx),
  });
}

async function updateStylePreset(
  ctx: StylesContext,
  deps: Pick<StylesDeps, 'fetch'>,
  presetId: string,
  json: StylePresetRequest
): Promise<StylePresetEnvelope> {
  return apiFetch('PATCH /api/spaces/:id/style-presets/:presetId', {
    baseUrl: ctx.baseUrl,
    fetch: deps.fetch,
    params: { id: ctx.spaceId, presetId },
    json,
    headers: authHeaders(ctx),
  });
}

async function deleteStylePreset(
  ctx: StylesContext,
  deps: Pick<StylesDeps, 'fetch'>,
  presetId: string
): Promise<void> {
  await apiFetch('DELETE /api/spaces/:id/style-presets/:presetId', {
    baseUrl: ctx.baseUrl,
    fetch: deps.fetch,
    params: { id: ctx.spaceId, presetId },
    headers: authHeaders(ctx),
  });
}

async function upsertStyleReferenceItems(
  ctx: StylesContext,
  deps: Pick<StylesDeps, 'fetch'>,
  collectionId: string,
  parsed: ParsedArgs,
  replaceExisting: boolean
): Promise<CollectionItem[]> {
  const refs = await buildStyleReferenceItemRequests(ctx, deps, parsed);
  if (refs.length === 0) return [];

  if (replaceExisting) {
    const existing = await listCollectionItems(ctx, deps, collectionId);
    await Promise.all(existing.map((item) => deleteCollectionItem(ctx, deps, collectionId, item.id)));
  }

  const created: CollectionItem[] = [];
  for (let index = 0; index < refs.length; index += 1) {
    created.push(await createCollectionItem(ctx, deps, collectionId, {
      ...refs[index],
      role: 'style_ref',
      sortIndex: index,
    }));
  }
  return created;
}

async function buildStyleReferenceItemRequests(
  ctx: StylesContext,
  deps: Pick<StylesDeps, 'fetch'>,
  parsed: ParsedArgs
): Promise<UpsertCollectionItemRequest[]> {
  const assets = parseCsvOptions(parsed, ['assets', 'asset']);
  const variants = parseCsvOptions(parsed, ['variants', 'variant']);
  const refs = parseCsvOptions(parsed, ['refs', 'ref']);
  if (assets.length === 0 && variants.length === 0 && refs.length === 0) return [];

  const allAssets = await listAssets(ctx, deps);
  const assetById = new Map(allAssets.map((asset) => [asset.id, asset]));
  const requests: UpsertCollectionItemRequest[] = [];

  for (const assetId of [...assets, ...refs.filter((ref) => assetById.has(ref))]) {
    const asset = assetById.get(assetId);
    if (!asset) throw new Error(`Asset not found in space ${ctx.spaceId}: ${assetId}`);
    if (!asset.active_variant_id) {
      throw new Error(`Asset ${assetId} has no active variant to pin as a style reference`);
    }
    requests.push({
      subjectType: 'asset',
      assetId,
      pinnedVariantId: asset.active_variant_id,
    });
  }

  for (const variantId of [...variants, ...refs.filter((ref) => !assetById.has(ref))]) {
    requests.push({
      subjectType: 'variant',
      variantId,
    });
  }

  return dedupeItemRequests(requests);
}

function dedupeItemRequests(requests: UpsertCollectionItemRequest[]): UpsertCollectionItemRequest[] {
  const seen = new Set<string>();
  return requests.filter((request) => {
    const key = request.subjectType === 'asset'
      ? `asset:${request.assetId}:${request.pinnedVariantId ?? ''}`
      : `variant:${request.variantId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildPresetUpdate(parsed: ParsedArgs): StylePresetRequest {
  const update: StylePresetRequest = {};
  const name = readOption(parsed, 'name', 'name');
  const description = nullableOption(parsed, 'description', 'description');
  const stylePrompt = readOption(parsed, 'prompt', 'stylePrompt');
  const collectionId = nullableOption(parsed, 'collection', 'collectionId');
  if (name !== undefined) update.name = name;
  if (description !== undefined) update.description = description;
  if (stylePrompt !== undefined) update.stylePrompt = stylePrompt;
  if (collectionId !== undefined) update.collectionId = collectionId;
  if (parsed.options.enable === 'true') update.enabled = true;
  if (parsed.options.disable === 'true') update.enabled = false;
  if (parsed.options.default === 'true') update.isDefault = true;
  if (parsed.options['no-default'] === 'true') update.isDefault = false;
  if (Object.keys(update).length === 0) {
    throw new Error('No preset updates provided');
  }
  return update;
}

function authHeaders(ctx: StylesContext): HeadersInit {
  return {
    'Authorization': `Bearer ${ctx.accessToken}`,
    'Accept': 'application/json',
  };
}

function hasReferenceOptions(parsed: ParsedArgs): boolean {
  return ['refs', 'ref', 'assets', 'asset', 'variants', 'variant'].some((key) => Boolean(readRawOption(parsed, key)));
}

function parseCsvOptions(parsed: ParsedArgs, keys: string[]): string[] {
  return keys.flatMap((key) => parseCsv(readRawOption(parsed, key)));
}

function parseCsv(value: string | undefined): string[] {
  if (!value || value === 'true') return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function readRequiredOption(parsed: ParsedArgs, kebabName: string, camelName: string): string {
  const value = readOption(parsed, kebabName, camelName);
  if (value === undefined) {
    throw new Error(`--${kebabName} is required`);
  }
  return value;
}

function readOption(parsed: ParsedArgs, kebabName: string, camelName: string): string | undefined {
  const value = readRawOption(parsed, kebabName) ?? readRawOption(parsed, camelName);
  return !value || value === 'true' ? undefined : value;
}

function readRawOption(parsed: ParsedArgs, key: string): string | undefined {
  return parsed.options[key];
}

function nullableOption(parsed: ParsedArgs, kebabName: string, camelName: string): string | null | undefined {
  if (parsed.options['no-collection'] === 'true' && (kebabName === 'collection' || camelName === 'collectionId')) {
    return null;
  }
  const value = readOption(parsed, kebabName, camelName);
  if (value === undefined) return undefined;
  return value === 'null' || value === '-' ? null : value;
}

function isEnabled(value: boolean | number): boolean {
  return value === true || value === 1;
}

function printReferences(references: StyleReferenceItem[], print: (message: string) => void): void {
  if (references.length === 0) {
    print('No style reference assets found.');
    return;
  }
  print(`Found ${references.length} style reference asset(s):\n`);
  print('Collection'.padEnd(28) + 'Subject'.padEnd(10) + 'Asset'.padEnd(28) + 'Variant'.padEnd(28) + 'Item');
  print('-'.repeat(108));
  for (const reference of references) {
    const item = reference.item;
    print(
      truncate(reference.collectionName, 26).padEnd(28) +
      item.subject_type.padEnd(10) +
      truncate(item.asset_id || '-', 26).padEnd(28) +
      truncate(item.pinned_variant_id || item.variant_id || '-', 26).padEnd(28) +
      truncate(item.id, 26)
    );
  }
}

function printCollections(collections: StyleReferenceCollection[], print: (message: string) => void): void {
  if (collections.length === 0) {
    print('No style reference collections found.');
    return;
  }
  print(`Found ${collections.length} style reference collection(s):\n`);
  print('References'.padEnd(12) + 'Presets'.padEnd(10) + 'Collection'.padEnd(34) + 'Name');
  print('-'.repeat(88));
  for (const collection of collections) {
    print(
      String(collection.reference_count).padEnd(12) +
      String(collection.preset_count).padEnd(10) +
      truncate(collection.id, 32).padEnd(34) +
      truncate(collection.name, 40)
    );
  }
}

function printPresets(presets: StylePreset[], print: (message: string) => void): void {
  if (presets.length === 0) {
    print('No style presets found.');
    return;
  }
  print(`Found ${presets.length} style preset(s):\n`);
  print('State'.padEnd(14) + 'References'.padEnd(12) + 'Preset'.padEnd(30) + 'Collection'.padEnd(28) + 'Name');
  print('-'.repeat(104));
  for (const preset of presets) {
    const state = `${isEnabled(preset.enabled) ? 'enabled' : 'disabled'}${isEnabled(preset.is_default) ? ',default' : ''}`;
    print(
      truncate(state, 12).padEnd(14) +
      String(preset.reference_count).padEnd(12) +
      truncate(preset.id, 28).padEnd(30) +
      truncate(preset.collection_name || preset.collection_id || '-', 26).padEnd(28) +
      truncate(preset.name, 34)
    );
  }
}

function printCollectionMutation(
  verb: string,
  collection: SpaceCollection,
  items: CollectionItem[] | undefined,
  print: (message: string) => void,
  asJson: boolean
): void {
  if (asJson) {
    print(JSON.stringify({ collection, items }, null, 2));
    return;
  }
  print(`${verb} style reference collection ${collection.id}`);
  print(`  Name:       ${collection.name}`);
  if (items) print(`  References: ${items.filter((item) => item.role === 'style_ref').length}`);
}

function printPresetMutation(
  verb: string,
  preset: StylePreset,
  print: (message: string) => void,
  asJson: boolean
): void {
  if (asJson) {
    print(JSON.stringify(preset, null, 2));
    return;
  }
  print(`${verb} style preset ${preset.id}`);
  print(`  Name:       ${preset.name}`);
  print(`  Enabled:    ${isEnabled(preset.enabled) ? 'yes' : 'no'}`);
  print(`  Default:    ${isEnabled(preset.is_default) ? 'yes' : 'no'}`);
  print(`  Collection: ${preset.collection_name || preset.collection_id || '-'}`);
  print(`  References: ${preset.reference_count}`);
}

function printUsage(): void {
  console.log(`
Usage:
  makefx styles references [--collection <id-or-name>] [--json]
  makefx styles collections list [--json]
  makefx styles collections create <name> --refs <asset_or_variant,...>
  makefx styles collections update <collection-id> [--name <name>] [--refs <asset_or_variant,...>] [--append]
  makefx styles presets list [--json]
  makefx styles presets create <name> --collection <collection-id> --prompt "style prompt" [--default]
  makefx styles presets update <preset-id> [--name <name>] [--collection <collection-id>] [--prompt "style prompt"]
  makefx styles presets enable <preset-id>
  makefx styles presets disable <preset-id>
  makefx styles presets delete <preset-id>

Options:
  --space <id>      Target space ID; defaults from the initialized project
  --refs <ids>      Comma-separated asset IDs or variant IDs to use as style references
  --assets <ids>    Comma-separated asset IDs; active variants are pinned
  --variants <ids>  Comma-separated variant IDs
  --json            Print machine-readable output
  --env <env>       Environment (production|stage|local)
  --local           Shortcut for --env local
`);
}
