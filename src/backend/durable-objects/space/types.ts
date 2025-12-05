/**
 * Types for SpaceDO - Durable Object SQLite Schema and WebSocket Messages
 *
 * This module extracts all type definitions from SpaceDO.ts for:
 * - Testability (types can be imported without DO runtime)
 * - Reusability (shared across handlers and services)
 * - Maintainability (single source of truth for schema types)
 */

import type {
  ChatRequestMessage,
  GenerateRequestMessage,
  RefineRequestMessage,
  DescribeRequestMessage,
  CompareRequestMessage,
} from '../../workflows/types';
import type { ClaudeUsage, ErrorCode, SimplePlan } from '../../../shared/websocket-types';

// Re-export plan types from shared module (single source of truth)
export type { PlanStatus, PlanStepStatus } from '../../../shared/websocket-types';

// ============================================================================
// DO SQLite Schema Types
// ============================================================================

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
 * ChatMessage - A message in the space chat
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
  // Chat
  | { type: 'chat:send'; content: string }
  | { type: 'chat:history'; since?: number } // Request chat history for active session
  | { type: 'chat:new_session' } // Start a new chat session
  // Approval operations
  | { type: 'approval:approve'; approvalId: string }
  | { type: 'approval:reject'; approvalId: string }
  | { type: 'approval:list' } // Request pending approvals
  // Session context operations
  | { type: 'session:get' }
  | { type: 'session:update'; viewingAssetId?: string | null; viewingVariantId?: string | null; forgeContext?: string | null }
  // Workflow-triggering messages
  | ChatRequestMessage
  | GenerateRequestMessage
  | RefineRequestMessage
  // Vision (describe/compare) messages
  | DescribeRequestMessage
  | CompareRequestMessage;

// ============================================================================
// Message Types (Server → Client)
// ============================================================================

/**
 * All messages that can be sent from server to client via WebSocket
 */
export type ServerMessage =
  // Sync (full state)
  | { type: 'sync:state'; assets: Asset[]; variants: Variant[]; lineage: Lineage[]; presence: UserPresence[] }
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
  // Chat
  | { type: 'chat:message'; message: ChatMessage }
  | { type: 'chat:history'; messages: ChatMessage[]; sessionId: string | null }
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
  | { type: 'chat:response'; requestId: string; success: boolean; response?: unknown; error?: string }
  | { type: 'generate:started'; requestId: string; jobId: string; assetId: string; assetName: string }
  | { type: 'generate:result'; requestId: string; jobId: string; success: boolean; variant?: Variant; error?: string }
  | { type: 'refine:started'; requestId: string; jobId: string; assetId: string; assetName: string }
  | { type: 'refine:result'; requestId: string; jobId: string; success: boolean; variant?: Variant; error?: string }
  // Vision (describe/compare) response messages
  | { type: 'describe:response'; requestId: string; success: boolean; description?: string; error?: string; usage?: ClaudeUsage }
  | { type: 'compare:response'; requestId: string; success: boolean; comparison?: string; error?: string; usage?: ClaudeUsage }
  // Pre-check error messages (quota/rate limit exceeded)
  | { type: 'chat:error'; requestId: string; error: string; code: string }
  | { type: 'generate:error'; requestId: string; error: string; code: string }
  | { type: 'refine:error'; requestId: string; error: string; code: string };

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
