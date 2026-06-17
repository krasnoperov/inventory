import process from 'node:process';
import path from 'node:path';
import type { ParsedArgs, StoredConfig } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import { loadProjectConfig, type ProjectConfig } from '../lib/project-config';
import {
  loginCommandForEnvironment,
  resolveCommandEnvironment,
  resolveCommandSpace,
} from '../lib/command-context';
import { downloadFile } from '../lib/image-transfer';
import { truncate } from '../lib/utils';
import { WebSocketClient, type AssetMutationClient, type AssetRecord } from '../lib/websocket-client';
import type { MediaKind } from '../../shared/websocket-types';

interface Asset {
  id: string;
  name: string;
  type: string | null;
  media_kind?: MediaKind;
  tags?: string | null;
  parent_asset_id?: string | null;
  active_variant_id: string | null;
  created_at?: number;
  updated_at?: number;
}

interface Variant {
  id: string;
  asset_id: string;
  media_kind?: MediaKind;
  status: string;
  image_key: string | null;
  thumb_key: string | null;
  media_key?: string | null;
  media_mime_type?: string | null;
  media_size_bytes?: number | null;
  media_width?: number | null;
  media_height?: number | null;
  media_duration_ms?: number | null;
  transcript_key?: string | null;
  transcript_mime_type?: string | null;
  transcript_size_bytes?: number | null;
  word_timings_key?: string | null;
  word_timings_mime_type?: string | null;
  word_timings_size_bytes?: number | null;
  render_metadata_key?: string | null;
  render_metadata_mime_type?: string | null;
  render_metadata_size_bytes?: number | null;
  generation_provenance?: string | null;
  provider_metadata?: string | null;
  recipe?: string;
  starred?: boolean;
  error_message?: string | null;
  created_at?: number;
  updated_at?: number | null;
}

interface Lineage {
  id: string;
  parent_variant_id: string;
  child_variant_id: string;
  relation_type: string;
  severed?: boolean;
  created_at?: number;
}

interface AssetDetails {
  asset: Asset;
  variants: Variant[];
  lineage: Lineage[];
}

type AssetsResult =
  | { type: 'list'; assets: Asset[] }
  | { type: 'show'; details: AssetDetails }
  | { type: 'download'; mediaKey: string; outputPath: string; variant?: Variant }
  | { type: 'delete'; assetId: string }
  | { type: 'rename'; asset: AssetRecord }
  | { type: 'set-active'; asset: AssetRecord };

interface AssetsDeps {
  loadConfig: (env: string) => Promise<StoredConfig | null>;
  loadProjectConfig: () => Promise<ProjectConfig | null>;
  resolveBaseUrl: (env: string) => string;
  fetch: typeof fetch;
  downloadFile: typeof downloadFile;
  createMutationClient: (env: string, spaceId: string) => Promise<AssetMutationClient>;
  print: (message: string) => void;
}

interface AssetsContext {
  env: string;
  spaceId: string;
  baseUrl: string;
  accessToken: string;
  force: boolean;
}

const defaultDeps: AssetsDeps = {
  loadConfig: loadStoredConfig,
  loadProjectConfig,
  resolveBaseUrl,
  fetch,
  downloadFile,
  createMutationClient: (env, spaceId) => WebSocketClient.create(env, spaceId),
  print: console.log,
};

async function withAssetClient<T>(
  ctx: AssetsContext,
  deps: Pick<AssetsDeps, 'createMutationClient'>,
  run: (client: AssetMutationClient) => Promise<T>
): Promise<T> {
  const client = await deps.createMutationClient(ctx.env, ctx.spaceId);
  await client.connect();
  try {
    return await run(client);
  } finally {
    client.disconnect();
  }
}

export async function handleAssets(parsed: ParsedArgs): Promise<void> {
  try {
    await executeAssets(parsed);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    printUsage();
    process.exitCode = 1;
  }
}

export async function executeAssets(
  parsed: ParsedArgs,
  deps: AssetsDeps = defaultDeps
): Promise<AssetsResult> {
  const ctx = await buildContext(parsed, deps);
  const subcommand = parsed.positionals[0] || 'list';

  if (subcommand === 'list') {
    const assets = await listAssets(ctx, deps);
    if (parsed.options.json === 'true') {
      deps.print(JSON.stringify(assets.map(toAssetJson), null, 2));
    } else {
      printAssetList(assets, deps.print);
    }
    return { type: 'list', assets };
  }

  if (subcommand === 'show') {
    const assetId = parsed.positionals[1];
    if (!assetId) {
      throw new Error('Asset ID is required: pnpm run cli assets show <asset-id>');
    }
    const details = await getAssetDetails(ctx, deps, assetId);
    if (parsed.options.json === 'true') {
      deps.print(JSON.stringify(details, null, 2));
    } else {
      printAssetDetails(details, ctx, deps.print);
    }
    return { type: 'show', details };
  }

  if (subcommand === 'download') {
    const ref = parsed.positionals[1];
    if (!ref) {
      throw new Error('Variant ID or legacy image key is required: pnpm run cli assets download <variant-id-or-legacy-image-key> -o <file>');
    }
    const outputPath = getOutputPath(parsed);
    const resolved = await resolveDownloadRef(ref, ctx, deps);
    await deps.downloadFile({
      baseUrl: ctx.baseUrl,
      accessToken: ctx.accessToken,
      requestPath: resolved.requestPath,
      outputPath,
      force: ctx.force,
    });
    deps.print(`Downloaded ${resolved.mediaKey} to ${outputPath}`);
    return { type: 'download', mediaKey: resolved.mediaKey, outputPath, variant: resolved.variant };
  }

  if (subcommand === 'delete') {
    const assetId = parsed.positionals[1];
    if (!assetId) {
      throw new Error('Asset ID is required: pnpm run cli assets delete <asset-id>');
    }
    await withAssetClient(ctx, deps, (client) => client.deleteAsset(assetId));
    deps.print(`Deleted asset ${assetId}`);
    return { type: 'delete', assetId };
  }

  if (subcommand === 'rename') {
    const assetId = parsed.positionals[1];
    const name = parsed.positionals[2];
    if (!assetId || !name) {
      throw new Error('Usage: pnpm run cli assets rename <asset-id> "<new-name>"');
    }
    const asset = await withAssetClient(ctx, deps, (client) => client.renameAsset(assetId, name));
    deps.print(`Renamed asset ${assetId} -> "${asset.name}"`);
    return { type: 'rename', asset };
  }

  if (subcommand === 'set-active') {
    const assetId = parsed.positionals[1];
    const variantId = parsed.positionals[2] || normalizeOption(parsed.options.variant);
    if (!assetId || !variantId) {
      throw new Error('Usage: pnpm run cli assets set-active <asset-id> <variant-id>');
    }
    const asset = await withAssetClient(ctx, deps, (client) => client.setActiveVariant(assetId, variantId));
    deps.print(`Set active variant of asset ${assetId} to ${asset.active_variant_id}`);
    return { type: 'set-active', asset };
  }

  throw new Error(`Unknown assets command: ${subcommand}`);
}

function normalizeOption(value: string | undefined): string | undefined {
  return !value || value === 'true' ? undefined : value;
}

async function buildContext(parsed: ParsedArgs, deps: AssetsDeps): Promise<AssetsContext> {
  const projectConfig = await deps.loadProjectConfig();
  const env = resolveCommandEnvironment(parsed, projectConfig);
  const spaceId = resolveCommandSpace(parsed, projectConfig);
  if (!spaceId) {
    throw new Error('--space is required, or run: pnpm run cli init --space <id>');
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
    force: parsed.options.force === 'true',
  };
}

async function listAssets(ctx: AssetsContext, deps: Pick<AssetsDeps, 'fetch'>): Promise<Asset[]> {
  const data = await fetchJson<{ assets: Asset[] }>(ctx, deps, `/api/spaces/${ctx.spaceId}/assets`);
  return data.assets || [];
}

async function getAssetDetails(
  ctx: AssetsContext,
  deps: Pick<AssetsDeps, 'fetch'>,
  assetId: string
): Promise<AssetDetails> {
  return fetchJson<AssetDetails>(ctx, deps, `/api/spaces/${ctx.spaceId}/assets/${assetId}`);
}

async function fetchJson<T>(
  ctx: AssetsContext,
  deps: Pick<AssetsDeps, 'fetch'>,
  apiPath: string
): Promise<T> {
  const response = await deps.fetch(`${ctx.baseUrl}${apiPath}`, {
    headers: {
      'Authorization': `Bearer ${ctx.accessToken}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed (${response.status}): ${errorText || response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function resolveDownloadRef(
  ref: string,
  ctx: AssetsContext,
  deps: Pick<AssetsDeps, 'fetch'>
): Promise<{ mediaKey: string; requestPath: string; variant?: Variant }> {
  if (looksLikeStorageKey(ref)) {
    if (!isLegacyImageStorageKey(ref)) {
      throw new Error('Direct media key downloads are not supported. Pass a variant ID so the authenticated media endpoint can authorize the download.');
    }
    return { mediaKey: ref, requestPath: `/api/images/${ref}` };
  }

  const assets = await listAssets(ctx, deps);
  for (const asset of assets) {
    const details = await getAssetDetails(ctx, deps, asset.id);
    const variant = details.variants.find((candidate) => candidate.id === ref);
    if (!variant) continue;
    const mediaKey = variant.media_key || variant.image_key;
    if (mediaKey) {
      return {
        mediaKey,
        requestPath: `/api/spaces/${encodeURIComponent(ctx.spaceId)}/variants/${encodeURIComponent(variant.id)}/media`,
        variant,
      };
    }
    throw new Error(`Variant ${ref} has no downloadable media; status is ${variant.status}`);
  }

  throw new Error(`Variant not found in space ${ctx.spaceId}: ${ref}`);
}

function looksLikeStorageKey(value: string): boolean {
  return value.includes('/') || [
    '.aac',
    '.flac',
    '.gif',
    '.jpg',
    '.jpeg',
    '.m4a',
    '.m4v',
    '.mov',
    '.mp3',
    '.mp4',
    '.ogg',
    '.png',
    '.wav',
    '.webm',
    '.webp',
  ].includes(path.extname(value).toLowerCase());
}

function isLegacyImageStorageKey(value: string): boolean {
  return value.startsWith('images/') || value.startsWith('styles/') || value.startsWith('thumbs/');
}

function getOutputPath(parsed: ParsedArgs): string {
  const outputPath = parsed.options.o || parsed.options.output;
  if (!outputPath || outputPath === 'true') {
    throw new Error('Output path is required: pass -o <file> or --output <file>');
  }
  return path.normalize(outputPath);
}

function printAssetList(assets: Asset[], print: (message: string) => void): void {
  if (assets.length === 0) {
    print('No assets found.');
    return;
  }

  print(`Found ${assets.length} asset(s):\n`);
  print(
    'Updated'.padEnd(21) +
    'Type'.padEnd(14) +
    'Media'.padEnd(9) +
    'Active Variant'.padEnd(26) +
    'Asset'.padEnd(28) +
    'Name'
  );
  print('-'.repeat(113));
  for (const asset of assets) {
    print(
      formatTimestamp(asset.updated_at).padEnd(21) +
      truncate(asset.type || 'unknown', 12).padEnd(14) +
      truncate(asset.media_kind || '-', 7).padEnd(9) +
      truncate(asset.active_variant_id || '-', 24).padEnd(26) +
      truncate(asset.id, 26).padEnd(28) +
      truncate(asset.name, 32)
    );
  }
}

function printAssetDetails(details: AssetDetails, ctx: AssetsContext, print: (message: string) => void): void {
  const { asset, variants, lineage } = details;
  print(`\nAsset ${asset.id}\n`);
  print(`  Name:     ${asset.name}`);
  print(`  Type:     ${asset.type || 'unknown'}`);
  print(`  Media:    ${asset.media_kind || '-'}`);
  print(`  Active:   ${asset.active_variant_id || '-'}`);
  print(`  Parent:   ${asset.parent_asset_id || '-'}`);
  print(`  Created:  ${formatTimestamp(asset.created_at)}`);
  print(`  Updated:  ${formatTimestamp(asset.updated_at)}`);
  print(`  Web:      ${ctx.baseUrl}/spaces/${ctx.spaceId}/assets/${asset.id}`);

  if (variants.length > 0) {
    print('\nVariants:');
    for (const variant of [...variants].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))) {
      const active = variant.id === asset.active_variant_id ? '*' : ' ';
      print(` ${active} ${variant.id}`);
      print(`     Status: ${variant.status}`);
      print(`     Media:  ${variant.media_kind || '-'}`);
      print(`     File:   ${variant.media_key || variant.image_key || '-'}`);
      if (variant.image_key) print(`     Image:  ${variant.image_key}`);
      if (variant.media_mime_type) print(`     MIME:   ${variant.media_mime_type}`);
      if (variant.transcript_key) print(`     Transcript:      ${variant.transcript_key}`);
      if (variant.word_timings_key) print(`     Word timings:    ${variant.word_timings_key}`);
      if (variant.render_metadata_key) print(`     Render metadata: ${variant.render_metadata_key}`);
      const provenance = formatMetadataSummary(variant.generation_provenance, [
        'operation',
        'assetType',
        'mediaKind',
        'model',
        'modelProvider',
        'prompt',
      ]);
      if (provenance) print(`     Provenance: ${provenance}`);
      const provider = formatMetadataSummary(variant.provider_metadata, [
        'provider',
        'providerMode',
        'model',
        'operation',
        'api',
        'resolution',
        'durationSeconds',
      ]);
      if (provider) print(`     Provider:   ${provider}`);
    }
  }

  if (lineage.length > 0) {
    print('\nLineage:');
    for (const link of lineage) {
      print(`  ${link.parent_variant_id} -> ${link.child_variant_id} (${link.relation_type})`);
    }
  }
}

function toAssetJson(asset: Asset): Record<string, unknown> {
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    media_kind: asset.media_kind || null,
    activeVariantId: asset.active_variant_id,
    parentAssetId: asset.parent_asset_id || null,
    createdAt: asset.created_at || null,
    updatedAt: asset.updated_at || null,
  };
}

function formatMetadataSummary(value: string | null | undefined, preferredKeys: string[]): string | null {
  if (!value) return null;
  const parsed = parseJsonObject(value);
  if (!parsed) return truncate(value, 120);

  const parts: string[] = [];
  for (const key of preferredKeys) {
    const field = parsed[key];
    if (field === undefined || field === null || typeof field === 'object') continue;
    parts.push(`${key}=${String(field)}`);
  }
  return parts.length > 0 ? truncate(parts.join(' '), 160) : truncate(JSON.stringify(parsed), 160);
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function formatTimestamp(value?: number | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z').slice(0, 20);
}

function printUsage(): void {
  console.log(`
Usage:
  pnpm run cli assets
  pnpm run cli assets --json
  pnpm run cli assets show <asset-id>
  pnpm run cli assets show <asset-id> --json
  pnpm run cli assets download <variant-id|legacy-image-key> -o output-file
  pnpm run cli assets delete <asset-id>
  pnpm run cli assets rename <asset-id> "<new-name>"
  pnpm run cli assets set-active <asset-id> <variant-id>
`);
}
