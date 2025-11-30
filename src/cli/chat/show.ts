/**
 * Show Command - Pretty-print state for evaluation
 *
 * Usage: npm run cli chat show --state <file> [--section <name>]
 */

import type { ParsedArgs } from '../lib/types';
import { loadState } from './state';
import type { ConversationState, PendingAction, ExecutedAction, PlanState } from './types';
import type { ForgeContext, ViewingContext, AutoExecutedAction } from '../../api/types';

type Section = 'all' | 'conversation' | 'pending' | 'executed' | 'artifacts' | 'gemini' | 'meta' | 'plan' | 'context' | 'autoexecuted';

export async function handleShow(parsed: ParsedArgs): Promise<void> {
  // Parse arguments
  const statePath = parsed.options.state;
  const section = (parsed.options.section || 'all') as Section;

  // Validate arguments
  if (!statePath) {
    console.error('Error: --state <file> is required');
    console.error('Usage: npm run cli chat show --state <file> [--section <name>]');
    console.error('\nSections: all, conversation, pending, executed, autoexecuted, artifacts, gemini, meta, plan, context');
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

  // Display requested sections
  const showAll = section === 'all';

  if (showAll || section === 'meta') {
    showMeta(state);
  }

  if (showAll || section === 'conversation') {
    showConversation(state);
  }

  if (showAll || section === 'pending') {
    showPending(state);
  }

  if (showAll || section === 'executed') {
    showExecuted(state);
  }

  if (showAll || section === 'autoexecuted') {
    showAutoExecuted(state);
  }

  if (showAll || section === 'artifacts') {
    showArtifacts(state);
  }

  if (showAll || section === 'gemini') {
    showGemini(state);
  }

  if (showAll || section === 'plan') {
    showPlan(state);
  }

  if (showAll || section === 'context') {
    showContext(state);
  }
}

function showMeta(state: ConversationState): void {
  console.log('\n=== META ===\n');
  console.log(`Space ID: ${state.meta.spaceId}`);
  if (state.meta.spaceName) {
    console.log(`Space Name: ${state.meta.spaceName}`);
  }
  console.log(`Environment: ${state.meta.environment}`);
  console.log(`Created: ${state.meta.createdAt}`);
  console.log(`Updated: ${state.meta.updatedAt}`);
}

function showConversation(state: ConversationState): void {
  console.log('\n=== CONVERSATION ===\n');

  if (state.conversation.history.length === 0) {
    console.log('(no messages yet)');
    return;
  }

  for (const msg of state.conversation.history) {
    const prefix = msg.role === 'user' ? 'USER' : 'BOT';
    const content = msg.content.length > 200
      ? msg.content.slice(0, 200) + '...'
      : msg.content;
    console.log(`[${prefix}]`);
    console.log(`  ${content.replace(/\n/g, '\n  ')}`);
    console.log('');
  }

  // Show current context
  console.log('Current Context:');
  if (state.conversation.context.viewingContext) {
    const vc = state.conversation.context.viewingContext;
    console.log(`  Viewing: ${vc.type}`);
    if (vc.assetName) console.log(`    Asset: ${vc.assetName} (${vc.assetId})`);
    if (vc.variantId) console.log(`    Variant: ${vc.variantId}`);
  } else {
    console.log('  Viewing: (none)');
  }

  if (state.conversation.context.forgeContext) {
    const fc = state.conversation.context.forgeContext;
    console.log(`  Forge: ${fc.operation}`);
    if (fc.slots.length > 0) {
      console.log(`    Slots: ${fc.slots.length}`);
    }
    if (fc.prompt) {
      console.log(`    Prompt: ${fc.prompt.slice(0, 50)}...`);
    }
  }
}

function showPending(state: ConversationState): void {
  console.log('\n=== PENDING ACTIONS ===\n');

  if (state.pendingActions.length === 0) {
    console.log('(no pending actions)');
    return;
  }

  for (const action of state.pendingActions) {
    showAction(action, 'pending');
    console.log('');
  }
}

function showExecuted(state: ConversationState): void {
  console.log('\n=== EXECUTED ACTIONS ===\n');

  if (state.executedActions.length === 0) {
    console.log('(no executed actions)');
    return;
  }

  for (const action of state.executedActions) {
    showAction(action, action.status);

    // Show result
    console.log('  Result:');
    if (action.result.success) {
      console.log(`    Success: true`);
      if (action.result.assetId) {
        console.log(`    Asset ID: ${action.result.assetId}`);
      }
      if (action.result.variantId) {
        console.log(`    Variant ID: ${action.result.variantId}`);
      }
      if (action.result.jobId) {
        console.log(`    Job ID: ${action.result.jobId}`);
      }
      if (action.result.jobResult) {
        console.log(`    Job Status: ${action.result.jobResult.status}`);
        if (action.result.jobResult.variantId) {
          console.log(`    Result Variant: ${action.result.jobResult.variantId}`);
        }
      }
    } else {
      console.log(`    Success: false`);
      console.log(`    Error: ${action.result.error}`);
    }

    console.log(`  Executed At: ${action.executedAt}`);
    console.log('');
  }
}

function showAutoExecuted(state: ConversationState): void {
  console.log('\n=== AUTO-EXECUTED TOOLS ===\n');

  if (!state.autoExecuted || state.autoExecuted.length === 0) {
    console.log('(no auto-executed tools in last response)');
    return;
  }

  console.log(`Safe tools that were auto-executed (${state.autoExecuted.length}):\n`);

  for (const action of state.autoExecuted) {
    showAutoExecutedAction(action);
    console.log('');
  }
}

function showAutoExecutedAction(action: AutoExecutedAction): void {
  const statusIcon = action.success ? '✓' : '✗';

  console.log(`${statusIcon} ${action.tool}`);

  // Show params
  if (action.params && Object.keys(action.params).length > 0) {
    console.log('  Params:');
    for (const [key, value] of Object.entries(action.params)) {
      const valueStr = typeof value === 'string'
        ? `"${value.length > 60 ? value.slice(0, 60) + '...' : value}"`
        : JSON.stringify(value);
      console.log(`    ${key}: ${valueStr}`);
    }
  }

  // Show result
  console.log('  Result:');
  if (action.success) {
    if (action.result === null || action.result === undefined) {
      console.log('    (no result)');
    } else if (typeof action.result === 'string') {
      // String result - show with word wrap
      const lines = wrapText(action.result, 68);
      console.log('  ┌' + '─'.repeat(70));
      for (const line of lines) {
        console.log('  │ ' + line);
      }
      console.log('  └' + '─'.repeat(70));
    } else if (Array.isArray(action.result)) {
      // Array result (e.g., search results)
      console.log(`    Found ${action.result.length} item(s):`);
      for (const item of action.result.slice(0, 5)) {
        if (typeof item === 'object' && item !== null) {
          const name = (item as Record<string, unknown>).name || (item as Record<string, unknown>).id || 'unknown';
          console.log(`      - ${name}`);
        } else {
          console.log(`      - ${item}`);
        }
      }
      if (action.result.length > 5) {
        console.log(`      ... and ${action.result.length - 5} more`);
      }
    } else if (typeof action.result === 'object') {
      // Object result - show key fields
      console.log('    ' + JSON.stringify(action.result, null, 2).replace(/\n/g, '\n    '));
    } else {
      console.log(`    ${action.result}`);
    }
  } else {
    console.log(`    Error: ${action.error || 'Unknown error'}`);
  }
}

function showAction(action: PendingAction | ExecutedAction, status: string): void {
  const statusIcon = status === 'completed' ? '✓' : status === 'failed' ? '✗' : '○';

  console.log(`${statusIcon} ${action.tool}`);
  console.log(`  ID: ${action.id}`);
  console.log(`  Description: ${action.description}`);
  console.log('  Params:');

  // Show relevant params
  const params = action.params;
  if (params.name) {
    console.log(`    name: "${params.name}"`);
  }
  if (params.type) {
    console.log(`    type: "${params.type}"`);
  }
  if (params.assetId) {
    console.log(`    assetId: "${params.assetId}"`);
  }
  if (params.variantId || params.sourceVariantId) {
    console.log(`    sourceVariantId: "${params.variantId || params.sourceVariantId}"`);
  }
  if (params.referenceVariantIds) {
    console.log(`    referenceVariantIds: ${JSON.stringify(params.referenceVariantIds)}`);
  }
  if (params.prompt) {
    const prompt = String(params.prompt);
    console.log(`    prompt: "${prompt.length > 100 ? prompt.slice(0, 100) + '...' : prompt}"`);
  }
  if (params.aspectRatio) {
    console.log(`    aspectRatio: "${params.aspectRatio}"`);
  }
}

function showArtifacts(state: ConversationState): void {
  console.log('\n=== ARTIFACTS ===\n');

  if (state.artifacts.assets.length === 0 &&
      state.artifacts.variants.length === 0 &&
      state.artifacts.jobs.length === 0) {
    console.log('(no artifacts created)');
    return;
  }

  if (state.artifacts.assets.length > 0) {
    console.log('Assets:');
    for (const asset of state.artifacts.assets) {
      console.log(`  - ${asset.name} (${asset.id})`);
      if (asset.type) {
        console.log(`    Type: ${asset.type}`);
      }
    }
    console.log('');
  }

  if (state.artifacts.variants.length > 0) {
    console.log('Variants:');
    for (const variant of state.artifacts.variants) {
      console.log(`  - ${variant.id}`);
      if (variant.assetId) {
        console.log(`    Asset: ${variant.assetId}`);
      }
      if (variant.prompt) {
        console.log(`    Prompt: ${variant.prompt.slice(0, 50)}...`);
      }
    }
    console.log('');
  }

  if (state.artifacts.jobs.length > 0) {
    console.log('Jobs:');
    for (const job of state.artifacts.jobs) {
      console.log(`  - ${job.id}`);
      console.log(`    Status: ${job.status}`);
      console.log(`    Created: ${job.createdAt}`);
    }
  }
}

function showGemini(state: ConversationState): void {
  console.log('\n=== GEMINI PROMPTS ===\n');

  const allActions = [
    ...state.pendingActions.map(a => ({ ...a, executionStatus: 'pending' as 'pending' | 'completed' | 'failed' })),
    ...state.executedActions.map(a => ({ ...a, executionStatus: a.status as 'pending' | 'completed' | 'failed' })),
  ];

  const geminiActions = allActions.filter(a => a.geminiRequest);

  if (geminiActions.length === 0) {
    console.log('(no Gemini requests)');
    return;
  }

  for (const action of geminiActions) {
    const statusIcon = action.executionStatus === 'completed' ? '✓' :
                       action.executionStatus === 'failed' ? '✗' : '○';
    const gemini = action.geminiRequest!;

    console.log(`${statusIcon} [${action.executionStatus}] ${action.tool}`);
    console.log('');
    console.log('  Model: ' + gemini.model);
    console.log('');
    console.log('  Prompt:');
    console.log('  ┌' + '─'.repeat(70));

    // Word wrap the prompt
    const promptLines = wrapText(gemini.prompt, 68);
    for (const line of promptLines) {
      console.log('  │ ' + line);
    }

    console.log('  └' + '─'.repeat(70));
    console.log('');
    console.log('  Config:');
    console.log(`    responseModalities: ${JSON.stringify(gemini.config.responseModalities)}`);
    if (gemini.config.aspectRatio) {
      console.log(`    aspectRatio: ${gemini.config.aspectRatio}`);
    }

    if (gemini.referenceImages && gemini.referenceImages.length > 0) {
      console.log('');
      console.log('  Reference Images:');
      for (const ref of gemini.referenceImages) {
        console.log(`    - ${ref}`);
      }
    }

    console.log('');
    console.log('─'.repeat(74));
    console.log('');
  }
}

function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= maxWidth) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function showPlan(state: ConversationState): void {
  console.log('\n=== ACTIVE PLAN ===\n');

  if (!state.activePlan) {
    console.log('(no active plan)');
    return;
  }

  const plan = state.activePlan;
  showPlanDetails(plan);
}

function showPlanDetails(planState: PlanState): void {
  const { plan, status, currentStepIndex, stepResults } = planState;

  // Status icon
  const statusIcon =
    status === 'completed' ? '✓' :
    status === 'failed' ? '✗' :
    status === 'executing' ? '▶' :
    status === 'paused' ? '⏸' :
    '○';

  console.log(`${statusIcon} Plan: ${plan.goal}`);
  console.log(`  Status: ${status}`);
  console.log(`  ID: ${plan.id}`);
  console.log(`  Created: ${new Date(plan.createdAt).toISOString()}`);
  console.log('');

  // Show steps
  console.log(`Steps (${plan.steps.length}):`);
  console.log('');

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const isCurrent = i === currentStepIndex && status === 'executing';

    // Step status icon
    const stepIcon =
      step.status === 'completed' ? '✓' :
      step.status === 'failed' ? '✗' :
      step.status === 'in_progress' ? '▶' :
      isCurrent ? '→' :
      '○';

    const marker = isCurrent ? '>>>' : '   ';

    console.log(`${marker} ${stepIcon} Step ${i + 1}: [${step.action}] ${step.description}`);

    // Show step params
    const prompt = step.params.prompt as string | undefined;
    if (prompt) {
      const truncated = prompt.length > 60 ? prompt.slice(0, 60) + '...' : prompt;
      console.log(`        Prompt: "${truncated}"`);
    }

    const refs = step.params.referenceAssetIds as string[] | undefined;
    if (refs && refs.length > 0) {
      console.log(`        References: ${refs.join(', ')}`);
    }

    // Show result if step was executed
    const result = stepResults.find(r => r.stepIndex === i);
    if (result) {
      if (result.result.success) {
        const parts = [];
        if (result.result.assetId) parts.push(`asset=${result.result.assetId}`);
        if (result.result.variantId) parts.push(`variant=${result.result.variantId}`);
        console.log(`        Result: ${parts.join(', ')}`);
      } else {
        console.log(`        Error: ${result.result.error}`);
      }
    }

    console.log('');
  }

  // Summary
  const completedCount = plan.steps.filter(s => s.status === 'completed').length;
  const pendingCount = plan.steps.filter(s => s.status === 'pending').length;
  const failedCount = plan.steps.filter(s => s.status === 'failed').length;

  console.log(`Progress: ${completedCount}/${plan.steps.length} completed`);
  if (failedCount > 0) {
    console.log(`         ${failedCount} failed`);
  }
  if (pendingCount > 0 && status !== 'completed' && status !== 'failed') {
    console.log(`         ${pendingCount} pending`);
    console.log('');
    console.log('To continue: npm run cli chat advance --state <file>');
  }
}

function showContext(state: ConversationState): void {
  console.log('\n=== CONTEXT ===\n');

  showViewingContext(state.conversation.context.viewingContext);
  console.log('');
  showForgeContext(state.conversation.context.forgeContext);
}

function showViewingContext(vc: ViewingContext | undefined): void {
  console.log('Viewing Context:');
  if (!vc) {
    console.log('  (none - browsing catalog)');
    return;
  }

  console.log(`  Type: ${vc.type}`);
  if (vc.assetId) {
    console.log(`  Asset: ${vc.assetName || '(unnamed)'} (${vc.assetId})`);
  }
  if (vc.variantId) {
    console.log(`  Variant: ${vc.variantId}`);
    if (vc.variantIndex && vc.variantCount) {
      console.log(`           (${vc.variantIndex} of ${vc.variantCount})`);
    }
  }
}

function showForgeContext(fc: ForgeContext | undefined): void {
  console.log('Forge Context (Tray):');
  if (!fc) {
    console.log('  (none)');
    return;
  }

  console.log(`  Operation: ${fc.operation}`);

  if (fc.prompt) {
    const truncated = fc.prompt.length > 60 ? fc.prompt.slice(0, 60) + '...' : fc.prompt;
    console.log(`  Prompt: "${truncated}"`);
  } else {
    console.log('  Prompt: (empty)');
  }

  console.log(`  Slots (${fc.slots.length}):`);
  if (fc.slots.length === 0) {
    console.log('    (empty tray)');
  } else {
    for (let i = 0; i < fc.slots.length; i++) {
      const slot = fc.slots[i];
      console.log(`    [${i + 1}] ${slot.assetName} (${slot.assetId})`);
      console.log(`        Variant: ${slot.variantId}`);
    }
  }
}
