/**
 * Types for SpaceDO - Durable Object SQLite Schema and WebSocket Messages
 *
 * This module extracts all type definitions from SpaceDO.ts for:
 * - Testability (types can be imported without DO runtime)
 * - Reusability (shared across handlers and services)
 * - Maintainability (single source of truth for schema types)
 */

import type {
  GenerateRequestMessage,
  RefineRequestMessage,
  DescribeRequestMessage,
  CompareRequestMessage,
  EnhanceRequestMessage,
  AutoDescribeRequestMessage,
  ForgeChatRequestMessage,
  BatchRequestMessage,
  BatchMode,
} from '../../workflows/types';
import type { ClaudeUsage, DeferredAction, ErrorCode, SimplePlan } from '../../../shared/websocket-types';

// Re-export plan types from shared module (single source of truth)
export type { PlanStatus, PlanStepStatus } from '../../../shared/websocket-types';

// ============================================================================
// DO SQLite Schema Types
// ============================================================================

/**
 * SpaceStyle - Visual identity for style anchoring
 */
export interface SpaceStyle {
  id: string;
  name: string;
  description: string;
  image_keys: string; // JSON array of R2 image keys
  enabled: number; // SQLite boolean (0/1)
  created_by: string;
  created_at: number;
  updated_at: number;
}

/**
 * Variant generation status
 */
export type VariantStatus = 'pending' | 'processing' | 'uploading' | 'completed' | 'failed';

/**
 * Asset - A graphical asset in the inventory (character, item, scene, etc.)
 */
export interface Asset {
  id: string;
  name: string;
  type: string; // User-editable: character, item, scene, sprite-sheet, animation, style-sheet, reference, etc.
  tags: string; // JSON array
  parent_asset_id: string | null; // NULL = root asset, else nested under parent
  active_variant_id: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

/**
 * Variant - A version/iteration of an asset
 *
 * Can be a placeholder (pending/processing/failed) or completed with images.
 * Placeholders are created immediately when generation starts, allowing
 * the UI to show progress and enabling retry on failure.
 */
export interface Variant {
  id: string;
  asset_id: string;
  workflow_id: string | null; // Cloudflare workflow instance ID (null for forks/imports)
  status: VariantStatus; // Generation lifecycle status
  error_message: string | null; // Error details when status='failed'
  image_key: string | null; // R2 key, null until generation completes
  thumb_key: string | null; // R2 key for thumbnail, null until generation completes
  recipe: string; // JSON - generation parameters stored upfront for retry
  starred: boolean; // User marks important versions
  created_by: string;
  created_at: number;
  updated_at: number | null; // Track status changes
  plan_step_id: string | null; // If this variant was created by a plan step
  description: string | null; // Cached AI-generated description for vision-aware enhancement
  batch_id: string | null; // Batch generation group ID
}

/**
 * ChatSession - A conversation thread in the space
 */
export interface ChatSession {
  id: string;
  title: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

/**
 * ChatMessage - A message in the space chat (DB format with snake_case)
 */
export interface ChatMessage {
  id: string;
  session_id: string | null;
  sender_type: 'user' | 'bot';
  sender_id: string;
  content: string;
  metadata: string | null; // JSON
  created_at: number;
}

/**
 * ChatMessageClient - A message formatted for the client (camelCase)
 */
export interface ChatMessageClient {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  suggestedPrompt?: string;
  descriptions?: Array<{ variantId: string; assetName: string; description: string; cached: boolean }>;
}

// ============================================================================
// Rotation & Tile Set Types
// ============================================================================

export type RotationConfig = '4-directional' | '8-directional' | 'turnaround';

export const ROTATION_DIRECTIONS: Record<RotationConfig, string[]> = {
  '4-directional': ['S', 'E', 'N', 'W'],
  '8-directional': ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'],
  'turnaround': ['front', '3/4-front', 'side', '3/4-back', 'back'],
};

export type RotationSetStatus = 'pending' | 'generating' | 'completed' | 'failed' | 'cancelled';

export interface RotationSet {
  id: string;
  asset_id: string;
  source_variant_id: string;
  config: string; // JSON: { type: RotationConfig, subjectDescription?: string }
  status: RotationSetStatus;
  current_step: number;
  total_steps: number;
  error_message: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface RotationView {
  id: string;
  rotation_set_id: string;
  variant_id: string;
  direction: string;
  step_index: number;
  created_at: number;
}

export type TileType = 'terrain' | 'building' | 'decoration' | 'custom';
export type TileSetStatus = 'pending' | 'generating' | 'completed' | 'failed' | 'cancelled';

export interface TileSet {
  id: string;
  asset_id: string;
  tile_type: TileType;
  grid_width: number;
  grid_height: number;
  status: TileSetStatus;
  seed_variant_id: string | null;
  config: string; // JSON: { prompt: string }
  current_step: number;
  total_steps: number;
  error_message: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface TilePosition {
  id: string;
  tile_set_id: string;
  variant_id: string;
  grid_x: number;
  grid_y: number;
  created_at: number;
}

/**
 * Lineage - Parent-child relationship between variants
 */
export interface Lineage {
  id: string;
  parent_variant_id: string;
  child_variant_id: string;
  relation_type: 'derived' | 'refined' | 'forked';
  severed: boolean; // User can cut the link if desired
  created_at: number;
}

// Import PlanStatus and PlanStepStatus from shared module (re-exported above)
import type { PlanStatus, PlanStepStatus } from '../../../shared/websocket-types';

/**
 * Plan - A multi-step assistant workflow
 */
export interface Plan {
  id: string;
  goal: string;
  status: PlanStatus;
  current_step_index: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  // Auto-advance improvements
  auto_advance: boolean; // Execute steps automatically after approval
  max_parallel: number; // Maximum concurrent steps (default 3)
  active_step_count: number; // Currently executing steps
  // Revision tracking
  revised_at: number | null; // Last revision timestamp
  revision_count: number; // Number of revisions made
}

/**
 * PlanStep - A single step in a plan
 */
export interface PlanStep {
  id: string;
  plan_id: string;
  step_index: number;
  description: string;
  action: string; // 'generate', 'derive', 'refine', 'fork', 'add_to_tray', etc.
  params: string; // JSON
  status: PlanStepStatus;
  result: string | null;
  error: string | null;
  created_at: number;
  updated_at: number | null;
  // Dependencies
  depends_on: string | null; // JSON array of step IDs that must complete first
  // Revision tracking
  skipped: boolean; // Step was skipped (not failed)
  original_description: string | null; // Original description before revision
  revised_at: number | null; // When this step was revised
}

/**
 * Approval status lifecycle
 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

/**
 * PendingApproval - A tool call awaiting user approval (trust zones)
 */
export interface PendingApproval {
  id: string;
  request_id: string;
  plan_id: string | null;
  plan_step_id: string | null;
  tool: string; // 'derive', 'generate', 'refine', etc.
  params: string; // JSON
  description: string;
  status: ApprovalStatus;
  created_by: string;
  approved_by: string | null;
  rejected_by: string | null;
  error_message: string | null;
  result_job_id: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * AutoExecuted - Result of a safe auto-executed tool (describe, search, compare)
 */
export interface AutoExecuted {
  id: string;
  request_id: string;
  tool: string;
  params: string; // JSON
  result: string; // JSON
  success: boolean;
  error: string | null;
  created_at: number;
}

/**
 * UserSession - Per-user context for stateless CLI and cross-client sync
 */
export interface UserSession {
  user_id: string;
  viewing_asset_id: string | null;
  viewing_variant_id: string | null;
  forge_context: string | null; // JSON: { operation, slots, prompt }
  active_chat_session_id: string | null; // Current chat session
  last_seen: number;
  updated_at: number;
}

/**
 * ChatMessageMetadata - Extended fields stored in chat_messages.metadata
 */
export interface ChatMessageMetadata {
  mode?: 'advisor' | 'actor';
  type?: 'advice' | 'action' | 'plan';
  thumbnail?: { url: string; assetName: string; assetId?: string };
  quotaError?: { service: string; used: number; limit: number | null };
  rateLimitError?: { resetsAt: string | null; remainingSeconds: number };
  isError?: boolean;
  planId?: string;
  approvalIds?: string[];
  autoExecutedIds?: string[];
}

// ============================================================================
// WebSocket Types
// ============================================================================

/**
 * WebSocket client metadata - attached when connection is accepted
 */
export interface WebSocketMeta {
  userId: string;
  role: 'owner' | 'editor' | 'viewer';
}

/**
 * Presence data for a user - tracks what they're viewing
 */
export interface UserPresence {
  userId: string;
  viewing: string | null; // Asset ID being viewed
  lastSeen: number;
}

// ============================================================================
// Message Types (Client → Server)
// ============================================================================

/**
 * All messages that can be sent from client to server via WebSocket
 */
export type ClientMessage =
  // Sync
  | { type: 'sync:request' }
  // Asset operations
  | { type: 'asset:create'; name: string; assetType: string; parentAssetId?: string }
  | { type: 'asset:update'; assetId: string; changes: { name?: string; tags?: string[]; type?: string; parentAssetId?: string | null } }
  | { type: 'asset:delete'; assetId: string }
  | { type: 'asset:setActive'; assetId: string; variantId: string }
  | { type: 'asset:fork'; sourceAssetId?: string; sourceVariantId?: string; name: string; assetType: string; parentAssetId?: string }
  // Variant operations
  | { type: 'variant:delete'; variantId: string }
  | { type: 'variant:star'; variantId: string; starred: boolean }
  | { type: 'variant:retry'; variantId: string }
  // Lineage operations
  | { type: 'lineage:sever'; lineageId: string }
  // Presence
  | { type: 'presence:update'; viewing?: string }
  // Chat (persistent space chat with ForgeTray context)
  | { type: 'chat:send'; content: string; forgeContext?: { prompt: string; slotVariantIds: string[] } }
  | { type: 'chat:history' } // Request chat history for active session
  | { type: 'chat:clear' } // Clear chat (create new session)
  // Approval operations
  | { type: 'approval:approve'; approvalId: string }
  | { type: 'approval:reject'; approvalId: string }
  | { type: 'approval:list' } // Request pending approvals
  // Session context operations
  | { type: 'session:get' }
  | { type: 'session:update'; viewingAssetId?: string | null; viewingVariantId?: string | null; forgeContext?: string | null }
  // Workflow-triggering messages
  | GenerateRequestMessage
  | RefineRequestMessage
  // Vision (describe/compare) messages
  | DescribeRequestMessage
  | CompareRequestMessage
  // Enhance prompt messages
  | EnhanceRequestMessage
  // Auto-describe messages (lazy description caching)
  | AutoDescribeRequestMessage
  // ForgeChat messages (multi-turn prompt refinement)
  | ForgeChatRequestMessage
  // Style anchoring messages
  | { type: 'style:get' }
  | { type: 'style:set'; name?: string; description: string; imageKeys: string[]; enabled?: boolean }
  | { type: 'style:delete' }
  | { type: 'style:toggle'; enabled: boolean }
  // Batch generation messages
  | BatchRequestMessage
  // Rotation pipeline messages
  | { type: 'rotation:request'; requestId: string; sourceVariantId: string; config: RotationConfig; subjectDescription?: string; aspectRatio?: string; disableStyle?: boolean }
  | { type: 'rotation:cancel'; rotationSetId: string }
  // Tile pipeline messages
  | { type: 'tileset:request'; requestId: string; tileType: TileType; gridWidth: number; gridHeight: number; prompt: string; seedVariantId?: string; aspectRatio?: string; disableStyle?: boolean }
  | { type: 'tileset:cancel'; tileSetId: string };

// ============================================================================
// Message Types (Server → Client)
// ============================================================================

/**
 * All messages that can be sent from server to client via WebSocket
 */
export type ServerMessage =
  // Sync (full state)
  | { type: 'sync:state'; assets: Asset[]; variants: Variant[]; lineage: Lineage[]; presence: UserPresence[]; rotationSets?: RotationSet[]; rotationViews?: RotationView[]; tileSets?: TileSet[]; tilePositions?: TilePosition[]; style?: SpaceStyle | null }
  // TODO: sync:chat_state is currently unused - chat history is loaded via REST API instead.
  // Consider implementing for WebSocket reconnection state recovery.
  // | { type: 'sync:chat_state'; messages: ChatMessage[]; plan: Plan | null; planSteps: PlanStep[]; approvals: PendingApproval[]; autoExecuted: AutoExecuted[] }
  // Asset mutations
  | { type: 'asset:created'; asset: Asset }
  | { type: 'asset:updated'; asset: Asset }
  | { type: 'asset:deleted'; assetId: string }
  | { type: 'asset:forked'; asset: Asset; variant: Variant; lineage: Lineage }
  // Variant mutations
  | { type: 'variant:created'; variant: Variant }
  | { type: 'variant:updated'; variant: Variant }
  | { type: 'variant:deleted'; variantId: string }
  // Lineage mutations
  | { type: 'lineage:created'; lineage: Lineage }
  | { type: 'lineage:severed'; lineageId: string }
  // Job status
  | { type: 'job:progress'; jobId: string; status: string }
  | { type: 'job:completed'; jobId: string; variant: Variant }
  | { type: 'job:failed'; jobId: string; error: string }
  // Chat (persistent space chat)
  | { type: 'chat:message'; message: ChatMessageClient }
  | { type: 'chat:history'; messages: ChatMessageClient[]; sessionId: string | null }
  | { type: 'chat:session_created'; session: ChatSession }
  // SimplePlan mutations (markdown-based)
  | { type: 'simple_plan:updated'; plan: SimplePlan }
  | { type: 'simple_plan:archived'; planId: string }
  // Approval mutations
  | { type: 'approval:created'; approval: PendingApproval }
  | { type: 'approval:updated'; approval: PendingApproval }
  | { type: 'approval:deleted'; approvalId: string }
  | { type: 'approval:list'; approvals: PendingApproval[] }
  // Auto-executed results
  | { type: 'auto_executed'; autoExecuted: AutoExecuted }
  // Session context
  | { type: 'session:state'; session: UserSession }
  // Presence
  | { type: 'presence:update'; presence: UserPresence[] }
  // Errors
  | { type: 'error'; code: ErrorCode; message: string }
  // Workflow response messages
  | { type: 'chat:response'; requestId: string; success: boolean; response?: unknown; error?: string; deferredActions?: DeferredAction[] }
  | { type: 'generate:started'; requestId: string; jobId: string; assetId: string; assetName: string }
  | { type: 'generate:result'; requestId: string; jobId: string; success: boolean; variant?: Variant; error?: string }
  | { type: 'refine:started'; requestId: string; jobId: string; assetId: string; assetName: string }
  | { type: 'refine:result'; requestId: string; jobId: string; success: boolean; variant?: Variant; error?: string }
  // Vision (describe/compare) response messages
  | { type: 'describe:response'; requestId: string; success: boolean; description?: string; error?: string; usage?: ClaudeUsage }
  | { type: 'compare:response'; requestId: string; success: boolean; comparison?: string; error?: string; usage?: ClaudeUsage }
  // Enhance prompt response messages
  | { type: 'enhance:response'; requestId: string; success: boolean; enhancedPrompt?: string; error?: string; usage?: ClaudeUsage }
  // Auto-describe response messages
  | { type: 'auto-describe:response'; requestId: string; success: boolean; variantId: string; description?: string; error?: string }
  // ForgeChat progress and response messages
  | { type: 'forge-chat:progress'; requestId: string; phase: 'describing'; variantId: string; assetName: string; status: 'started' | 'completed' | 'cached'; description?: string; index: number; total: number }
  | { type: 'forge-chat:response'; requestId: string; success: boolean; message?: string; suggestedPrompt?: string; error?: string; usage?: ClaudeUsage; descriptions?: Array<{ variantId: string; assetName: string; description: string; cached: boolean }> }
  // Chat progress messages
  | { type: 'chat:progress'; requestId: string; toolName: string; toolParams: Record<string, unknown>; status: 'executing' | 'complete' | 'failed'; result?: string; error?: string } // Agentic loop tool execution
  | { type: 'chat:progress'; requestId: string; phase: 'describing'; variantId: string; assetName: string; status: 'started' | 'completed' | 'cached'; description?: string; index: number; total: number } // Description progress
  // Pre-check error messages (quota/rate limit exceeded)
  | { type: 'chat:error'; requestId: string; error: string; code: string }
  | { type: 'generate:error'; requestId: string; error: string; code: string }
  | { type: 'refine:error'; requestId: string; error: string; code: string }
  // Style anchoring messages
  | { type: 'style:state'; style: SpaceStyle | null }
  | { type: 'style:updated'; style: SpaceStyle }
  | { type: 'style:deleted' }
  // Batch generation messages
  | { type: 'batch:started'; requestId: string; batchId: string; jobIds: string[]; assetIds: string[]; count: number; mode: BatchMode }
  | { type: 'batch:progress'; batchId: string; completedCount: number; failedCount: number; totalCount: number; variant: Variant }
  | { type: 'batch:completed'; batchId: string; completedCount: number; failedCount: number; totalCount: number }
  | { type: 'batch:error'; requestId: string; error: string; code: string }
  // Rotation pipeline responses
  | { type: 'rotation:started'; requestId: string; rotationSetId: string; assetId: string; totalSteps: number; directions: string[] }
  | { type: 'rotation:step_completed'; rotationSetId: string; direction: string; variantId: string; step: number; total: number }
  | { type: 'rotation:completed'; rotationSetId: string; views: RotationView[] }
  | { type: 'rotation:failed'; rotationSetId: string; error: string; failedStep: number }
  | { type: 'rotation:cancelled'; rotationSetId: string }
  // Tile pipeline responses
  | { type: 'tileset:started'; requestId: string; tileSetId: string; assetId: string; gridWidth: number; gridHeight: number; totalTiles: number }
  | { type: 'tileset:tile_completed'; tileSetId: string; variantId: string; gridX: number; gridY: number; step: number; total: number }
  | { type: 'tileset:completed'; tileSetId: string; positions: TilePosition[] }
  | { type: 'tileset:failed'; tileSetId: string; error: string; failedStep: number }
  | { type: 'tileset:cancelled'; tileSetId: string };

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Changes that can be applied to an asset
 */
export interface AssetChanges {
  name?: string;
  tags?: string[];
  type?: string;
  parent_asset_id?: string | null;
  active_variant_id?: string | null;
}

/**
 * Input for creating a new asset
 */
export interface CreateAssetInput {
  id?: string;
  name: string;
  type: string;
  parentAssetId?: string;
  createdBy: string;
}

/**
 * Input for forking an asset from a variant
 */
export interface ForkAssetInput {
  sourceVariantId: string;
  name: string;
  type: string;
  parentAssetId?: string;
  createdBy: string;
}

/**
 * Result of forking an asset
 */
export interface ForkResult {
  asset: Asset;
  variant: Variant;
  lineage: Lineage;
}
