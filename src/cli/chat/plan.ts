/**
 * Plan Commands - View and manage plans from server
 *
 * Usage:
 *   npm run cli chat plan --space <id>            # View active plan
 *   npm run cli chat plan:approve <id> --space <id>  # Approve a plan
 *   npm run cli chat plan:advance <id> --space <id>  # Advance to next step
 *   npm run cli chat plan:cancel <id> --space <id>   # Cancel a plan
 */

import process from 'node:process';
import type { ParsedArgs } from '../lib/types';
import { WebSocketClient, type Plan, type PlanStep } from '../lib/websocket-client';
import { truncate } from '../lib/utils';

/**
 * View active plan
 */
export async function handlePlan(parsed: ParsedArgs): Promise<void> {
  const spaceId = parsed.options.space;
  const isLocal = parsed.options.local === 'true';
  const env = isLocal ? 'local' : (parsed.options.env || 'stage');

  if (!spaceId) {
    console.error('Error: --space <id> is required');
    process.exitCode = 1;
    return;
  }

  let wsClient: WebSocketClient | null = null;

  try {
    wsClient = await WebSocketClient.create(env, spaceId);

    // Set up handlers - store in object to avoid closure issues
    const state: { plan: Plan | null; steps: PlanStep[] } = { plan: null, steps: [] };
    const planReceived = new Promise<{ plan: Plan; steps: PlanStep[] } | null>((resolve) => {
      const timeoutId = setTimeout(() => resolve(null), 5000);
      wsClient!.setOnPlanCreated((p, s) => {
        clearTimeout(timeoutId);
        resolve({ plan: p, steps: s });
      });
      wsClient!.setOnPlanUpdated((p) => {
        clearTimeout(timeoutId);
        state.plan = p;
        resolve({ plan: p, steps: state.steps });
      });
    });

    await wsClient.connect();

    // Request sync to get current plan state
    wsClient.requestSync();

    // Wait for response
    const result = await planReceived;

    if (!result || !result.plan) {
      console.log('\nNo active plan.');
      console.log(`\nStart a conversation: npm run cli chat send "<message>" --space ${spaceId}`);
      return;
    }

    const { plan, steps } = result;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Plan: ${plan.goal}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`ID: ${plan.id}`);
    console.log(`Status: ${plan.status}`);
    console.log(`Current Step: ${plan.current_step_index + 1} of ${steps.length}`);
    console.log(`${'─'.repeat(60)}`);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const status = step.status === 'completed' ? '✅' :
                     step.status === 'failed' ? '❌' :
                     step.status === 'in_progress' ? '⏳' : '○';
      console.log(`${status} Step ${i + 1}: ${step.description}`);
      console.log(`    Action: ${step.action}`);
      try {
        const params = JSON.parse(step.params) as Record<string, unknown>;
        if (params.prompt) {
          console.log(`    Prompt: "${truncate(String(params.prompt), 50)}"`);
        }
        if (params.name) {
          console.log(`    Name: ${params.name}`);
        }
      } catch {
        // Ignore parse errors
      }
      if (step.result) {
        console.log(`    Result: ${truncate(step.result, 60)}`);
      }
      if (step.error) {
        console.log(`    Error: ${step.error}`);
      }
    }

    console.log(`${'═'.repeat(60)}`);

    // Show available actions
    if (plan.status === 'planning') {
      console.log(`\nTo approve: npm run cli chat plan:approve ${plan.id} --space ${spaceId}`);
      console.log(`To cancel:  npm run cli chat plan:cancel ${plan.id} --space ${spaceId}`);
    } else if (plan.status === 'paused') {
      console.log(`\nTo continue: npm run cli chat plan:advance ${plan.id} --space ${spaceId}`);
      console.log(`To cancel:   npm run cli chat plan:cancel ${plan.id} --space ${spaceId}`);
    } else if (plan.status === 'executing') {
      console.log(`\nPlan is executing... Watch for updates:`);
      console.log(`  npm run cli chat watch --space ${spaceId}`);
    }

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    wsClient?.disconnect();
  }
}

/**
 * Approve a plan (start execution)
 */
export async function handlePlanApprove(parsed: ParsedArgs): Promise<void> {
  const planId = parsed.positionals[1]; // positionals[0] is 'plan:approve'
  const spaceId = parsed.options.space;
  const isLocal = parsed.options.local === 'true';
  const env = isLocal ? 'local' : (parsed.options.env || 'stage');

  if (!planId) {
    console.error('Error: Plan ID is required');
    console.error('Usage: npm run cli chat plan:approve <planId> --space <id>');
    process.exitCode = 1;
    return;
  }

  if (!spaceId) {
    console.error('Error: --space <id> is required');
    process.exitCode = 1;
    return;
  }

  let wsClient: WebSocketClient | null = null;

  try {
    wsClient = await WebSocketClient.create(env, spaceId);

    // Set up handler for plan update
    const planUpdated = new Promise<Plan>((resolve) => {
      wsClient!.setOnPlanUpdated((plan) => {
        if (plan.id === planId) {
          resolve(plan);
        }
      });
    });

    await wsClient.connect();

    console.log(`\nApproving plan ${planId}...`);

    // Send approval
    wsClient.approvePlan(planId);

    // Also advance to start first step
    setTimeout(() => {
      wsClient!.advancePlan(planId);
    }, 500);

    // Wait for response (with timeout)
    const timeout = new Promise<Plan>((_, reject) => {
      setTimeout(() => reject(new Error('Timeout waiting for plan update')), 30000);
    });

    const updated = await Promise.race([planUpdated, timeout]);

    console.log(`✅ Plan approved`);
    console.log(`Status: ${updated.status}`);
    console.log(`\nWatch execution: npm run cli chat watch --space ${spaceId}`);

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    wsClient?.disconnect();
  }
}

/**
 * Advance a plan to the next step
 */
export async function handlePlanAdvance(parsed: ParsedArgs): Promise<void> {
  const planId = parsed.positionals[1]; // positionals[0] is 'plan:advance'
  const spaceId = parsed.options.space;
  const isLocal = parsed.options.local === 'true';
  const env = isLocal ? 'local' : (parsed.options.env || 'stage');

  if (!planId) {
    console.error('Error: Plan ID is required');
    console.error('Usage: npm run cli chat plan:advance <planId> --space <id>');
    process.exitCode = 1;
    return;
  }

  if (!spaceId) {
    console.error('Error: --space <id> is required');
    process.exitCode = 1;
    return;
  }

  let wsClient: WebSocketClient | null = null;

  try {
    wsClient = await WebSocketClient.create(env, spaceId);

    // Set up handlers
    const stepUpdated = new Promise<PlanStep>((resolve) => {
      wsClient!.setOnPlanStepUpdated((step) => {
        resolve(step);
      });
    });

    await wsClient.connect();

    console.log(`\nAdvancing plan ${planId}...`);

    // Send advance request
    wsClient.advancePlan(planId);

    // Wait for response (with timeout)
    const timeout = new Promise<PlanStep>((_, reject) => {
      setTimeout(() => reject(new Error('Timeout waiting for step update')), 30000);
    });

    const step = await Promise.race([stepUpdated, timeout]);

    console.log(`⏳ Started step ${step.step_index + 1}: ${step.description}`);
    console.log(`Action: ${step.action}`);
    console.log(`\nWatch progress: npm run cli chat watch --space ${spaceId}`);

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    wsClient?.disconnect();
  }
}

/**
 * Cancel a plan
 */
export async function handlePlanCancel(parsed: ParsedArgs): Promise<void> {
  const planId = parsed.positionals[1]; // positionals[0] is 'plan:cancel'
  const spaceId = parsed.options.space;
  const isLocal = parsed.options.local === 'true';
  const env = isLocal ? 'local' : (parsed.options.env || 'stage');

  if (!planId) {
    console.error('Error: Plan ID is required');
    console.error('Usage: npm run cli chat plan:cancel <planId> --space <id>');
    process.exitCode = 1;
    return;
  }

  if (!spaceId) {
    console.error('Error: --space <id> is required');
    process.exitCode = 1;
    return;
  }

  let wsClient: WebSocketClient | null = null;

  try {
    wsClient = await WebSocketClient.create(env, spaceId);

    // Set up handler for plan update
    const planUpdated = new Promise<Plan>((resolve) => {
      wsClient!.setOnPlanUpdated((plan) => {
        if (plan.id === planId) {
          resolve(plan);
        }
      });
    });

    await wsClient.connect();

    console.log(`\nCancelling plan ${planId}...`);

    // Send cancel request
    wsClient.cancelPlan(planId);

    // Wait for response (with timeout)
    const timeout = new Promise<Plan>((_, reject) => {
      setTimeout(() => reject(new Error('Timeout waiting for plan update')), 10000);
    });

    const updated = await Promise.race([planUpdated, timeout]);

    console.log(`❌ Plan cancelled`);
    console.log(`Status: ${updated.status}`);

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    wsClient?.disconnect();
  }
}
