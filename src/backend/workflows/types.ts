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
  /** Source variant ID (for derive - single source edit) */
  sourceVariantId?: string;
  /** Source image R2 keys (resolved from variants) */
  sourceImageKeys?: string[];
  /** Parent variant IDs for lineage tracking */
  parentVariantIds?: string[];
  /** Operation type (derive/refine) - matches user-facing tool name */
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
  /** Multiple source variants from ForgeTray (for refine with multiple refs) */
  sourceVariantIds?: string[];
  /** Asset-level references - backend resolves to default variants */
  referenceAssetIds?: string[];
  aspectRatio?: string;
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
