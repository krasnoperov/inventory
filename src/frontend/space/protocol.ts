import type {
  DescribeFocus,
  ClaudeUsage,
  CollectionPlacementInput,
  GenerationEstimateOperation,
  GenerationUsageEstimate,
  MediaKind,
  MusicGenerationProvider,
  SimplePlan,
} from '../../shared/websocket-types';
import type {
  VideoGenerationDurationSeconds,
  VideoGenerationResolution,
  VideoGenerationTier,
} from '../../shared/videoGenerationOptions';
import { getR2ImageUrl } from '../media-cdn';

// Asset and Variant types based on DO SQLite schema
export interface Asset {
  id: string;
  name: string;
  type: string;  // User-editable: character, item, scene, sprite-sheet, animation, style-sheet, reference, etc.
  media_kind: MediaKind;
  tags: string;
  parent_asset_id: string | null;  // Legacy compatibility field; not writable organization state
  active_variant_id: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

/** Variant status for placeholder lifecycle */
export type VariantStatus = 'pending' | 'processing' | 'uploading' | 'completed' | 'failed';

export interface Variant {
  id: string;
  asset_id: string;
  media_kind: MediaKind;
  workflow_id: string | null;  // Cloudflare workflow ID
  status: VariantStatus;
  error_message: string | null;  // Error details when status='failed'
  image_key: string | null;  // NULL until generation completes
  thumb_key: string | null;  // NULL until generation completes
  media_key: string | null;  // Canonical primary media key
  media_mime_type: string | null;
  media_size_bytes: number | null;
  media_width: number | null;
  media_height: number | null;
  media_duration_ms: number | null;
  transcript_key?: string | null;
  transcript_mime_type?: string | null;
  transcript_size_bytes?: number | null;
  word_timings_key?: string | null;
  word_timings_mime_type?: string | null;
  word_timings_size_bytes?: number | null;
  render_metadata_key?: string | null;
  render_metadata_mime_type?: string | null;
  render_metadata_size_bytes?: number | null;
  generation_provenance?: string | null;
  provider_metadata?: string | null;
  recipe: string;
  starred: boolean;  // User marks important versions
  created_by: string;
  created_at: number;
  updated_at: number | null;  // Track status changes
  description: string | null;  // Cached AI-generated description for vision-aware enhancement
  quality_rating?: 'approved' | 'rejected' | null;  // Curation rating for training data
  rated_at?: number | null;  // Timestamp of rating
}

/**
 * Get image thumbnail URL for a variant, returning undefined for non-image media.
 */
export function getVariantThumbnailUrl(variant: Variant): string | undefined {
  if (!variant.image_key) return undefined;
  const key = variant.thumb_key || variant.image_key;
  return getR2ImageUrl(key);
}

/**
 * Get the canonical media URL for downloads and media-specific rendering.
 * Prefer the authenticated variant media route when the caller has space context.
 */
export function getVariantMediaUrl(variant: Variant, spaceId?: string): string | undefined {
  if (!variant.media_key && !variant.image_key) return undefined;
  if (spaceId) {
    return `/api/spaces/${spaceId}/variants/${variant.id}/media`;
  }
  return getR2ImageUrl(variant.media_key || variant.image_key || '');
}

/**
 * Pick the image URL to render for a variant.
 *
 * With `fullResolution`, image-ready variants prefer the authenticated
 * full-size media so the image stays sharp when zoomed past the thumbnail's
 * 512px pixels; it falls back to the thumbnail when full-res isn't available
 * (no media URL) or the variant isn't an image. Without `fullResolution` it
 * always returns the lightweight thumbnail.
 */
export function getVariantDisplayImageUrl(
  variant: Variant,
  options?: { fullResolution?: boolean; spaceId?: string },
): string | undefined {
  if (options?.fullResolution && isVariantImageReady(variant)) {
    const mediaUrl = getVariantMediaUrl(variant, options.spaceId);
    if (mediaUrl) return mediaUrl;
  }
  return getVariantThumbnailUrl(variant);
}

/**
 * Check if a variant is ready to display.
 */
export function isVariantReady(variant: Variant): boolean {
  return variant.status === 'completed' && (variant.media_key !== null || variant.image_key !== null);
}

/**
 * Check if a variant has a completed image artifact for image-only tools.
 */
export function isVariantImageReady(variant: Variant): boolean {
  return variant.status === 'completed' && variant.image_key !== null;
}

/**
 * Check if a variant has a completed audio artifact for browser preview.
 */
export function isVariantAudioReady(variant: Variant): boolean {
  return variant.status === 'completed' && variant.media_kind === 'audio' && variant.media_key !== null;
}

/**
 * Check if a variant can be used as a Forge Tray reference.
 */
export function isVariantForgeTrayReady(variant: Variant): boolean {
  if (variant.media_kind === 'audio') {
    return isVariantAudioReady(variant);
  }
  if (variant.media_kind === 'video') {
    return isVariantVideoReady(variant);
  }
  return isVariantImageReady(variant);
}

/**
 * Check if a variant has a completed video artifact for native playback.
 */
export function isVariantVideoReady(variant: Variant): boolean {
  return variant.status === 'completed' && variant.media_kind === 'video' && variant.media_key !== null;
}

/**
 * Check if a variant is in a loading state
 */
export function isVariantLoading(variant: Variant): boolean {
  return variant.status === 'pending' || variant.status === 'processing' || variant.status === 'uploading';
}

/**
 * Check if a variant failed and can be retried
 */
export function isVariantFailed(variant: Variant): boolean {
  return variant.status === 'failed';
}

export interface Lineage {
  id: string;
  parent_variant_id: string;
  child_variant_id: string;
  relation_type: 'derived' | 'refined' | 'forked';
  severed: boolean;  // User can cut the historical link
  created_at: number;
}

export type SpaceSubjectType = 'asset' | 'variant';

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

export interface SpaceSubject {
  subjectType: SpaceSubjectType;
  assetId?: string;
  variantId?: string;
}

export interface SpaceRelationContext {
  label?: string;
  context?: string;
  notes?: string;
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
  context: string | null;
  sort_index: number;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export type CollectionKind =
  | 'cast'
  | 'style_refs'
  | 'backgrounds'
  | 'scenes'
  | 'thumbnails'
  | 'maps'
  | 'deliverables'
  | 'custom';

export interface SpaceCollection {
  id: string;
  name: string;
  kind: CollectionKind;
  color: string | null;
  description: string | null;
  sort_index: number;
  item_count?: number;
  created_by?: string;
  created_at: number;
  updated_at: number;
}

export interface CollectionItem {
  id: string;
  collection_id: string;
  subject_type: 'asset' | 'variant';
  asset_id: string | null;
  variant_id: string | null;
  role: string;
  pinned_variant_id: string | null;
  sort_index: number;
  created_by: string;
  created_at: number;
  updated_at: number;
}

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

export interface CompositionItem {
  id: string;
  composition_id: string;
  role: CompositionItemRole;
  asset_id: string | null;
  variant_id: string;
  metadata: string;
  sort_index: number;
  created_by: string;
  created_at: number;
  updated_at: number;
}

// Rotation & Tile Set types

export type RotationConfig = '4-directional' | '8-directional' | 'turnaround';
export type TileType = 'terrain' | 'building' | 'decoration' | 'custom';

export interface RotationSet {
  id: string;
  asset_id: string;
  source_variant_id: string;
  config: string;
  status: 'pending' | 'generating' | 'completed' | 'failed' | 'cancelled';
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

export interface TileSet {
  id: string;
  asset_id: string;
  tile_type: TileType;
  grid_width: number;
  grid_height: number;
  status: 'pending' | 'generating' | 'completed' | 'failed' | 'cancelled';
  seed_variant_id: string | null;
  config: string;
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
  status?: 'pending' | 'generating' | 'completed' | 'failed';
  created_at: number;
}

// Rotation/Tile request params

export interface RotationRequestParams {
  sourceVariantId: string;
  config: RotationConfig;
  subjectDescription?: string;
  aspectRatio?: string;
  disableStyle?: boolean;
  stylePresetId?: string;
  styleVariantIds?: string[];
}

export interface TileSetRequestParams {
  tileType: TileType;
  gridWidth: number;
  gridHeight: number;
  prompt: string;
  seedVariantId?: string;
  aspectRatio?: string;
  disableStyle?: boolean;
  stylePresetId?: string;
  styleVariantIds?: string[];
  generationMode?: 'sequential' | 'single-shot';
}

export interface RotationRequestParamsExtended extends RotationRequestParams {
  generationMode?: 'sequential' | 'single-shot';
}

export interface UserPresence {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  viewing?: string;  // Asset ID currently viewing, or null for catalog
  lastSeen: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  content: string;
  role: 'user' | 'assistant';
  createdAt: number;
}

/** Chat message in client format (from persistent chat) */
export interface ChatMessageClient {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  suggestedPrompt?: string;
  descriptions?: Array<{ variantId: string; assetName: string; description: string; cached: boolean }>;
}

/** Forge context sent with chat messages */
export interface ChatForgeContext {
  prompt: string;
  slotVariantIds: string[];
}

// Bot response type from Claude
export interface BotResponse {
  type: 'advice' | 'action' | 'clarification' | 'rejection';
  message?: string;
  actions?: Array<{
    type: string;
    params: Record<string, unknown>;
    explanation?: string;
  }>;
}

// Plan types - import from shared module and re-export (single source of truth)
import type { PlanStatus, PlanStepStatus } from '../../shared/websocket-types';
export type { PlanStatus, PlanStepStatus };

export interface Plan {
  id: string;
  goal: string;
  status: PlanStatus;
  current_step_index: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  auto_advance: boolean;
  max_parallel: number;
  active_step_count: number;
}

export interface PlanStep {
  id: string;
  plan_id: string;
  step_index: number;
  description: string;
  action: string;
  params: string; // JSON
  status: PlanStepStatus;
  result: string | null;
  error: string | null;
  created_at: number;
  updated_at: number | null;
  depends_on: string | null; // JSON array of step IDs
}

// Approval types (synced from backend)
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

export interface PendingApproval {
  id: string;
  request_id: string;
  plan_id: string | null;
  plan_step_id: string | null;
  tool: string;
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

// Auto-executed tool result
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

// User session (for CLI stateless mode)
export interface UserSession {
  user_id: string;
  viewing_asset_id: string | null;
  viewing_variant_id: string | null;
  forge_context: string | null;
  active_chat_session_id: string | null;
  last_seen: number;
  updated_at: number;
}

// Chat session (conversation thread)
export interface ChatSession {
  id: string;
  title: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

// Forge and Viewing context - import from shared module and re-export
import type { ForgeContext, ViewingContext } from '../../shared/websocket-types';
export type { ForgeContext, ViewingContext };

// Chat request parameters
export interface ChatRequestParams {
  message: string;
  mode: 'advisor' | 'actor';
  forgeContext?: ForgeContext;
  viewingContext?: ViewingContext;
}

// Generate request parameters
export interface GenerateRequestParams {
  name: string;
  assetType: string;
  mediaKind?: MediaKind;
  prompt?: string;
  /** Asset-level references - backend resolves to default variants */
  referenceAssetIds?: string[];
  /** Explicit variant references from ForgeTray UI - used as-is */
  referenceVariantIds?: string[];
  /** Image model selection (`pro`/`flash`) or resolved model ID */
  model?: string;
  aspectRatio?: string;
  /** Image output size (`1K`, `2K`, `4K`) */
  imageSize?: string;
  /** Disable style anchoring */
  disableStyle?: boolean;
  /** Named asset-backed style preset to apply */
  stylePresetId?: string;
  /** Exact style reference variants for this request */
  styleVariantIds?: string[];
  /** ElevenLabs speech voice ID (audio modes only) */
  voiceId?: string;
  /** ElevenLabs dialogue voice IDs, ordered by speaker (audio modes only) */
  dialogueVoiceIds?: string[];
  /** Music provider selection (music mode only) */
  musicProvider?: MusicGenerationProvider;
  /** Whether Veo should generate native synchronized audio (video assets only) */
  generateAudio?: boolean;
  /** Veo output resolution (video assets only) */
  videoResolution?: VideoGenerationResolution;
  /** Veo output duration in seconds (video assets only) */
  videoDurationSeconds?: VideoGenerationDurationSeconds;
  /** Veo model tier (video assets only) */
  videoTier?: VideoGenerationTier;
  collectionPlacements?: CollectionPlacementInput[];
}

// Refine request parameters
export interface RefineRequestParams {
  assetId: string;
  mediaKind?: MediaKind;
  prompt: string;
  /** Single source variant (legacy, for simple refine) */
  sourceVariantId?: string;
  /** Multiple source variants from ForgeTray (for combine into existing asset) */
  sourceVariantIds?: string[];
  /** Asset-level references - backend resolves to default variants */
  referenceAssetIds?: string[];
  /** Image model selection (`pro`/`flash`) or resolved model ID */
  model?: string;
  aspectRatio?: string;
  /** Image output size (`1K`, `2K`, `4K`) */
  imageSize?: string;
  /** Disable style anchoring */
  disableStyle?: boolean;
  /** Named asset-backed style preset to apply */
  stylePresetId?: string;
  /** Exact style reference variants for this request */
  styleVariantIds?: string[];
  /** ElevenLabs speech voice ID (audio modes only) */
  voiceId?: string;
  /** ElevenLabs dialogue voice IDs, ordered by speaker (audio modes only) */
  dialogueVoiceIds?: string[];
  /** Music provider selection (music mode only) */
  musicProvider?: MusicGenerationProvider;
  /** Whether Veo should generate native synchronized audio (video assets only) */
  generateAudio?: boolean;
  /** Veo output resolution (video assets only) */
  videoResolution?: VideoGenerationResolution;
  /** Veo output duration in seconds (video assets only) */
  videoDurationSeconds?: VideoGenerationDurationSeconds;
  /** Veo model tier (video assets only) */
  videoTier?: VideoGenerationTier;
  collectionPlacements?: CollectionPlacementInput[];
}

// Batch request parameters
export type BatchMode = 'explore' | 'set';

export interface BatchRequestParams {
  name: string;
  assetType: string;
  mediaKind?: MediaKind;
  prompt?: string;
  count: number;
  mode: BatchMode;
  referenceAssetIds?: string[];
  referenceVariantIds?: string[];
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  disableStyle?: boolean;
  stylePresetId?: string;
  styleVariantIds?: string[];
  /** ElevenLabs speech voice ID (audio modes only) */
  voiceId?: string;
  /** ElevenLabs dialogue voice IDs, ordered by speaker (audio modes only) */
  dialogueVoiceIds?: string[];
  /** Music provider selection (music mode only) */
  musicProvider?: MusicGenerationProvider;
}

export interface GenerationEstimateRequestParams {
  operation: GenerationEstimateOperation;
  assetId?: string;
  assetType?: string;
  mediaKind?: MediaKind;
  prompt?: string;
  count?: number;
  model?: string;
  imageSize?: string;
  musicProvider?: MusicGenerationProvider;
  generateAudio?: boolean;
  videoResolution?: VideoGenerationResolution;
  videoDurationSeconds?: VideoGenerationDurationSeconds;
  videoTier?: VideoGenerationTier;
}

export interface GenerationEstimateResult {
  requestId: string;
  success: boolean;
  estimate?: GenerationUsageEstimate;
  error?: string;
  code?: string;
}

export interface StyleReferenceCollectionRaw {
  id: string;
  name: string;
  description: string | null;
  sort_index: number;
  created_by: string;
  created_at: number;
  updated_at: number;
  reference_count: number;
  preset_count: number;
}

export interface StylePresetRaw {
  id: string;
  name: string;
  description: string | null;
  style_prompt: string;
  collection_id: string | null;
  enabled: number | boolean;
  is_default: number | boolean;
  created_by: string;
  created_at: number;
  updated_at: number;
  collection_name: string | null;
  reference_count: number;
  style_reference_variant_ids: string[];
  style_reference_image_keys: string[];
}

export interface StylePresetCreateParams {
  id?: string;
  name: string;
  description?: string | null;
  stylePrompt?: string;
  collectionId?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
}

export interface StylePresetUpdateParams {
  name?: string;
  description?: string | null;
  stylePrompt?: string;
  collectionId?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
}

// Batch started event
export interface BatchStartedResult {
  requestId: string;
  batchId: string;
  jobIds: string[];
  assetIds: string[];
  count: number;
  mode: BatchMode;
}

// Batch progress event
export interface BatchProgressResult {
  batchId: string;
  completedCount: number;
  failedCount: number;
  totalCount: number;
  variant: Variant;
}

// Batch completed event
export interface BatchCompletedResult {
  batchId: string;
  completedCount: number;
  failedCount: number;
  totalCount: number;
}

// Re-export shared types
export type { DescribeFocus, ClaudeUsage, SimplePlan } from '../../shared/websocket-types';

// Describe image request parameters
export interface DescribeRequestParams {
  assetId: string;
  variantId: string;
  assetName: string;
  focus?: DescribeFocus;
  question?: string;
}

// Compare images request parameters
export interface CompareRequestParams {
  variantIds: string[];
  aspects?: string[];
}

// Auto-describe request parameters (lazy description caching)
export interface AutoDescribeRequestParams {
  variantId: string;
}

export interface CollectionCreateParams {
  id?: string;
  name: string;
  kind?: CollectionKind;
  color?: string | null;
  description?: string | null;
  sortIndex?: number;
}

export interface CollectionUpdateParams {
  name?: string;
  kind?: CollectionKind;
  color?: string | null;
  description?: string | null;
  sortIndex?: number;
}

export interface CollectionItemCreateParams {
  id?: string;
  collectionId: string;
  subjectType: 'asset' | 'variant';
  assetId?: string;
  variantId?: string;
  role?: string;
  pinnedVariantId?: string | null;
  sortIndex?: number;
}

export interface CollectionItemUpdateParams {
  role?: string;
  pinnedVariantId?: string | null;
  sortIndex?: number;
}

export interface CompositionCreateParams {
  id?: string;
  name: string;
  description?: string | null;
  status?: CompositionStatus;
  outputAssetId?: string | null;
  outputVariantId?: string | null;
  metadata?: Record<string, unknown>;
  sortIndex?: number;
}

export interface CompositionUpdateParams {
  name?: string;
  description?: string | null;
  status?: CompositionStatus;
  outputAssetId?: string | null;
  outputVariantId?: string | null;
  metadata?: Record<string, unknown>;
  sortIndex?: number;
}

export interface CompositionItemCreateParams {
  id?: string;
  role: CompositionItemRole;
  assetId?: string | null;
  variantId: string;
  metadata?: Record<string, unknown>;
  sortIndex?: number;
}

export interface CompositionItemUpdateParams {
  role?: CompositionItemRole;
  assetId?: string | null;
  variantId?: string;
  metadata?: Record<string, unknown>;
  sortIndex?: number;
}

// Deferred action from agentic loop (tray operations)
export interface DeferredAction {
  tool: string;
  params: Record<string, unknown>;
  acknowledgment: string;
}

// Chat response from workflow
export interface ChatResponseResult {
  requestId: string;
  success: boolean;
  response?: BotResponse;
  error?: string;
  deferredActions?: DeferredAction[];
}

// Describe response from server
export interface DescribeResponseResult {
  requestId: string;
  success: boolean;
  description?: string;
  error?: string;
  usage?: ClaudeUsage;
}

// Compare response from server
export interface CompareResponseResult {
  requestId: string;
  success: boolean;
  comparison?: string;
  error?: string;
  usage?: ClaudeUsage;
}

// Auto-describe response from server
export interface AutoDescribeResponseResult {
  requestId: string;
  variantId: string;
  success: boolean;
  description?: string;
  error?: string;
}

// ForgeChat progress update (description phase)
export interface ForgeChatProgressResult {
  requestId: string;
  phase: 'describing';
  variantId: string;
  assetName: string;
  status: 'started' | 'completed' | 'cached';
  description?: string;
  index: number;
  total: number;
}

// Chat progress update (agentic loop tool execution)
export interface ChatProgressResult {
  requestId: string;
  toolName: string;
  toolParams: Record<string, unknown>;
  status: 'executing' | 'complete' | 'failed';
  result?: string;
  error?: string;
}

// WebSocket connection parameters
export interface UseSpaceWebSocketParams {
  spaceId: string;
  syncMode?: 'overview' | 'full';
  requestChatHistoryOnConnect?: boolean;
  sessionUpdateOnConnect?: { viewingAssetId?: string | null; viewingVariantId?: string | null; forgeContext?: string | null };
  onConnect?: () => void;
  onDisconnect?: () => void;
  onJobComplete?: (job: JobStatus, variant: Variant) => void;
  onChatMessage?: (message: ChatMessage) => void;
  onChatResponse?: (response: ChatResponseResult) => void;
  onChatProgress?: (progress: ChatProgressResult) => void;
  onGenerateStarted?: (data: { requestId: string; jobId: string; assetId: string; assetName: string; prompt?: string }) => void;
  onGenerateResult?: (data: { requestId: string; jobId: string; success: boolean; variant?: Variant; error?: string }) => void;
  onDescribeResponse?: (response: DescribeResponseResult) => void;
  onCompareResponse?: (response: CompareResponseResult) => void;
  // Approval lifecycle callbacks
  onApprovalCreated?: (approval: PendingApproval) => void;
  onApprovalUpdated?: (approval: PendingApproval) => void;
  onApprovalList?: (approvals: PendingApproval[]) => void;
  // Auto-executed callback
  onAutoExecuted?: (autoExecuted: AutoExecuted) => void;
  // Session state callback
  onSessionState?: (session: UserSession | null) => void;
  // Persistent chat history callback (WebSocket-based)
  onChatHistory?: (messages: ChatMessageClient[], sessionId: string | null) => void;
  // Persistent chat message callback (new message received)
  onPersistentChatMessage?: (message: ChatMessageClient) => void;
  // Persistent chat progress callback (description phase)
  onPersistentChatProgress?: (progress: ForgeChatProgressResult) => void;
  // Chat session created callback
  onSessionCreated?: (session: ChatSession) => void;
  // SimplePlan callbacks
  onPlanUpdated?: (plan: SimplePlan) => void;
  onPlanArchived?: (planId: string) => void;
  // Batch callbacks
  onBatchStarted?: (data: BatchStartedResult) => void;
  onBatchProgress?: (data: BatchProgressResult) => void;
  onBatchCompleted?: (data: BatchCompletedResult) => void;
  onGenerationEstimate?: (data: GenerationEstimateResult) => void;
  // Rotation pipeline callbacks
  onRotationStarted?: (data: { rotationSetId: string; assetId: string; directions: string[]; totalSteps: number }) => void;
  onRotationStepCompleted?: (data: { rotationSetId: string; direction: string; step: number; total: number; variantId: string }) => void;
  onRotationCompleted?: (data: { rotationSetId: string; views: RotationView[] }) => void;
  onRotationFailed?: (data: { rotationSetId: string; error: string; failedStep: number }) => void;
  onRotationCancelled?: (rotationSetId: string) => void;
  // Tile set pipeline callbacks
  onTileSetStarted?: (data: { tileSetId: string; assetId: string; gridWidth: number; gridHeight: number; totalTiles: number }) => void;
  onTileSetTileCompleted?: (data: { tileSetId: string; gridX: number; gridY: number; step: number; total: number; variantId: string }) => void;
  onTileSetCompleted?: (data: { tileSetId: string; positions: TilePosition[] }) => void;
  onTileSetFailed?: (data: { tileSetId: string; error: string; failedStep: number }) => void;
  onTileSetCancelled?: (tileSetId: string) => void;
  // Generation/refine/batch error callbacks
  onGenerateError?: (data: { requestId: string; error: string; code: string }) => void;
  onRefineError?: (data: { requestId: string; error: string; code: string }) => void;
  onBatchError?: (data: { requestId: string; error: string; code: string }) => void;
  // Error callback for WebSocket errors
  onError?: (error: { code: string; message: string }) => void;
}

// Connection status
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

// Job status tracking with context
export interface JobStatus {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  variantId?: string;
  // Context for displaying meaningful job info
  assetId?: string;
  assetName?: string;
  // Operation types (maps to tools, not Gemini API):
  // - 'derive': Create new asset using references as inspiration
  // - 'refine': Add variant to existing asset
  // Note: 'fork' is synchronous copy, doesn't create a job
  operation?: 'derive' | 'refine';
  prompt?: string;
}

// Job context for tracking (used when calling trackJob)
export interface JobContext {
  assetId?: string;
  assetName?: string;
  operation?: 'derive' | 'refine';
  prompt?: string;
}

// Server message types based on ARCHITECTURE.md
export type ServerMessage =
  | { type: 'sync:state'; assets: Asset[]; variants: Variant[]; lineage: Lineage[]; relations?: SpaceRelation[]; collections?: SpaceCollection[]; collectionItems?: CollectionItem[]; compositions?: Composition[]; compositionItems?: CompositionItem[]; presence?: UserPresence[]; rotationSets?: RotationSet[]; rotationViews?: RotationView[]; tileSets?: TileSet[]; tilePositions?: TilePosition[]; stylePresets?: StylePresetRaw[]; styleReferenceCollections?: StyleReferenceCollectionRaw[] }
  | { type: 'sync:overview'; assets: Asset[]; variants: Variant[]; relations?: SpaceRelation[]; collections?: SpaceCollection[]; collectionItems?: CollectionItem[]; compositions?: CompositionOverview[]; presence?: UserPresence[]; rotationSets?: RotationSet[]; rotationViews?: RotationView[]; tileSets?: TileSet[]; tilePositions?: TilePosition[]; stylePresets?: StylePresetRaw[]; styleReferenceCollections?: StyleReferenceCollectionRaw[] }
  | { type: 'asset:created'; asset: Asset }
  | { type: 'asset:updated'; asset: Asset }
  | { type: 'asset:deleted'; assetId: string }
  | { type: 'asset:forked'; asset: Asset; variant: Variant; lineage: Lineage }
  | { type: 'variant:created'; variant: Variant }
  | { type: 'variant:updated'; variant: Variant }
  | { type: 'variant:deleted'; variantId: string }
  | { type: 'lineage:created'; lineage: Lineage }
  | { type: 'lineage:severed'; lineageId: string }
  | { type: 'relation:created'; relation: SpaceRelation }
  | { type: 'relation:updated'; relation: SpaceRelation }
  | { type: 'relation:deleted'; relationId: string }
  | { type: 'collection:created'; collection: SpaceCollection }
  | { type: 'collection:updated'; collection: SpaceCollection }
  | { type: 'collection:deleted'; collectionId: string }
  | { type: 'collection_item:created'; item: CollectionItem }
  | { type: 'collection_item:updated'; item: CollectionItem }
  | { type: 'collection_items:reordered'; collectionId: string; items: CollectionItem[] }
  | { type: 'collection_item:deleted'; collectionId: string; itemId: string }
  | { type: 'composition:created'; composition: Composition }
  | { type: 'composition:updated'; composition: Composition }
  | { type: 'composition:deleted'; compositionId: string }
  | { type: 'composition_item:created'; item: CompositionItem }
  | { type: 'composition_item:updated'; item: CompositionItem }
  | { type: 'composition_items:reordered'; compositionId: string; items: CompositionItem[] }
  | { type: 'composition_item:deleted'; compositionId: string; itemId: string }
  | { type: 'job:progress'; jobId: string; status: string }
  | { type: 'job:completed'; jobId: string; variant: Variant }
  | { type: 'job:failed'; jobId: string; error: string }
  | { type: 'chat:message'; message: ChatMessage | ChatMessageClient }
  | { type: 'presence:update'; presence: UserPresence[] }
  | { type: 'error'; code: string; message: string }
  // Workflow response messages
  | { type: 'chat:response'; requestId: string; success: boolean; response?: BotResponse; error?: string; deferredActions?: DeferredAction[] }
  | { type: 'chat:progress'; requestId: string; toolName: string; toolParams: Record<string, unknown>; status: 'executing' | 'complete' | 'failed'; result?: string; error?: string }
  | { type: 'chat:progress'; requestId: string; phase: 'describing'; variantId: string; assetName: string; status: 'started' | 'completed' | 'cached'; description?: string; index: number; total: number }
  | { type: 'generate:started'; requestId: string; jobId: string; assetId: string; assetName: string; prompt?: string }
  | { type: 'refine:started'; requestId: string; jobId: string; assetId: string; assetName: string; prompt?: string }
  | { type: 'generate:result'; requestId: string; jobId: string; success: boolean; variant?: Variant; error?: string }
  | { type: 'refine:result'; requestId: string; jobId: string; success: boolean; variant?: Variant; error?: string }
  // Vision (describe/compare) response messages
  | { type: 'describe:response'; requestId: string; success: boolean; description?: string; error?: string; usage?: ClaudeUsage }
  | { type: 'compare:response'; requestId: string; success: boolean; comparison?: string; error?: string; usage?: ClaudeUsage }
  // Auto-describe response message
  | { type: 'auto-describe:response'; requestId: string; variantId: string; success: boolean; description?: string; error?: string }
  // SimplePlan messages (markdown-based plan)
  | { type: 'simple_plan:updated'; plan: SimplePlan }
  | { type: 'simple_plan:archived'; planId: string }
  // Approval lifecycle messages
  | { type: 'approval:created'; approval: PendingApproval }
  | { type: 'approval:updated'; approval: PendingApproval }
  | { type: 'approval:deleted'; approvalId: string }
  | { type: 'approval:list'; approvals: PendingApproval[] }
  // Auto-executed tool result
  | { type: 'auto_executed'; autoExecuted: AutoExecuted }
  // Session state
  | { type: 'session:state'; session: UserSession | null }
  // Chat history (WebSocket-based sync) - uses client format
  | { type: 'chat:history'; messages: ChatMessageClient[]; sessionId: string | null }
  // Chat session created
  | { type: 'chat:session_created'; session: ChatSession }
  // Asset-backed style preset messages
  | { type: 'style_preset:created'; preset: StylePresetRaw }
  | { type: 'style_preset:updated'; preset: StylePresetRaw }
  | { type: 'style_preset:deleted'; presetId: string }
  // Batch messages
  | { type: 'batch:started'; requestId: string; batchId: string; jobIds: string[]; assetIds: string[]; count: number; mode: BatchMode }
  | { type: 'batch:progress'; batchId: string; completedCount: number; failedCount: number; totalCount: number; variant: Variant }
  | { type: 'batch:completed'; batchId: string; completedCount: number; failedCount: number; totalCount: number }
  | { type: 'generation:estimate'; requestId: string; success: true; estimate: GenerationUsageEstimate }
  | { type: 'generation:estimate'; requestId: string; success: false; error: string; code: string }
  // Rotation pipeline messages
  | { type: 'rotation:started'; requestId: string; rotationSetId: string; assetId: string; totalSteps: number; directions: string[] }
  | { type: 'rotation:step_completed'; rotationSetId: string; direction: string; variantId: string; step: number; total: number }
  | { type: 'rotation:completed'; rotationSetId: string; views: RotationView[] }
  | { type: 'rotation:failed'; rotationSetId: string; error: string; failedStep: number }
  | { type: 'rotation:cancelled'; rotationSetId: string }
  // Tile set pipeline messages
  | { type: 'tileset:started'; requestId: string; tileSetId: string; assetId: string; gridWidth: number; gridHeight: number; totalTiles: number }
  | { type: 'tileset:tile_completed'; tileSetId: string; variantId: string; gridX: number; gridY: number; step: number; total: number }
  | { type: 'tileset:completed'; tileSetId: string; positions: TilePosition[] }
  | { type: 'tileset:failed'; tileSetId: string; error: string; failedStep: number }
  | { type: 'tileset:cancelled'; tileSetId: string }
  // Generation/refine/batch error messages
  | { type: 'generate:error'; requestId: string; error: string; code: string }
  | { type: 'refine:error'; requestId: string; error: string; code: string }
  | { type: 'batch:error'; requestId: string; error: string; code: string };

// Predefined asset types (user can also create custom)
export const PREDEFINED_ASSET_TYPES = [
  'character',
  'item',
  'scene',
  'environment',
  'sprite-sheet',
  'tile-set',
  'animation',
  'style-sheet',
  'reference',
] as const;

export type PredefinedAssetType = typeof PREDEFINED_ASSET_TYPES[number];

export interface AssetChanges {
  name?: string;
  type?: string;
  tags?: string[];
}

// Fork params for creating new asset from an existing asset or variant
// Provide either sourceAssetId (resolves to active variant) or sourceVariantId (uses directly)
export interface ForkParams {
  sourceAssetId?: string;
  sourceVariantId?: string;
  name: string;
  assetType: string;
  mediaKind?: MediaKind;
  collectionPlacements?: CollectionPlacementInput[];
}

// Return type
export interface UseSpaceWebSocketReturn {
  status: ConnectionStatus;
  error: string | null;
  hasSynced: boolean;
  assets: Asset[];
  variants: Variant[];
  lineage: Lineage[];
  relations: SpaceRelation[];
  collections: SpaceCollection[];
  collectionItems: CollectionItem[];
  compositions: Array<Composition | CompositionOverview>;
  compositionItems: CompositionItem[];
  jobs: Map<string, JobStatus>;
  presence: UserPresence[];
  stylePresets: StylePresetRaw[];
  styleReferenceCollections: StyleReferenceCollectionRaw[];
  sendMessage: (msg: object) => void;
  createAsset: (name: string, type: string) => void;
  updateAsset: (assetId: string, changes: AssetChanges) => void;
  deleteAsset: (assetId: string) => void;
  setActiveVariant: (assetId: string, variantId: string) => void;
  deleteVariant: (variantId: string) => void;
  forkAsset: (params: ForkParams) => void;
  starVariant: (variantId: string, starred: boolean) => void;
  retryVariant: (variantId: string) => void;
  regenerateVariant: (variantId: string) => void;
  severLineage: (lineageId: string) => void;
  createRelation: (params: {
    subject: SpaceSubject;
    object: SpaceSubject;
    relationType: SpaceRelationType;
    context?: SpaceRelationContext | string | null;
  }) => void;
  updateRelation: (relationId: string, changes: {
    relationType?: SpaceRelationType;
    context?: SpaceRelationContext | string | null;
  }) => void;
  deleteRelation: (relationId: string) => void;
  createCollection: (params: CollectionCreateParams) => void;
  updateCollection: (collectionId: string, changes: CollectionUpdateParams) => void;
  deleteCollection: (collectionId: string) => void;
  addCollectionItem: (params: CollectionItemCreateParams) => void;
  updateCollectionItem: (collectionId: string, itemId: string, changes: CollectionItemUpdateParams) => void;
  reorderCollectionItems: (collectionId: string, itemIds: string[]) => void;
  deleteCollectionItem: (collectionId: string, itemId: string) => void;
  createComposition: (params: CompositionCreateParams) => string;
  updateComposition: (compositionId: string, changes: CompositionUpdateParams) => void;
  deleteComposition: (compositionId: string) => void;
  createCompositionItem: (compositionId: string, params: CompositionItemCreateParams) => string;
  updateCompositionItem: (compositionId: string, itemId: string, changes: CompositionItemUpdateParams) => void;
  reorderCompositionItems: (compositionId: string, itemIds: string[]) => void;
  deleteCompositionItem: (compositionId: string, itemId: string) => void;
  requestSync: () => void;
  requestOverviewSync: () => void;
  trackJob: (jobId: string, context?: JobContext) => void;
  clearJob: (jobId: string) => void;
  updatePresence: (viewing?: string) => void;
  sendChatMessage: (content: string) => void;
  // Workflow-triggering methods
  sendChatRequest: (params: ChatRequestParams) => string;  // Returns requestId
  sendGenerateRequest: (params: GenerateRequestParams) => string;  // Returns requestId
  sendRefineRequest: (params: RefineRequestParams) => string;  // Returns requestId
  sendDescribeRequest: (params: DescribeRequestParams) => string;  // Returns requestId
  sendCompareRequest: (params: CompareRequestParams) => string;  // Returns requestId
  sendAutoDescribeRequest: (params: AutoDescribeRequestParams) => string;  // Returns requestId
  // Approval methods
  approveApproval: (approvalId: string) => void;
  rejectApproval: (approvalId: string) => void;
  listApprovals: () => void;
  // Session methods
  getSession: () => void;
  updateSession: (updates: { viewingAssetId?: string | null; viewingVariantId?: string | null; forgeContext?: string | null }) => void;
  // Chat history (WebSocket-based)
  requestChatHistory: (since?: number) => void;
  // Chat session methods
  startNewSession: () => void;
  // Persistent chat methods
  sendPersistentChatMessage: (content: string, forgeContext?: ChatForgeContext) => void;
  clearChatSession: () => void;
  // Asset-backed style preset methods
  createStylePreset: (params: StylePresetCreateParams) => void;
  updateStylePreset: (presetId: string, changes: StylePresetUpdateParams) => void;
  deleteStylePreset: (presetId: string) => void;
  // Batch methods
  sendBatchRequest: (params: BatchRequestParams) => string;
  sendGenerationEstimateRequest: (params: GenerationEstimateRequestParams) => string;
  // Rotation pipeline
  rotationSets: RotationSet[];
  rotationViews: RotationView[];
  sendRotationRequest: (params: RotationRequestParams) => void;
  sendRotationCancel: (rotationSetId: string) => void;
  // Tile set pipeline
  tileSets: TileSet[];
  tilePositions: TilePosition[];
  sendTileSetRequest: (params: TileSetRequestParams) => void;
  sendTileSetCancel: (tileSetId: string) => void;
  sendRetryTile: (tileSetId: string, gridX: number, gridY: number) => void;
  sendRefineEdges: (tileSetId: string) => void;
  sendRefineTile: (tileSetId: string, gridX: number, gridY: number) => void;
  sendVariantRate: (variantId: string, rating: 'approved' | 'rejected') => void;
}
