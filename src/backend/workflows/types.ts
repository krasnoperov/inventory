/**
 * Workflow Types
 *
 * Shared input/output types for Cloudflare Workflows.
 * These define the contract between SpaceDO (trigger) and Workflows (execution).
 */

// ============================================================================
// GENERATION WORKFLOW TYPES
// ============================================================================

/**
 * Operation type - matches user-facing ForgeTray operations
 * Used throughout the pipeline for clarity in logs and tracking
 *
 * Recipe operations (stored in variant.recipe.operation):
 * - generate: Create new asset from prompt only (no references)
 * - derive: Create new asset using references as inspiration
 * - refine: Add variant to existing asset
 * - upload: User uploaded an image (no AI generation)
 *
 * UI/tracking operations (not stored in recipe):
 * - fork: Copy variant to new asset (copies source recipe, not stored as operation)
 *
 * Note: 'fork' doesn't appear in recipes - forked variants copy source recipe.
 * The lineage.relation_type = 'forked' tracks the fork relationship.
 * Lineage uses: 'derived', 'refined', 'forked' for relationships.
 */
export type OperationType = 'generate' | 'derive' | 'refine' | 'fork' | 'upload';

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
  /** Image output size (1K, 2K, 4K) — defaults to '1K' */
  imageSize?: string;
  /** Source variant ID (for derive - single source edit) */
  sourceVariantId?: string;
  /** Source image R2 keys (resolved from variants) */
  sourceImageKeys?: string[];
  /** Parent variant IDs for lineage tracking */
  parentVariantIds?: string[];
  /** Operation type (derive/refine) - matches user-facing tool name */
  operation: OperationType;
  /** Style description prepended to prompt (if style anchoring active) */
  styleDescription?: string;
  /** Style reference image R2 keys (prepended to source images) */
  styleImageKeys?: string[];
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
  /** Disable style anchoring for this generation */
  disableStyle?: boolean;
}

/** Refine request from client (replaces HTTP POST /api/spaces/:id/assets/:id/variants) */
export interface RefineRequestMessage {
  type: 'refine:request';
  requestId: string;
  assetId: string;
  prompt: string;
  /** Single source variant (legacy) */
  sourceVariantId?: string;
  /** Multiple source variants from ForgeTray (for refine with multiple refs) */
  sourceVariantIds?: string[];
  /** Asset-level references - backend resolves to default variants */
  referenceAssetIds?: string[];
  aspectRatio?: string;
  /** Disable style anchoring for this generation */
  disableStyle?: boolean;
}

// ============================================================================
// BATCH GENERATION TYPES
// ============================================================================

/** Batch mode: 'explore' = 1 asset N variants, 'set' = N assets 1 variant each */
export type BatchMode = 'explore' | 'set';

/** Batch generation request from client */
export interface BatchRequestMessage {
  type: 'batch:request';
  requestId: string;
  name: string;
  assetType: string;
  prompt?: string;
  /** Number of variants/assets to generate (2-8) */
  count: number;
  /** Batch mode */
  mode: BatchMode;
  /** Asset-level references */
  referenceAssetIds?: string[];
  /** Explicit variant references from ForgeTray UI */
  referenceVariantIds?: string[];
  aspectRatio?: string;
  parentAssetId?: string;
  /** Disable style anchoring for this batch */
  disableStyle?: boolean;
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

// ============================================================================
// ENHANCE PROMPT WEBSOCKET MESSAGE TYPES
// ============================================================================

/** Enhance type for prompt enhancement options */
export type EnhanceType = 'geminify';

/** Enhance prompt request from client */
export interface EnhanceRequestMessage {
  type: 'enhance:request';
  requestId: string;
  /** The prompt to enhance */
  prompt: string;
  /** Type of enhancement to apply */
  enhanceType: EnhanceType;
  /** Optional variant IDs in ForgeTray for vision-aware enhancement */
  slotVariantIds?: string[];
}

/** Enhance prompt response to client */
export interface EnhanceResponseMessage {
  type: 'enhance:response';
  requestId: string;
  success: boolean;
  /** The enhanced prompt (if success) */
  enhancedPrompt?: string;
  error?: string;
  usage?: ClaudeUsage;
}

// ============================================================================
// AUTO-DESCRIBE WEBSOCKET MESSAGE TYPES (lazy description caching)
// ============================================================================

/** Auto-describe request - triggered when variant added to ForgeTray */
export interface AutoDescribeRequestMessage {
  type: 'auto-describe:request';
  requestId: string;
  /** Variant ID to describe */
  variantId: string;
}

/** Auto-describe response - returns cached or newly generated description */
export interface AutoDescribeResponseMessage {
  type: 'auto-describe:response';
  requestId: string;
  success: boolean;
  /** Variant ID that was described */
  variantId: string;
  /** AI-generated description (if success) */
  description?: string;
  error?: string;
}

// ============================================================================
// FORGE CHAT WEBSOCKET MESSAGE TYPES (multi-turn prompt refinement)
// ============================================================================

/** ForgeChat request - multi-turn conversation for prompt refinement */
export interface ForgeChatRequestMessage {
  type: 'forge-chat:request';
  requestId: string;
  /** User's message in the conversation */
  message: string;
  /** Current prompt in ForgeTray */
  currentPrompt: string;
  /** Variant IDs in ForgeTray slots (for context) */
  slotVariantIds: string[];
  /** Conversation history for multi-turn */
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/** ForgeChat progress - sent during description phase before main response */
export interface ForgeChatProgressMessage {
  type: 'forge-chat:progress';
  requestId: string;
  /** Which phase we're in */
  phase: 'describing';
  /** Variant being described */
  variantId: string;
  /** Asset name for display */
  assetName: string;
  /** Current status */
  status: 'started' | 'completed' | 'cached';
  /** Description text (when completed) */
  description?: string;
  /** Progress index (1-based) */
  index: number;
  /** Total count */
  total: number;
}

/** ForgeChat response - assistant's reply with optional prompt suggestion */
export interface ForgeChatResponseMessage {
  type: 'forge-chat:response';
  requestId: string;
  success: boolean;
  /** Assistant's response message */
  message?: string;
  /** Suggested enhanced prompt (if applicable) */
  suggestedPrompt?: string;
  error?: string;
  usage?: ClaudeUsage;
  /** Descriptions generated during this request (for UI display) */
  descriptions?: Array<{
    variantId: string;
    assetName: string;
    description: string;
    cached: boolean;
  }>;
}
