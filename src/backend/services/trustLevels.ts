/**
 * Trust Levels for Chat Assistant Tools
 *
 * Tools are classified by their impact and cost:
 * - SAFE: Read-only operations or local state changes (auto-execute)
 * - GENERATING: AI operations that consume credits (require approval)
 * - PLANNING: Creates plans that need user review (require approval)
 */

export type TrustLevel = 'safe' | 'generating' | 'planning';

export interface ToolTrustConfig {
  level: TrustLevel;
  autoExecute: boolean;
  description: string;
}

/**
 * Tool trust classification map
 *
 * SAFE tools (autoExecute: true):
 * - Read operations: search, describe, compare
 * - Local state changes: tray manipulation, prompt setting
 *
 * GENERATING tools (autoExecute: false):
 * - AI image generation: generate, derive, refine
 * - Consumes credits, irreversible
 *
 * PLANNING tools (autoExecute: false):
 * - Creates multi-step plans
 * - Needs user review before execution
 */
export const TOOL_TRUST_MAP: Record<string, ToolTrustConfig> = {
  // === SAFE: Auto-execute without approval ===

  // Read operations (no state change, low cost)
  search: {
    level: 'safe',
    autoExecute: true,
    description: 'Search assets by name/type',
  },
  describe: {
    level: 'safe',
    autoExecute: true,
    description: 'Analyze variant image',
  },
  compare: {
    level: 'safe',
    autoExecute: true,
    description: 'Compare multiple variants',
  },

  // Tray operations (local state only)
  add_to_tray: {
    level: 'safe',
    autoExecute: true,
    description: 'Add asset to Forge Tray',
  },
  remove_from_tray: {
    level: 'safe',
    autoExecute: true,
    description: 'Remove from Forge Tray',
  },
  clear_tray: {
    level: 'safe',
    autoExecute: true,
    description: 'Clear Forge Tray',
  },
  set_prompt: {
    level: 'safe',
    autoExecute: true,
    description: 'Set generation prompt',
  },

  // === GENERATING: Requires approval (consumes credits) ===

  generate: {
    level: 'generating',
    autoExecute: false,
    description: 'Generate new asset from prompt',
  },
  derive: {
    level: 'generating',
    autoExecute: false,
    description: 'Derive new asset from references',
  },
  refine: {
    level: 'generating',
    autoExecute: false,
    description: 'Add variant to existing asset',
  },

  // === SAFE BUT MODIFYING: Fork (no AI, just copy) ===

  fork: {
    level: 'safe',
    autoExecute: true,
    description: 'Fork asset as new copy',
  },

  // === PLANNING: Requires approval (creates execution plan) ===

  create_plan: {
    level: 'planning',
    autoExecute: false,
    description: 'Create multi-step plan',
  },

  // === REVISING: Mixed - minor changes auto-apply, structural need approval ===
  // Note: The actual auto-execute decision happens in parseToolResponse based on action type
  // - update_params, update_description → auto-execute
  // - skip, insert_after → require approval
  revise_plan: {
    level: 'planning',
    autoExecute: false, // Default to approval; parsing may override for minor changes
    description: 'Revise pending plan steps',
  },
};

/**
 * Check if a tool should auto-execute
 */
export function shouldAutoExecute(toolName: string): boolean {
  const config = TOOL_TRUST_MAP[toolName];
  return config?.autoExecute ?? false;
}

/**
 * Get trust level for a tool
 */
export function getTrustLevel(toolName: string): TrustLevel {
  const config = TOOL_TRUST_MAP[toolName];
  return config?.level ?? 'generating'; // Default to requiring approval
}

/**
 * Check if a tool requires approval
 */
export function requiresApproval(toolName: string): boolean {
  return !shouldAutoExecute(toolName);
}

/**
 * Get all tools by trust level
 */
export function getToolsByTrustLevel(level: TrustLevel): string[] {
  return Object.entries(TOOL_TRUST_MAP)
    .filter(([_, config]) => config.level === level)
    .map(([name]) => name);
}

/**
 * Get safe tools (for quick reference)
 */
export const SAFE_TOOLS = getToolsByTrustLevel('safe');

/**
 * Get generating tools (for quick reference)
 */
export const GENERATING_TOOLS = getToolsByTrustLevel('generating');
