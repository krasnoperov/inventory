import { useEffect, useRef, useState, useCallback } from 'react';
import type { DescribeFocus, ClaudeUsage, SimplePlan } from '../../shared/websocket-types';

// Asset and Variant types based on DO SQLite schema
export interface Asset {
  id: string;
  name: string;
  type: string;  // User-editable: character, item, scene, sprite-sheet, animation, style-sheet, reference, etc.
  tags: string;
  parent_asset_id: string | null;  // NULL = root asset, else nested under parent
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
  workflow_id: string | null;  // Cloudflare workflow ID
  status: VariantStatus;
  error_message: string | null;  // Error details when status='failed'
  image_key: string | null;  // NULL until generation completes
  thumb_key: string | null;  // NULL until generation completes
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
 * Get thumbnail URL for a variant, returning undefined for pending/failed variants
 */
export function getVariantThumbnailUrl(variant: Variant): string | undefined {
  if (!variant.image_key) return undefined;
  const key = variant.thumb_key || variant.image_key;
  return `/api/images/${key}`;
}

/**
 * Check if a variant is ready to display (has an image)
 */
export function isVariantReady(variant: Variant): boolean {
  return variant.status === 'completed' && variant.image_key !== null;
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
}

export interface TileSetRequestParams {
  tileType: TileType;
  gridWidth: number;
  gridHeight: number;
  prompt: string;
  seedVariantId?: string;
  aspectRatio?: string;
  disableStyle?: boolean;
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
  prompt?: string;
  /** Asset-level references - backend resolves to default variants */
  referenceAssetIds?: string[];
  /** Explicit variant references from ForgeTray UI - used as-is */
  referenceVariantIds?: string[];
  aspectRatio?: string;
  parentAssetId?: string;
  /** Disable style anchoring */
  disableStyle?: boolean;
}

// Refine request parameters
export interface RefineRequestParams {
  assetId: string;
  prompt: string;
  /** Single source variant (legacy, for simple refine) */
  sourceVariantId?: string;
  /** Multiple source variants from ForgeTray (for combine into existing asset) */
  sourceVariantIds?: string[];
  /** Asset-level references - backend resolves to default variants */
  referenceAssetIds?: string[];
  aspectRatio?: string;
  /** Disable style anchoring */
  disableStyle?: boolean;
}

// Batch request parameters
export type BatchMode = 'explore' | 'set';

export interface BatchRequestParams {
  name: string;
  assetType: string;
  prompt?: string;
  count: number;
  mode: BatchMode;
  referenceAssetIds?: string[];
  referenceVariantIds?: string[];
  aspectRatio?: string;
  parentAssetId?: string;
  disableStyle?: boolean;
}

// Style data from server (raw format)
export interface SpaceStyleRaw {
  id: string;
  name: string;
  description: string;
  image_keys: string; // JSON array
  enabled: number; // 0/1
  created_by: string;
  created_at: number;
  updated_at: number;
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
  onConnect?: () => void;
  onDisconnect?: () => void;
  onJobComplete?: (job: JobStatus, variant: Variant) => void;
  onChatMessage?: (message: ChatMessage) => void;
  onChatResponse?: (response: ChatResponseResult) => void;
  onChatProgress?: (progress: ChatProgressResult) => void;
  onGenerateStarted?: (data: { requestId: string; jobId: string; assetId: string; assetName: string }) => void;
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
  // Style callbacks
  onStyleState?: (style: SpaceStyleRaw | null) => void;
  onStyleUpdated?: (style: SpaceStyleRaw) => void;
  onStyleDeleted?: () => void;
  // Batch callbacks
  onBatchStarted?: (data: BatchStartedResult) => void;
  onBatchProgress?: (data: BatchProgressResult) => void;
  onBatchCompleted?: (data: BatchCompletedResult) => void;
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
type ServerMessage =
  | { type: 'sync:state'; assets: Asset[]; variants: Variant[]; lineage: Lineage[]; presence?: UserPresence[]; rotationSets?: RotationSet[]; rotationViews?: RotationView[]; tileSets?: TileSet[]; tilePositions?: TilePosition[]; style?: SpaceStyleRaw | null }
  | { type: 'asset:created'; asset: Asset }
  | { type: 'asset:updated'; asset: Asset }
  | { type: 'asset:deleted'; assetId: string }
  | { type: 'asset:forked'; asset: Asset; variant: Variant; lineage: Lineage }
  | { type: 'variant:created'; variant: Variant }
  | { type: 'variant:updated'; variant: Variant }
  | { type: 'variant:deleted'; variantId: string }
  | { type: 'lineage:created'; lineage: Lineage }
  | { type: 'lineage:severed'; lineageId: string }
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
  | { type: 'generate:started'; requestId: string; jobId: string; assetId: string; assetName: string }
  | { type: 'refine:started'; requestId: string; jobId: string; assetId: string; assetName: string }
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
  // Style messages
  | { type: 'style:state'; style: SpaceStyleRaw | null }
  | { type: 'style:updated'; style: SpaceStyleRaw }
  | { type: 'style:deleted' }
  // Batch messages
  | { type: 'batch:started'; requestId: string; batchId: string; jobIds: string[]; assetIds: string[]; count: number; mode: BatchMode }
  | { type: 'batch:progress'; batchId: string; completedCount: number; failedCount: number; totalCount: number; variant: Variant }
  | { type: 'batch:completed'; batchId: string; completedCount: number; failedCount: number; totalCount: number }
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

interface AssetChanges {
  name?: string;
  type?: string;
  tags?: string[];
  parentAssetId?: string | null;
}

// Fork params for creating new asset from an existing asset or variant
// Provide either sourceAssetId (resolves to active variant) or sourceVariantId (uses directly)
export interface ForkParams {
  sourceAssetId?: string;
  sourceVariantId?: string;
  name: string;
  assetType: string;
  parentAssetId?: string;
}

// Return type
export interface UseSpaceWebSocketReturn {
  status: ConnectionStatus;
  error: string | null;
  assets: Asset[];
  variants: Variant[];
  lineage: Lineage[];
  jobs: Map<string, JobStatus>;
  presence: UserPresence[];
  sendMessage: (msg: object) => void;
  createAsset: (name: string, type: string, parentAssetId?: string) => void;
  updateAsset: (assetId: string, changes: AssetChanges) => void;
  deleteAsset: (assetId: string) => void;
  setActiveVariant: (assetId: string, variantId: string) => void;
  deleteVariant: (variantId: string) => void;
  forkAsset: (params: ForkParams) => void;
  starVariant: (variantId: string, starred: boolean) => void;
  retryVariant: (variantId: string) => void;
  severLineage: (lineageId: string) => void;
  requestSync: () => void;
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
  // Helper methods for hierarchy navigation
  getChildren: (assetId: string) => Asset[];
  getAncestors: (assetId: string) => Asset[];
  getRootAssets: () => Asset[];
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
  // Style methods
  sendStyleGet: () => void;
  sendStyleSet: (data: { name?: string; description?: string; imageKeys?: string[]; enabled?: boolean }) => void;
  sendStyleDelete: () => void;
  sendStyleToggle: (enabled: boolean) => void;
  // Batch methods
  sendBatchRequest: (params: BatchRequestParams) => string;
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

/**
 * WebSocket hook for real-time space updates
 * Manages connection state, asset/variant synchronization, and provides methods for mutations
 */
export function useSpaceWebSocket({
  spaceId,
  onConnect,
  onDisconnect,
  onJobComplete,
  onChatMessage,
  onChatResponse,
  onChatProgress,
  onGenerateStarted,
  onGenerateResult,
  onDescribeResponse,
  onCompareResponse,
  onApprovalCreated,
  onApprovalUpdated,
  onApprovalList,
  onAutoExecuted,
  onSessionState,
  onChatHistory,
  onPersistentChatMessage,
  onPersistentChatProgress,
  onSessionCreated,
  onPlanUpdated,
  onPlanArchived,
  onStyleState,
  onStyleUpdated,
  onStyleDeleted,
  onBatchStarted,
  onBatchProgress,
  onBatchCompleted,
  onRotationStarted,
  onRotationStepCompleted,
  onRotationCompleted,
  onRotationFailed,
  onRotationCancelled,
  onTileSetStarted,
  onTileSetTileCompleted,
  onTileSetCompleted,
  onTileSetFailed,
  onTileSetCancelled,
  onGenerateError,
  onRefineError,
  onBatchError,
  onError,
}: UseSpaceWebSocketParams): UseSpaceWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [lineage, setLineage] = useState<Lineage[]>([]);
  const [jobs, setJobs] = useState<Map<string, JobStatus>>(new Map());
  const [presence, setPresence] = useState<UserPresence[]>([]);
  const [rotationSets, setRotationSets] = useState<RotationSet[]>([]);
  const [rotationViews, setRotationViews] = useState<RotationView[]>([]);
  const [tileSets, setTileSets] = useState<TileSet[]>([]);
  const [tilePositions, setTilePositions] = useState<TilePosition[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const maxReconnectAttempts = 5;

  // Send a message through the WebSocket
  const sendMessage = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    } else {
      console.warn('WebSocket not connected, cannot send message:', msg);
    }
  }, []);

  // Asset mutation methods
  const createAsset = useCallback((name: string, type: string, parentAssetId?: string) => {
    sendMessage({ type: 'asset:create', name, assetType: type, parentAssetId });
  }, [sendMessage]);

  const updateAsset = useCallback((assetId: string, changes: AssetChanges) => {
    sendMessage({ type: 'asset:update', assetId, changes });
  }, [sendMessage]);

  const deleteAsset = useCallback((assetId: string) => {
    sendMessage({ type: 'asset:delete', assetId });
  }, [sendMessage]);

  const setActiveVariant = useCallback((assetId: string, variantId: string) => {
    sendMessage({ type: 'asset:setActive', assetId, variantId });
  }, [sendMessage]);

  const deleteVariant = useCallback((variantId: string) => {
    sendMessage({ type: 'variant:delete', variantId });
  }, [sendMessage]);

  // Fork new asset from existing asset or variant (copy operation with lineage)
  const forkAsset = useCallback((params: ForkParams) => {
    sendMessage({
      type: 'asset:fork',
      sourceAssetId: params.sourceAssetId,
      sourceVariantId: params.sourceVariantId,
      name: params.name,
      assetType: params.assetType,
      parentAssetId: params.parentAssetId,
    });
  }, [sendMessage]);

  // Star/unstar a variant
  const starVariant = useCallback((variantId: string, starred: boolean) => {
    sendMessage({ type: 'variant:star', variantId, starred });
  }, [sendMessage]);

  // Retry a failed variant generation
  const retryVariant = useCallback((variantId: string) => {
    sendMessage({ type: 'variant:retry', variantId });
  }, [sendMessage]);

  // Sever lineage link (cut historical connection)
  const severLineage = useCallback((lineageId: string) => {
    sendMessage({ type: 'lineage:sever', lineageId });
  }, [sendMessage]);

  const requestSync = useCallback(() => {
    sendMessage({ type: 'sync:request' });
  }, [sendMessage]);

  // Update presence (what asset the user is viewing)
  const updatePresence = useCallback((viewing?: string) => {
    sendMessage({ type: 'presence:update', viewing });
  }, [sendMessage]);

  // Send chat message via WebSocket
  const sendChatMessage = useCallback((content: string) => {
    sendMessage({ type: 'chat:send', content });
  }, [sendMessage]);

  // Send chat request to trigger ChatWorkflow
  const sendChatRequest = useCallback((params: ChatRequestParams): string => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'chat:request',
      requestId,
      message: params.message,
      mode: params.mode,
      forgeContext: params.forgeContext,
      viewingContext: params.viewingContext,
    });
    return requestId;
  }, [sendMessage]);

  // Send generate request to trigger GenerationWorkflow
  const sendGenerateRequest = useCallback((params: GenerateRequestParams): string => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'generate:request',
      requestId,
      name: params.name,
      assetType: params.assetType,
      prompt: params.prompt,
      referenceAssetIds: params.referenceAssetIds,
      referenceVariantIds: params.referenceVariantIds,
      aspectRatio: params.aspectRatio,
      parentAssetId: params.parentAssetId,
      disableStyle: params.disableStyle,
    });
    return requestId;
  }, [sendMessage]);

  // Send refine request to trigger GenerationWorkflow for variant refinement
  const sendRefineRequest = useCallback((params: RefineRequestParams): string => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'refine:request',
      requestId,
      assetId: params.assetId,
      prompt: params.prompt,
      sourceVariantId: params.sourceVariantId,
      sourceVariantIds: params.sourceVariantIds,
      referenceAssetIds: params.referenceAssetIds,
      aspectRatio: params.aspectRatio,
      disableStyle: params.disableStyle,
    });
    return requestId;
  }, [sendMessage]);

  // Send describe request to get image description via Claude vision
  const sendDescribeRequest = useCallback((params: DescribeRequestParams): string => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'describe:request',
      requestId,
      assetId: params.assetId,
      variantId: params.variantId,
      assetName: params.assetName,
      focus: params.focus,
      question: params.question,
    });
    return requestId;
  }, [sendMessage]);

  // Send compare request to compare multiple images via Claude vision
  const sendCompareRequest = useCallback((params: CompareRequestParams): string => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'compare:request',
      requestId,
      variantIds: params.variantIds,
      aspects: params.aspects,
    });
    return requestId;
  }, [sendMessage]);

  // Send auto-describe request to lazily cache variant description
  const sendAutoDescribeRequest = useCallback((params: AutoDescribeRequestParams): string => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'auto-describe:request',
      requestId,
      variantId: params.variantId,
    });
    return requestId;
  }, [sendMessage]);

  // Approval methods
  const approveApproval = useCallback((approvalId: string) => {
    sendMessage({ type: 'approval:approve', approvalId });
  }, [sendMessage]);

  const rejectApproval = useCallback((approvalId: string) => {
    sendMessage({ type: 'approval:reject', approvalId });
  }, [sendMessage]);

  const listApprovals = useCallback(() => {
    sendMessage({ type: 'approval:list' });
  }, [sendMessage]);

  // Session methods
  const getSession = useCallback(() => {
    sendMessage({ type: 'session:get' });
  }, [sendMessage]);

  const updateSessionMethod = useCallback((updates: {
    viewingAssetId?: string | null;
    viewingVariantId?: string | null;
    forgeContext?: string | null;
  }) => {
    sendMessage({ type: 'session:update', ...updates });
  }, [sendMessage]);

  // Request chat history via WebSocket (replaces REST endpoint)
  const requestChatHistory = useCallback((since?: number) => {
    sendMessage({ type: 'chat:history', since });
  }, [sendMessage]);

  // Start a new chat session
  const startNewSession = useCallback(() => {
    sendMessage({ type: 'chat:new_session' });
  }, [sendMessage]);

  // Send persistent chat message with forge context
  const sendPersistentChatMessage = useCallback((content: string, forgeContext?: ChatForgeContext) => {
    sendMessage({ type: 'chat:send', content, forgeContext });
  }, [sendMessage]);

  // Clear chat session (start fresh)
  const clearChatSession = useCallback(() => {
    sendMessage({ type: 'chat:clear' });
  }, [sendMessage]);

  // Style methods
  const sendStyleGet = useCallback(() => {
    sendMessage({ type: 'style:get' });
  }, [sendMessage]);

  const sendStyleSet = useCallback((data: { name?: string; description?: string; imageKeys?: string[]; enabled?: boolean }) => {
    sendMessage({ type: 'style:set', ...data });
  }, [sendMessage]);

  const sendStyleDelete = useCallback(() => {
    sendMessage({ type: 'style:delete' });
  }, [sendMessage]);

  const sendStyleToggle = useCallback((enabled: boolean) => {
    sendMessage({ type: 'style:toggle', enabled });
  }, [sendMessage]);

  // Batch request
  const sendBatchRequest = useCallback((params: BatchRequestParams): string => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'batch:request',
      requestId,
      name: params.name,
      assetType: params.assetType,
      prompt: params.prompt,
      count: params.count,
      mode: params.mode,
      referenceAssetIds: params.referenceAssetIds,
      referenceVariantIds: params.referenceVariantIds,
      aspectRatio: params.aspectRatio,
      parentAssetId: params.parentAssetId,
      disableStyle: params.disableStyle,
    });
    return requestId;
  }, [sendMessage]);

  // Rotation pipeline methods
  const sendRotationRequest = useCallback((params: RotationRequestParams & { generationMode?: 'sequential' | 'single-shot' }) => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'rotation:request',
      requestId,
      sourceVariantId: params.sourceVariantId,
      config: params.config,
      subjectDescription: params.subjectDescription,
      aspectRatio: params.aspectRatio,
      disableStyle: params.disableStyle,
      generationMode: params.generationMode,
    });
  }, [sendMessage]);

  const sendRotationCancel = useCallback((rotationSetId: string) => {
    sendMessage({ type: 'rotation:cancel', rotationSetId });
  }, [sendMessage]);

  // Tile set pipeline methods
  const sendTileSetRequest = useCallback((params: TileSetRequestParams) => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'tileset:request',
      requestId,
      tileType: params.tileType,
      gridWidth: params.gridWidth,
      gridHeight: params.gridHeight,
      prompt: params.prompt,
      seedVariantId: params.seedVariantId,
      aspectRatio: params.aspectRatio,
      disableStyle: params.disableStyle,
      generationMode: params.generationMode,
    });
  }, [sendMessage]);

  const sendTileSetCancel = useCallback((tileSetId: string) => {
    sendMessage({ type: 'tileset:cancel', tileSetId });
  }, [sendMessage]);

  const sendRetryTile = useCallback((tileSetId: string, gridX: number, gridY: number) => {
    sendMessage({ type: 'tileset:retry_tile', tileSetId, gridX, gridY });
  }, [sendMessage]);

  const sendRefineEdges = useCallback((tileSetId: string) => {
    sendMessage({ type: 'tileset:refine_edges', tileSetId });
  }, [sendMessage]);

  const sendRefineTile = useCallback((tileSetId: string, gridX: number, gridY: number) => {
    sendMessage({ type: 'tileset:refine_tile', tileSetId, gridX, gridY });
  }, [sendMessage]);

  const sendVariantRate = useCallback((variantId: string, rating: 'approved' | 'rejected') => {
    sendMessage({ type: 'variant:rate', variantId, rating });
  }, [sendMessage]);

  // Helper methods for hierarchy navigation
  const getChildren = useCallback((assetId: string): Asset[] => {
    return assets.filter(a => a.parent_asset_id === assetId);
  }, [assets]);

  const getAncestors = useCallback((assetId: string): Asset[] => {
    const ancestors: Asset[] = [];
    let current = assets.find(a => a.id === assetId);

    while (current?.parent_asset_id) {
      const parent = assets.find(a => a.id === current!.parent_asset_id);
      if (parent) {
        ancestors.unshift(parent);  // Add to front for root-first order
        current = parent;
      } else {
        break;
      }
    }

    return ancestors;
  }, [assets]);

  const getRootAssets = useCallback((): Asset[] => {
    return assets.filter(a => a.parent_asset_id === null);
  }, [assets]);

  // Job tracking methods
  const trackJob = useCallback((jobId: string, context?: JobContext) => {
    setJobs((prev) => {
      const next = new Map(prev);
      next.set(jobId, {
        jobId,
        status: 'pending',
        ...context,
      });
      return next;
    });
  }, []);

  const clearJob = useCallback((jobId: string) => {
    setJobs((prev) => {
      const next = new Map(prev);
      next.delete(jobId);
      return next;
    });
  }, []);

  // Store callbacks in refs to avoid dependency issues
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onJobCompleteRef = useRef(onJobComplete);
  const onChatMessageRef = useRef(onChatMessage);
  const onChatResponseRef = useRef(onChatResponse);
  const onChatProgressRef = useRef(onChatProgress);
  const onGenerateStartedRef = useRef(onGenerateStarted);
  const onGenerateResultRef = useRef(onGenerateResult);
  const onDescribeResponseRef = useRef(onDescribeResponse);
  const onCompareResponseRef = useRef(onCompareResponse);
  const onApprovalCreatedRef = useRef(onApprovalCreated);
  const onApprovalUpdatedRef = useRef(onApprovalUpdated);
  const onApprovalListRef = useRef(onApprovalList);
  const onAutoExecutedRef = useRef(onAutoExecuted);
  const onSessionStateRef = useRef(onSessionState);
  const onChatHistoryRef = useRef(onChatHistory);
  const onPersistentChatMessageRef = useRef(onPersistentChatMessage);
  const onPersistentChatProgressRef = useRef(onPersistentChatProgress);
  const onSessionCreatedRef = useRef(onSessionCreated);
  const onPlanUpdatedRef = useRef(onPlanUpdated);
  const onPlanArchivedRef = useRef(onPlanArchived);
  const onStyleStateRef = useRef(onStyleState);
  const onStyleUpdatedRef = useRef(onStyleUpdated);
  const onStyleDeletedRef = useRef(onStyleDeleted);
  const onBatchStartedRef = useRef(onBatchStarted);
  const onBatchProgressRef = useRef(onBatchProgress);
  const onBatchCompletedRef = useRef(onBatchCompleted);
  const onRotationStartedRef = useRef(onRotationStarted);
  const onRotationStepCompletedRef = useRef(onRotationStepCompleted);
  const onRotationCompletedRef = useRef(onRotationCompleted);
  const onRotationFailedRef = useRef(onRotationFailed);
  const onRotationCancelledRef = useRef(onRotationCancelled);
  const onTileSetStartedRef = useRef(onTileSetStarted);
  const onTileSetTileCompletedRef = useRef(onTileSetTileCompleted);
  const onTileSetCompletedRef = useRef(onTileSetCompleted);
  const onTileSetFailedRef = useRef(onTileSetFailed);
  const onTileSetCancelledRef = useRef(onTileSetCancelled);
  const onGenerateErrorRef = useRef(onGenerateError);
  const onRefineErrorRef = useRef(onRefineError);
  const onBatchErrorRef = useRef(onBatchError);
  const onErrorRef = useRef(onError);

  // Update refs in useEffect to avoid accessing refs during render
  useEffect(() => {
    onConnectRef.current = onConnect;
    onDisconnectRef.current = onDisconnect;
    onJobCompleteRef.current = onJobComplete;
    onChatMessageRef.current = onChatMessage;
    onChatResponseRef.current = onChatResponse;
    onChatProgressRef.current = onChatProgress;
    onGenerateStartedRef.current = onGenerateStarted;
    onGenerateResultRef.current = onGenerateResult;
    onDescribeResponseRef.current = onDescribeResponse;
    onCompareResponseRef.current = onCompareResponse;
    onApprovalCreatedRef.current = onApprovalCreated;
    onApprovalUpdatedRef.current = onApprovalUpdated;
    onApprovalListRef.current = onApprovalList;
    onAutoExecutedRef.current = onAutoExecuted;
    onSessionStateRef.current = onSessionState;
    onChatHistoryRef.current = onChatHistory;
    onPersistentChatMessageRef.current = onPersistentChatMessage;
    onPersistentChatProgressRef.current = onPersistentChatProgress;
    onSessionCreatedRef.current = onSessionCreated;
    onPlanUpdatedRef.current = onPlanUpdated;
    onPlanArchivedRef.current = onPlanArchived;
    onStyleStateRef.current = onStyleState;
    onStyleUpdatedRef.current = onStyleUpdated;
    onStyleDeletedRef.current = onStyleDeleted;
    onBatchStartedRef.current = onBatchStarted;
    onBatchProgressRef.current = onBatchProgress;
    onBatchCompletedRef.current = onBatchCompleted;
    onRotationStartedRef.current = onRotationStarted;
    onRotationStepCompletedRef.current = onRotationStepCompleted;
    onRotationCompletedRef.current = onRotationCompleted;
    onRotationFailedRef.current = onRotationFailed;
    onRotationCancelledRef.current = onRotationCancelled;
    onTileSetStartedRef.current = onTileSetStarted;
    onTileSetTileCompletedRef.current = onTileSetTileCompleted;
    onTileSetCompletedRef.current = onTileSetCompleted;
    onTileSetFailedRef.current = onTileSetFailed;
    onTileSetCancelledRef.current = onTileSetCancelled;
    onGenerateErrorRef.current = onGenerateError;
    onRefineErrorRef.current = onRefineError;
    onBatchErrorRef.current = onBatchError;
    onErrorRef.current = onError;
  });

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    if (!spaceId) return;

    let isMounted = true;

    const connect = () => {
      // Clear any pending reconnect timeout
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const url = `${protocol}//${host}/api/spaces/${spaceId}/ws`;

      setStatus('connecting');

      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isMounted) return;
          console.log('WebSocket connected to space:', spaceId);
          setStatus('connected');
          setError(null);
          reconnectAttempts.current = 0;
          onConnectRef.current?.();
        };

        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const message = JSON.parse(event.data) as ServerMessage;

            switch (message.type) {
              case 'sync:state':
                setAssets(message.assets);
                setVariants(message.variants);
                setLineage(message.lineage || []);
                setPresence(message.presence || []);
                setRotationSets(message.rotationSets || []);
                setRotationViews(message.rotationViews || []);
                setTileSets(message.tileSets || []);
                setTilePositions(message.tilePositions || []);
                // Handle style included in sync:state
                if (message.style !== undefined) {
                  onStyleStateRef.current?.(message.style ?? null);
                }
                setError(null);
                break;

              case 'asset:created':
                setAssets((prev) => [...prev, message.asset]);
                break;

              case 'asset:updated':
                setAssets((prev) =>
                  prev.map((asset) =>
                    asset.id === message.asset.id ? message.asset : asset
                  )
                );
                break;

              case 'asset:deleted':
                setAssets((prev) => prev.filter((asset) => asset.id !== message.assetId));
                break;

              case 'asset:forked':
                // Add the forked asset, variant, and lineage
                setAssets((prev) => [...prev, message.asset]);
                setVariants((prev) => {
                  if (prev.some(v => v.id === message.variant.id)) return prev;
                  return [...prev, message.variant];
                });
                setLineage((prev) => [...prev, message.lineage]);
                break;

              case 'variant:created':
                setVariants((prev) => {
                  // Avoid duplicates (variant may already exist from job:completed)
                  if (prev.some(v => v.id === message.variant.id)) return prev;
                  return [...prev, message.variant];
                });
                break;

              case 'variant:updated':
                setVariants((prev) =>
                  prev.map((variant) =>
                    variant.id === message.variant.id ? message.variant : variant
                  )
                );
                break;

              case 'variant:deleted':
                setVariants((prev) =>
                  prev.filter((variant) => variant.id !== message.variantId)
                );
                break;

              case 'lineage:created':
                setLineage((prev) => {
                  if (prev.some(l => l.id === message.lineage.id)) return prev;
                  return [...prev, message.lineage];
                });
                break;

              case 'lineage:severed':
                setLineage((prev) =>
                  prev.map((l) =>
                    l.id === message.lineageId ? { ...l, severed: true } : l
                  )
                );
                break;

              case 'job:progress':
                setJobs((prev) => {
                  const next = new Map(prev);
                  const existing = next.get(message.jobId);
                  if (existing) {
                    next.set(message.jobId, { ...existing, status: 'processing' });
                  } else {
                    next.set(message.jobId, { jobId: message.jobId, status: 'processing' });
                  }
                  return next;
                });
                break;

              case 'job:completed':
                setVariants((prev) => {
                  // Avoid duplicates (variant may already exist from variant:created)
                  if (prev.some(v => v.id === message.variant.id)) return prev;
                  return [...prev, message.variant];
                });
                setJobs((prev) => {
                  const next = new Map(prev);
                  const existing = next.get(message.jobId);
                  // Preserve original context (assetId, assetName, jobType, prompt) when marking complete
                  const completedJob: JobStatus = {
                    ...existing,
                    jobId: message.jobId,
                    status: 'completed',
                    variantId: message.variant.id,
                  };
                  next.set(message.jobId, completedJob);
                  // Notify callback if provided
                  onJobCompleteRef.current?.(completedJob, message.variant);
                  return next;
                });
                break;

              case 'job:failed':
                setJobs((prev) => {
                  const next = new Map(prev);
                  const existing = next.get(message.jobId);
                  // Preserve original context when marking failed
                  next.set(message.jobId, {
                    ...existing,
                    jobId: message.jobId,
                    status: 'failed',
                    error: message.error,
                  });
                  return next;
                });
                break;

              case 'chat:message':
                // Notify callback for real-time chat sync
                // Check if it's the new client format (has 'role' property)
                if ('role' in message.message) {
                  onPersistentChatMessageRef.current?.(message.message as ChatMessageClient);
                } else {
                  onChatMessageRef.current?.(message.message as ChatMessage);
                }
                break;

              case 'chat:history':
                // Notify callback with full chat history (WebSocket-based sync)
                onChatHistoryRef.current?.(message.messages, message.sessionId);
                break;

              case 'chat:session_created':
                // Notify callback when a new chat session is created
                onSessionCreatedRef.current?.(message.session);
                break;

              case 'presence:update':
                setPresence(message.presence);
                break;

              case 'error':
                setError(message.message);
                console.error('WebSocket error from server:', message.code, message.message);
                onErrorRef.current?.({ code: message.code, message: message.message });
                break;

              // Workflow response messages
              case 'chat:response':
                onChatResponseRef.current?.({
                  requestId: message.requestId,
                  success: message.success,
                  response: message.response,
                  error: message.error,
                  deferredActions: message.deferredActions,
                });
                break;

              case 'chat:progress':
                // Check if it's the new description phase format or old agentic format
                if ('phase' in message && message.phase === 'describing') {
                  onPersistentChatProgressRef.current?.({
                    requestId: message.requestId,
                    phase: message.phase,
                    variantId: message.variantId,
                    assetName: message.assetName,
                    status: message.status,
                    description: message.description,
                    index: message.index,
                    total: message.total,
                  });
                } else if ('toolName' in message) {
                  onChatProgressRef.current?.({
                    requestId: message.requestId,
                    toolName: message.toolName,
                    toolParams: message.toolParams,
                    status: message.status,
                    result: message.result,
                    error: message.error,
                  });
                }
                break;

              case 'generate:started':
                onGenerateStartedRef.current?.({
                  requestId: message.requestId,
                  jobId: message.jobId,
                  assetId: message.assetId,
                  assetName: message.assetName,
                });
                // Also track the job
                setJobs((prev) => {
                  const next = new Map(prev);
                  next.set(message.jobId, {
                    jobId: message.jobId,
                    status: 'pending',
                    assetId: message.assetId,
                    assetName: message.assetName,
                  });
                  return next;
                });
                break;

              case 'refine:started':
                // Mirror generate:started handling for refinements
                onGenerateStartedRef.current?.({
                  requestId: message.requestId,
                  jobId: message.jobId,
                  assetId: message.assetId,
                  assetName: message.assetName,
                });
                setJobs((prev) => {
                  const next = new Map(prev);
                  next.set(message.jobId, {
                    jobId: message.jobId,
                    status: 'pending',
                    assetId: message.assetId,
                    assetName: message.assetName,
                  });
                  return next;
                });
                break;

              case 'generate:result':
                onGenerateResultRef.current?.({
                  requestId: message.requestId,
                  jobId: message.jobId,
                  success: message.success,
                  variant: message.variant,
                  error: message.error,
                });
                // Update job status
                setJobs((prev) => {
                  const next = new Map(prev);
                  const existing = next.get(message.jobId);
                  if (message.success && message.variant) {
                    next.set(message.jobId, {
                      ...existing,
                      jobId: message.jobId,
                      status: 'completed',
                      variantId: message.variant.id,
                    });
                    // Notify job completion callback
                    onJobCompleteRef.current?.(
                      { ...existing, jobId: message.jobId, status: 'completed', variantId: message.variant.id },
                      message.variant
                    );
                  } else {
                    next.set(message.jobId, {
                      ...existing,
                      jobId: message.jobId,
                      status: 'failed',
                      error: message.error,
                    });
                  }
                  return next;
                });
                // Add variant to state if successful
                if (message.success && message.variant) {
                  setVariants((prev) => {
                    if (prev.some(v => v.id === message.variant!.id)) return prev;
                    return [...prev, message.variant!];
                  });
                }
                break;

              case 'refine:result':
                // Handle refine result similar to generate:result
                onGenerateResultRef.current?.({
                  requestId: message.requestId,
                  jobId: message.jobId,
                  success: message.success,
                  variant: message.variant,
                  error: message.error,
                });
                // Update job status
                setJobs((prev) => {
                  const next = new Map(prev);
                  const existing = next.get(message.jobId);
                  if (message.success && message.variant) {
                    next.set(message.jobId, {
                      ...existing,
                      jobId: message.jobId,
                      status: 'completed',
                      variantId: message.variant.id,
                    });
                    onJobCompleteRef.current?.(
                      { ...existing, jobId: message.jobId, status: 'completed', variantId: message.variant.id },
                      message.variant
                    );
                  } else {
                    next.set(message.jobId, {
                      ...existing,
                      jobId: message.jobId,
                      status: 'failed',
                      error: message.error,
                    });
                  }
                  return next;
                });
                if (message.success && message.variant) {
                  setVariants((prev) => {
                    if (prev.some(v => v.id === message.variant!.id)) return prev;
                    return [...prev, message.variant!];
                  });
                }
                break;

              // Vision (describe/compare) response messages
              case 'describe:response':
                onDescribeResponseRef.current?.({
                  requestId: message.requestId,
                  success: message.success,
                  description: message.description,
                  error: message.error,
                  usage: message.usage,
                });
                break;

              case 'compare:response':
                onCompareResponseRef.current?.({
                  requestId: message.requestId,
                  success: message.success,
                  comparison: message.comparison,
                  error: message.error,
                  usage: message.usage,
                });
                break;

              // Approval lifecycle messages
              case 'approval:created':
                onApprovalCreatedRef.current?.(message.approval);
                break;

              case 'approval:updated':
                onApprovalUpdatedRef.current?.(message.approval);
                break;

              case 'approval:deleted':
                // Approvals are not stored locally, just notify callback
                break;

              case 'approval:list':
                onApprovalListRef.current?.(message.approvals);
                break;

              // Auto-executed tool result
              case 'auto_executed':
                onAutoExecutedRef.current?.(message.autoExecuted);
                break;

              // Session state
              case 'session:state':
                onSessionStateRef.current?.(message.session);
                break;

              // SimplePlan messages
              case 'simple_plan:updated':
                onPlanUpdatedRef.current?.(message.plan);
                break;

              case 'simple_plan:archived':
                onPlanArchivedRef.current?.(message.planId);
                break;

              // Style messages
              case 'style:state':
                onStyleStateRef.current?.(message.style);
                break;

              case 'style:updated':
                onStyleUpdatedRef.current?.(message.style);
                break;

              case 'style:deleted':
                onStyleDeletedRef.current?.();
                break;

              // Batch messages
              case 'batch:started':
                onBatchStartedRef.current?.({
                  requestId: message.requestId,
                  batchId: message.batchId,
                  jobIds: message.jobIds,
                  assetIds: message.assetIds,
                  count: message.count,
                  mode: message.mode,
                });
                // Track all batch jobs
                setJobs((prev) => {
                  const next = new Map(prev);
                  for (const jobId of message.jobIds) {
                    next.set(jobId, { jobId, status: 'pending' });
                  }
                  return next;
                });
                break;

              case 'batch:progress':
                onBatchProgressRef.current?.({
                  batchId: message.batchId,
                  completedCount: message.completedCount,
                  failedCount: message.failedCount,
                  totalCount: message.totalCount,
                  variant: message.variant,
                });
                break;

              case 'batch:completed':
                onBatchCompletedRef.current?.({
                  batchId: message.batchId,
                  completedCount: message.completedCount,
                  failedCount: message.failedCount,
                  totalCount: message.totalCount,
                });
                break;

              // Generation/refine/batch error messages
              case 'generate:error':
                onGenerateErrorRef.current?.({
                  requestId: message.requestId,
                  error: message.error,
                  code: message.code,
                });
                break;

              case 'refine:error':
                onRefineErrorRef.current?.({
                  requestId: message.requestId,
                  error: message.error,
                  code: message.code,
                });
                break;

              case 'batch:error':
                onBatchErrorRef.current?.({
                  requestId: message.requestId,
                  error: message.error,
                  code: message.code,
                });
                break;

              // Rotation pipeline messages
              case 'rotation:started':
                setRotationSets((prev) => {
                  const existing = prev.find(rs => rs.id === message.rotationSetId);
                  if (existing) {
                    return prev.map(rs => rs.id === message.rotationSetId
                      ? { ...rs, status: 'generating' as const, total_steps: message.totalSteps }
                      : rs
                    );
                  }
                  // Add new set from broadcast data
                  return [...prev, {
                    id: message.rotationSetId,
                    asset_id: message.assetId,
                    source_variant_id: '',
                    config: '',
                    status: 'generating' as const,
                    current_step: 0,
                    total_steps: message.totalSteps,
                    error_message: null,
                    created_by: '',
                    created_at: Date.now(),
                    updated_at: Date.now(),
                  }];
                });
                onRotationStartedRef.current?.({
                  rotationSetId: message.rotationSetId,
                  assetId: message.assetId,
                  directions: message.directions,
                  totalSteps: message.totalSteps,
                });
                break;

              case 'rotation:step_completed':
                setRotationSets((prev) =>
                  prev.map(rs => rs.id === message.rotationSetId
                    ? { ...rs, current_step: message.step + 1 }
                    : rs
                  )
                );
                onRotationStepCompletedRef.current?.({
                  rotationSetId: message.rotationSetId,
                  direction: message.direction,
                  step: message.step,
                  total: message.total,
                  variantId: message.variantId,
                });
                break;

              case 'rotation:completed':
                setRotationSets((prev) =>
                  prev.map(rs => rs.id === message.rotationSetId
                    ? { ...rs, status: 'completed' as const }
                    : rs
                  )
                );
                setRotationViews((prev) => {
                  const existingIds = new Set(prev.map(rv => rv.id));
                  const newViews = message.views.filter(v => !existingIds.has(v.id));
                  return newViews.length > 0 ? [...prev, ...newViews] : prev;
                });
                onRotationCompletedRef.current?.({ rotationSetId: message.rotationSetId, views: message.views });
                break;

              case 'rotation:failed':
                setRotationSets((prev) =>
                  prev.map(rs => rs.id === message.rotationSetId
                    ? { ...rs, status: 'failed' as const, error_message: message.error }
                    : rs
                  )
                );
                onRotationFailedRef.current?.({
                  rotationSetId: message.rotationSetId,
                  error: message.error,
                  failedStep: message.failedStep,
                });
                break;

              case 'rotation:cancelled':
                setRotationSets((prev) =>
                  prev.map(rs => rs.id === message.rotationSetId
                    ? { ...rs, status: 'cancelled' as const }
                    : rs
                  )
                );
                onRotationCancelledRef.current?.(message.rotationSetId);
                break;

              // Tile set pipeline messages
              case 'tileset:started':
                setTileSets((prev) => {
                  const existing = prev.find(ts => ts.id === message.tileSetId);
                  if (existing) {
                    return prev.map(ts => ts.id === message.tileSetId
                      ? { ...ts, status: 'generating' as const, total_steps: message.totalTiles }
                      : ts
                    );
                  }
                  // Add new set from broadcast data
                  return [...prev, {
                    id: message.tileSetId,
                    asset_id: message.assetId,
                    tile_type: 'custom' as const,
                    grid_width: message.gridWidth,
                    grid_height: message.gridHeight,
                    status: 'generating' as const,
                    seed_variant_id: null,
                    config: '',
                    current_step: 0,
                    total_steps: message.totalTiles,
                    error_message: null,
                    created_by: '',
                    created_at: Date.now(),
                    updated_at: Date.now(),
                  }];
                });
                onTileSetStartedRef.current?.({
                  tileSetId: message.tileSetId,
                  assetId: message.assetId,
                  gridWidth: message.gridWidth,
                  gridHeight: message.gridHeight,
                  totalTiles: message.totalTiles,
                });
                break;

              case 'tileset:tile_completed':
                setTileSets((prev) =>
                  prev.map(ts => ts.id === message.tileSetId
                    ? { ...ts, current_step: message.step + 1 }
                    : ts
                  )
                );
                onTileSetTileCompletedRef.current?.({
                  tileSetId: message.tileSetId,
                  gridX: message.gridX,
                  gridY: message.gridY,
                  step: message.step,
                  total: message.total,
                  variantId: message.variantId,
                });
                break;

              case 'tileset:completed':
                setTileSets((prev) =>
                  prev.map(ts => ts.id === message.tileSetId
                    ? { ...ts, status: 'completed' as const }
                    : ts
                  )
                );
                setTilePositions((prev) => {
                  const existingIds = new Set(prev.map(tp => tp.id));
                  const newPositions = message.positions.filter(p => !existingIds.has(p.id));
                  return newPositions.length > 0 ? [...prev, ...newPositions] : prev;
                });
                onTileSetCompletedRef.current?.({ tileSetId: message.tileSetId, positions: message.positions });
                break;

              case 'tileset:failed':
                setTileSets((prev) =>
                  prev.map(ts => ts.id === message.tileSetId
                    ? { ...ts, status: 'failed' as const, error_message: message.error }
                    : ts
                  )
                );
                onTileSetFailedRef.current?.({
                  tileSetId: message.tileSetId,
                  error: message.error,
                  failedStep: message.failedStep,
                });
                break;

              case 'tileset:cancelled':
                setTileSets((prev) =>
                  prev.map(ts => ts.id === message.tileSetId
                    ? { ...ts, status: 'cancelled' as const }
                    : ts
                  )
                );
                onTileSetCancelledRef.current?.(message.tileSetId);
                break;

              default:
                console.warn('Unknown message type:', message);
            }
          } catch (err) {
            console.error('Error parsing WebSocket message:', err);
          }
        };

        ws.onerror = (event) => {
          if (!isMounted) return;
          console.error('WebSocket error:', event);
          setStatus('error');
          setError('WebSocket connection error');
        };

        ws.onclose = () => {
          if (!isMounted) return;
          console.log('WebSocket disconnected from space:', spaceId);
          setStatus('disconnected');
          onDisconnectRef.current?.();

          // Attempt to reconnect with exponential backoff
          if (reconnectAttempts.current < maxReconnectAttempts) {
            const backoffMs = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
            console.log(
              `Reconnecting in ${backoffMs}ms (attempt ${reconnectAttempts.current + 1}/${maxReconnectAttempts})`
            );

            reconnectTimeoutRef.current = window.setTimeout(() => {
              if (!isMounted) return;
              reconnectAttempts.current++;
              connect();
            }, backoffMs);
          } else {
            setStatus('error');
            setError(
              `Failed to reconnect after ${maxReconnectAttempts} attempts. Please refresh the page.`
            );
          }
        };
      } catch (err) {
        console.error('Error creating WebSocket:', err);
        setStatus('error');
        setError('Failed to create WebSocket connection');
      }
    };

    connect();

    return () => {
      isMounted = false;

      // Clear reconnect timeout
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      // Close WebSocket connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [spaceId]);

  return {
    status,
    error,
    assets,
    variants,
    lineage,
    jobs,
    presence,
    sendMessage,
    createAsset,
    updateAsset,
    deleteAsset,
    setActiveVariant,
    deleteVariant,
    forkAsset,
    starVariant,
    retryVariant,
    severLineage,
    requestSync,
    trackJob,
    clearJob,
    updatePresence,
    sendChatMessage,
    sendChatRequest,
    sendGenerateRequest,
    sendRefineRequest,
    sendDescribeRequest,
    sendCompareRequest,
    sendAutoDescribeRequest,
    getChildren,
    getAncestors,
    getRootAssets,
    // Approval methods
    approveApproval,
    rejectApproval,
    listApprovals,
    // Session methods
    getSession,
    updateSession: updateSessionMethod,
    // Chat history (WebSocket-based)
    requestChatHistory,
    // Chat session methods
    startNewSession,
    // Persistent chat methods
    sendPersistentChatMessage,
    clearChatSession,
    // Style methods
    sendStyleGet,
    sendStyleSet,
    sendStyleDelete,
    sendStyleToggle,
    // Batch methods
    sendBatchRequest,
    // Rotation pipeline
    rotationSets,
    rotationViews,
    sendRotationRequest,
    sendRotationCancel,
    // Tile set pipeline
    tileSets,
    tilePositions,
    sendTileSetRequest,
    sendTileSetCancel,
    sendRetryTile,
    sendRefineEdges,
    sendRefineTile,
    sendVariantRate,
  };
}

export default useSpaceWebSocket;
