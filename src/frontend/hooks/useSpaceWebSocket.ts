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

// Enhance prompt request parameters
export interface EnhanceRequestParams {
  prompt: string;
  enhanceType: 'geminify';
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

// Enhance prompt response from server
export interface EnhanceResponseResult {
  requestId: string;
  success: boolean;
  enhancedPrompt?: string;
  error?: string;
  usage?: ClaudeUsage;
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
  onEnhanceResponse?: (response: EnhanceResponseResult) => void;
  // Approval lifecycle callbacks
  onApprovalCreated?: (approval: PendingApproval) => void;
  onApprovalUpdated?: (approval: PendingApproval) => void;
  onApprovalList?: (approvals: PendingApproval[]) => void;
  // Auto-executed callback
  onAutoExecuted?: (autoExecuted: AutoExecuted) => void;
  // Session state callback
  onSessionState?: (session: UserSession | null) => void;
  // Chat history callback (WebSocket-based, replaces REST)
  // Messages are in server format with sender_type/created_at fields
  onChatHistory?: (messages: Array<{ sender_type: 'user' | 'bot'; content: string; created_at: number }>, sessionId: string | null) => void;
  // Chat session created callback
  onSessionCreated?: (session: ChatSession) => void;
  // SimplePlan callbacks
  onPlanUpdated?: (plan: SimplePlan) => void;
  onPlanArchived?: (planId: string) => void;
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
  | { type: 'sync:state'; assets: Asset[]; variants: Variant[]; lineage: Lineage[]; presence?: UserPresence[] }
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
  | { type: 'chat:message'; message: ChatMessage }
  | { type: 'presence:update'; presence: UserPresence[] }
  | { type: 'error'; code: string; message: string }
  // Workflow response messages
  | { type: 'chat:response'; requestId: string; success: boolean; response?: BotResponse; error?: string; deferredActions?: DeferredAction[] }
  | { type: 'chat:progress'; requestId: string; toolName: string; toolParams: Record<string, unknown>; status: 'executing' | 'complete' | 'failed'; result?: string; error?: string }
  | { type: 'generate:started'; requestId: string; jobId: string; assetId: string; assetName: string }
  | { type: 'generate:result'; requestId: string; jobId: string; success: boolean; variant?: Variant; error?: string }
  | { type: 'refine:result'; requestId: string; jobId: string; success: boolean; variant?: Variant; error?: string }
  // Vision (describe/compare) response messages
  | { type: 'describe:response'; requestId: string; success: boolean; description?: string; error?: string; usage?: ClaudeUsage }
  | { type: 'compare:response'; requestId: string; success: boolean; comparison?: string; error?: string; usage?: ClaudeUsage }
  // Enhance prompt response message
  | { type: 'enhance:response'; requestId: string; success: boolean; enhancedPrompt?: string; error?: string; usage?: ClaudeUsage }
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
  // Chat history (WebSocket-based sync) - uses server format with sender_type/created_at
  | { type: 'chat:history'; messages: Array<{ sender_type: 'user' | 'bot'; content: string; created_at: number }>; sessionId: string | null }
  // Chat session created
  | { type: 'chat:session_created'; session: ChatSession };

// Predefined asset types (user can also create custom)
export const PREDEFINED_ASSET_TYPES = [
  'character',
  'item',
  'scene',
  'environment',
  'sprite-sheet',
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
  sendEnhanceRequest: (params: EnhanceRequestParams) => string;  // Returns requestId
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
  onEnhanceResponse,
  onApprovalCreated,
  onApprovalUpdated,
  onApprovalList,
  onAutoExecuted,
  onSessionState,
  onChatHistory,
  onSessionCreated,
  onPlanUpdated,
  onPlanArchived,
}: UseSpaceWebSocketParams): UseSpaceWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [lineage, setLineage] = useState<Lineage[]>([]);
  const [jobs, setJobs] = useState<Map<string, JobStatus>>(new Map());
  const [presence, setPresence] = useState<UserPresence[]>([]);

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

  // Send enhance request to enhance a prompt via Claude
  const sendEnhanceRequest = useCallback((params: EnhanceRequestParams): string => {
    const requestId = crypto.randomUUID();
    sendMessage({
      type: 'enhance:request',
      requestId,
      prompt: params.prompt,
      enhanceType: params.enhanceType,
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
  const onEnhanceResponseRef = useRef(onEnhanceResponse);
  const onApprovalCreatedRef = useRef(onApprovalCreated);
  const onApprovalUpdatedRef = useRef(onApprovalUpdated);
  const onApprovalListRef = useRef(onApprovalList);
  const onAutoExecutedRef = useRef(onAutoExecuted);
  const onSessionStateRef = useRef(onSessionState);
  const onChatHistoryRef = useRef(onChatHistory);
  const onSessionCreatedRef = useRef(onSessionCreated);
  const onPlanUpdatedRef = useRef(onPlanUpdated);
  const onPlanArchivedRef = useRef(onPlanArchived);

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
    onEnhanceResponseRef.current = onEnhanceResponse;
    onApprovalCreatedRef.current = onApprovalCreated;
    onApprovalUpdatedRef.current = onApprovalUpdated;
    onApprovalListRef.current = onApprovalList;
    onAutoExecutedRef.current = onAutoExecuted;
    onSessionStateRef.current = onSessionState;
    onChatHistoryRef.current = onChatHistory;
    onSessionCreatedRef.current = onSessionCreated;
    onPlanUpdatedRef.current = onPlanUpdated;
    onPlanArchivedRef.current = onPlanArchived;
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
                onChatMessageRef.current?.(message.message);
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
                onChatProgressRef.current?.({
                  requestId: message.requestId,
                  toolName: message.toolName,
                  toolParams: message.toolParams,
                  status: message.status,
                  result: message.result,
                  error: message.error,
                });
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

              case 'enhance:response':
                onEnhanceResponseRef.current?.({
                  requestId: message.requestId,
                  success: message.success,
                  enhancedPrompt: message.enhancedPrompt,
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
    sendEnhanceRequest,
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
  };
}

export default useSpaceWebSocket;
