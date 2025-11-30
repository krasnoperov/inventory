/**
 * Execute Command - Execute pending actions
 *
 * Usage: npm run cli chat execute --state <file>
 */

import type { ParsedArgs } from '../lib/types';
import { ApiClient } from './api-client';
import { loadState, saveStateWithLog } from './state';
import type { ExecutedAction } from './types';
import { getNextStepNumber, formatExecuteStep, type LogEntry } from './logger';

export async function handleExecute(parsed: ParsedArgs): Promise<void> {
  // Parse arguments
  const statePath = parsed.options.state;
  const actionId = parsed.options.action;
  const wait = parsed.options.wait !== 'false'; // Default true
  const timeout = parseInt(parsed.options.timeout || '120000', 10);
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

  try {
    // Create API client
    const apiClient = await ApiClient.create(env);

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
      if (action.tool === 'generate_asset' && action.params.referenceAssetIds) {
        const refIds = action.params.referenceAssetIds as string[];
        console.log(`  Reference assets: ${refIds.length} (backend resolves to variants)`);
      }

      // Execute the action
      const result = await apiClient.executeAction(state.meta.spaceId, action);

      // Wait for async job if needed
      if (result.jobId && wait) {
        console.log(`  Job: ${result.jobId}`);
        console.log(`  Waiting for completion...`);

        const jobResult = await apiClient.waitForJob(result.jobId, timeout);
        result.jobResult = jobResult;

        if (jobResult.status === 'completed') {
          console.log(`  ✓ Completed`);
          if (jobResult.variantId) {
            console.log(`  Variant: ${jobResult.variantId}`);
          }
        } else {
          console.log(`  ✗ ${jobResult.status}: ${jobResult.error || 'Unknown error'}`);
        }
      } else if (result.success) {
        console.log(`  ✓ Started`);
        if (result.jobId) {
          console.log(`  Job: ${result.jobId} (not waiting)`);
        }
      } else {
        console.log(`  ✗ Failed: ${result.error}`);
      }

      // Move to executed
      const executedAction: ExecutedAction = {
        id: action.id,
        tool: action.tool,
        params: action.params,
        description: action.description,
        geminiRequest: action.geminiRequest,
        status: result.success && result.jobResult?.status !== 'failed' ? 'completed' : 'failed',
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

      if (result.jobResult?.variantId) {
        state.artifacts.variants.push({
          id: result.jobResult.variantId,
          assetId: result.assetId || '',
          prompt: action.params.prompt as string,
        });
      }

      if (result.jobId) {
        state.artifacts.jobs.push({
          id: result.jobId,
          status: result.jobResult?.status || 'pending',
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
  }
}
