/**
 * Spaces Command - List and manage user's spaces
 *
 * Usage:
 *   pnpm run cli spaces                    List all spaces
 *   pnpm run cli spaces --details          Show asset counts per space
 *   pnpm run cli spaces --id <space_id>    Show details for a specific space
 *   pnpm run cli spaces create <name>      Create a new space
 */

import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
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

export async function handleSpaces(parsed: ParsedArgs): Promise<void> {
  const env = resolveCommandEnvironment(parsed);
  const showDetails = parsed.options.details === 'true';
  const spaceId = parsed.options.id;
  const subcommand = parsed.positionals[0];
  const jsonOutput = parsed.options.json === 'true';

  // Load config
  const config = await loadStoredConfig(env);
  if (!config) {
    console.error(`Not logged in to ${env} environment.`);
    console.error(`Run: ${loginCommandForEnvironment(env)}`);
    process.exitCode = 1;
    return;
  }

  // Check token expiry
  if (config.token.expiresAt < Date.now()) {
    console.error(`Token expired for ${env} environment.`);
    console.error(`Run: ${loginCommandForEnvironment(env)}`);
    process.exitCode = 1;
    return;
  }

  const baseUrl = resolveBaseUrl(env);
  const accessToken = config.token.accessToken;

  // Disable SSL verification for local dev
  if (env === 'local') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  try {
    if (subcommand === 'create') {
      // Create a new space
      const spaceName = parsed.positionals.slice(1).join(' ') || parsed.options.name;
      if (!spaceName) {
        console.error('Error: Space name is required');
        console.error('Usage: pnpm run cli spaces create <name>');
        console.error('       pnpm run cli spaces create --name "My Space"');
        process.exitCode = 1;
        return;
      }
      const space = await createSpace(baseUrl, accessToken, spaceName);
      const project = parsed.options.init === 'true'
        ? {
          configPath: await saveProjectConfig({ environment: env, spaceId: space.id }),
          environment: env,
          spaceId: space.id,
        }
        : undefined;

      if (jsonOutput) {
        console.log(JSON.stringify({ space, project }, null, 2));
      } else {
        printCreatedSpace(space, env, project?.configPath);
      }
    } else if (spaceId) {
      // Show details for a specific space
      await showSpaceDetails(baseUrl, accessToken, spaceId);
    } else if (showDetails) {
      // List all spaces with asset counts
      await listSpacesWithDetails(baseUrl, accessToken);
    } else {
      // Just list spaces
      await listSpaces(baseUrl, accessToken);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

async function createSpace(baseUrl: string, accessToken: string, name: string): Promise<Space> {
  const response = await fetch(`${baseUrl}/api/spaces`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
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

function printCreatedSpace(space: Space, env: string, configPath?: string): void {
  const envFlag = env === 'production' ? '' : env === 'local' ? ' --local' : ` --env ${env}`;

  console.log(`\nSpace created successfully!\n`);
  console.log(`  ID:   ${space.id}`);
  console.log(`  Name: ${space.name}`);
  console.log(`  Role: ${space.role}`);
  if (configPath) {
    console.log(`  Config: ${configPath}`);
  }
  console.log(`\nTo bind this directory:`);
  console.log(`  pnpm run cli init --space ${space.id}${envFlag}`);
  console.log(`\nTo listen for events:`);
  console.log(`  pnpm run cli listen --space ${space.id}${envFlag}`);
}

async function listSpaces(baseUrl: string, accessToken: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/spaces`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch spaces: ${response.status}`);
  }

  const data = await response.json() as { spaces: Space[] };
  const spaces = data.spaces;

  if (spaces.length === 0) {
    console.log('No spaces found.');
    return;
  }

  console.log(`\nFound ${spaces.length} space(s):\n`);
  console.log('ID'.padEnd(38) + 'Name'.padEnd(30) + 'Role');
  console.log('-'.repeat(80));

  for (const space of spaces) {
    console.log(
      space.id.padEnd(38) +
      truncatePad(space.name, 30) +
      space.role
    );
  }

  console.log(`\nFor details: pnpm run cli spaces --details`);
  console.log(`For a specific space: pnpm run cli spaces --id <space_id>`);
}

async function listSpacesWithDetails(baseUrl: string, accessToken: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/spaces`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch spaces: ${response.status}`);
  }

  const data = await response.json() as { spaces: Space[] };
  const spaces = data.spaces;

  if (spaces.length === 0) {
    console.log('No spaces found.');
    return;
  }

  console.log(`\nFetching details for ${spaces.length} space(s)...\n`);

  for (const space of spaces) {
    // Get assets for this space
    const assetsResponse = await fetch(`${baseUrl}/api/spaces/${space.id}/assets`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    let assetCount = 0;
    let assetSummary = '';

    if (assetsResponse.ok) {
      const assetsData = await assetsResponse.json() as { assets: Asset[] };
      const assets = assetsData.assets;
      assetCount = assets.length;

      if (assets.length > 0) {
        // Group by type
        const byType = new Map<string, number>();
        for (const asset of assets) {
          const type = asset.type || 'unknown';
          byType.set(type, (byType.get(type) || 0) + 1);
        }

        const typeParts: string[] = [];
        for (const [type, count] of byType) {
          typeParts.push(`${count} ${type}`);
        }
        assetSummary = typeParts.join(', ');

        // Show first few asset names
        const firstNames = assets.slice(0, 3).map(a => a.name);
        if (assets.length > 3) {
          firstNames.push(`+${assets.length - 3} more`);
        }
        assetSummary += ` (${firstNames.join(', ')})`;
      }
    }

    console.log(`━━━ ${space.name} ━━━`);
    console.log(`  ID: ${space.id}`);
    console.log(`  Role: ${space.role}`);
    console.log(`  Assets: ${assetCount}`);
    if (assetSummary) {
      console.log(`  Content: ${assetSummary}`);
    }
    console.log('');
  }
}

async function showSpaceDetails(baseUrl: string, accessToken: string, spaceId: string): Promise<void> {
  // Get space info
  const spaceResponse = await fetch(`${baseUrl}/api/spaces/${spaceId}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
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

  const spaceData = await spaceResponse.json() as { space: { id: string; name: string; owner_id: string } };
  const space = spaceData.space;

  // Get assets
  const assetsResponse = await fetch(`${baseUrl}/api/spaces/${spaceId}/assets`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  let assets: Asset[] = [];
  if (assetsResponse.ok) {
    const assetsData = await assetsResponse.json() as { assets: Asset[] };
    assets = assetsData.assets;
  }

  console.log(`\n━━━ ${space.name} ━━━`);
  console.log(`ID: ${space.id}`);
  console.log(`Assets: ${assets.length}\n`);

  if (assets.length === 0) {
    console.log('(No assets in this space)');
    return;
  }

  // Group by type
  const byType = new Map<string, Asset[]>();
  for (const asset of assets) {
    const type = asset.type || 'unknown';
    if (!byType.has(type)) {
      byType.set(type, []);
    }
    byType.get(type)!.push(asset);
  }

  for (const [type, typeAssets] of byType) {
    console.log(`${type.charAt(0).toUpperCase() + type.slice(1)}s (${typeAssets.length}):`);
    for (const asset of typeAssets) {
      const hasImage = asset.active_variant_id ? '✓' : '○';
      console.log(`  ${hasImage} ${asset.name}`);
      console.log(`    ID: ${asset.id}`);
    }
    console.log('');
  }

  console.log(`\nTo start a chat session with this space:`);
  console.log(`  pnpm run cli chat send "What's in this space?" --space ${spaceId} --state ./test/${space.name.toLowerCase().replace(/\s+/g, '-')}.json`);
}

function truncatePad(str: string, width: number): string {
  if (str.length > width - 2) {
    return str.slice(0, width - 3) + '.. ';
  }
  return str.padEnd(width);
}
