import process from 'node:process';
import type { ParsedArgs, StoredConfig } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import { loadProjectConfig, type ProjectConfig } from '../lib/project-config';
import {
  loginCommandForEnvironment,
  resolveCommandEnvironment,
  resolveCommandSpace,
} from '../lib/command-context';
import { apiFetch } from '../../shared/api/client';
import type {
  CollectionItem,
  ReorderItemsRequest,
  SpaceCollection,
  UpdateCollectionItemRequest,
  UpdateCollectionRequest,
  UpsertCollectionItemRequest,
  UpsertCollectionRequest,
} from '../../shared/api/schemas';

type CollectionsResult =
  | { type: 'list'; collections: SpaceCollection[] }
  | { type: 'collection'; collection: SpaceCollection }
  | { type: 'delete'; collectionId: string }
  | { type: 'items'; collectionId: string; items: CollectionItem[] }
  | { type: 'item'; collectionId: string; item: CollectionItem }
  | { type: 'items-added'; collectionId: string; items: CollectionItem[] }
  | { type: 'item-delete'; collectionId: string; itemId: string };

interface CollectionsDeps {
  loadConfig: (env: string) => Promise<StoredConfig | null>;
  loadProjectConfig: () => Promise<ProjectConfig | null>;
  resolveBaseUrl: (env: string) => string;
  fetch: typeof fetch;
  print: (message: string) => void;
}

interface CollectionsContext {
  env: string;
  spaceId: string;
  baseUrl: string;
  accessToken: string;
}

const defaultDeps: CollectionsDeps = {
  loadConfig: loadStoredConfig,
  loadProjectConfig,
  resolveBaseUrl,
  fetch,
  print: console.log,
};

export async function handleCollections(parsed: ParsedArgs): Promise<void> {
  try {
    await executeCollections(parsed);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    printUsage();
    process.exitCode = 1;
  }
}

export async function executeCollections(
  parsed: ParsedArgs,
  deps: CollectionsDeps = defaultDeps
): Promise<CollectionsResult> {
  const action = parsed.positionals[0] || 'list';
  const ctx = await buildContext(parsed, deps);
  const json = parsed.options.json === 'true';

  if (action === 'list') {
    const collections = await listCollections(ctx, deps);
    if (json) {
      printJson(collections, deps.print);
    } else {
      printCollections(collections, deps.print);
    }
    return { type: 'list', collections };
  }

  if (action === 'create') {
    const name = parsed.positionals[1] || readRequiredOption(parsed, 'name');
    const collection = await createCollection(ctx, deps, buildCollectionCreateRequest(parsed, name));
    if (json) {
      printJson(collection, deps.print);
    } else {
      deps.print(`Created collection ${collection.id} (${collection.name})`);
    }
    return { type: 'collection', collection };
  }

  if (action === 'update') {
    const collectionId = parsed.positionals[1] || readRequiredOption(parsed, 'id');
    const collection = await updateCollection(ctx, deps, collectionId, buildCollectionUpdateRequest(parsed));
    if (json) {
      printJson(collection, deps.print);
    } else {
      deps.print(`Updated collection ${collection.id} (${collection.name})`);
    }
    return { type: 'collection', collection };
  }

  if (action === 'delete' || action === 'remove-collection') {
    const collectionId = parsed.positionals[1] || readRequiredOption(parsed, 'id');
    await deleteCollection(ctx, deps, collectionId);
    if (json) {
      printJson({ success: true, collectionId }, deps.print);
    } else {
      deps.print(`Deleted collection ${collectionId}`);
    }
    return { type: 'delete', collectionId };
  }

  if (action === 'items' || action === 'list-items') {
    const collectionId = parsed.positionals[1] || readRequiredOption(parsed, 'collection');
    const items = await listCollectionItems(ctx, deps, collectionId);
    if (json) {
      printJson(items, deps.print);
    } else {
      printItems(collectionId, items, deps.print);
    }
    return { type: 'items', collectionId, items };
  }

  if (action === 'add') {
    const collectionId = parsed.positionals[1] || readRequiredOption(parsed, 'collection');
    const requests = buildCollectionItemCreateRequests(parsed);
    if (requests.length === 0) {
      throw new Error('Provide at least one --asset/--assets or --variant/--variants value');
    }
    const items: CollectionItem[] = [];
    for (const request of requests) {
      items.push(await createCollectionItem(ctx, deps, collectionId, request));
    }
    if (json) {
      printJson(items, deps.print);
    } else {
      deps.print(`Added ${items.length} item${items.length === 1 ? '' : 's'} to ${collectionId}`);
    }
    return { type: 'items-added', collectionId, items };
  }

  if (action === 'update-item') {
    const collectionId = parsed.positionals[1] || readRequiredOption(parsed, 'collection');
    const itemId = parsed.positionals[2] || readRequiredOption(parsed, 'item');
    const item = await updateCollectionItem(ctx, deps, collectionId, itemId, buildItemUpdateRequest(parsed));
    if (json) {
      printJson(item, deps.print);
    } else {
      deps.print(`Updated collection item ${item.id}`);
    }
    return { type: 'item', collectionId, item };
  }

  if (action === 'reorder') {
    const collectionId = parsed.positionals[1] || readRequiredOption(parsed, 'collection');
    const itemIds = parseCsvOptions(parsed, ['items', 'item-ids']);
    if (itemIds.length === 0) {
      throw new Error('Provide --items <item-id,item-id>');
    }
    const items = await reorderCollectionItems(ctx, deps, collectionId, { itemIds });
    if (json) {
      printJson(items, deps.print);
    } else {
      deps.print(`Reordered ${items.length} item${items.length === 1 ? '' : 's'} in ${collectionId}`);
    }
    return { type: 'items', collectionId, items };
  }

  if (action === 'remove' || action === 'delete-item') {
    const collectionId = parsed.positionals[1] || readRequiredOption(parsed, 'collection');
    const itemId = parsed.positionals[2] || readRequiredOption(parsed, 'item');
    await deleteCollectionItem(ctx, deps, collectionId, itemId);
    if (json) {
      printJson({ success: true, collectionId, itemId }, deps.print);
    } else {
      deps.print(`Removed collection item ${itemId}`);
    }
    return { type: 'item-delete', collectionId, itemId };
  }

  throw new Error(`Unknown collections command: ${action}`);
}

async function buildContext(parsed: ParsedArgs, deps: CollectionsDeps): Promise<CollectionsContext> {
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

function buildCollectionCreateRequest(parsed: ParsedArgs, name: string): UpsertCollectionRequest {
  const request: UpsertCollectionRequest = { name };
  const id = readOption(parsed, 'id');
  if (id !== undefined) request.id = id;
  applyCollectionOptions(request, parsed);
  return request;
}

function buildCollectionUpdateRequest(parsed: ParsedArgs): UpdateCollectionRequest {
  const request: UpdateCollectionRequest = {};
  const name = readOption(parsed, 'name');
  if (name !== undefined) request.name = name;
  applyCollectionOptions(request, parsed);
  if (Object.keys(request).length === 0) {
    throw new Error('No collection updates provided');
  }
  return request;
}

function applyCollectionOptions(request: UpdateCollectionRequest, parsed: ParsedArgs): void {
  const kind = readOption(parsed, 'kind');
  const color = nullableOption(parsed, 'color');
  const description = nullableOption(parsed, 'description');
  const sortIndex = numberOption(parsed, 'sort-index', 'sortIndex');
  if (kind !== undefined) request.kind = kind as UpdateCollectionRequest['kind'];
  if (color !== undefined) request.color = color;
  if (description !== undefined) request.description = description;
  if (sortIndex !== undefined) request.sortIndex = sortIndex;
}

function buildCollectionItemCreateRequests(parsed: ParsedArgs): UpsertCollectionItemRequest[] {
  const role = readOption(parsed, 'role');
  const pinnedVariantId = nullableOption(parsed, 'pinned-variant', 'pinnedVariantId');
  const sortIndex = numberOption(parsed, 'sort-index', 'sortIndex');
  const base: Partial<UpsertCollectionItemRequest> = {};
  if (role !== undefined) base.role = role;
  if (pinnedVariantId !== undefined) base.pinnedVariantId = pinnedVariantId;
  if (sortIndex !== undefined) base.sortIndex = sortIndex;

  return [
    ...parseCsvOptions(parsed, ['asset', 'assets']).map((assetId) => ({
      ...base,
      subjectType: 'asset' as const,
      assetId,
    })),
    ...parseCsvOptions(parsed, ['variant', 'variants']).map((variantId) => ({
      ...base,
      subjectType: 'variant' as const,
      variantId,
    })),
  ];
}

function buildItemUpdateRequest(parsed: ParsedArgs): UpdateCollectionItemRequest {
  const request: UpdateCollectionItemRequest = {};
  const role = readOption(parsed, 'role');
  const pinnedVariantId = nullableOption(parsed, 'pinned-variant', 'pinnedVariantId');
  const sortIndex = numberOption(parsed, 'sort-index', 'sortIndex');
  if (role !== undefined) request.role = role;
  if (pinnedVariantId !== undefined) request.pinnedVariantId = pinnedVariantId;
  if (sortIndex !== undefined) request.sortIndex = sortIndex;
  if (Object.keys(request).length === 0) {
    throw new Error('No collection item updates provided');
  }
  return request;
}

async function listCollections(ctx: CollectionsContext, deps: Pick<CollectionsDeps, 'fetch'>): Promise<SpaceCollection[]> {
  const response = await apiFetch('GET /api/spaces/:id/collections', {
    baseUrl: ctx.baseUrl,
    fetch: deps.fetch,
    params: { id: ctx.spaceId },
    headers: authHeaders(ctx),
  });
  return response.collections;
}

async function createCollection(
  ctx: CollectionsContext,
  deps: Pick<CollectionsDeps, 'fetch'>,
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
  ctx: CollectionsContext,
  deps: Pick<CollectionsDeps, 'fetch'>,
  collectionId: string,
  json: UpdateCollectionRequest
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

async function deleteCollection(
  ctx: CollectionsContext,
  deps: Pick<CollectionsDeps, 'fetch'>,
  collectionId: string
): Promise<void> {
  await apiFetch('DELETE /api/spaces/:id/collections/:collectionId', {
    baseUrl: ctx.baseUrl,
    fetch: deps.fetch,
    params: { id: ctx.spaceId, collectionId },
    headers: authHeaders(ctx),
  });
}

async function listCollectionItems(
  ctx: CollectionsContext,
  deps: Pick<CollectionsDeps, 'fetch'>,
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

async function createCollectionItem(
  ctx: CollectionsContext,
  deps: Pick<CollectionsDeps, 'fetch'>,
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

async function updateCollectionItem(
  ctx: CollectionsContext,
  deps: Pick<CollectionsDeps, 'fetch'>,
  collectionId: string,
  itemId: string,
  json: UpdateCollectionItemRequest
): Promise<CollectionItem> {
  const response = await apiFetch('PATCH /api/spaces/:id/collections/:collectionId/items/:itemId', {
    baseUrl: ctx.baseUrl,
    fetch: deps.fetch,
    params: { id: ctx.spaceId, collectionId, itemId },
    json,
    headers: authHeaders(ctx),
  });
  return response.item;
}

async function reorderCollectionItems(
  ctx: CollectionsContext,
  deps: Pick<CollectionsDeps, 'fetch'>,
  collectionId: string,
  json: ReorderItemsRequest
): Promise<CollectionItem[]> {
  const response = await apiFetch('POST /api/spaces/:id/collections/:collectionId/items/reorder', {
    baseUrl: ctx.baseUrl,
    fetch: deps.fetch,
    params: { id: ctx.spaceId, collectionId },
    json,
    headers: authHeaders(ctx),
  });
  return response.items;
}

async function deleteCollectionItem(
  ctx: CollectionsContext,
  deps: Pick<CollectionsDeps, 'fetch'>,
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

function printCollections(collections: SpaceCollection[], print: (message: string) => void): void {
  if (collections.length === 0) {
    print('No collections found.');
    return;
  }
  for (const collection of collections) {
    const suffix = collection.description ? ` - ${collection.description}` : '';
    print(`${collection.id}\t${collection.name}\t${collection.kind}${suffix}`);
  }
}

function printItems(collectionId: string, items: CollectionItem[], print: (message: string) => void): void {
  if (items.length === 0) {
    print(`No items found in ${collectionId}.`);
    return;
  }
  for (const item of items) {
    const subject = item.subject_type === 'asset' ? `asset:${item.asset_id}` : `variant:${item.variant_id}`;
    const pinned = item.pinned_variant_id ? ` pinned:${item.pinned_variant_id}` : '';
    print(`${item.id}\t${subject}\t${item.role}${pinned}`);
  }
}

function printJson(value: unknown, print: (message: string) => void): void {
  print(JSON.stringify(value, null, 2));
}

function authHeaders(ctx: CollectionsContext): HeadersInit {
  return {
    'Authorization': `Bearer ${ctx.accessToken}`,
    'Accept': 'application/json',
  };
}

function readOption(parsed: ParsedArgs, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = parsed.options[key];
    if (value !== undefined && value !== 'true') return value;
  }
  return undefined;
}

function readRequiredOption(parsed: ParsedArgs, ...keys: string[]): string {
  const value = readOption(parsed, ...keys);
  if (!value) {
    throw new Error(`Missing required option --${keys[0]}`);
  }
  return value;
}

function nullableOption(parsed: ParsedArgs, ...keys: string[]): string | null | undefined {
  for (const key of keys) {
    if (!(key in parsed.options)) continue;
    const value = parsed.options[key];
    if (value === 'null' || value === 'none' || value === '') return null;
    if (value !== 'true') return value;
  }
  return undefined;
}

function numberOption(parsed: ParsedArgs, ...keys: string[]): number | undefined {
  const value = readOption(parsed, ...keys);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number)) {
    throw new Error(`Expected integer for --${keys[0]}`);
  }
  return number;
}

function parseCsvOptions(parsed: ParsedArgs, keys: string[]): string[] {
  return keys.flatMap((key) => (parsed.options[key] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean));
}

function printUsage(): void {
  console.error(`Usage:
  makefx collections list [--json]
  makefx collections create <name> [--kind <kind>] [--description <text>] [--json]
  makefx collections update <collection-id> [--name <name>] [--description <text>] [--json]
  makefx collections delete <collection-id> [--json]
  makefx collections items <collection-id> [--json]
  makefx collections add <collection-id> --asset <asset-id>[,<asset-id>] [--variant <variant-id>] [--role <role>] [--json]
  makefx collections update-item <collection-id> <item-id> [--role <role>] [--pinned-variant <variant-id|none>] [--sort-index <n>] [--json]
  makefx collections reorder <collection-id> --items <item-id,item-id> [--json]
  makefx collections remove <collection-id> <item-id> [--json]`);
}
