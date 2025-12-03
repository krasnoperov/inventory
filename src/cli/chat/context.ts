/**
 * Context Command - Set viewing and forge context
 *
 * Usage: npm run cli chat context --state <file> [options]
 *
 * Options:
 *   --view <assetId>      Set viewing context to an asset
 *   --add <assetId>       Add asset to forge tray (can repeat)
 *   --clear-tray          Clear all slots from forge tray
 *   --prompt <text>       Set the forge prompt
 *   --operation <type>    Set operation type (generate|fork|derive|refine)
 */

import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { ApiClient } from './api-client';
import { loadState, saveStateWithLog } from './state';
import type { ForgeContext, ForgeContextSlot, ViewingContext } from '../../api/types';
import { getNextStepNumber, formatContextStep, type LogEntry } from './logger';

export async function handleContext(parsed: ParsedArgs): Promise<void> {
  // Parse arguments
  const statePath = parsed.options.state;
  const viewAssetId = parsed.options.view;
  const addAssetIds = parseMultiValue(parsed.options.add);
  const clearTray = parsed.options['clear-tray'] === 'true';
  const prompt = parsed.options.prompt;
  const operation = parsed.options.operation;
  const isLocal = parsed.options.local === 'true';
  const env = isLocal ? 'local' : (parsed.options.env || 'stage');

  // Validate arguments
  if (!statePath) {
    console.error('Error: --state <file> is required');
    console.error('Usage: npm run cli chat context --state <file> [options]');
    process.exitCode = 1;
    return;
  }

  // Load state
  const state = await loadState(statePath);

  if (!state) {
    console.error(`Error: State file not found: ${statePath}`);
    console.error('Start a conversation first with: npm run cli chat send <message> --space <id> --state <file>');
    process.exitCode = 1;
    return;
  }

  // Check if any context operation was requested
  const hasViewOp = !!viewAssetId;
  const hasForgeOp = clearTray || addAssetIds.length > 0 || prompt !== undefined || operation !== undefined;

  if (!hasViewOp && !hasForgeOp) {
    // Show current context
    showCurrentContext(state.conversation.context.viewingContext, state.conversation.context.forgeContext);
    return;
  }

  try {
    // Create API client for asset lookups
    const apiClient = await ApiClient.create(env);
    const { assets } = await apiClient.getSpaceAssets(state.meta.spaceId);

    // Create asset lookup map
    const assetMap = new Map(assets.map(a => [a.id, a]));

    // Track changes for logging
    let viewingChange: { assetId: string; assetName?: string } | null = null;
    let addedAssetNames: string[] = [];

    // Update viewing context
    if (viewAssetId) {
      const asset = assetMap.get(viewAssetId);
      if (!asset) {
        console.error(`Error: Asset not found: ${viewAssetId}`);
        console.log('\nAvailable assets:');
        for (const a of assets.slice(0, 10)) {
          console.log(`  ${a.id}: ${a.name}`);
        }
        if (assets.length > 10) {
          console.log(`  ... and ${assets.length - 10} more`);
        }
        process.exitCode = 1;
        return;
      }

      const viewingContext: ViewingContext = {
        type: 'asset',
        assetId: asset.id,
        assetName: asset.name,
        variantId: asset.active_variant_id || undefined,
      };
      state.conversation.context.viewingContext = viewingContext;
      viewingChange = { assetId: asset.id, assetName: asset.name };
      console.log(`✓ Viewing context set to: ${asset.name} (${asset.id})`);
    }

    // Update forge context
    if (hasForgeOp) {
      // Initialize forge context if needed
      if (!state.conversation.context.forgeContext) {
        state.conversation.context.forgeContext = {
          operation: 'generate',
          slots: [],
          prompt: '',
        };
      }

      const forgeContext = state.conversation.context.forgeContext;

      // Clear tray if requested
      if (clearTray) {
        forgeContext.slots = [];
        console.log('✓ Forge tray cleared');
      }

      // Add assets to tray
      for (const assetId of addAssetIds) {
        const asset = assetMap.get(assetId);
        if (!asset) {
          console.error(`Warning: Asset not found: ${assetId}, skipping`);
          continue;
        }

        if (!asset.active_variant_id) {
          console.error(`Warning: Asset ${assetId} has no active variant, skipping`);
          continue;
        }

        // Check if already in tray
        const existing = forgeContext.slots.find(s => s.assetId === assetId);
        if (existing) {
          console.log(`  Asset already in tray: ${asset.name}`);
          continue;
        }

        const slot: ForgeContextSlot = {
          assetId: asset.id,
          assetName: asset.name,
          variantId: asset.active_variant_id,
        };
        forgeContext.slots.push(slot);
        addedAssetNames.push(asset.name);
        console.log(`✓ Added to tray: ${asset.name} (${asset.id})`);
      }

      // Set prompt
      if (prompt !== undefined) {
        forgeContext.prompt = prompt;
        console.log(`✓ Prompt set: "${prompt.length > 60 ? prompt.slice(0, 60) + '...' : prompt}"`);
      }

      // Set operation
      if (operation !== undefined) {
        const validOps = ['generate', 'fork', 'derive', 'refine'];
        if (!validOps.includes(operation)) {
          console.error(`Warning: Unknown operation "${operation}", using anyway`);
        }
        forgeContext.operation = operation as ForgeContext['operation'];
        console.log(`✓ Operation set: ${operation}`);
      }

      // Auto-detect operation based on slots if not explicitly set
      if (!operation && forgeContext.slots.length > 0) {
        if (forgeContext.slots.length === 1) {
          forgeContext.operation = 'refine';
        } else {
          forgeContext.operation = 'derive';
        }
        console.log(`  Auto-detected operation: ${forgeContext.operation}`);
      }
    }

    // Build log entry
    const stepNumber = getNextStepNumber(state);
    const logContent = formatContextStep(stepNumber, {
      viewingChange,
      trayChanges: addedAssetNames.length > 0 ? addedAssetNames : undefined,
      promptChange: prompt,
      clearTray,
    });

    const logEntry: LogEntry = {
      stepNumber,
      type: 'context',
      timestamp: new Date().toISOString(),
      content: logContent,
    };

    // Save state with log
    state.meta.updatedAt = new Date().toISOString();
    await saveStateWithLog(statePath, state, logEntry);

    console.log(`\nState saved to: ${statePath}`);

    // Show current context
    console.log('\n--- Current Context ---');
    showCurrentContext(state.conversation.context.viewingContext, state.conversation.context.forgeContext);

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

/**
 * Parse a multi-value option (can be comma-separated or repeated)
 */
function parseMultiValue(value: string | undefined): string[] {
  if (!value) return [];
  // Handle comma-separated values
  return value.split(',').map(v => v.trim()).filter(v => v.length > 0);
}

/**
 * Display current context state
 */
function showCurrentContext(
  viewingContext: ViewingContext | undefined,
  forgeContext: ForgeContext | undefined
): void {
  console.log('\nViewing Context:');
  if (viewingContext) {
    console.log(`  Type: ${viewingContext.type}`);
    if (viewingContext.assetId) {
      console.log(`  Asset: ${viewingContext.assetName || viewingContext.assetId}`);
    }
    if (viewingContext.variantId) {
      console.log(`  Variant: ${viewingContext.variantId}`);
    }
  } else {
    console.log('  (none)');
  }

  console.log('\nForge Context:');
  if (forgeContext) {
    console.log(`  Operation: ${forgeContext.operation}`);
    console.log(`  Prompt: "${forgeContext.prompt || '(empty)'}"`);
    console.log(`  Tray (${forgeContext.slots.length} slots):`);
    if (forgeContext.slots.length === 0) {
      console.log('    (empty)');
    } else {
      for (const slot of forgeContext.slots) {
        console.log(`    - ${slot.assetName} (${slot.assetId})`);
      }
    }
  } else {
    console.log('  (none)');
  }
}
