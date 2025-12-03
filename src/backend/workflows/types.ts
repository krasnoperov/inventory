/**
 * Workflow Types
 *
 * Shared input/output types for Cloudflare Workflows.
 * These define the contract between SpaceDO (trigger) and Workflows (execution).
 */

import type {
  BotResponse,
  ChatMessage,
  ForgeContext,
  ViewingContext,
} from '../../api/types';

// ============================================================================
// CHAT WORKFLOW TYPES
// ============================================================================

/** Asset context for Claude (simplified view of space assets) */
export interface BotContextAsset {
  id: string;
  name: string;
  type: string;
  variantCount: number;
}

/** Input to ChatWorkflow - triggered by SpaceDO on chat:request */
export interface ChatWorkflowInput {
  /** Client-generated UUID for response correlation */
  requestId: string;
  /** Space ID */
  spaceId: string;
  /** User ID (string) */
  userId: string;
  /** User's chat message */
  message: string;
  /** Chat mode */
  mode: 'advisor' | 'actor';
  /** Conversation history (last N messages) */
  history: ChatMessage[];
  /** Current forge tray state */
  forgeContext?: ForgeContext;
  /** What user is currently viewing */
  viewingContext?: ViewingContext;
  /** Space assets for Claude context */
  assets: BotContextAsset[];
  /** Personalization context from memory service */
  personalizationContext?: string;
}

/** Output from ChatWorkflow - sent back to SpaceDO for broadcast */
export interface ChatWorkflowOutput {
  /** Echo back requestId for correlation */
  requestId: string;
  /** User ID for billing tracking */
  userId: string;
  /** Whether the workflow succeeded */
  success: boolean;
  /** Claude's response (if success) */
  response?: BotResponse;
  /** Error message (if failure) */
  error?: string;
  /** Token usage for billing tracking */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ============================================================================
// GENERATION WORKFLOW TYPES
// ============================================================================

/**
 * Operation type - matches user-facing tool names
 * Used throughout the pipeline for clarity in logs and tracking
 */
export type OperationType = 'create' | 'refine' | 'combine';

/** Input to GenerationWorkflow - triggered by SpaceDO on generate:request */
export interface GenerationWorkflowInput {
  /** Client-generated UUID for response correlation */
  requestId: string;
  /** Job ID for tracking in D1 */
  jobId: string;
  /** Space ID */
  spaceId: string;
  /** User ID (string) */
  userId: string;
  /** Generation prompt */
  prompt: string;
  /** Target asset ID */
  assetId: string;
  /** Asset name */
  assetName: string;
  /** Asset type */
  assetType: string;
  /** Generation model */
  model?: string;
  /** Aspect ratio */
  aspectRatio?: string;
  /** Source variant ID (for derive - single source edit) */
  sourceVariantId?: string;
  /** Source image R2 keys (resolved from variants) */
  sourceImageKeys?: string[];
  /** Parent variant IDs for lineage tracking */
  parentVariantIds?: string[];
  /** Operation type (create/refine/combine) - matches user-facing tool name */
  operation: OperationType;
}

/** Variant data returned after generation */
export interface GeneratedVariant {
  id: string;
  asset_id: string;
  job_id: string | null;
  image_key: string;
  thumb_key: string;
  recipe: string;
  created_by: string;
  created_at: number;
}

/** Output from GenerationWorkflow - sent back to SpaceDO for broadcast */
export interface GenerationWorkflowOutput {
  /** Echo back requestId for correlation */
  requestId: string;
  /** Job ID */
  jobId: string;
  /** Whether the workflow succeeded */
  success: boolean;
  /** Created variant (if success) */
  variant?: GeneratedVariant;
  /** Error message (if failure) */
  error?: string;
}

// ============================================================================
// REFINE WORKFLOW TYPES (variant creation in existing asset)
// ============================================================================

/** Input to refine request - creates new variant in existing asset */
export interface RefineWorkflowInput {
  /** Client-generated UUID for response correlation */
  requestId: string;
  /** Job ID for tracking */
  jobId: string;
  /** Space ID */
  spaceId: string;
  /** User ID */
  userId: string;
  /** Target asset ID */
  assetId: string;
  /** Asset name (for display) */
  assetName: string;
  /** Asset type */
  assetType: string;
  /** Refinement prompt */
  prompt: string;
  /** Source variant ID to refine from */
  sourceVariantId: string;
  /** Source image R2 key */
  sourceImageKey: string;
  /** Additional reference image keys */
  referenceImageKeys?: string[];
  /** Generation model */
  model?: string;
  /** Aspect ratio */
  aspectRatio?: string;
}

// ============================================================================
// WEBSOCKET MESSAGE TYPES (additions to SpaceDO)
// ============================================================================

/** Chat request from client (replaces HTTP POST /api/spaces/:id/chat) */
export interface ChatRequestMessage {
  type: 'chat:request';
  requestId: string;
  message: string;
  mode: 'advisor' | 'actor';
  history?: ChatMessage[];
  forgeContext?: ForgeContext;
  viewingContext?: ViewingContext;
}

/** Generate request from client (replaces HTTP POST /api/spaces/:id/assets) */
export interface GenerateRequestMessage {
  type: 'generate:request';
  requestId: string;
  name: string;
  assetType: string;
  prompt?: string;
  /** Asset-level references - backend resolves to default variants */
  referenceAssetIds?: string[];
  /** Explicit variant references from ForgeTray UI - used as-is */
  referenceVariantIds?: string[];
  aspectRatio?: string;
  parentAssetId?: string;
}

/** Refine request from client (replaces HTTP POST /api/spaces/:id/assets/:id/variants) */
export interface RefineRequestMessage {
  type: 'refine:request';
  requestId: string;
  assetId: string;
  prompt: string;
  /** Single source variant (legacy) */
  sourceVariantId?: string;
  /** Multiple source variants from ForgeTray (for combine into existing asset) */
  sourceVariantIds?: string[];
  /** Asset-level references - backend resolves to default variants */
  referenceAssetIds?: string[];
  aspectRatio?: string;
}

/** Chat response to client */
export interface ChatResponseMessage {
  type: 'chat:response';
  requestId: string;
  success: boolean;
  response?: BotResponse;
  error?: string;
}

/** Generation started notification (broadcast to all) */
export interface GenerateStartedMessage {
  type: 'generate:started';
  requestId: string;
  jobId: string;
  assetId: string;
  assetName: string;
}

/** Generation result notification (broadcast to all) */
export interface GenerateResultMessage {
  type: 'generate:result';
  requestId: string;
  jobId: string;
  success: boolean;
  variant?: GeneratedVariant;
  error?: string;
}

/** Refine result notification (broadcast to all) */
export interface RefineResultMessage {
  type: 'refine:result';
  requestId: string;
  jobId: string;
  success: boolean;
  variant?: GeneratedVariant;
  error?: string;
}

// ============================================================================
// DESCRIBE/COMPARE WEBSOCKET MESSAGE TYPES
// ============================================================================

// Re-export shared types for convenience
export type { DescribeFocus, ClaudeUsage } from '../../shared/websocket-types';
import type { DescribeFocus, ClaudeUsage } from '../../shared/websocket-types';

/** Describe image request from client (replaces HTTP POST /api/spaces/:id/chat/describe) */
export interface DescribeRequestMessage {
  type: 'describe:request';
  requestId: string;
  assetId: string;
  variantId: string;
  assetName: string;
  /** Optional focus for the description */
  focus?: DescribeFocus;
  /** Optional question about the image */
  question?: string;
}

/** Describe image response to client */
export interface DescribeResponseMessage {
  type: 'describe:response';
  requestId: string;
  success: boolean;
  description?: string;
  error?: string;
  usage?: ClaudeUsage;
}

/** Compare images request from client (replaces HTTP POST /api/spaces/:id/chat/compare) */
export interface CompareRequestMessage {
  type: 'compare:request';
  requestId: string;
  variantIds: string[];
  /** Aspects to compare (e.g., "style", "color", "composition") */
  aspects?: string[];
}

/** Compare images response to client */
export interface CompareResponseMessage {
  type: 'compare:response';
  requestId: string;
  success: boolean;
  comparison?: string;
  error?: string;
  usage?: ClaudeUsage;
}
