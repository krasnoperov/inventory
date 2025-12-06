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
import type { PendingApproval, ForgeContext, ViewingContext } from '../../api/types';
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
  /** Forge tray context for slot resolution */
  forgeContext?: ForgeContext;
  /** Viewing context for "viewing: true" resolution */
  viewingContext?: ViewingContext;
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
 * Resolve a reference to variantId and assetName
 *
 * Reference types (in priority order):
 * 1. slot: N     - Index into ForgeTray slots (0, 1, 2...)
 * 2. viewing     - What user is currently viewing on AssetDetailPage
 * 3. asset: Name - Lookup by asset name (case-insensitive)
 *
 * This allows Claude to reference images semantically without needing UUIDs.
 * Frontend sends forgeContext (tray slots) and viewingContext with each request.
 *
 * @example Claude tool call: describe({ slot: 0, focus: "style" })
 * @example Claude tool call: describe({ viewing: true })
 * @example Claude tool call: compare({ slots: [0, 1] })
 */
async function resolveReference(
  params: Record<string, unknown>,
  deps: ToolExecutorDeps
): Promise<{ variantId: string; assetName: string } | { error: string }> {
  const { slot, viewing, asset } = params as {
    slot?: number;
    viewing?: boolean;
    asset?: string;
  };

  // Priority: slot > viewing > asset
  if (typeof slot === 'number') {
    // Resolve from forge tray slot
    if (!deps.forgeContext?.slots || slot < 0 || slot >= deps.forgeContext.slots.length) {
      return { error: `Invalid tray slot: ${slot}. Tray has ${deps.forgeContext?.slots?.length || 0} slots.` };
    }
    const slotData = deps.forgeContext.slots[slot];
    return { variantId: slotData.variantId, assetName: slotData.assetName };
  }

  if (viewing === true) {
    // Resolve from viewing context
    if (!deps.viewingContext || deps.viewingContext.type !== 'asset') {
      return { error: 'User is not viewing an asset. Use slot or asset reference instead.' };
    }
    if (!deps.viewingContext.variantId) {
      return { error: 'No variant available for the viewed asset.' };
    }
    return {
      variantId: deps.viewingContext.variantId,
      assetName: deps.viewingContext.assetName || 'Unknown',
    };
  }

  if (asset) {
    // Resolve by asset name - fetch from DO
    const stateResp = await deps.doStub.fetch(new Request('http://do/internal/state'));
    if (!stateResp.ok) {
      return { error: 'Failed to fetch space state' };
    }
    const state = await stateResp.json() as { assets: AssetWithVariant[] };
    const found = state.assets.find(a => a.name.toLowerCase() === asset.toLowerCase());
    if (!found) {
      return { error: `Asset not found: "${asset}"` };
    }
    if (!found.active_variant_id) {
      return { error: `Asset "${asset}" has no variant yet.` };
    }
    return { variantId: found.active_variant_id, assetName: found.name };
  }

  return { error: 'No reference provided. Use slot, viewing, or asset parameter.' };
}

/**
 * Execute describe tool - analyze an image
 * Supports reference-based params: slot, viewing, asset
 *
 * IMPORTANT: Results include asset name prefix to help Claude correlate
 * which description belongs to which asset when multiple describes are executed.
 */
async function executeDescribe(
  params: Record<string, unknown>,
  deps: ToolExecutorDeps
): Promise<BackendToolResult> {
  const { slot, viewing, asset, question, focus } = params as {
    slot?: number;
    viewing?: boolean;
    asset?: string;
    question?: string;
    focus?: string;
  };

  // Build reference label for error messages
  const refLabel = typeof slot === 'number'
    ? `slot ${slot}`
    : viewing
      ? 'viewing'
      : asset
        ? `"${asset}"`
        : 'unknown reference';

  if (!deps.anthropicApiKey) {
    return { success: false, error: `Cannot describe ${refLabel}: Vision API not configured` };
  }

  if (!deps.imagesBucket) {
    return { success: false, error: `Cannot describe ${refLabel}: Image storage not configured` };
  }

  try {
    // Resolve reference to variantId
    const resolved = await resolveReference(params, deps);
    if ('error' in resolved) {
      return { success: false, error: `Cannot describe ${refLabel}: ${resolved.error}` };
    }

    const { variantId, assetName } = resolved;

    // Get variant info
    const variantResp = await deps.doStub.fetch(
      new Request(`http://do/internal/variant/${variantId}`)
    );
    if (!variantResp.ok) {
      return { success: false, error: `Cannot describe "${assetName}": Variant not found` };
    }
    const variant = await variantResp.json() as VariantInfo;

    // Fetch image from R2
    const imageObj = await deps.imagesBucket.get(variant.image_key);
    if (!imageObj) {
      return { success: false, error: `Cannot describe "${assetName}": Image not found in storage` };
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
      (focus as 'general' | 'style' | 'composition' | 'details' | 'prompt') || 'general',
      question
    );

    // Include asset name in result so Claude knows which asset was described
    // This is critical when multiple describes run - Claude needs to correlate results
    return {
      success: true,
      result: `[${assetName}]\n${description}`,
      usage,
    };
  } catch (error) {
    return {
      success: false,
      error: `Cannot describe ${refLabel}: ${error instanceof Error ? error.message : 'Failed to describe image'}`,
    };
  }
}

/**
 * Execute compare tool - compare multiple images
 * Supports slots (tray indices) for reference
 */
async function executeCompare(
  params: Record<string, unknown>,
  deps: ToolExecutorDeps
): Promise<BackendToolResult> {
  const { slots, aspects } = params as {
    slots: number[];
    aspects?: string[];
  };

  if (!deps.anthropicApiKey) {
    return { success: false, error: 'Vision API not configured' };
  }

  if (!deps.imagesBucket) {
    return { success: false, error: 'Image storage not configured' };
  }

  if (!slots || slots.length < 2 || slots.length > 4) {
    return { success: false, error: 'Must provide 2-4 slot indices to compare' };
  }

  // Validate all slots exist
  const traySlots = deps.forgeContext?.slots || [];
  for (const slotIdx of slots) {
    if (slotIdx < 0 || slotIdx >= traySlots.length) {
      return { error: `Invalid tray slot: ${slotIdx}. Tray has ${traySlots.length} slots.`, success: false };
    }
  }

  try {
    const images: Array<{
      base64: string;
      mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
      label: string;
    }> = [];

    // Fetch all images from slots
    for (const slotIdx of slots) {
      const slotData = traySlots[slotIdx];
      const variantResp = await deps.doStub.fetch(
        new Request(`http://do/internal/variant/${slotData.variantId}`)
      );
      if (!variantResp.ok) {
        return { success: false, error: `Variant not found for slot ${slotIdx}` };
      }
      const variant = await variantResp.json() as VariantInfo;

      const imageObj = await deps.imagesBucket.get(variant.image_key);
      if (!imageObj) {
        return { success: false, error: `Image not found for slot ${slotIdx}` };
      }
      const imageBuffer = await imageObj.arrayBuffer();
      const base64 = arrayBufferToBase64(imageBuffer);

      images.push({
        base64,
        mediaType: detectImageType(base64),
        label: slotData.assetName,
      });
    }

    // Import and use ClaudeService for vision
    const { ClaudeService } = await import('./claudeService');
    const claudeService = new ClaudeService(deps.anthropicApiKey);

    const { comparison, usage } = await claudeService.compareImages(
      images,
      aspects || ['style', 'composition', 'colors']
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
