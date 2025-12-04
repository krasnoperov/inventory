/**
 * Assets Command - List space assets
 *
 * Usage: npm run cli chat assets --space <id>
 *
 * Lists assets in a space, useful for getting asset IDs.
 */

import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { resolveBaseUrl, loadStoredConfig } from '../lib/config';

interface Asset {
  id: string;
  name: string;
  type: string;
  active_variant_id: string | null;
  parent_asset_id: string | null;
  created_at: number;
}

export async function handleAssets(parsed: ParsedArgs): Promise<void> {
  const spaceId = parsed.options.space;
  const isLocal = parsed.options.local === 'true';
  const env = isLocal ? 'local' : (parsed.options.env || 'stage');
  const format = parsed.options.format || 'table';

  if (!spaceId) {
    console.error('Error: --space <id> is required');
    process.exitCode = 1;
    return;
  }

  try {
    const config = await loadStoredConfig(env);
    if (!config) {
      console.error(`Not logged in to ${env} environment.`);
      console.error(`Run: npm run cli login --env ${env}`);
      process.exitCode = 1;
      return;
    }

    const baseUrl = resolveBaseUrl(env);
    const response = await fetch(`${baseUrl}/api/spaces/${spaceId}/assets`, {
      headers: {
        'Authorization': `Bearer ${config.token.accessToken}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json() as { error?: string };
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const data = await response.json() as { success: boolean; assets: Asset[] };
    const assets = data.assets || [];

    if (assets.length === 0) {
      console.log('\nNo assets found in this space.');
      console.log(`\nTo create an asset: npm run cli chat send "Create a character" --space ${spaceId}`);
      return;
    }

    // Display based on format
    if (format === 'json') {
      console.log(JSON.stringify(assets, null, 2));
    } else if (format === 'ids') {
      for (const asset of assets) {
        console.log(asset.id);
      }
    } else {
      // Table format
      console.log(`\n${'═'.repeat(80)}`);
      console.log(`Assets (${assets.length})`);
      console.log(`${'═'.repeat(80)}`);
      console.log('ID'.padEnd(38) + 'Name'.padEnd(30) + 'Type');
      console.log('─'.repeat(80));

      for (const asset of assets) {
        console.log(
          asset.id.padEnd(38) +
          truncatePad(asset.name, 30) +
          asset.type
        );
      }

      console.log(`${'═'.repeat(80)}`);
    }

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

/**
 * Truncate string and pad to width
 */
function truncatePad(str: string, width: number): string {
  if (str.length > width - 2) {
    return str.slice(0, width - 3) + '.. ';
  }
  return str.padEnd(width);
}
