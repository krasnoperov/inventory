/**
 * Assets Command - List space assets
 *
 * Usage: npm run cli chat assets --state <file>
 *        npm run cli chat assets --space <id>
 *
 * Lists assets in a space, useful for getting asset IDs to use with context command.
 */

import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { ApiClient } from './api-client';
import { loadState } from './state';

export async function handleAssets(parsed: ParsedArgs): Promise<void> {
  // Parse arguments
  const statePath = parsed.options.state;
  let spaceId = parsed.options.space;
  const isLocal = parsed.options.local === 'true';
  const env = isLocal ? 'local' : (parsed.options.env || 'stage');
  const format = parsed.options.format || 'table';

  // Get space ID from state file or argument
  if (!spaceId && statePath) {
    const state = await loadState(statePath);
    if (state) {
      spaceId = state.meta.spaceId;
    }
  }

  if (!spaceId) {
    console.error('Error: --space <id> or --state <file> is required');
    console.error('Usage: npm run cli chat assets --space <id>');
    console.error('   or: npm run cli chat assets --state <file>');
    process.exitCode = 1;
    return;
  }

  try {
    // Create API client
    const apiClient = await ApiClient.create(env);

    // Get assets
    console.log(`Fetching assets for space ${spaceId}...\n`);
    const { assets } = await apiClient.getSpaceAssets(spaceId);

    if (assets.length === 0) {
      console.log('No assets found in this space.');
      return;
    }

    // Display based on format
    if (format === 'json') {
      console.log(JSON.stringify(assets, null, 2));
    } else if (format === 'ids') {
      // Just output IDs, one per line (useful for scripting)
      for (const asset of assets) {
        console.log(asset.id);
      }
    } else {
      // Table format
      console.log(`Found ${assets.length} asset(s):\n`);
      console.log('ID'.padEnd(38) + 'Name'.padEnd(30) + 'Has Variant');
      console.log('-'.repeat(80));

      for (const asset of assets) {
        const hasVariant = asset.active_variant_id ? 'Yes' : 'No';
        console.log(
          asset.id.padEnd(38) +
          truncatePad(asset.name, 30) +
          hasVariant
        );
      }

      console.log(`\nUsage examples:`);
      if (assets.length > 0) {
        const firstAsset = assets[0];
        console.log(`  View asset:    npm run cli chat context --state <file> --view ${firstAsset.id}`);
        console.log(`  Add to tray:   npm run cli chat context --state <file> --add ${firstAsset.id}`);
        if (assets.length > 1) {
          const secondAsset = assets[1];
          console.log(`  Add multiple:  npm run cli chat context --state <file> --add ${firstAsset.id},${secondAsset.id}`);
        }
      }
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
