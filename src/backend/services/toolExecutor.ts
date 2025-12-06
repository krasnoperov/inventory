/**
 * Tool Executor Service
 *
 * Executes Claude tools in the backend during the agentic loop.
 * Tools are classified by execution behavior:
 * - EXECUTABLE: Run in backend, return results to Claude (describe, compare, search)
 * - DEFERRED: Return acknowledgment, queue for frontend (tray operations)
 * - GENERATING: Break loop, require approval (generate, derive, refine)
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { ClaudeUsage } from './claudeService';
import { TOOL_TRUST_MAP } from './trustLevels';
import type { PendingApproval } from '../../api/types';
import type { DeferredAction } from '../../shared/websocket-types';

// ============================================================================
// Types
// ============================================================================

/** Tool use block from Claude API */
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Result of executing a single tool */
export interface ToolExecutionResult {
  toolUseId: string;
  toolName: string;
  success: boolean;
  result?: unknown;
  error?: string;
  /** Usage tracking for billing */
  usage?: ClaudeUsage;
}

/** Result of executing all tools in a response */
export interface ToolsExecutionResult {
  /** Results to send back to Claude as tool_result */
  toolResults: ToolExecutionResult[];
  /** Actions deferred to frontend (tray operations) */
  deferredActions: DeferredAction[];
  /** Pending approvals for generating tools */
  pendingApprovals: PendingApproval[];
  /** Whether to continue the agentic loop */
  shouldContinue: boolean;
  /** Total usage from all tool executions */
  totalUsage: ClaudeUsage;
}

/** Dependencies for tool execution */
export interface ToolExecutorDeps {
  /** Durable Object stub for SpaceDO */
  doStub: DurableObjectStub;
  /** R2 bucket for images */
  imagesBucket?: R2Bucket;
  /** Anthropic API key for vision operations */
  anthropicApiKey?: string;
}

/** Variant info from SpaceDO */
interface VariantInfo {
  id: string;
  asset_id: string;
  image_key: string;
}

/** Asset with variant info */
interface AssetWithVariant {
  id: string;
  name: string;
  type: string;
  active_variant_id: string | null;
}

// ============================================================================
// Tool Classification
// ============================================================================

/** Tools that execute in backend and return results to Claude */
const EXECUTABLE_TOOLS = ['describe', 'compare', 'search'];

/** Tools that are acknowledged but deferred to frontend */
const DEFERRED_TOOLS = ['add_to_tray', 'remove_from_tray', 'clear_tray', 'set_prompt'];

/** Tools that require approval and break the loop */
const GENERATING_TOOLS = ['generate', 'derive', 'refine', 'fork', 'batch_generate'];

/** Update plan is handled separately in the workflow */
const PLAN_TOOLS = ['update_plan'];

// ============================================================================
// Tool Executor
// ============================================================================

/**
 * Execute all tools from a Claude response
 */
export async function executeTools(
  toolUseBlocks: ToolUseBlock[],
  deps: ToolExecutorDeps,
  _requestId: string // eslint-disable-line @typescript-eslint/no-unused-vars -- reserved for future use
): Promise<ToolsExecutionResult> {
  const toolResults: ToolExecutionResult[] = [];
  const deferredActions: DeferredAction[] = [];
  const pendingApprovals: PendingApproval[] = [];
  let shouldContinue = true;
  const totalUsage: ClaudeUsage = { inputTokens: 0, outputTokens: 0 };

  for (const block of toolUseBlocks) {
    const toolName = block.name;
    const params = block.input;

    // Handle generating tools - break loop, create approval
    if (GENERATING_TOOLS.includes(toolName)) {
      const config = TOOL_TRUST_MAP[toolName];
      pendingApprovals.push({
        id: `approval_${Date.now()}_${pendingApprovals.length}`,
        tool: toolName,
        params,
        description: config?.description || toolName,
        status: 'pending',
        createdAt: Date.now(),
      });
      shouldContinue = false;
      continue;
    }

    // Handle deferred tools - acknowledge but queue for frontend
    if (DEFERRED_TOOLS.includes(toolName)) {
      const acknowledgment = buildDeferredAcknowledgment(toolName, params);
      deferredActions.push({
        tool: toolName,
        params,
        acknowledgment,
      });
      // Return acknowledgment as tool result
      toolResults.push({
        toolUseId: block.id,
        toolName,
        success: true,
        result: acknowledgment,
      });
      continue;
    }

    // Handle plan tools - skip, handled in workflow
    if (PLAN_TOOLS.includes(toolName)) {
      toolResults.push({
        toolUseId: block.id,
        toolName,
        success: true,
        result: 'Plan update will be processed.',
      });
      continue;
    }

    // Handle executable tools - run and return result
    if (EXECUTABLE_TOOLS.includes(toolName)) {
      const result = await executeBackendTool(toolName, params, deps);
      toolResults.push({
        toolUseId: block.id,
        toolName,
        success: result.success,
        result: result.success ? result.result : undefined,
        error: result.success ? undefined : result.error,
        usage: result.usage,
      });

      // Accumulate usage
      if (result.usage) {
        totalUsage.inputTokens += result.usage.inputTokens;
        totalUsage.outputTokens += result.usage.outputTokens;
      }
      continue;
    }

    // Unknown tool - return error
    toolResults.push({
      toolUseId: block.id,
      toolName,
      success: false,
      error: `Unknown tool: ${toolName}`,
    });
  }

  return {
    toolResults,
    deferredActions,
    pendingApprovals,
    shouldContinue: shouldContinue && pendingApprovals.length === 0,
    totalUsage,
  };
}

// ============================================================================
// Backend Tool Execution
// ============================================================================

interface BackendToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
  usage?: ClaudeUsage;
}

async function executeBackendTool(
  toolName: string,
  params: Record<string, unknown>,
  deps: ToolExecutorDeps
): Promise<BackendToolResult> {
  switch (toolName) {
    case 'describe':
      return executeDescribe(params, deps);
    case 'compare':
      return executeCompare(params, deps);
    case 'search':
      return executeSearch(params, deps);
    default:
      return { success: false, error: `Unsupported executable tool: ${toolName}` };
  }
}

/**
 * Execute describe tool - analyze an image
 */
async function executeDescribe(
  params: Record<string, unknown>,
  deps: ToolExecutorDeps
): Promise<BackendToolResult> {
  const { assetId, assetName, variantId, question, focus } = params as {
    assetId: string;
    assetName: string;
    variantId?: string;
    question?: string;
    focus?: string;
  };

  if (!deps.anthropicApiKey) {
    return { success: false, error: 'Vision API not configured' };
  }

  if (!deps.imagesBucket) {
    return { success: false, error: 'Image storage not configured' };
  }

  try {
    // Resolve variantId if not provided
    let resolvedVariantId = variantId;
    if (!resolvedVariantId && assetId) {
      // Get default variant for asset
      const assetResp = await deps.doStub.fetch(
        new Request(`http://do/internal/asset/${assetId}`)
      );
      if (!assetResp.ok) {
        return { success: false, error: `Asset not found: ${assetId}` };
      }
      const asset = await assetResp.json() as AssetWithVariant;
      resolvedVariantId = asset.active_variant_id || undefined;
    }

    if (!resolvedVariantId) {
      return { success: false, error: 'No variant available for this asset' };
    }

    // Get variant info
    const variantResp = await deps.doStub.fetch(
      new Request(`http://do/internal/variant/${resolvedVariantId}`)
    );
    if (!variantResp.ok) {
      return { success: false, error: `Variant not found: ${resolvedVariantId}` };
    }
    const variant = await variantResp.json() as VariantInfo;

    // Fetch image from R2
    const imageObj = await deps.imagesBucket.get(variant.image_key);
    if (!imageObj) {
      return { success: false, error: 'Image not found in storage' };
    }
    const imageBuffer = await imageObj.arrayBuffer();

    // Convert to base64
    const base64 = arrayBufferToBase64(imageBuffer);
    const mediaType = detectImageType(base64);

    // Import and use ClaudeService for vision
    const { ClaudeService } = await import('./claudeService');
    const claudeService = new ClaudeService(deps.anthropicApiKey);

    const { description, usage } = await claudeService.describeImage(
      base64,
      mediaType,
      assetName,
      (focus as 'general' | 'style' | 'composition' | 'details' | 'compare' | 'prompt') || 'general',
      question
    );

    return {
      success: true,
      result: description,
      usage,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to describe image',
    };
  }
}

/**
 * Execute compare tool - compare multiple images
 */
async function executeCompare(
  params: Record<string, unknown>,
  deps: ToolExecutorDeps
): Promise<BackendToolResult> {
  const { variantIds, aspectsToCompare } = params as {
    variantIds: string[];
    aspectsToCompare?: string[];
  };

  if (!deps.anthropicApiKey) {
    return { success: false, error: 'Vision API not configured' };
  }

  if (!deps.imagesBucket) {
    return { success: false, error: 'Image storage not configured' };
  }

  if (!variantIds || variantIds.length < 2 || variantIds.length > 4) {
    return { success: false, error: 'Must provide 2-4 variants to compare' };
  }

  try {
    const images: Array<{
      base64: string;
      mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
      label: string;
    }> = [];

    // Fetch all images
    for (const vId of variantIds) {
      const variantResp = await deps.doStub.fetch(
        new Request(`http://do/internal/variant/${vId}`)
      );
      if (!variantResp.ok) {
        return { success: false, error: `Variant not found: ${vId}` };
      }
      const variant = await variantResp.json() as VariantInfo & { asset_name?: string };

      const imageObj = await deps.imagesBucket.get(variant.image_key);
      if (!imageObj) {
        return { success: false, error: `Image not found for variant ${vId}` };
      }
      const imageBuffer = await imageObj.arrayBuffer();
      const base64 = arrayBufferToBase64(imageBuffer);

      images.push({
        base64,
        mediaType: detectImageType(base64),
        label: variant.asset_name || `Variant ${vId.slice(0, 8)}`,
      });
    }

    // Import and use ClaudeService for vision
    const { ClaudeService } = await import('./claudeService');
    const claudeService = new ClaudeService(deps.anthropicApiKey);

    const { comparison, usage } = await claudeService.compareImages(
      images,
      aspectsToCompare || ['style', 'composition', 'colors']
    );

    return {
      success: true,
      result: comparison,
      usage,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to compare images',
    };
  }
}

/**
 * Execute search tool - find assets by query
 */
async function executeSearch(
  params: Record<string, unknown>,
  deps: ToolExecutorDeps
): Promise<BackendToolResult> {
  const { query } = params as { query: string };

  if (!query) {
    return { success: false, error: 'Search query is required' };
  }

  try {
    // Get full state which includes assets
    const stateResp = await deps.doStub.fetch(
      new Request('http://do/internal/state')
    );
    if (!stateResp.ok) {
      return { success: false, error: 'Failed to fetch space state' };
    }
    const state = await stateResp.json() as {
      assets: Array<{ id: string; name: string; type: string }>;
    };

    // Simple search: filter assets by name or type
    const lowerQuery = query.toLowerCase();
    const matches = state.assets.filter(asset =>
      asset.name.toLowerCase().includes(lowerQuery) ||
      asset.type.toLowerCase().includes(lowerQuery)
    );

    if (matches.length === 0) {
      return {
        success: true,
        result: `No assets found matching "${query}".`,
      };
    }

    const resultText = matches
      .map(a => `- ${a.name} (id: ${a.id}, type: ${a.type})`)
      .join('\n');

    return {
      success: true,
      result: `Found ${matches.length} asset(s) matching "${query}":\n${resultText}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Search failed',
    };
  }
}

// ============================================================================
// Deferred Action Acknowledgments
// ============================================================================

function buildDeferredAcknowledgment(
  toolName: string,
  params: Record<string, unknown>
): string {
  switch (toolName) {
    case 'add_to_tray': {
      const assetName = params.assetName as string;
      return `Added "${assetName}" to the Forge Tray.`;
    }
    case 'remove_from_tray': {
      const slotIndex = params.slotIndex as number;
      return `Removed slot ${slotIndex} from the Forge Tray.`;
    }
    case 'clear_tray':
      return 'Cleared the Forge Tray.';
    case 'set_prompt': {
      const prompt = params.prompt as string;
      return `Set prompt to: "${prompt.slice(0, 50)}${prompt.length > 50 ? '...' : ''}"`;
    }
    default:
      return `Action "${toolName}" queued.`;
  }
}

// ============================================================================
// Image Utilities (copied from VisionService for self-containment)
// ============================================================================

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function detectImageType(
  base64: string
): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  try {
    const decoded = atob(base64.slice(0, 20));
    const bytes = decoded.split('').map((c) => c.charCodeAt(0));

    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'image/png';
    }
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      return 'image/gif';
    }
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      return 'image/webp';
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
  } catch {
    // Default to JPEG
  }
  return 'image/jpeg';
}

// ============================================================================
// Tool Result Message Builder
// ============================================================================

/**
 * Build tool_result message blocks for Claude API
 */
export function buildToolResultMessage(
  toolResults: ToolExecutionResult[]
): Anthropic.ToolResultBlockParam[] {
  return toolResults.map(result => ({
    type: 'tool_result' as const,
    tool_use_id: result.toolUseId,
    content: result.success
      ? (typeof result.result === 'string' ? result.result : JSON.stringify(result.result))
      : `Error: ${result.error}`,
    is_error: !result.success,
  }));
}
