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
  GenerationEstimateRequestMessage,
  GenerationUsageEstimate,
  DescribeRequestMessage,
  CompareRequestMessage,
  EnhanceRequestMessage,
  AutoDescribeRequestMessage,
  ForgeChatRequestMessage,
  BatchRequestMessage,
  BatchMode,
} from '../../workflows/types';
import type { ClaudeUsage, CollectionPlacementInput, DeferredAction, ErrorCode, MediaKind, SimplePlan } from '../../../shared/websocket-types';

// Re-export plan types from shared module (single source of truth)
export type { MediaKind, PlanStatus, PlanStepStatus } from '../../../shared/websocket-types';

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
  media_kind: MediaKind;
  tags: string; // JSON array
  parent_asset_id: string | null; // Legacy compatibility field; not writable organization state
  active_variant_id: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
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
  media_kind: MediaKind;
  workflow_id: string | null; // Cloudflare workflow instance ID (null for forks/imports)
  status: VariantStatus; // Generation lifecycle status
  error_message: string | null; // Error details when status='failed'
  image_key: string | null; // R2 key, null until generation completes
  thumb_key: string | null; // R2 key for thumbnail, null until generation completes
  media_key: string | null; // Canonical R2 key for the primary media artifact
  media_mime_type: string | null; // MIME type for the primary media artifact
  media_size_bytes: number | null; // Byte size for the primary media artifact
  media_width: number | null; // Pixel width for image/video artifacts
  media_height: number | null; // Pixel height for image/video artifacts
  media_duration_ms: number | null; // Duration for time-based media artifacts
  transcript_key: string | null; // R2 key for audio transcript sidecar
  transcript_mime_type: string | null;
  transcript_size_bytes: number | null;
  word_timings_key: string | null; // R2 key for word-level timing sidecar
  word_timings_mime_type: string | null;
  word_timings_size_bytes: number | null;
  render_metadata_key: string | null; // R2 key for render metadata sidecar
  render_metadata_mime_type: string | null;
  render_metadata_size_bytes: number | null;
  generation_provenance: string | null; // JSON - normalized generation inputs/source refs
  provider_metadata: string | null; // JSON - provider/model/result metadata
  recipe: string; // JSON - generation parameters stored upfront for retry
  starred: boolean; // User marks important versions
  created_by: string;
  created_at: number;
  updated_at: number | null; // Track status changes
  plan_step_id: string | null; // If this variant was created by a plan step
  description: string | null; // Cached AI-generated description for vision-aware enhancement
  batch_id: string | null; // Batch generation group ID
  quality_rating: 'approved' | 'rejected' | null; // Curation rating for training data
  rated_at: number | null; // Timestamp of rating
  deleted_at: number | null;
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
  deleted_at: number | null;
}

export interface RotationView {
  id: string;
  rotation_set_id: string;
  variant_id: string;
  direction: string;
  step_index: number;
  created_at: number;
  deleted_at: number | null;
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
  deleted_at: number | null;
}

export type TilePositionStatus = 'pending' | 'generating' | 'completed' | 'failed';

export interface TilePosition {
  id: string;
  tile_set_id: string;
  variant_id: string;
  grid_x: number;
  grid_y: number;
  status: TilePositionStatus;
  created_at: number;
  deleted_at: number | null;
}

/**
 * ProductionRecord - Timeline placement metadata for downstream production tools.
 */
export interface ProductionRecord {
  id: string;
  production_id: string;
  variant_id: string;
  asset_id: string;
  media_kind: MediaKind;
  shot_id: string | null;
  scene_label: string;
  timeline_start_ms: number;
  duration_ms: number | null;
  motion_prompt: string | null;
  source_refs: string; // JSON string[]
  source_variant_ids: string; // JSON string[]
  metadata: string; // JSON object
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface Production {
  id: string;
  name: string;
  description: string | null;
  metadata: string; // JSON object
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface ProductionShot {
  id: string;
  production_id: string;
  shot_id: string | null;
  label: string;
  timeline_start_ms: number;
  duration_ms: number | null;
  metadata: string; // JSON object
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export type ProductionCueType = 'music' | 'sfx' | 'dialogue' | 'ambience' | 'custom';

export interface ProductionCue {
  id: string;
  production_id: string;
  cue_type: ProductionCueType;
  label: string;
  timeline_start_ms: number;
  duration_ms: number | null;
  metadata: string; // JSON object
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export type ProductionPlacementTargetKind = 'shot' | 'cue';

export interface ProductionPlacement {
  id: string;
  production_id: string;
  target_kind: ProductionPlacementTargetKind;
  target_id: string;
  variant_id: string;
  asset_id: string;
  media_kind: MediaKind;
  role: string | null;
  source_refs: string; // JSON string[]
  source_variant_ids: string; // JSON string[]
  metadata: string; // JSON object
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export type SpaceSubjectType = 'asset' | 'variant';

export type CollectionKind =
  | 'cast'
  | 'style_refs'
  | 'backgrounds'
  | 'scenes'
  | 'thumbnails'
  | 'maps'
  | 'deliverables'
  | 'custom';

export type SpaceRelationType =
  | 'appears_in'
  | 'background_for'
  | 'style_reference_for'
  | 'thumbnail_for'
  | 'alternate_of'
  | 'prop_in'
  | 'map_for'
  | 'part_of'
  | 'reference_for'
  | 'custom';

export type CompositionItemRole =
  | 'output'
  | 'background'
  | 'character'
  | 'prop'
  | 'style_ref'
  | 'overlay'
  | 'map'
  | 'thumbnail'
  | 'custom';

export type CompositionStatus = 'draft' | 'final';

export interface SpaceCollection {
  id: string;
  name: string;
  kind: CollectionKind;
  color: string | null;
  description: string | null;
  sort_index: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface CollectionItem {
  id: string;
  collection_id: string;
  subject_type: SpaceSubjectType;
  asset_id: string | null;
  variant_id: string | null;
  role: string;
  pinned_variant_id: string | null;
  sort_index: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface StylePreset {
  id: string;
  name: string;
  description: string | null;
  style_prompt: string;
  collection_id: string | null;
  enabled: number;
  is_default: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface StyleReferenceCollectionPreview extends SpaceCollection {
  reference_count: number;
  preset_count: number;
}

export interface StylePresetPreview extends StylePreset {
  collection_name: string | null;
  reference_count: number;
  style_reference_variant_ids: string[];
  style_reference_image_keys: string[];
}

export interface SpaceRelation {
  id: string;
  subject_type: SpaceSubjectType;
  subject_asset_id: string | null;
  subject_variant_id: string | null;
  object_type: SpaceSubjectType;
  object_asset_id: string | null;
  object_variant_id: string | null;
  relation_type: SpaceRelationType;
  label: string | null;
  context: string | null;
  metadata: string;
  sort_index: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface Composition {
  id: string;
  name: string;
  description: string | null;
  status: CompositionStatus;
  output_asset_id: string | null;
  output_variant_id: string | null;
  metadata: string;
  sort_index: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface CompositionItem {
  id: string;
  composition_id: string;
  role: CompositionItemRole;
  label: string | null;
  asset_id: string | null;
  variant_id: string;
  metadata: string;
  sort_index: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface SpaceCollectionOverview {
  id: string;
  name: string;
  kind: CollectionKind;
  color: string | null;
  description: string | null;
  sort_index: number;
  item_count: number;
  created_at: number;
  updated_at: number;
}

export interface CompositionOverview {
  id: string;
  name: string;
  description: string | null;
  status: CompositionStatus;
  output_asset_id: string | null;
  output_variant_id: string | null;
  sort_index: number;
  item_count: number;
  created_at: number;
  updated_at: number;
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
  /** Unique WebSocket connection/session ID. Distinct from user presence. */
  clientSessionId?: string;
}

/**
 * Presence data for a user - tracks the user's most recent active view.
 */
export interface UserPresence {
  userId: string;
  viewing: string | null; // Asset ID being viewed
  lastSeen: number;
}

/**
 * In-memory presence for one WebSocket client session.
 * Multiple client sessions can aggregate into a single UserPresence.
 */
export interface ClientSessionPresence {
  clientSessionId: string;
  userId: string;
  viewing: string | null;
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
  | { type: 'sync:overview' }
  // Asset operations
  | { type: 'asset:create'; name: string; assetType: string; mediaKind?: MediaKind }
  | { type: 'asset:update'; assetId: string; changes: { name?: string; tags?: string[]; type?: string } }
  | { type: 'asset:delete'; assetId: string }
  | { type: 'asset:setActive'; assetId: string; variantId: string }
  | { type: 'asset:fork'; sourceAssetId?: string; sourceVariantId?: string; name: string; assetType: string; mediaKind?: MediaKind; collectionPlacements?: CollectionPlacementInput[] }
  // Manual organization operations
  | { type: 'collection:create'; id?: string; name: string; kind?: CollectionKind; color?: string | null; description?: string | null; sortIndex?: number }
  | { type: 'collection:update'; collectionId: string; changes: { name?: string; kind?: CollectionKind; color?: string | null; description?: string | null; sortIndex?: number } }
  | { type: 'collection:delete'; collectionId: string }
  | { type: 'collection_item:create'; collectionId: string; id?: string; subjectType: SpaceSubjectType; assetId?: string; variantId?: string; role?: string; pinnedVariantId?: string | null; sortIndex?: number }
  | { type: 'collection_item:update'; collectionId: string; itemId: string; changes: { role?: string; pinnedVariantId?: string | null; sortIndex?: number } }
  | { type: 'collection_items:reorder'; collectionId: string; itemIds: string[] }
  | { type: 'collection_item:delete'; collectionId: string; itemId: string }
  | { type: 'relation:create'; id?: string; subject: { subjectType: SpaceSubjectType; assetId?: string; variantId?: string }; object: { subjectType: SpaceSubjectType; assetId?: string; variantId?: string }; relationType: SpaceRelationType; label?: string | null; context?: string | Record<string, unknown> | null; metadata?: Record<string, unknown>; sortIndex?: number }
  | { type: 'relation:update'; relationId: string; changes: { relationType?: SpaceRelationType; label?: string | null; context?: string | Record<string, unknown> | null; metadata?: Record<string, unknown>; sortIndex?: number } }
  | { type: 'relation:delete'; relationId: string }
  | { type: 'composition:create'; id?: string; name: string; description?: string | null; status?: CompositionStatus; outputAssetId?: string | null; outputVariantId?: string | null; metadata?: Record<string, unknown>; sortIndex?: number }
  | { type: 'composition:update'; compositionId: string; changes: { name?: string; description?: string | null; status?: CompositionStatus; outputAssetId?: string | null; outputVariantId?: string | null; metadata?: Record<string, unknown>; sortIndex?: number } }
  | { type: 'composition:delete'; compositionId: string }
  | { type: 'composition_item:create'; compositionId: string; id?: string; role: CompositionItemRole; label?: string | null; assetId?: string | null; variantId: string; metadata?: Record<string, unknown>; sortIndex?: number }
  | { type: 'composition_item:update'; compositionId: string; itemId: string; changes: { role?: CompositionItemRole; label?: string | null; assetId?: string | null; variantId?: string; metadata?: Record<string, unknown>; sortIndex?: number } }
  | { type: 'composition_items:reorder'; compositionId: string; itemIds: string[] }
  | { type: 'composition_item:delete'; compositionId: string; itemId: string }
  // Variant operations
  | { type: 'variant:delete'; variantId: string }
  | { type: 'variant:star'; variantId: string; starred: boolean }
  | { type: 'variant:retry'; variantId: string }
  | { type: 'variant:regenerate'; variantId: string }
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
  | GenerationEstimateRequestMessage
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
  // Asset-backed style preset messages
  | { type: 'style_preset:create'; id?: string; name: string; description?: string | null; stylePrompt?: string; collectionId?: string | null; enabled?: boolean; isDefault?: boolean }
  | { type: 'style_preset:update'; presetId: string; changes: { name?: string; description?: string | null; stylePrompt?: string; collectionId?: string | null; enabled?: boolean; isDefault?: boolean } }
  | { type: 'style_preset:delete'; presetId: string }
  // Batch generation messages
  | BatchRequestMessage
  // Rotation pipeline messages
  | { type: 'rotation:request'; requestId: string; sourceVariantId: string; config: RotationConfig; subjectDescription?: string; aspectRatio?: string; disableStyle?: boolean; generationMode?: 'sequential' | 'single-shot' }
  | { type: 'rotation:cancel'; rotationSetId: string }
  // Tile pipeline messages
  | { type: 'tileset:request'; requestId: string; tileType: TileType; gridWidth: number; gridHeight: number; prompt: string; seedVariantId?: string; aspectRatio?: string; disableStyle?: boolean; generationMode?: 'sequential' | 'single-shot' }
  | { type: 'tileset:cancel'; tileSetId: string }
  | { type: 'tileset:retry_tile'; tileSetId: string; gridX: number; gridY: number }
  | { type: 'tileset:refine_edges'; tileSetId: string }
  | { type: 'tileset:refine_tile'; tileSetId: string; gridX: number; gridY: number }
  // Variant quality rating
  | { type: 'variant:rate'; variantId: string; rating: 'approved' | 'rejected' };

// ============================================================================
// Message Types (Server → Client)
// ============================================================================

/**
 * All messages that can be sent from server to client via WebSocket
 */
export type ServerMessage =
  // Sync (full state)
  | { type: 'sync:state'; assets: Asset[]; variants: Variant[]; lineage: Lineage[]; presence: UserPresence[]; rotationSets?: RotationSet[]; rotationViews?: RotationView[]; tileSets?: TileSet[]; tilePositions?: TilePosition[]; stylePresets?: StylePresetPreview[]; styleReferenceCollections?: StyleReferenceCollectionPreview[]; collections?: SpaceCollection[]; collectionItems?: CollectionItem[]; relations?: SpaceRelation[]; compositions?: Composition[]; compositionItems?: CompositionItem[] }
  | { type: 'sync:overview'; assets: Asset[]; variants: Variant[]; presence: UserPresence[]; rotationSets?: RotationSet[]; rotationViews?: RotationView[]; tileSets?: TileSet[]; tilePositions?: TilePosition[]; stylePresets?: StylePresetPreview[]; styleReferenceCollections?: StyleReferenceCollectionPreview[]; collections?: SpaceCollectionOverview[]; collectionItems?: CollectionItem[]; compositions?: CompositionOverview[] }
  // TODO: sync:chat_state is currently unused - chat history is loaded via REST API instead.
  // Consider implementing for WebSocket reconnection state recovery.
  // | { type: 'sync:chat_state'; messages: ChatMessage[]; plan: Plan | null; planSteps: PlanStep[]; approvals: PendingApproval[]; autoExecuted: AutoExecuted[] }
  // Asset mutations
  | { type: 'asset:created'; asset: Asset }
  | { type: 'asset:updated'; asset: Asset }
  | { type: 'asset:deleted'; assetId: string }
  | { type: 'asset:forked'; asset: Asset; variant: Variant; lineage: Lineage }
  // Manual organization mutations
  | { type: 'collection:created'; collection: SpaceCollection }
  | { type: 'collection:updated'; collection: SpaceCollection }
  | { type: 'collection:deleted'; collectionId: string }
  | { type: 'collection_item:created'; item: CollectionItem }
  | { type: 'collection_item:updated'; item: CollectionItem }
  | { type: 'collection_items:reordered'; collectionId: string; items: CollectionItem[] }
  | { type: 'collection_item:deleted'; collectionId: string; itemId: string }
  | { type: 'relation:created'; relation: SpaceRelation }
  | { type: 'relation:updated'; relation: SpaceRelation }
  | { type: 'relation:deleted'; relationId: string }
  | { type: 'composition:created'; composition: Composition }
  | { type: 'composition:updated'; composition: Composition }
  | { type: 'composition:deleted'; compositionId: string }
  | { type: 'composition_item:created'; item: CompositionItem }
  | { type: 'composition_item:updated'; item: CompositionItem }
  | { type: 'composition_items:reordered'; compositionId: string; items: CompositionItem[] }
  | { type: 'composition_item:deleted'; compositionId: string; itemId: string }
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
  | { type: 'generation:estimate'; requestId: string; success: true; estimate: GenerationUsageEstimate }
  | { type: 'generation:estimate'; requestId: string; success: false; error: string; code: ErrorCode }
  | { type: 'chat:response'; requestId: string; success: boolean; response?: unknown; error?: string; deferredActions?: DeferredAction[] }
  | { type: 'generate:started'; requestId: string; jobId: string; assetId: string; assetName: string; prompt?: string }
  | { type: 'generate:result'; requestId: string; jobId: string; success: boolean; variant?: Variant; error?: string }
  | { type: 'refine:started'; requestId: string; jobId: string; assetId: string; assetName: string; prompt?: string }
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
  // Asset-backed style preset messages
  | { type: 'style_preset:created'; preset: StylePresetPreview }
  | { type: 'style_preset:updated'; preset: StylePresetPreview }
  | { type: 'style_preset:deleted'; presetId: string }
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
  | { type: 'tileset:tile_failed'; tileSetId: string; variantId: string; gridX: number; gridY: number; error: string }
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
  active_variant_id?: string | null;
}

/**
 * Input for creating a new asset
 */
export interface CreateAssetInput {
  id?: string;
  name: string;
  type: string;
  mediaKind?: MediaKind;
  createdBy: string;
}

/**
 * Input for forking an asset from a variant
 */
export interface ForkAssetInput {
  sourceVariantId: string;
  name: string;
  type: string;
  mediaKind?: MediaKind;
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
