import process from 'node:process';
import path from 'node:path';
import type { ParsedArgs, StoredConfig } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import { loadProjectConfig, type ProjectConfig } from '../lib/project-config';
import { downloadImage } from '../lib/image-transfer';
import { truncate } from '../lib/utils';
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
  | { type: 'download'; imageKey: string; outputPath: string; variant?: Variant };

interface AssetsDeps {
  loadConfig: (env: string) => Promise<StoredConfig | null>;
  loadProjectConfig: () => Promise<ProjectConfig | null>;
  resolveBaseUrl: (env: string) => string;
  fetch: typeof fetch;
  downloadImage: typeof downloadImage;
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
  downloadImage,
  print: console.log,
};

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
      throw new Error('Variant ID or image key is required: pnpm run cli assets download <variant-or-image-key> -o <file>');
    }
    const outputPath = getOutputPath(parsed);
    const resolved = await resolveDownloadRef(ref, ctx, deps);
    await deps.downloadImage({
      baseUrl: ctx.baseUrl,
      accessToken: ctx.accessToken,
      imageKey: resolved.imageKey,
      outputPath,
      force: ctx.force,
    });
    deps.print(`Downloaded ${resolved.imageKey} to ${outputPath}`);
    return { type: 'download', imageKey: resolved.imageKey, outputPath, variant: resolved.variant };
  }

  throw new Error(`Unknown assets command: ${subcommand}`);
}

async function buildContext(parsed: ParsedArgs, deps: AssetsDeps): Promise<AssetsContext> {
  const projectConfig = await deps.loadProjectConfig();
  const env = parsed.options.local === 'true'
    ? 'local'
    : parsed.options.env || projectConfig?.environment || 'stage';
  const spaceId = parsed.options.space || projectConfig?.spaceId;
  if (!spaceId || spaceId === 'true') {
    throw new Error('--space is required, or run: pnpm run cli init --space <id>');
  }

  const config = await deps.loadConfig(env);
  if (!config) {
    throw new Error(`Not logged in to ${env} environment. Run: pnpm run cli login --env ${env}`);
  }
  if (config.token.expiresAt < Date.now()) {
    throw new Error(`Token expired for ${env} environment. Run: pnpm run cli login --env ${env}`);
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
): Promise<{ imageKey: string; variant?: Variant }> {
  if (looksLikeImageKey(ref)) {
    return { imageKey: ref };
  }

  const assets = await listAssets(ctx, deps);
  for (const asset of assets) {
    const details = await getAssetDetails(ctx, deps, asset.id);
    const variant = details.variants.find((candidate) => candidate.id === ref);
    if (!variant) continue;
    if (!variant.image_key) {
      throw new Error(`Variant ${ref} has no image key; status is ${variant.status}`);
    }
    return { imageKey: variant.image_key, variant };
  }

  throw new Error(`Variant not found in space ${ctx.spaceId}: ${ref}`);
}

function looksLikeImageKey(value: string): boolean {
  return value.includes('/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(path.extname(value).toLowerCase());
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
      print(`     Image:  ${variant.image_key || '-'}`);
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
  pnpm run cli assets download <variant-id|image-key> -o image.png
`);
}
