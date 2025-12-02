/**
 * Markdown Logger for Chat CLI
 *
 * Writes human-readable logs alongside JSON state files.
 * Log file is named {state-file}.log.md and lives in the same directory.
 */

import { appendFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import type { ConversationState, PendingAction, ExecutedAction, GeminiRequest, PlanState } from './types';
import type { BotResponse, AutoExecutedAction } from '../../api/types';

// ============================================================================
// LOG ENTRY TYPES
// ============================================================================

export interface LogEntry {
  stepNumber: number;
  type: 'send' | 'execute' | 'advance' | 'context';
  timestamp: string;
  content: string;
}

export interface SendStepData {
  message: string;
  mode: string;
  response: BotResponse;
  pendingActions: PendingAction[];
  autoExecuted: AutoExecutedAction[];
  activePlan: PlanState | null;
}

export interface ExecuteStepData {
  executedActions: ExecutedAction[];
}

export interface AdvanceStepData {
  planState: PlanState;
  executedStepIndices: number[];
}

export interface ContextStepData {
  viewingChange?: { assetId: string; assetName?: string } | null;
  trayChanges?: string[];
  promptChange?: string;
  clearTray?: boolean;
}

// ============================================================================
// PATH HELPERS
// ============================================================================

/**
 * Derive log path from state path
 * test.json -> test.log.md
 */
export function getLogPath(statePath: string): string {
  const dir = path.dirname(statePath);
  const base = path.basename(statePath, '.json');
  return path.join(dir, `${base}.log.md`);
}

/**
 * Check if log file exists
 */
export async function logExists(logPath: string): Promise<boolean> {
  try {
    await access(logPath);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// LOG INITIALIZATION
// ============================================================================

/**
 * Initialize log file with header
 */
export async function initLog(logPath: string, state: ConversationState): Promise<void> {
  const header = formatLogHeader(state);
  await writeFile(logPath, header, 'utf8');
}

/**
 * Format the log file header
 */
function formatLogHeader(state: ConversationState): string {
  const spaceName = state.meta.spaceName || state.meta.spaceId;
  const spaceInfo = state.meta.spaceName
    ? `${state.meta.spaceName} (${state.meta.spaceId})`
    : state.meta.spaceId;

  return `# Chat Session Log

**Space:** ${spaceInfo}
**Environment:** ${state.meta.environment}
**Started:** ${state.meta.createdAt}

---

`;
}

// ============================================================================
// LOG ENTRY WRITING
// ============================================================================

/**
 * Append entry to existing log
 */
export async function appendLogEntry(logPath: string, entry: LogEntry): Promise<void> {
  await appendFile(logPath, entry.content, 'utf8');
}

/**
 * Get next step number based on state
 */
export function getNextStepNumber(state: ConversationState): number {
  // Count user messages as send steps
  const sendSteps = state.conversation.history.filter(m => m.role === 'user').length;

  // Count execute batches (group by timestamp would be ideal, approximate with executed count)
  const executeBatches = state.executedActions.length > 0 ? 1 : 0;

  // Count advance steps
  const advanceSteps = state.activePlan?.stepResults.length ?? 0;

  return sendSteps + executeBatches + advanceSteps + 1;
}

// ============================================================================
// STEP FORMATTERS
// ============================================================================

/**
 * Format a send step for the log
 */
export function formatSendStep(stepNumber: number, data: SendStepData): string {
  const { message, mode, response, pendingActions, autoExecuted, activePlan } = data;
  const timestamp = new Date().toISOString();

  let content = `## [${stepNumber}] Send - ${timestamp}

**User Message:**
> ${message.replace(/\n/g, '\n> ')}

**Mode:** ${mode}

**Bot Response:** (${response.type})
${response.message}

`;

  // Auto-executed tools
  if (autoExecuted.length > 0) {
    content += `### Auto-Executed Tools

| Tool | Result |
|------|--------|
`;
    for (const action of autoExecuted) {
      const result = action.success
        ? formatAutoResult(action.tool, action.result)
        : `Error: ${action.error || 'Unknown'}`;
      content += `| ${action.tool} | ${truncate(result, 60)} |\n`;
    }
    content += '\n';
  }

  // Pending actions
  if (pendingActions.length > 0) {
    content += `### Pending Actions

| # | Tool | Name | Description |
|---|------|------|-------------|
`;
    pendingActions.forEach((action, i) => {
      const name = (action.params.name as string) || '-';
      content += `| ${i + 1} | ${action.tool} | ${truncate(name, 20)} | ${truncate(action.description, 40)} |\n`;
    });
    content += '\n';

    // Gemini requests for each action
    for (const action of pendingActions) {
      if (action.geminiRequest) {
        content += formatGeminiRequest(action.geminiRequest, action.tool);
      }
    }
  }

  // Plan
  if (activePlan) {
    content += `### Plan

**Goal:** ${activePlan.plan.goal}

| # | Action | Description | Status |
|---|--------|-------------|--------|
`;
    activePlan.plan.steps.forEach((step, i) => {
      content += `| ${i + 1} | ${step.action} | ${truncate(step.description, 40)} | ${step.status} |\n`;
    });
    content += '\n';
  }

  content += '---\n\n';
  return content;
}

/**
 * Format an execute step for the log
 */
export function formatExecuteStep(stepNumber: number, data: ExecuteStepData): string {
  const { executedActions } = data;
  const timestamp = new Date().toISOString();

  let content = `## [${stepNumber}] Execute - ${timestamp}

### Actions Executed

`;

  for (const action of executedActions) {
    const name = (action.params.name as string) || action.id;
    content += `#### ${action.tool} - ${truncate(name, 30)}

**Status:** ${action.status}`;

    if (action.result.assetId) {
      content += `  \n**Asset ID:** ${action.result.assetId}`;
    }
    if (action.result.variantId) {
      content += `  \n**Variant ID:** ${action.result.variantId}`;
    }
    if (action.result.jobId) {
      content += `  \n**Job ID:** ${action.result.jobId}`;
    }
    if (action.result.jobResult) {
      content += `  \n**Job Status:** ${action.result.jobResult.status}`;
    }
    if (action.status === 'failed' && action.result.error) {
      content += `  \n**Error:** ${action.result.error}`;
    }

    content += '\n\n';
  }

  content += '---\n\n';
  return content;
}

/**
 * Format an advance step for the log
 */
export function formatAdvanceStep(stepNumber: number, data: AdvanceStepData): string {
  const { planState, executedStepIndices } = data;
  const timestamp = new Date().toISOString();

  let content = `## [${stepNumber}] Advance - ${timestamp}

### Plan Progress

**Goal:** ${planState.plan.goal}
**Status:** ${planState.status}

`;

  for (const stepIndex of executedStepIndices) {
    const step = planState.plan.steps[stepIndex];
    const result = planState.stepResults.find(r => r.stepIndex === stepIndex);

    content += `#### Step ${stepIndex + 1}: ${step.action} - ${truncate(step.description, 40)}

**Status:** ${step.status}`;

    if (step.params.prompt) {
      content += `

**Prompt:**
\`\`\`
${step.params.prompt}
\`\`\``;
    }

    if (result) {
      if (result.result.success) {
        content += '\n\n**Result:**';
        if (result.result.assetId) content += `\n- Asset ID: ${result.result.assetId}`;
        if (result.result.variantId) content += `\n- Variant ID: ${result.result.variantId}`;
      } else {
        content += `\n\n**Error:** ${result.result.error}`;
      }
    }

    content += '\n\n';
  }

  content += '---\n\n';
  return content;
}

/**
 * Format a context step for the log
 */
export function formatContextStep(stepNumber: number, data: ContextStepData): string {
  const { viewingChange, trayChanges, promptChange, clearTray } = data;
  const timestamp = new Date().toISOString();

  let content = `## [${stepNumber}] Context - ${timestamp}

**Changes:**
`;

  if (viewingChange) {
    const name = viewingChange.assetName || viewingChange.assetId;
    content += `- Viewing: now viewing "${name}" (${viewingChange.assetId})\n`;
  }

  if (clearTray) {
    content += `- Tray: cleared\n`;
  }

  if (trayChanges && trayChanges.length > 0) {
    content += `- Tray: added ${trayChanges.join(', ')}\n`;
  }

  if (promptChange !== undefined) {
    content += `- Prompt: set to "${truncate(promptChange, 60)}"\n`;
  }

  content += '\n---\n\n';
  return content;
}

// ============================================================================
// GEMINI REQUEST FORMATTER
// ============================================================================

/**
 * Format a Gemini request for the log
 */
export function formatGeminiRequest(gemini: GeminiRequest, label?: string): string {
  let content = `### Gemini Request${label ? `: ${label}` : ''}

**Model:** ${gemini.model}
**Aspect Ratio:** ${gemini.config.aspectRatio || '1:1'}`;

  if (gemini.referenceImages && gemini.referenceImages.length > 0) {
    content += `  \n**References:** ${gemini.referenceImages.join(', ')}`;
  }

  content += `

**Prompt:**
\`\`\`
${gemini.prompt}
\`\`\`

`;
  return content;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Truncate text to max length
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

/**
 * Format auto-executed tool result for display
 */
function formatAutoResult(tool: string, result: unknown): string {
  if (result === null || result === undefined) return 'Done';

  switch (tool) {
    case 'describe': {
      if (typeof result === 'string') return result;
      const desc = (result as Record<string, unknown>).description;
      if (typeof desc === 'string') return desc;
      return 'Image described';
    }

    case 'search': {
      if (Array.isArray(result)) {
        if (result.length === 0) return 'No assets found';
        return `Found ${result.length} asset(s)`;
      }
      return 'Search completed';
    }

    case 'compare': {
      if (typeof result === 'string') return result;
      return 'Comparison completed';
    }

    case 'add_to_tray':
    case 'remove_from_tray':
    case 'clear_tray':
    case 'set_prompt': {
      if (typeof result === 'string') return result;
      const message = (result as Record<string, unknown>).message;
      if (typeof message === 'string') return message;
      return 'Done';
    }

    default:
      if (typeof result === 'string') return result;
      return 'Done';
  }
}
