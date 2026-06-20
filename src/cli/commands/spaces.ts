/**
 * Spaces Command - List and manage user's spaces
 *
 * Usage:
 *   makefx spaces                    List all spaces
 *   makefx spaces --details          Show asset counts per space
 *   makefx spaces --id <space_id>    Show details for a specific space
 *   makefx spaces create <name>      Create a new space
 */

import process from 'node:process';
import type { ParsedArgs, StoredConfig } from '../lib/types';
import { loadStoredConfig, resolveBaseUrl } from '../lib/config';
import { saveProjectConfig } from '../lib/project-config';
import {
  loginCommandForEnvironment,
  resolveCommandEnvironment,
} from '../lib/command-context';
import type { MediaKind } from '../../shared/websocket-types';

interface Space {
  id: string;
  name: string;
  owner_id: string;
  role: string;
  created_at: string;
}

interface Asset {
  id: string;
  name: string;
  type: string | null;
  media_kind?: MediaKind;
  active_variant_id: string | null;
}

interface SpaceDetails {
  space: Space;
  assets: Asset[];
}

interface SpaceSummary {
  space: Space;
  assetCount: number;
  assetSummary: string;
}

type SpacesResult =
  | { type: 'create'; space: Space; project?: { configPath: string; environment: string; spaceId: string } }
  | { type: 'list'; spaces: Space[] }
  | { type: 'details'; spaces: SpaceSummary[] }
  | { type: 'show'; space: Space; assets: Asset[] };

interface SpacesDeps {
  loadConfig: (env: string) => Promise<StoredConfig | null>;
  resolveBaseUrl: (env: string) => string;
  saveProjectConfig: typeof saveProjectConfig;
  fetch: typeof fetch;
  print: (message: string) => void;
}

interface SpacesContext {
  env: string;
  baseUrl: string;
  accessToken: string;
}

const defaultDeps: SpacesDeps = {
  loadConfig: loadStoredConfig,
  resolveBaseUrl,
  saveProjectConfig,
  fetch,
  print: console.log,
};

export async function handleSpaces(parsed: ParsedArgs): Promise<void> {
  try {
    await executeSpaces(parsed);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

export async function executeSpaces(
  parsed: ParsedArgs,
  deps: SpacesDeps = defaultDeps
): Promise<SpacesResult> {
  const env = resolveCommandEnvironment(parsed);
  const showDetails = parsed.options.details === 'true';
  const spaceId = parsed.options.id;
  const subcommand = parsed.positionals[0];
  const jsonOutput = parsed.options.json === 'true';

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

  const ctx: SpacesContext = {
    env,
    baseUrl: deps.resolveBaseUrl(env),
    accessToken: config.token.accessToken,
  };

  if (subcommand === 'create') {
    const spaceName = parsed.positionals.slice(1).join(' ') || parsed.options.name;
    if (!spaceName) {
      throw new Error('Space name is required. Usage: makefx spaces create <name>');
    }
    const space = await createSpace(ctx, deps, spaceName);
    const project = parsed.options.init === 'true'
      ? {
        configPath: await deps.saveProjectConfig({ environment: env, spaceId: space.id }),
        environment: env,
        spaceId: space.id,
      }
      : undefined;

    if (jsonOutput) {
      deps.print(JSON.stringify({ space, project }, null, 2));
    } else {
      printCreatedSpace(space, ctx.env, project?.configPath, deps.print);
    }
    return { type: 'create', space, project };
  }

  if (spaceId) {
    const details = await getSpaceDetails(ctx, deps, spaceId);
    if (jsonOutput) {
      deps.print(JSON.stringify(details, null, 2));
    } else {
      printSpaceDetails(details, deps.print);
    }
    return { type: 'show', space: details.space, assets: details.assets };
  }

  if (showDetails) {
    const spaces = await listSpaceSummaries(ctx, deps);
    if (jsonOutput) {
      deps.print(JSON.stringify(spaces, null, 2));
    } else {
      printSpaceSummaries(spaces, deps.print);
    }
    return { type: 'details', spaces };
  }

  const spaces = await fetchSpaces(ctx, deps);
  if (jsonOutput) {
    deps.print(JSON.stringify(spaces, null, 2));
  } else {
    printSpaces(spaces, deps.print);
  }
  return { type: 'list', spaces };
}

async function createSpace(ctx: SpacesContext, deps: Pick<SpacesDeps, 'fetch'>, name: string): Promise<Space> {
  const response = await deps.fetch(`${ctx.baseUrl}/api/spaces`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create space: ${response.status} - ${error}`);
  }

  const data = await response.json() as { space: Space };
  return data.space;
}

function printCreatedSpace(
  space: Space,
  env: string,
  configPath: string | undefined,
  print: (message: string) => void
): void {
  const envFlag = env === 'production' ? '' : env === 'local' ? ' --local' : ` --env ${env}`;

  print(`\nSpace created successfully!\n`);
  print(`  ID:   ${space.id}`);
  print(`  Name: ${space.name}`);
  print(`  Role: ${space.role}`);
  if (configPath) {
    print(`  Config: ${configPath}`);
  }
  print(`\nTo bind this directory:`);
  print(`  makefx init --space ${space.id}${envFlag}`);
  print(`\nTo listen for events:`);
  print(`  makefx listen --space ${space.id}${envFlag}`);
}

async function fetchSpaces(ctx: SpacesContext, deps: Pick<SpacesDeps, 'fetch'>): Promise<Space[]> {
  const response = await deps.fetch(`${ctx.baseUrl}/api/spaces`, {
    headers: {
      'Authorization': `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch spaces: ${response.status}`);
  }

  const data = await response.json() as { spaces: Space[] };
  return data.spaces;
}

function printSpaces(spaces: Space[], print: (message: string) => void): void {
  if (spaces.length === 0) {
    print('No spaces found.');
    return;
  }

  print(`\nFound ${spaces.length} space(s):\n`);
  print('ID'.padEnd(38) + 'Name'.padEnd(30) + 'Role');
  print('-'.repeat(80));

  for (const space of spaces) {
    print(
      space.id.padEnd(38) +
      truncatePad(space.name, 30) +
      space.role
    );
  }

  print(`\nFor details: makefx spaces --details`);
  print(`For a specific space: makefx spaces --id <space_id>`);
}

async function listSpaceSummaries(ctx: SpacesContext, deps: Pick<SpacesDeps, 'fetch'>): Promise<SpaceSummary[]> {
  const spaces = await fetchSpaces(ctx, deps);
  const summaries: SpaceSummary[] = [];

  for (const space of spaces) {
    const assets = await fetchSpaceAssets(ctx, deps, space.id);
    summaries.push({
      space,
      assetCount: assets.length,
      assetSummary: summarizeAssets(assets),
    });
  }

  return summaries;
}

function printSpaceSummaries(summaries: SpaceSummary[], print: (message: string) => void): void {
  if (summaries.length === 0) {
    print('No spaces found.');
    return;
  }

  print(`\nFetching details for ${summaries.length} space(s)...\n`);

  for (const summary of summaries) {
    print(`━━━ ${summary.space.name} ━━━`);
    print(`  ID: ${summary.space.id}`);
    print(`  Role: ${summary.space.role}`);
    print(`  Assets: ${summary.assetCount}`);
    if (summary.assetSummary) {
      print(`  Content: ${summary.assetSummary}`);
    }
    print('');
  }
}

function summarizeAssets(assets: Asset[]): string {
  if (assets.length === 0) {
    return '';
  }

  const byType = new Map<string, number>();
  for (const asset of assets) {
    const type = asset.type || 'unknown';
    byType.set(type, (byType.get(type) || 0) + 1);
  }

  const typeParts: string[] = [];
  for (const [type, count] of byType) {
    typeParts.push(`${count} ${type}`);
  }

  const firstNames = assets.slice(0, 3).map(a => a.name);
  if (assets.length > 3) {
    firstNames.push(`+${assets.length - 3} more`);
  }

  return `${typeParts.join(', ')} (${firstNames.join(', ')})`;
}

async function getSpaceDetails(ctx: SpacesContext, deps: Pick<SpacesDeps, 'fetch'>, spaceId: string): Promise<SpaceDetails> {
  const spaceResponse = await deps.fetch(`${ctx.baseUrl}/api/spaces/${spaceId}`, {
    headers: {
      'Authorization': `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!spaceResponse.ok) {
    if (spaceResponse.status === 403) {
      throw new Error(`Access denied to space ${spaceId}`);
    }
    if (spaceResponse.status === 404) {
      throw new Error(`Space not found: ${spaceId}`);
    }
    throw new Error(`Failed to fetch space: ${spaceResponse.status}`);
  }

  const spaceData = await spaceResponse.json() as { space: Space };
  const assets = await fetchSpaceAssets(ctx, deps, spaceId);

  return { space: spaceData.space, assets };
}

async function fetchSpaceAssets(
  ctx: SpacesContext,
  deps: Pick<SpacesDeps, 'fetch'>,
  spaceId: string
): Promise<Asset[]> {
  const assetsResponse = await deps.fetch(`${ctx.baseUrl}/api/spaces/${spaceId}/assets`, {
    headers: {
      'Authorization': `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (assetsResponse.ok) {
    const assetsData = await assetsResponse.json() as { assets: Asset[] };
    return assetsData.assets;
  }

  throw new Error(`Failed to fetch assets for space ${spaceId}: ${assetsResponse.status}`);
}

function printSpaceDetails(details: SpaceDetails, print: (message: string) => void): void {
  const { space, assets } = details;

  print(`\n━━━ ${space.name} ━━━`);
  print(`ID: ${space.id}`);
  print(`Assets: ${assets.length}\n`);

  if (assets.length === 0) {
    print('(No assets in this space)');
    return;
  }

  const byType = new Map<string, Asset[]>();
  for (const asset of assets) {
    const type = asset.type || 'unknown';
    if (!byType.has(type)) {
      byType.set(type, []);
    }
    byType.get(type)!.push(asset);
  }

  for (const [type, typeAssets] of byType) {
    print(`${type.charAt(0).toUpperCase() + type.slice(1)}s (${typeAssets.length}):`);
    for (const asset of typeAssets) {
      const hasImage = asset.active_variant_id ? '✓' : '○';
      print(`  ${hasImage} ${asset.name}`);
      print(`    ID: ${asset.id}`);
    }
    print('');
  }

  print(`\nTo start a chat session with this space:`);
  print(`  makefx chat send "What's in this space?" --space ${space.id} --state ./test/${space.name.toLowerCase().replace(/\s+/g, '-')}.json`);
}

function truncatePad(str: string, width: number): string {
  if (str.length > width - 2) {
    return str.slice(0, width - 3) + '.. ';
  }
  return str.padEnd(width);
}
