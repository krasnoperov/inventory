/**
 * Execute Command - Execute pending actions
 *
 * Usage: npm run cli chat execute --state <file>
 *
 * Uses WebSocket for generation operations (generate, refine, combine)
 * since REST endpoints have been removed in favor of WebSocket messages.
 */

import type { ParsedArgs } from '../lib/types';
import { WebSocketClient } from '../lib/websocket-client';
import { loadState, saveStateWithLog } from './state';
import type { ActionResult, ExecutedAction, PendingAction } from './types';
import { getNextStepNumber, formatExecuteStep, type LogEntry } from './logger';

/**
 * Execute a single action via WebSocket
 */
async function executeActionViaWebSocket(
  wsClient: WebSocketClient,
  action: PendingAction
): Promise<ActionResult> {
  const { tool, params } = action;

  try {
    switch (tool) {
      case 'generate': {
        const result = await wsClient.sendGenerateRequest({
          name: params.name as string,
          assetType: params.type as string,
          prompt: params.prompt as string,
          referenceAssetIds: params.referenceAssetIds as string[] | undefined,
          aspectRatio: params.aspectRatio as string | undefined,
        });

        if (result.success && result.variant) {
          return {
            success: true,
            assetId: result.variant.asset_id,
            assetName: params.name as string,
            variantId: result.variant.id,
            jobId: result.jobId,
            jobResult: {
              status: 'completed',
              variantId: result.variant.id,
            },
          };
        } else {
          return {
            success: false,
            error: result.error || 'Generation failed',
            jobId: result.jobId,
            jobResult: {
              status: 'failed',
              error: result.error || 'Generation failed',
            },
          };
        }
      }

      case 'refine': {
        const assetId = params.assetId as string;
        const result = await wsClient.sendRefineRequest({
          assetId,
          prompt: params.prompt as string,
          sourceVariantId: params.sourceVariantId as string | undefined,
          referenceAssetIds: params.referenceAssetIds as string[] | undefined,
          aspectRatio: params.aspectRatio as string | undefined,
        });

        if (result.success && result.variant) {
          return {
            success: true,
            assetId,
            variantId: result.variant.id,
            jobId: result.jobId,
            jobResult: {
              status: 'completed',
              variantId: result.variant.id,
            },
          };
        } else {
          return {
            success: false,
            assetId,
            error: result.error || 'Refinement failed',
            jobId: result.jobId,
            jobResult: {
              status: 'failed',
              error: result.error || 'Refinement failed',
            },
          };
        }
      }

      case 'combine': {
        // Combine is handled like generate with multiple references
        const result = await wsClient.sendGenerateRequest({
          name: params.name as string,
          assetType: params.type as string,
          prompt: params.prompt as string,
          referenceAssetIds: params.sourceAssetIds as string[],
          aspectRatio: params.aspectRatio as string | undefined,
        });

        if (result.success && result.variant) {
          return {
            success: true,
            assetId: result.variant.asset_id,
            assetName: params.name as string,
            variantId: result.variant.id,
            jobId: result.jobId,
            jobResult: {
              status: 'completed',
              variantId: result.variant.id,
            },
          };
        } else {
          return {
            success: false,
            error: result.error || 'Combination failed',
            jobId: result.jobId,
            jobResult: {
              status: 'failed',
              error: result.error || 'Combination failed',
            },
          };
        }
      }

      default:
        return {
          success: false,
          error: `Unknown tool: ${tool}`,
        };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleExecute(parsed: ParsedArgs): Promise<void> {
  // Parse arguments
  const statePath = parsed.options.state;
  const actionId = parsed.options.action;
  const isLocal = parsed.options.local === 'true';
  const env = isLocal ? 'local' : (parsed.options.env || 'stage');

  // Validate arguments
  if (!statePath) {
    console.error('Error: --state <file> is required');
    console.error('Usage: npm run cli chat execute --state <file>');
    process.exitCode = 1;
    return;
  }

  // Load state
  const state = await loadState(statePath);

  if (!state) {
    console.error(`Error: State file not found: ${statePath}`);
    process.exitCode = 1;
    return;
  }

  if (state.pendingActions.length === 0) {
    console.log('No pending actions to execute');
    return;
  }

  // Filter to specific action if requested
  const actionsToExecute = actionId
    ? state.pendingActions.filter(a => a.id === actionId)
    : state.pendingActions;

  if (actionsToExecute.length === 0) {
    console.error(`Error: No action found with ID: ${actionId}`);
    process.exitCode = 1;
    return;
  }

  let wsClient: WebSocketClient | null = null;

  try {
    // Create WebSocket client and connect
    wsClient = await WebSocketClient.create(env, state.meta.spaceId);
    console.log(`Connecting to space ${state.meta.spaceId}...`);
    await wsClient.connect();

    console.log(`\nExecuting ${actionsToExecute.length} action(s)...\n`);

    for (const action of actionsToExecute) {
      console.log(`Executing: ${action.tool}`);
      console.log(`  ID: ${action.id}`);
      if (action.params.name) {
        console.log(`  Name: ${action.params.name}`);
      }
      if (action.params.prompt) {
        const prompt = String(action.params.prompt);
        console.log(`  Prompt: ${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}`);
      }

      // Log reference info if present (backend resolves asset IDs to variant IDs)
      if (action.tool === 'generate' && action.params.referenceAssetIds) {
        const refIds = action.params.referenceAssetIds as string[];
        console.log(`  Reference assets: ${refIds.length} (backend resolves to variants)`);
      }

      // Execute the action via WebSocket
      console.log(`  Waiting for generation to complete...`);
      const result = await executeActionViaWebSocket(wsClient, action);

      if (result.success) {
        console.log(`  ✓ Completed`);
        if (result.variantId) {
          console.log(`  Variant: ${result.variantId}`);
        }
        if (result.assetId) {
          console.log(`  Asset: ${result.assetId}`);
        }
      } else {
        console.log(`  ✗ Failed: ${result.error || 'Unknown error'}`);
      }

      // Move to executed
      const executedAction: ExecutedAction = {
        id: action.id,
        tool: action.tool,
        params: action.params,
        description: action.description,
        geminiRequest: action.geminiRequest,
        status: result.success ? 'completed' : 'failed',
        executedAt: new Date().toISOString(),
        result,
      };
      state.executedActions.push(executedAction);

      // Track artifacts
      if (result.assetId) {
        const existingAsset = state.artifacts.assets.find(a => a.id === result.assetId);
        if (!existingAsset) {
          state.artifacts.assets.push({
            id: result.assetId,
            name: result.assetName || action.params.name as string || 'Unknown',
            type: action.params.type as string,
          });
        }
      }

      if (result.variantId) {
        state.artifacts.variants.push({
          id: result.variantId,
          assetId: result.assetId || '',
          prompt: action.params.prompt as string,
        });
      }

      if (result.jobId) {
        state.artifacts.jobs.push({
          id: result.jobId,
          status: result.jobResult?.status || 'completed',
          createdAt: new Date().toISOString(),
        });
      }

      // Remove from pending
      const idx = state.pendingActions.findIndex(a => a.id === action.id);
      if (idx !== -1) {
        state.pendingActions.splice(idx, 1);
      }

      console.log('');
    }

    // Update viewing context if we created/modified assets
    const lastAsset = state.artifacts.assets[state.artifacts.assets.length - 1];
    const lastVariant = state.artifacts.variants[state.artifacts.variants.length - 1];

    if (lastAsset) {
      state.conversation.context.viewingContext = {
        type: lastVariant ? 'variant' : 'asset',
        assetId: lastAsset.id,
        assetName: lastAsset.name,
        variantId: lastVariant?.id,
      };
    }

    // Update last step
    state.lastStep = {
      type: 'execute',
      timestamp: new Date().toISOString(),
    };

    // Get the actions we just executed for logging
    const executedThisRun = actionsToExecute.map(a =>
      state.executedActions.find(e => e.id === a.id)!
    ).filter(Boolean);

    // Build log entry
    const stepNumber = getNextStepNumber(state);
    const logContent = formatExecuteStep(stepNumber, {
      executedActions: executedThisRun,
    });

    const logEntry: LogEntry = {
      stepNumber,
      type: 'execute',
      timestamp: new Date().toISOString(),
      content: logContent,
    };

    // Save state with log
    await saveStateWithLog(statePath, state, logEntry);

    console.log(`State updated: ${statePath}`);

    // Summary
    const completed = state.executedActions.filter(a => a.status === 'completed').length;
    const failed = state.executedActions.filter(a => a.status === 'failed').length;
    console.log(`\nSummary: ${completed} completed, ${failed} failed`);

    if (state.pendingActions.length > 0) {
      console.log(`\nRemaining pending actions: ${state.pendingActions.length}`);
    }

    console.log(`\nNext steps:`);
    console.log(`  - Show results: npm run cli chat show --state ${statePath} --section artifacts`);
    console.log(`  - Continue: npm run cli chat send "<message>" --state ${statePath}`);
  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    // Always disconnect WebSocket
    if (wsClient) {
      wsClient.disconnect();
    }
  }
}
