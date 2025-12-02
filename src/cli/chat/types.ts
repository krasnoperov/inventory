/**
 * Chat Test CLI Types
 *
 * Types for the stateful chat testing workflow.
 */

import type {
  BotResponse,
  ChatMessage,
  ForgeContext,
  ViewingContext,
  PendingApproval,
  AssistantPlan,
  PlanStep,
  AutoExecutedAction,
} from '../../api/types';

// ============================================================================
// STATE FILE STRUCTURE
// ============================================================================

/** Metadata about the conversation state */
export interface StateMeta {
  version: string;
  createdAt: string;
  updatedAt: string;
  spaceId: string;
  spaceName?: string;
  environment: string;
}

/** Conversation context and history */
export interface ConversationData {
  history: ChatMessage[];
  context: {
    forgeContext?: ForgeContext;
    viewingContext?: ViewingContext;
  };
}

/** Record of the last step executed */
export interface StepRecord {
  type: 'send' | 'execute' | 'advance';
  timestamp: string;
  request?: {
    message: string;
    mode: 'advisor' | 'actor';
  };
  response?: BotResponse;
}

/** Gemini request details for evaluation */
export interface GeminiRequest {
  model: string;
  prompt: string;
  config: {
    responseModalities: string[];
    aspectRatio?: string;
    [key: string]: unknown;
  };
  /** Reference images if this is a refine/combine operation */
  referenceImages?: string[];
}

/** Action pending execution */
export interface PendingAction {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  description: string;
  status: 'pending';
  /** The full Gemini request for inspection */
  geminiRequest?: GeminiRequest;
}

/** Action that has been executed */
export interface ExecutedAction {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  description: string;
  status: 'completed' | 'failed';
  geminiRequest?: GeminiRequest;
  executedAt: string;
  result: ActionResult;
}

/** Result of executing an action */
export interface ActionResult {
  success: boolean;
  assetId?: string;
  assetName?: string;
  variantId?: string;
  jobId?: string;
  jobResult?: JobResult;
  error?: string;
}

/** Result of a generation job */
export interface JobResult {
  status: 'completed' | 'failed' | 'timeout';
  variantId?: string;
  error?: string;
}

/** Created artifacts */
export interface Artifacts {
  assets: Array<{
    id: string;
    name: string;
    type?: string;
  }>;
  variants: Array<{
    id: string;
    assetId: string;
    prompt?: string;
  }>;
  jobs: Array<{
    id: string;
    status: string;
    createdAt: string;
  }>;
}

/** Plan state for multi-step operations */
export interface PlanState {
  /** The plan from Claude */
  plan: AssistantPlan;
  /** Index of current step being executed */
  currentStepIndex: number;
  /** Overall plan status */
  status: 'awaiting_approval' | 'executing' | 'paused' | 'completed' | 'failed' | 'cancelled';
  /** Results for each step */
  stepResults: Array<{
    stepIndex: number;
    executedAt: string;
    result: ActionResult;
  }>;
}

/** Complete conversation state saved to file */
export interface ConversationState {
  meta: StateMeta;
  conversation: ConversationData;
  lastStep: StepRecord | null;
  pendingActions: PendingAction[];
  executedActions: ExecutedAction[];
  /** Auto-executed safe tool results (describe, search, etc.) */
  autoExecuted: AutoExecutedAction[];
  /** Active plan (if any) */
  activePlan: PlanState | null;
  artifacts: Artifacts;
}

// ============================================================================
// COMMAND OPTIONS
// ============================================================================

export interface SendOptions {
  message: string;
  spaceId?: string;
  statePath: string;
  mode: 'advisor' | 'actor';
  env: string;
}

export interface ExecuteOptions {
  statePath: string;
  actionId?: string;
  wait: boolean;
  timeout: number;
  env: string;
}

export interface ShowOptions {
  statePath: string;
  section: 'all' | 'meta' | 'conversation' | 'pending' | 'executed' | 'artifacts' | 'gemini' | 'plan' | 'context';
}

export interface AdvanceOptions {
  statePath: string;
  all: boolean;
  wait: boolean;
  timeout: number;
  env: string;
}

export interface ContextOptions {
  statePath: string;
  viewingAssetId?: string;
  addToTray?: string[];
  clearTray?: boolean;
  setPrompt?: string;
  env: string;
}

// ============================================================================
// HELPERS
// ============================================================================

/** Build a GeminiRequest from pending approval params */
export function buildGeminiRequest(approval: PendingApproval): GeminiRequest | undefined {
  const { tool, params } = approval;

  // Only generating tools have Gemini requests
  if (!['create', 'refine', 'combine'].includes(tool)) {
    return undefined;
  }

  const prompt = params.prompt as string | undefined;
  if (!prompt) {
    return undefined;
  }

  return {
    model: 'gemini-2.0-flash-preview-image-generation',
    prompt,
    config: {
      responseModalities: ['image', 'text'],
      aspectRatio: (params.aspectRatio as string) || '1:1',
    },
    referenceImages: params.sourceVariantId
      ? [`variant:${params.sourceVariantId}`]
      : params.referenceVariantIds
        ? (params.referenceVariantIds as string[]).map((id) => `variant:${id}`)
        : params.referenceAssetIds
          ? (params.referenceAssetIds as string[]).map((id) => `asset:${id}`)
          : undefined,
  };
}

/** Build a GeminiRequest from a plan step */
export function buildGeminiRequestFromStep(step: PlanStep): GeminiRequest | undefined {
  const { action, params } = step;

  // Only generating actions have Gemini requests
  if (!['create', 'refine', 'combine'].includes(action)) {
    return undefined;
  }

  const prompt = params.prompt as string | undefined;
  if (!prompt) {
    return undefined;
  }

  return {
    model: 'gemini-2.0-flash-preview-image-generation',
    prompt,
    config: {
      responseModalities: ['image', 'text'],
      aspectRatio: (params.aspectRatio as string) || '1:1',
    },
    referenceImages: params.sourceVariantId
      ? [`variant:${params.sourceVariantId}`]
      : params.referenceVariantIds
        ? (params.referenceVariantIds as string[]).map((id) => `variant:${id}`)
        : params.referenceAssetIds
          ? (params.referenceAssetIds as string[]).map((id) => `asset:${id}`)
          : undefined,
  };
}

/** Create initial empty state */
export function createInitialState(spaceId: string, env: string): ConversationState {
  const now = new Date().toISOString();
  return {
    meta: {
      version: '1.0',
      createdAt: now,
      updatedAt: now,
      spaceId,
      environment: env,
    },
    conversation: {
      history: [],
      context: {},
    },
    lastStep: null,
    pendingActions: [],
    executedActions: [],
    autoExecuted: [],
    activePlan: null,
    artifacts: {
      assets: [],
      variants: [],
      jobs: [],
    },
  };
}

/** Get the next pending step in a plan */
export function getNextPendingStep(plan: AssistantPlan): { step: PlanStep; index: number } | null {
  const index = plan.steps.findIndex(s => s.status === 'pending');
  if (index === -1) return null;
  return { step: plan.steps[index], index };
}

/** Build forge context from a plan step */
export function buildForgeContextFromStep(
  step: PlanStep,
  assets: Array<{ id: string; name: string; active_variant_id: string | null }>
): ForgeContext {
  const referenceAssetIds = step.params.referenceAssetIds as string[] | undefined;
  const prompt = step.params.prompt as string || '';

  const slots = (referenceAssetIds || [])
    .map(assetId => {
      const asset = assets.find(a => a.id === assetId);
      if (!asset || !asset.active_variant_id) return null;
      return {
        assetId: asset.id,
        assetName: asset.name,
        variantId: asset.active_variant_id,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  // Determine ForgeContext operation based on step action and refs
  // Note: ForgeContext.operation is UI state, step.action is tool name
  let operation: ForgeContext['operation'] = 'generate';
  if (step.action === 'refine') {
    operation = 'refine';
  } else if (step.action === 'combine') {
    operation = 'combine';
  } else if (step.action === 'create') {
    // 'create' tool maps to UI operation based on ref count
    if (slots.length === 0) {
      operation = 'generate'; // text-to-image
    } else if (slots.length === 1) {
      operation = 'create'; // transform with 1 ref
    } else {
      operation = 'combine'; // multiple refs
    }
  }

  return {
    operation,
    slots,
    prompt,
  };
}
