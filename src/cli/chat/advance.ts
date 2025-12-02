/**
 * Advance Command - Execute the next step in an active plan
 *
 * Usage: npm run cli chat advance --state <file> [--all]
 *
 * Uses WebSocket for generation operations (create, refine, combine)
 * since REST endpoints have been removed in favor of WebSocket messages.
 */

import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { ApiClient } from './api-client';
import { WebSocketClient } from '../lib/websocket-client';
import { loadState, saveState, saveStateWithLog } from './state';
import {
  getNextPendingStep,
  buildForgeContextFromStep,
  buildGeminiRequestFromStep,
  type ActionResult,
} from './types';
import { truncate } from '../lib/utils';
import { getNextStepNumber, formatAdvanceStep, type LogEntry } from './logger';

export async function handleAdvance(parsed: ParsedArgs): Promise<void> {
  // Parse arguments
  const statePath = parsed.options.state;
  const executeAll = parsed.options.all === 'true';
  const isLocal = parsed.options.local === 'true';
  const env = isLocal ? 'local' : (parsed.options.env || 'stage');

  // Validate arguments
  if (!statePath) {
    console.error('Error: --state <file> is required');
    console.error('Usage: npm run cli chat advance --state <file> [--all]');
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

  if (!state.activePlan) {
    console.error('Error: No active plan. Use "send" to start a conversation that creates a plan.');
    process.exitCode = 1;
    return;
  }

  const planState = state.activePlan;

  // Check plan status
  if (planState.status === 'completed') {
    console.log('Plan already completed.');
    return;
  }

  if (planState.status === 'failed' || planState.status === 'cancelled') {
    console.error(`Error: Plan is ${planState.status}. Start a new conversation.`);
    process.exitCode = 1;
    return;
  }

  let wsClient: WebSocketClient | null = null;

  try {
    // Create API client (for getSpaceAssets only)
    const apiClient = await ApiClient.create(env);

    // Create WebSocket client and connect (for generation operations)
    wsClient = await WebSocketClient.create(env, state.meta.spaceId);
    console.log(`Connecting to space ${state.meta.spaceId}...`);
    await wsClient.connect();

    // Get space assets for context building
    const assetsResponse = await apiClient.getSpaceAssets(state.meta.spaceId);
    const assets = assetsResponse.assets;

    // Execute steps
    let continueExecution = true;
    const executedStepIndices: number[] = [];

    while (continueExecution) {
      // Find next pending step
      const nextStep = getNextPendingStep(planState.plan);

      if (!nextStep) {
        // All steps completed
        planState.status = 'completed';
        console.log('\n✓ Plan completed successfully!');
        break;
      }

      const { step, index } = nextStep;
      planState.currentStepIndex = index;
      planState.status = 'executing';

      console.log(`\n--- Step ${index + 1}/${planState.plan.steps.length} ---`);
      console.log(`Action: ${step.action}`);
      console.log(`Description: ${step.description}`);

      const prompt = step.params.prompt as string | undefined;
      if (prompt) {
        console.log(`Prompt: "${truncate(prompt, 100)}"`);
      }

      // Build forge context from step
      const forgeContext = buildForgeContextFromStep(step, assets);

      // Update conversation context with forge context
      state.conversation.context.forgeContext = forgeContext;

      // Show Gemini request details
      const geminiRequest = buildGeminiRequestFromStep(step);
      if (geminiRequest) {
        console.log(`\nGemini Request:`);
        console.log(`  Model: ${geminiRequest.model}`);
        console.log(`  Aspect Ratio: ${geminiRequest.config.aspectRatio || '1:1'}`);
        if (geminiRequest.referenceImages && geminiRequest.referenceImages.length > 0) {
          console.log(`  References: ${geminiRequest.referenceImages.join(', ')}`);
        }
      }

      // Mark step as in progress
      step.status = 'in_progress';

      // Execute the step via WebSocket
      console.log(`\nExecuting...`);
      const result = await executeStep(wsClient, step);

      if (result.success) {
        // Mark step as completed
        step.status = 'completed';
        step.result = result.variantId
          ? `Created variant ${result.variantId}`
          : `Created asset ${result.assetId}`;

        // Record result
        planState.stepResults.push({
          stepIndex: index,
          executedAt: new Date().toISOString(),
          result,
        });

        // Track artifacts
        if (result.assetId) {
          state.artifacts.assets.push({
            id: result.assetId,
            name: result.assetName || step.params.name as string || 'Unknown',
            type: step.params.type as string,
          });
        }
        if (result.variantId) {
          state.artifacts.variants.push({
            id: result.variantId,
            assetId: result.assetId || '',
            prompt: step.params.prompt as string,
          });
        }
        if (result.jobId) {
          state.artifacts.jobs.push({
            id: result.jobId,
            status: result.jobResult?.status || 'completed',
            createdAt: new Date().toISOString(),
          });
        }

        console.log(`✓ Step ${index + 1} completed`);
        if (result.assetId) console.log(`  Asset ID: ${result.assetId}`);
        if (result.variantId) console.log(`  Variant ID: ${result.variantId}`);

        executedStepIndices.push(index);
      } else {
        // Mark step as failed
        step.status = 'failed';
        step.error = result.error;
        planState.status = 'failed';

        console.error(`✗ Step ${index + 1} failed: ${result.error}`);
        executedStepIndices.push(index);
        continueExecution = false;
      }

      // Save state after each step
      state.meta.updatedAt = new Date().toISOString();
      await saveState(statePath, state);

      // Stop if not executing all
      if (!executeAll) {
        continueExecution = false;

        // Check if there are more steps
        const remaining = planState.plan.steps.filter(s => s.status === 'pending').length;
        if (remaining > 0 && planState.status !== 'failed') {
          planState.status = 'paused';
          console.log(`\n${remaining} step(s) remaining.`);
          console.log(`Continue: npm run cli chat advance --state ${statePath}`);
        }
      }
    }

    // Update last step record
    state.lastStep = {
      type: 'advance',
      timestamp: new Date().toISOString(),
    };

    // Build log entry for executed steps
    let logEntry: LogEntry | undefined;
    if (executedStepIndices.length > 0) {
      const stepNumber = getNextStepNumber(state);
      const logContent = formatAdvanceStep(stepNumber, {
        planState,
        executedStepIndices,
      });

      logEntry = {
        stepNumber,
        type: 'advance',
        timestamp: new Date().toISOString(),
        content: logContent,
      };
    }

    // Final save with log
    await saveStateWithLog(statePath, state, logEntry);
    console.log(`\nState saved to: ${statePath}`);

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

/**
 * Execute a single plan step via WebSocket
 */
async function executeStep(
  wsClient: WebSocketClient,
  step: { action: string; params: Record<string, unknown> }
): Promise<ActionResult> {
  const { action, params } = step;

  try {
    switch (action) {
      case 'create': {
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
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
