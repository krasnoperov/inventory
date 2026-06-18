/**
 * WebSocket Client for CLI
 *
 * Provides WebSocket-based communication with the Space Durable Object.
 * Replaces HTTP API calls with WebSocket messages for chat and generation.
 */

import process from 'node:process';
import http from 'node:http';
import https from 'node:https';
import WebSocket from 'ws';
import { loadStoredConfig, resolveBaseUrl } from './config';
import { loginCommandForEnvironment } from './command-context';
import type { DescribeFocus, ClaudeUsage, MediaKind, MusicGenerationProvider, SimplePlan } from '../../shared/websocket-types';
import type {
  VideoGenerationDurationSeconds,
  VideoGenerationResolution,
  VideoGenerationTier,
} from '../../shared/videoGenerationOptions';

export const GENERATION_REQUEST_TIMEOUT_MS = 300_000;
export const VIDEO_GENERATION_REQUEST_TIMEOUT_MS = 720_000;
export const PIPELINE_REQUEST_TIMEOUT_MS = 1_800_000;

export function getGenerationRequestTimeoutMs(mediaKind?: MediaKind): number {
  return mediaKind === 'video' ? VIDEO_GENERATION_REQUEST_TIMEOUT_MS : GENERATION_REQUEST_TIMEOUT_MS;
}

// Re-export SimplePlan for CLI commands
export type { SimplePlan } from '../../shared/websocket-types';

// =============================================================================
// Types
// =============================================================================

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

export interface PendingApproval {
  id: string;
  request_id: string;
  plan_id: string | null;
  plan_step_id: string | null;
  tool: string;
  params: string; // JSON string
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

export interface AutoExecuted {
  id: string;
  request_id: string;
  tool: string;
  params: string; // JSON string
  result: string; // JSON string
  success: boolean;
  error: string | null;
  created_at: number;
}

export interface UserSession {
  user_id: string;
  viewing_asset_id: string | null;
  viewing_variant_id: string | null;
  forge_context: string | null; // JSON string
  last_seen: number;
  updated_at: number;
}

// Message types matching backend definitions
interface ChatRequestMessage {
  type: 'chat:request';
  requestId: string;
  message: string;
  mode: 'advisor' | 'actor';
  forgeContext?: {
    items: Array<{
      assetId: string;
      assetName: string;
      assetType: string;
      variantId?: string;
    }>;
    prompt?: string;
  };
  viewingContext?: {
    assetId?: string;
    variantId?: string;
  };
}

interface GenerateRequestMessage {
  type: 'generate:request';
  requestId: string;
  name: string;
  assetType: string;
  prompt?: string;
  referenceAssetIds?: string[];
  referenceVariantIds?: string[];
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  parentAssetId?: string;
  disableStyle?: boolean;
  mediaKind?: MediaKind;
  voiceId?: string;
  dialogueVoiceIds?: string[];
  musicProvider?: MusicGenerationProvider;
  generateAudio?: boolean;
  videoResolution?: VideoGenerationResolution;
  videoDurationSeconds?: VideoGenerationDurationSeconds;
  videoTier?: VideoGenerationTier;
}

interface RefineRequestMessage {
  type: 'refine:request';
  requestId: string;
  assetId: string;
  prompt: string;
  sourceVariantId?: string;
  sourceVariantIds?: string[];
  referenceAssetIds?: string[];
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  disableStyle?: boolean;
  mediaKind?: MediaKind;
  voiceId?: string;
  dialogueVoiceIds?: string[];
  musicProvider?: MusicGenerationProvider;
  generateAudio?: boolean;
  videoResolution?: VideoGenerationResolution;
  videoDurationSeconds?: VideoGenerationDurationSeconds;
  videoTier?: VideoGenerationTier;
}

interface BatchRequestMessage {
  type: 'batch:request';
  requestId: string;
  name: string;
  assetType: string;
  prompt: string;
  count: number;
  mode: 'explore' | 'set';
  referenceVariantIds?: string[];
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  parentAssetId?: string;
  disableStyle?: boolean;
  mediaKind?: MediaKind;
  voiceId?: string;
  dialogueVoiceIds?: string[];
  musicProvider?: MusicGenerationProvider;
}

interface DescribeRequestMessage {
  type: 'describe:request';
  requestId: string;
  assetId: string;
  variantId: string;
  assetName: string;
  focus?: DescribeFocus;
  question?: string;
}

interface CompareRequestMessage {
  type: 'compare:request';
  requestId: string;
  variantIds: string[];
  aspects?: string[];
}

// Response types
interface ChatResponse {
  type: 'chat:response';
  requestId: string;
  success: boolean;
  response?: unknown;
  error?: string;
  deferredActions?: Array<{
    tool: string;
    params: Record<string, unknown>;
    acknowledgment: string;
  }>;
}

/** Variant status lifecycle */
type VariantStatus = 'pending' | 'processing' | 'uploading' | 'completed' | 'failed';

/** Variant from backend (placeholder variants architecture) */
export interface Variant {
  id: string;
  asset_id: string;
  media_kind: MediaKind;
  workflow_id: string | null;
  status: VariantStatus;
  error_message: string | null;
  image_key: string | null;
  thumb_key: string | null;
  media_key?: string | null;
  media_mime_type?: string | null;
  media_size_bytes?: number | null;
  media_width?: number | null;
  media_height?: number | null;
  media_duration_ms?: number | null;
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
  starred: boolean;
  quality_rating?: 'approved' | 'rejected' | null;
  rated_at?: number | null;
  created_by: string;
  created_at: number;
  updated_at: number | null;
}

/** Asset record as broadcast by the Space Durable Object. */
export interface AssetRecord {
  id: string;
  name: string;
  type: string | null;
  media_kind?: MediaKind;
  tags?: string | null;
  parent_asset_id?: string | null;
  active_variant_id: string | null;
  created_at?: number;
  updated_at?: number;
}

export interface GenerateStarted {
  type: 'generate:started';
  requestId: string;
  jobId: string; // This is the variantId
  assetId: string;
  assetName: string;
}

interface GenerateError {
  type: 'generate:error';
  requestId: string;
  error: string;
  code: string;
}

interface RefineError {
  type: 'refine:error';
  requestId: string;
  error: string;
  code: string;
}

interface RefineStarted {
  type: 'refine:started';
  requestId: string;
  jobId: string; // This is the variantId
  assetId: string;
  assetName: string;
}

export interface BatchStarted {
  type: 'batch:started';
  requestId: string;
  batchId: string;
  jobIds: string[];
  assetIds: string[];
  count: number;
  mode: 'explore' | 'set';
}

interface BatchError {
  type: 'batch:error';
  requestId: string;
  error: string;
  code: string;
}

interface VariantUpdated {
  type: 'variant:updated';
  variant: Variant;
}

// Legacy result types (deprecated, but kept for compatibility)
export interface GenerateResult {
  type: 'generate:result';
  requestId: string;
  jobId: string;
  success: boolean;
  variant?: Variant;
  error?: string;
}

export interface BatchResult {
  type: 'batch:result';
  requestId: string;
  batchId: string;
  success: boolean;
  variants: Variant[];
  failed: Array<{ variantId: string; error: string }>;
}

interface DescribeResponse {
  type: 'describe:response';
  requestId: string;
  success: boolean;
  description?: string;
  error?: string;
  usage?: ClaudeUsage;
}

interface CompareResponse {
  type: 'compare:response';
  requestId: string;
  success: boolean;
  comparison?: string;
  error?: string;
  usage?: ClaudeUsage;
}

// Specific server message types
type SyncStateMessage = { type: 'sync:state'; assets: unknown[]; variants: Variant[]; lineage: unknown[] };
type ErrorMessage = { type: 'error'; code: string; message: string };
type RefineResult = Omit<GenerateResult, 'type'> & { type: 'refine:result' };

// Chat progress message (agentic loop tool execution)
export interface ChatProgress {
  requestId: string;
  toolName: string;
  toolParams: Record<string, unknown>;
  status: 'executing' | 'complete' | 'failed';
  result?: string;
  error?: string;
}
type ChatProgressMessage = { type: 'chat:progress' } & ChatProgress;

// SimplePlan message types (markdown-based)
type SimplePlanUpdatedMessage = { type: 'simple_plan:updated'; plan: SimplePlan };
type SimplePlanArchivedMessage = { type: 'simple_plan:archived'; planId: string };

// Approval message types
type ApprovalCreatedMessage = { type: 'approval:created'; approval: PendingApproval };
type ApprovalUpdatedMessage = { type: 'approval:updated'; approval: PendingApproval };
type ApprovalListMessage = { type: 'approval:list'; approvals: PendingApproval[] };
type AutoExecutedMessage = { type: 'auto_executed'; autoExecuted: AutoExecuted };

// Session message types
type SessionStateMessage = { type: 'session:state'; session: UserSession | null };

// Asset / variant mutation broadcast types (responses to management messages)
type AssetCreatedMessage = { type: 'asset:created'; asset: AssetRecord };
type AssetUpdatedMessage = { type: 'asset:updated'; asset: AssetRecord };
type AssetDeletedMessage = { type: 'asset:deleted'; assetId: string };
type AssetForkedMessage = { type: 'asset:forked'; asset: AssetRecord };
type VariantDeletedMessage = { type: 'variant:deleted'; variantId: string };

export type RotationConfig = '4-directional' | '8-directional' | 'turnaround';
export type RotationGenerationMode = 'sequential' | 'single-shot';
export type TileType = 'terrain' | 'building' | 'decoration' | 'custom';

export interface RotationView {
  id: string;
  rotation_set_id: string;
  variant_id: string;
  direction: string;
  step_index: number;
  created_at: number;
}

export interface TilePosition {
  id: string;
  tile_set_id: string;
  variant_id: string;
  grid_x: number;
  grid_y: number;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  created_at: number;
}

export interface RotationStarted {
  type: 'rotation:started';
  requestId: string;
  rotationSetId: string;
  assetId: string;
  totalSteps: number;
  directions: string[];
}

export interface RotationStepCompleted {
  type: 'rotation:step_completed';
  rotationSetId: string;
  direction: string;
  variantId: string;
  step: number;
  total: number;
}

export interface RotationCompleted {
  type: 'rotation:completed';
  rotationSetId: string;
  views: RotationView[];
}

export interface RotationFailed {
  type: 'rotation:failed';
  rotationSetId: string;
  error: string;
  failedStep: number;
}

export interface RotationCancelled {
  type: 'rotation:cancelled';
  rotationSetId: string;
}

export interface RotationPipelineResult {
  requestId: string;
  rotationSetId: string;
  assetId: string;
  totalSteps: number;
  directions: string[];
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  views?: RotationView[];
  error?: string;
  failedStep?: number;
}

export interface TileSetStarted {
  type: 'tileset:started';
  requestId: string;
  tileSetId: string;
  assetId: string;
  gridWidth: number;
  gridHeight: number;
  totalTiles: number;
}

export interface TileSetTileCompleted {
  type: 'tileset:tile_completed';
  tileSetId: string;
  variantId: string;
  gridX: number;
  gridY: number;
  step: number;
  total: number;
}

export interface TileSetTileFailed {
  type: 'tileset:tile_failed';
  tileSetId: string;
  variantId: string;
  gridX: number;
  gridY: number;
  error: string;
}

export interface TileSetCompleted {
  type: 'tileset:completed';
  tileSetId: string;
  positions: TilePosition[];
}

export interface TileSetFailed {
  type: 'tileset:failed';
  tileSetId: string;
  error: string;
  failedStep: number;
}

export interface TileSetCancelled {
  type: 'tileset:cancelled';
  tileSetId: string;
}

export interface TileSetPipelineResult {
  requestId: string;
  tileSetId: string;
  assetId: string;
  gridWidth: number;
  gridHeight: number;
  totalTiles: number;
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  positions?: TilePosition[];
  error?: string;
  failedStep?: number;
}

type RotationPipelineMessage =
  | RotationStarted
  | RotationStepCompleted
  | RotationCompleted
  | RotationFailed
  | RotationCancelled;

type TileSetPipelineMessage =
  | TileSetStarted
  | TileSetTileCompleted
  | TileSetTileFailed
  | TileSetCompleted
  | TileSetFailed
  | TileSetCancelled;

// Server message type union (discriminated union for type narrowing)
type ServerMessage =
  | ChatResponse
  | ChatProgressMessage
  | GenerateStarted
  | RefineStarted
  | BatchStarted
  | GenerateError
  | RefineError
  | BatchError
  | GenerateResult
  | RefineResult
  | VariantUpdated
  | DescribeResponse
  | CompareResponse
  | SyncStateMessage
  | ErrorMessage
  | SimplePlanUpdatedMessage
  | SimplePlanArchivedMessage
  | ApprovalCreatedMessage
  | ApprovalUpdatedMessage
  | ApprovalListMessage
  | AutoExecutedMessage
  | SessionStateMessage
  | AssetCreatedMessage
  | AssetUpdatedMessage
  | AssetDeletedMessage
  | AssetForkedMessage
  | VariantDeletedMessage
  | RotationPipelineMessage
  | TileSetPipelineMessage;

/**
 * Client surface for asset-management mutations. Implemented by WebSocketClient;
 * declared separately so CLI commands can depend on (and tests can fake) just
 * the methods they use.
 */
export interface AssetMutationClient {
  connect(): Promise<void>;
  disconnect(): void;
  deleteAsset(assetId: string): Promise<void>;
  renameAsset(assetId: string, name: string): Promise<AssetRecord>;
  setActiveVariant(assetId: string, variantId: string): Promise<AssetRecord>;
}

/** Client surface for variant-management mutations. Implemented by WebSocketClient. */
export interface VariantMutationClient {
  connect(): Promise<void>;
  disconnect(): void;
  deleteVariant(variantId: string): Promise<void>;
  retryVariant(variantId: string): Promise<Variant>;
  starVariant(variantId: string, starred: boolean): Promise<Variant>;
  rateVariant(variantId: string, rating: 'approved' | 'rejected'): Promise<Variant>;
}

export interface PipelineClient {
  connect(): Promise<void>;
  disconnect(): void;
  setConnectionLogging?(enabled: boolean): void;
  sendRotationRequest(params: {
    sourceVariantId: string;
    config: RotationConfig;
    subjectDescription?: string;
    aspectRatio?: string;
    disableStyle?: boolean;
    generationMode?: RotationGenerationMode;
    waitForCompletion?: boolean;
    timeoutMs?: number;
    onStarted?: (data: RotationStarted) => void;
    onStepCompleted?: (data: RotationStepCompleted) => void;
  }): Promise<RotationPipelineResult>;
  cancelRotation(rotationSetId: string): Promise<RotationCancelled>;
  sendTileSetRequest(params: {
    tileType: TileType;
    gridWidth: number;
    gridHeight: number;
    prompt: string;
    seedVariantId?: string;
    aspectRatio?: string;
    disableStyle?: boolean;
    generationMode?: RotationGenerationMode;
    waitForCompletion?: boolean;
    timeoutMs?: number;
    onStarted?: (data: TileSetStarted) => void;
    onTileCompleted?: (data: TileSetTileCompleted) => void;
    onTileFailed?: (data: TileSetTileFailed) => void;
  }): Promise<TileSetPipelineResult>;
  cancelTileSet(tileSetId: string): Promise<TileSetCancelled>;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private baseUrl: string;
  private accessToken: string;
  private env: string;
  private spaceId: string;
  private connectionLoggingEnabled = true;

  // Pending request handlers
  private chatHandlers: Map<string, {
    resolve: (response: ChatResponse) => void;
    reject: (error: Error) => void;
  }> = new Map();

  private generateHandlers: Map<string, {
    onStarted?: (data: GenerateStarted) => void;
    onResult: (result: GenerateResult) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();

  private batchHandlers: Map<string, {
    onStarted?: (data: BatchStarted) => void;
    onResult: (result: BatchResult) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
    batchId?: string;
    pending: Set<string>;
    completed: Variant[];
    failed: Array<{ variantId: string; error: string }>;
  }> = new Map();

  private batchVariantToRequestId: Map<string, string> = new Map();

  // Track pending variant completions (variantId → callbacks)
  private variantCompletionHandlers: Map<string, {
    requestId: string;
    assetId: string;
    assetName: string;
    onUpdate?: (variant: Variant) => void;
    onResult: (result: GenerateResult) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();

  private describeHandlers: Map<string, {
    resolve: (response: DescribeResponse) => void;
    reject: (error: Error) => void;
  }> = new Map();

  private compareHandlers: Map<string, {
    resolve: (response: CompareResponse) => void;
    reject: (error: Error) => void;
  }> = new Map();

  // Pending mutation waiters (asset/variant management ops awaiting a broadcast)
  private mutationWaiters: Array<{
    predicate: (msg: ServerMessage) => boolean;
    resolve: (msg: ServerMessage) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = [];

  private rotationHandlers: Map<string, {
    requestId: string;
    waitForCompletion: boolean;
    onStarted?: (data: RotationStarted) => void;
    onStepCompleted?: (data: RotationStepCompleted) => void;
    resolve: (result: RotationPipelineResult) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
    started?: RotationStarted;
  }> = new Map();

  private rotationSetToRequestId: Map<string, string> = new Map();

  private tileSetHandlers: Map<string, {
    requestId: string;
    waitForCompletion: boolean;
    onStarted?: (data: TileSetStarted) => void;
    onTileCompleted?: (data: TileSetTileCompleted) => void;
    onTileFailed?: (data: TileSetTileFailed) => void;
    resolve: (result: TileSetPipelineResult) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
    started?: TileSetStarted;
  }> = new Map();

  private tileSetToRequestId: Map<string, string> = new Map();

  // Event handlers
  private onError?: (error: Error) => void;
  private onSyncState?: (data: { assets: unknown[]; variants: unknown[]; lineage: unknown[] }) => void;
  private onChatProgress?: (progress: ChatProgress) => void;

  // SimplePlan event handlers
  private onPlanUpdated?: (plan: SimplePlan) => void;
  private onPlanArchived?: (planId: string) => void;

  // Approval event handlers
  private onApprovalCreated?: (approval: PendingApproval) => void;
  private onApprovalUpdated?: (approval: PendingApproval) => void;
  private onApprovalList?: (approvals: PendingApproval[]) => void;
  private onAutoExecuted?: (autoExecuted: AutoExecuted) => void;

  // Session event handlers
  private onSessionState?: (session: UserSession | null) => void;

  constructor(baseUrl: string, accessToken: string, env: string, spaceId: string) {
    this.baseUrl = baseUrl;
    this.accessToken = accessToken;
    this.env = env;
    this.spaceId = spaceId;
  }

  setConnectionLogging(enabled: boolean): void {
    this.connectionLoggingEnabled = enabled;
  }

  /**
   * Create a WebSocketClient for a given environment and space
   */
  static async create(env: string, spaceId: string): Promise<WebSocketClient> {
    const config = await loadStoredConfig(env);
    if (!config) {
      throw new Error(
        `Not logged in to ${env} environment.\n` +
        `Run: ${loginCommandForEnvironment(env)}`
      );
    }

    if (config.token.expiresAt < Date.now()) {
      throw new Error(
        `Token expired for ${env} environment.\n` +
        `Run: ${loginCommandForEnvironment(env)}`
      );
    }

    const baseUrl = resolveBaseUrl(env);

    // Disable SSL verification for local dev
    if (env === 'local') {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }

    return new WebSocketClient(baseUrl, config.token.accessToken, env, spaceId);
  }

  /**
   * Connect to the WebSocket endpoint
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = this.baseUrl.startsWith('https') ? 'wss' : 'ws';
      const host = this.baseUrl.replace(/^https?:\/\//, '');
      const url = `${protocol}://${host}/api/spaces/${this.spaceId}/ws`;

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${this.accessToken}`,
      };

      // For local dev with self-signed certs, disable certificate verification
      const wsOptions: WebSocket.ClientOptions = { headers };
      if (this.env === 'local' && protocol === 'wss') {
        wsOptions.agent = new https.Agent({ rejectUnauthorized: false });
      } else if (this.env === 'local' && protocol === 'ws') {
        wsOptions.agent = new http.Agent();
      }

      this.ws = new WebSocket(url, wsOptions);

      this.ws.on('open', () => {
        if (this.connectionLoggingEnabled) {
          console.log(`[WebSocketClient] Connected to space ${this.spaceId}`);
        }
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as ServerMessage;
          this.handleMessage(message);
        } catch (err) {
          console.error('[WebSocketClient] Error parsing message:', err);
        }
      });

      this.ws.on('error', (err) => {
        console.error('[WebSocketClient] WebSocket error:', err);
        this.onError?.(err);
        reject(err);
      });

      this.ws.on('close', (code, reason) => {
        if (this.connectionLoggingEnabled) {
          console.log(`[WebSocketClient] Disconnected: ${code} - ${reason}`);
        }
        this.ws = null;
      });
    });
  }

  /**
   * Disconnect from the WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Set error handler
   */
  setOnError(handler: (error: Error) => void): void {
    this.onError = handler;
  }

  /**
   * Set sync state handler (called when initial state is received)
   */
  setOnSyncState(handler: (data: { assets: unknown[]; variants: unknown[]; lineage: unknown[] }) => void): void {
    this.onSyncState = handler;
  }

  /**
   * Set chat progress handler (agentic loop tool execution)
   */
  setOnChatProgress(handler: (progress: ChatProgress) => void): void {
    this.onChatProgress = handler;
  }

  /**
   * Set SimplePlan event handlers
   */
  setOnPlanUpdated(handler: (plan: SimplePlan) => void): void {
    this.onPlanUpdated = handler;
  }

  setOnPlanArchived(handler: (planId: string) => void): void {
    this.onPlanArchived = handler;
  }

  /**
   * Set approval event handlers
   */
  setOnApprovalCreated(handler: (approval: PendingApproval) => void): void {
    this.onApprovalCreated = handler;
  }

  setOnApprovalUpdated(handler: (approval: PendingApproval) => void): void {
    this.onApprovalUpdated = handler;
  }

  setOnApprovalList(handler: (approvals: PendingApproval[]) => void): void {
    this.onApprovalList = handler;
  }

  setOnAutoExecuted(handler: (autoExecuted: AutoExecuted) => void): void {
    this.onAutoExecuted = handler;
  }

  /**
   * Set session event handler
   */
  setOnSessionState(handler: (session: UserSession | null) => void): void {
    this.onSessionState = handler;
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(message: ServerMessage): void {
    // Resolve any pending mutation awaiting this broadcast (asset/variant ops).
    // Safe to run first: waiters only match their own success predicates and are
    // only registered for the duration of a single mutation call.
    this.notifyMutationWaiters(message);

    switch (message.type) {
      case 'chat:response': {
        const chatMsg = message as ChatResponse;
        const handler = this.chatHandlers.get(chatMsg.requestId);
        if (handler) {
          this.chatHandlers.delete(chatMsg.requestId);
          handler.resolve(chatMsg);
        }
        break;
      }

      case 'chat:progress': {
        const progressMsg = message as ChatProgressMessage;
        this.onChatProgress?.(progressMsg);
        break;
      }

      case 'generate:started':
      case 'refine:started': {
        const startedMsg = message as GenerateStarted | RefineStarted;
        const handler = this.generateHandlers.get(startedMsg.requestId);
        if (handler) {
          // Call onStarted callback if provided
          if (handler.onStarted) {
            handler.onStarted(startedMsg as GenerateStarted);
          }
          // Move handler to variant completion tracking (jobId === variantId)
          this.variantCompletionHandlers.set(startedMsg.jobId, {
            requestId: startedMsg.requestId,
            assetId: startedMsg.assetId,
            assetName: startedMsg.assetName,
            onResult: handler.onResult,
            reject: handler.reject,
            timeout: handler.timeout,
          });
          // Remove from request-based handlers (we'll resolve via variant:updated)
          this.generateHandlers.delete(startedMsg.requestId);
        }
        break;
      }

      case 'batch:started': {
        const startedMsg = message as BatchStarted;
        const handler = this.batchHandlers.get(startedMsg.requestId);
        if (handler) {
          handler.batchId = startedMsg.batchId;
          handler.pending = new Set(startedMsg.jobIds);
          for (const jobId of startedMsg.jobIds) {
            this.batchVariantToRequestId.set(jobId, startedMsg.requestId);
          }
          handler.onStarted?.(startedMsg);
        }
        break;
      }

      case 'generate:error':
      case 'refine:error': {
        const errorMsg = message as GenerateError | RefineError;
        const handler = this.generateHandlers.get(errorMsg.requestId);
        if (handler) {
          this.generateHandlers.delete(errorMsg.requestId);
          clearTimeout(handler.timeout);
          handler.reject(new Error(`${errorMsg.code}: ${errorMsg.error}`));
        }
        break;
      }

      case 'batch:error': {
        const errorMsg = message as BatchError;
        const handler = this.batchHandlers.get(errorMsg.requestId);
        if (handler) {
          this.batchHandlers.delete(errorMsg.requestId);
          clearTimeout(handler.timeout);
          handler.reject(new Error(`${errorMsg.code}: ${errorMsg.error}`));
        }
        break;
      }

      case 'variant:updated': {
        const updateMsg = message as VariantUpdated;
        const variant = updateMsg.variant;
        const batchRequestId = this.batchVariantToRequestId.get(variant.id);
        if (batchRequestId && (variant.status === 'completed' || variant.status === 'failed')) {
          const batchHandler = this.batchHandlers.get(batchRequestId);
          if (batchHandler && batchHandler.pending.has(variant.id)) {
            batchHandler.pending.delete(variant.id);
            this.batchVariantToRequestId.delete(variant.id);
            if (variant.status === 'completed') {
              batchHandler.completed.push(variant);
            } else {
              batchHandler.failed.push({
                variantId: variant.id,
                error: variant.error_message || 'Generation failed',
              });
            }

            if (batchHandler.pending.size === 0) {
              this.batchHandlers.delete(batchRequestId);
              clearTimeout(batchHandler.timeout);
              batchHandler.onResult({
                type: 'batch:result',
                requestId: batchRequestId,
                batchId: batchHandler.batchId || '',
                success: batchHandler.failed.length === 0,
                variants: batchHandler.completed,
                failed: batchHandler.failed,
              });
            }
          }
        }

        const handler = this.variantCompletionHandlers.get(variant.id);
        if (handler) {
          handler.onUpdate?.(variant);
          if (variant.status === 'completed' || variant.status === 'failed') {
            this.variantCompletionHandlers.delete(variant.id);
            clearTimeout(handler.timeout);
            // Convert to GenerateResult format for compatibility
            const result: GenerateResult = {
              type: 'generate:result',
              requestId: handler.requestId,
              jobId: variant.id,
              success: variant.status === 'completed',
              variant: variant.status === 'completed' ? variant : undefined,
              error: variant.status === 'failed' ? (variant.error_message || 'Generation failed') : undefined,
            };
            handler.onResult(result);
          }
        }
        break;
      }

      case 'generate:result':
      case 'refine:result': {
        // Legacy handler for backwards compatibility
        const resultMsg = message as GenerateResult;
        const handler = this.generateHandlers.get(resultMsg.requestId);
        if (handler) {
          this.generateHandlers.delete(resultMsg.requestId);
          clearTimeout(handler.timeout);
          handler.onResult(resultMsg);
        }
        break;
      }

      case 'sync:state': {
        const syncMsg = message as SyncStateMessage;
        this.onSyncState?.({
          assets: syncMsg.assets,
          variants: syncMsg.variants,
          lineage: syncMsg.lineage,
        });
        break;
      }

      case 'describe:response': {
        const describeMsg = message as DescribeResponse;
        const handler = this.describeHandlers.get(describeMsg.requestId);
        if (handler) {
          this.describeHandlers.delete(describeMsg.requestId);
          handler.resolve(describeMsg);
        }
        break;
      }

      case 'compare:response': {
        const compareMsg = message as CompareResponse;
        const handler = this.compareHandlers.get(compareMsg.requestId);
        if (handler) {
          this.compareHandlers.delete(compareMsg.requestId);
          handler.resolve(compareMsg);
        }
        break;
      }

      case 'error': {
        const errorMsg = message as ErrorMessage;
        // Reject any in-flight mutation so the CLI surfaces the server's reason.
        // If a mutation consumed it, don't also log to stderr (avoids double noise).
        const error = new Error(`${errorMsg.code}: ${errorMsg.message}`);
        const mutationConsumed = this.failMutationWaiters(error);
        const pipelineConsumed = this.failPipelineHandlers(error);
        const consumed = mutationConsumed || pipelineConsumed;
        if (!consumed) {
          console.error(`[WebSocketClient] Server error: ${errorMsg.code} - ${errorMsg.message}`);
          this.onError?.(new Error(errorMsg.message));
        }
        break;
      }

      case 'rotation:started':
      case 'rotation:step_completed':
      case 'rotation:completed':
      case 'rotation:failed':
      case 'rotation:cancelled':
        this.handleRotationPipelineMessage(message as RotationPipelineMessage);
        break;

      case 'tileset:started':
      case 'tileset:tile_completed':
      case 'tileset:tile_failed':
      case 'tileset:completed':
      case 'tileset:failed':
      case 'tileset:cancelled':
        this.handleTileSetPipelineMessage(message as TileSetPipelineMessage);
        break;

      // SimplePlan message handlers
      case 'simple_plan:updated': {
        const planMsg = message as SimplePlanUpdatedMessage;
        this.onPlanUpdated?.(planMsg.plan);
        break;
      }

      case 'simple_plan:archived': {
        const archivedMsg = message as SimplePlanArchivedMessage;
        this.onPlanArchived?.(archivedMsg.planId);
        break;
      }

      // Approval message handlers
      case 'approval:created': {
        const approvalMsg = message as ApprovalCreatedMessage;
        this.onApprovalCreated?.(approvalMsg.approval);
        break;
      }

      case 'approval:updated': {
        const approvalMsg = message as ApprovalUpdatedMessage;
        this.onApprovalUpdated?.(approvalMsg.approval);
        break;
      }

      case 'approval:list': {
        const listMsg = message as ApprovalListMessage;
        this.onApprovalList?.(listMsg.approvals);
        break;
      }

      case 'auto_executed': {
        const autoMsg = message as AutoExecutedMessage;
        this.onAutoExecuted?.(autoMsg.autoExecuted);
        break;
      }

      // Session message handler
      case 'session:state': {
        const sessionMsg = message as SessionStateMessage;
        this.onSessionState?.(sessionMsg.session);
        break;
      }

      default:
        // Ignore other message types
        break;
    }
  }

  // ==========================================================================
  // Mutation waiters (asset/variant management)
  // ==========================================================================

  private notifyMutationWaiters(message: ServerMessage): void {
    for (let i = 0; i < this.mutationWaiters.length; i++) {
      const waiter = this.mutationWaiters[i];
      if (waiter.predicate(message)) {
        this.mutationWaiters.splice(i, 1);
        clearTimeout(waiter.timeout);
        waiter.resolve(message);
        return;
      }
    }
  }

  /** Reject all in-flight mutations. Returns true if any were pending. */
  private failMutationWaiters(error: Error): boolean {
    if (this.mutationWaiters.length === 0) return false;
    const waiters = this.mutationWaiters.splice(0);
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    return true;
  }

  /** Reject all in-flight pipeline requests. Returns true if any were pending. */
  private failPipelineHandlers(error: Error): boolean {
    const hadHandlers = this.rotationHandlers.size > 0 || this.tileSetHandlers.size > 0;
    if (!hadHandlers) return false;

    for (const [requestId, handler] of this.rotationHandlers) {
      clearTimeout(handler.timeout);
      this.rotationHandlers.delete(requestId);
      handler.reject(error);
    }
    this.rotationSetToRequestId.clear();

    for (const [requestId, handler] of this.tileSetHandlers) {
      clearTimeout(handler.timeout);
      this.tileSetHandlers.delete(requestId);
      handler.reject(error);
    }
    this.tileSetToRequestId.clear();

    return true;
  }

  private handleRotationPipelineMessage(message: RotationPipelineMessage): void {
    if (message.type === 'rotation:started') {
      const handler = this.rotationHandlers.get(message.requestId);
      if (!handler) return;
      handler.started = message;
      this.rotationSetToRequestId.set(message.rotationSetId, message.requestId);
      handler.onStarted?.(message);

      if (!handler.waitForCompletion) {
        this.rotationHandlers.delete(message.requestId);
        this.rotationSetToRequestId.delete(message.rotationSetId);
        clearTimeout(handler.timeout);
        handler.resolve({
          requestId: message.requestId,
          rotationSetId: message.rotationSetId,
          assetId: message.assetId,
          totalSteps: message.totalSteps,
          directions: message.directions,
          status: 'started',
        });
      }
      return;
    }

    const requestId = this.rotationSetToRequestId.get(message.rotationSetId);
    if (!requestId) return;
    const handler = this.rotationHandlers.get(requestId);
    if (!handler) return;

    if (message.type === 'rotation:step_completed') {
      handler.onStepCompleted?.(message);
      return;
    }

    const started = handler.started;
    if (!started) return;

    this.rotationHandlers.delete(requestId);
    this.rotationSetToRequestId.delete(message.rotationSetId);
    clearTimeout(handler.timeout);

    if (message.type === 'rotation:completed') {
      handler.resolve({
        requestId,
        rotationSetId: message.rotationSetId,
        assetId: started.assetId,
        totalSteps: started.totalSteps,
        directions: started.directions,
        status: 'completed',
        views: message.views,
      });
      return;
    }

    if (message.type === 'rotation:failed') {
      handler.resolve({
        requestId,
        rotationSetId: message.rotationSetId,
        assetId: started.assetId,
        totalSteps: started.totalSteps,
        directions: started.directions,
        status: 'failed',
        error: message.error,
        failedStep: message.failedStep,
      });
      return;
    }

    handler.resolve({
      requestId,
      rotationSetId: message.rotationSetId,
      assetId: started.assetId,
      totalSteps: started.totalSteps,
      directions: started.directions,
      status: 'cancelled',
    });
  }

  private handleTileSetPipelineMessage(message: TileSetPipelineMessage): void {
    if (message.type === 'tileset:started') {
      const handler = this.tileSetHandlers.get(message.requestId);
      if (!handler) return;
      handler.started = message;
      this.tileSetToRequestId.set(message.tileSetId, message.requestId);
      handler.onStarted?.(message);

      if (!handler.waitForCompletion) {
        this.tileSetHandlers.delete(message.requestId);
        this.tileSetToRequestId.delete(message.tileSetId);
        clearTimeout(handler.timeout);
        handler.resolve({
          requestId: message.requestId,
          tileSetId: message.tileSetId,
          assetId: message.assetId,
          gridWidth: message.gridWidth,
          gridHeight: message.gridHeight,
          totalTiles: message.totalTiles,
          status: 'started',
        });
      }
      return;
    }

    const requestId = this.tileSetToRequestId.get(message.tileSetId);
    if (!requestId) return;
    const handler = this.tileSetHandlers.get(requestId);
    if (!handler) return;

    if (message.type === 'tileset:tile_completed') {
      handler.onTileCompleted?.(message);
      return;
    }

    if (message.type === 'tileset:tile_failed') {
      handler.onTileFailed?.(message);
      return;
    }

    const started = handler.started;
    if (!started) return;

    this.tileSetHandlers.delete(requestId);
    this.tileSetToRequestId.delete(message.tileSetId);
    clearTimeout(handler.timeout);

    if (message.type === 'tileset:completed') {
      handler.resolve({
        requestId,
        tileSetId: message.tileSetId,
        assetId: started.assetId,
        gridWidth: started.gridWidth,
        gridHeight: started.gridHeight,
        totalTiles: started.totalTiles,
        status: 'completed',
        positions: message.positions,
      });
      return;
    }

    if (message.type === 'tileset:failed') {
      handler.resolve({
        requestId,
        tileSetId: message.tileSetId,
        assetId: started.assetId,
        gridWidth: started.gridWidth,
        gridHeight: started.gridHeight,
        totalTiles: started.totalTiles,
        status: 'failed',
        error: message.error,
        failedStep: message.failedStep,
      });
      return;
    }

    handler.resolve({
      requestId,
      tileSetId: message.tileSetId,
      assetId: started.assetId,
      gridWidth: started.gridWidth,
      gridHeight: started.gridHeight,
      totalTiles: started.totalTiles,
      status: 'cancelled',
    });
  }

  /**
   * Send a mutation message and resolve when a matching broadcast arrives, or
   * reject on a server `error` message / timeout. Used by the management ops
   * below, which run on a dedicated short-lived connection (one op at a time).
   */
  private awaitServerMessage<T extends ServerMessage>(
    message: object,
    predicate: (msg: ServerMessage) => msg is T,
    timeoutMs = 30_000
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const waiter = {
        predicate,
        resolve: resolve as (msg: ServerMessage) => void,
        reject,
        timeout: setTimeout(() => {
          this.removeWaiter(waiter);
          reject(new Error('Timed out waiting for server confirmation'));
        }, timeoutMs),
      };
      this.mutationWaiters.push(waiter);
      try {
        this.send(message);
      } catch (err) {
        this.removeWaiter(waiter);
        clearTimeout(waiter.timeout);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private removeWaiter(waiter: unknown): void {
    const index = this.mutationWaiters.indexOf(waiter as never);
    if (index >= 0) this.mutationWaiters.splice(index, 1);
  }

  // ==========================================================================
  // Asset management mutations
  // ==========================================================================

  /** Delete an asset (and its variants). Resolves once the deletion is confirmed. */
  async deleteAsset(assetId: string): Promise<void> {
    await this.awaitServerMessage(
      { type: 'asset:delete', assetId },
      (msg): msg is AssetDeletedMessage => msg.type === 'asset:deleted' && msg.assetId === assetId
    );
  }

  /** Rename an asset. Resolves with the updated asset record. */
  async renameAsset(assetId: string, name: string): Promise<AssetRecord> {
    // Match the new name too: `asset:updated` is broadcast for many reasons
    // (concurrent edits, child reparenting), so matching the asset id alone
    // could resolve on an unrelated broadcast.
    const result = await this.awaitServerMessage(
      { type: 'asset:update', assetId, changes: { name } },
      (msg): msg is AssetUpdatedMessage =>
        msg.type === 'asset:updated' && msg.asset.id === assetId && msg.asset.name === name
    );
    return result.asset;
  }

  /** Set the active variant of an asset. Resolves with the updated asset record. */
  async setActiveVariant(assetId: string, variantId: string): Promise<AssetRecord> {
    const result = await this.awaitServerMessage(
      { type: 'asset:setActive', assetId, variantId },
      (msg): msg is AssetUpdatedMessage =>
        msg.type === 'asset:updated' && msg.asset.id === assetId && msg.asset.active_variant_id === variantId
    );
    return result.asset;
  }

  // ==========================================================================
  // Variant management mutations
  // ==========================================================================

  /** Delete a variant. Resolves once the deletion is confirmed. */
  async deleteVariant(variantId: string): Promise<void> {
    await this.awaitServerMessage(
      { type: 'variant:delete', variantId },
      (msg): msg is VariantDeletedMessage => msg.type === 'variant:deleted' && msg.variantId === variantId
    );
  }

  /** Retry a failed variant. Resolves once it has been re-queued (status pending). */
  async retryVariant(variantId: string): Promise<Variant> {
    const result = await this.awaitServerMessage(
      { type: 'variant:retry', variantId },
      (msg): msg is VariantUpdated =>
        msg.type === 'variant:updated' && msg.variant.id === variantId && msg.variant.status === 'pending'
    );
    return result.variant;
  }

  /** Star or unstar a variant. Resolves with the updated variant. */
  async starVariant(variantId: string, starred: boolean): Promise<Variant> {
    const result = await this.awaitServerMessage(
      { type: 'variant:star', variantId, starred },
      (msg): msg is VariantUpdated =>
        msg.type === 'variant:updated' && msg.variant.id === variantId && msg.variant.starred === starred
    );
    return result.variant;
  }

  /** Rate a variant (approved/rejected). Resolves with the updated variant. */
  async rateVariant(variantId: string, rating: 'approved' | 'rejected'): Promise<Variant> {
    // Match the new rating too: `variant:updated` fires for many reasons (star,
    // status changes), so matching the variant id alone could resolve early on
    // an unrelated broadcast.
    const result = await this.awaitServerMessage(
      { type: 'variant:rate', variantId, rating },
      (msg): msg is VariantUpdated =>
        msg.type === 'variant:updated' && msg.variant.id === variantId && msg.variant.quality_rating === rating
    );
    return result.variant;
  }

  // ==========================================================================
  // Rotation and tile-set pipelines
  // ==========================================================================

  async sendRotationRequest(params: {
    sourceVariantId: string;
    config: RotationConfig;
    subjectDescription?: string;
    aspectRatio?: string;
    disableStyle?: boolean;
    generationMode?: RotationGenerationMode;
    waitForCompletion?: boolean;
    timeoutMs?: number;
    onStarted?: (data: RotationStarted) => void;
    onStepCompleted?: (data: RotationStepCompleted) => void;
  }): Promise<RotationPipelineResult> {
    const requestId = crypto.randomUUID();
    const waitForCompletion = params.waitForCompletion ?? true;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const handler = this.rotationHandlers.get(requestId);
        if (!handler) return;
        this.rotationHandlers.delete(requestId);
        if (handler.started) {
          this.rotationSetToRequestId.delete(handler.started.rotationSetId);
        }
        reject(new Error('Rotation pipeline request timed out'));
      }, params.timeoutMs ?? PIPELINE_REQUEST_TIMEOUT_MS);

      this.rotationHandlers.set(requestId, {
        requestId,
        waitForCompletion,
        onStarted: params.onStarted,
        onStepCompleted: params.onStepCompleted,
        resolve,
        reject,
        timeout,
      });

      try {
        this.send({
          type: 'rotation:request',
          requestId,
          sourceVariantId: params.sourceVariantId,
          config: params.config,
          subjectDescription: params.subjectDescription,
          aspectRatio: params.aspectRatio,
          disableStyle: params.disableStyle,
          generationMode: params.generationMode,
        });
      } catch (err) {
        this.rotationHandlers.delete(requestId);
        clearTimeout(timeout);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async cancelRotation(rotationSetId: string): Promise<RotationCancelled> {
    return this.awaitServerMessage(
      { type: 'rotation:cancel', rotationSetId },
      (msg): msg is RotationCancelled =>
        msg.type === 'rotation:cancelled' && msg.rotationSetId === rotationSetId
    );
  }

  async sendTileSetRequest(params: {
    tileType: TileType;
    gridWidth: number;
    gridHeight: number;
    prompt: string;
    seedVariantId?: string;
    aspectRatio?: string;
    disableStyle?: boolean;
    generationMode?: RotationGenerationMode;
    waitForCompletion?: boolean;
    timeoutMs?: number;
    onStarted?: (data: TileSetStarted) => void;
    onTileCompleted?: (data: TileSetTileCompleted) => void;
    onTileFailed?: (data: TileSetTileFailed) => void;
  }): Promise<TileSetPipelineResult> {
    const requestId = crypto.randomUUID();
    const waitForCompletion = params.waitForCompletion ?? true;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const handler = this.tileSetHandlers.get(requestId);
        if (!handler) return;
        this.tileSetHandlers.delete(requestId);
        if (handler.started) {
          this.tileSetToRequestId.delete(handler.started.tileSetId);
        }
        reject(new Error('Tile set pipeline request timed out'));
      }, params.timeoutMs ?? PIPELINE_REQUEST_TIMEOUT_MS);

      this.tileSetHandlers.set(requestId, {
        requestId,
        waitForCompletion,
        onStarted: params.onStarted,
        onTileCompleted: params.onTileCompleted,
        onTileFailed: params.onTileFailed,
        resolve,
        reject,
        timeout,
      });

      try {
        this.send({
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
      } catch (err) {
        this.tileSetHandlers.delete(requestId);
        clearTimeout(timeout);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async cancelTileSet(tileSetId: string): Promise<TileSetCancelled> {
    return this.awaitServerMessage(
      { type: 'tileset:cancel', tileSetId },
      (msg): msg is TileSetCancelled =>
        msg.type === 'tileset:cancelled' && msg.tileSetId === tileSetId
    );
  }

  /**
   * Send a message through the WebSocket
   */
  private send(message: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Send a chat request and wait for response
   */
  async sendChatRequest(params: {
    message: string;
    mode: 'advisor' | 'actor';
    forgeContext?: ChatRequestMessage['forgeContext'];
    viewingContext?: ChatRequestMessage['viewingContext'];
  }): Promise<ChatResponse> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      // Set up handler for response
      this.chatHandlers.set(requestId, { resolve, reject });

      // Send the request
      const message: ChatRequestMessage = {
        type: 'chat:request',
        requestId,
        message: params.message,
        mode: params.mode,
        forgeContext: params.forgeContext,
        viewingContext: params.viewingContext,
      };

      try {
        this.send(message);
      } catch (err) {
        this.chatHandlers.delete(requestId);
        reject(err);
      }

      // Timeout after 2 minutes
      setTimeout(() => {
        if (this.chatHandlers.has(requestId)) {
          this.chatHandlers.delete(requestId);
          reject(new Error('Chat request timed out'));
        }
      }, 120000);
    });
  }

  /**
   * Send a generate request and wait for result
   */
  async sendGenerateRequest(params: {
    name: string;
    assetType: string;
    prompt?: string;
    referenceAssetIds?: string[];
    referenceVariantIds?: string[];
    model?: string;
    aspectRatio?: string;
    imageSize?: string;
    parentAssetId?: string;
    disableStyle?: boolean;
    mediaKind?: MediaKind;
    voiceId?: string;
    dialogueVoiceIds?: string[];
    musicProvider?: MusicGenerationProvider;
    generateAudio?: boolean;
    videoResolution?: VideoGenerationResolution;
    videoDurationSeconds?: VideoGenerationDurationSeconds;
    videoTier?: VideoGenerationTier;
    onStarted?: (data: GenerateStarted) => void;
  }): Promise<GenerateResult> {
    const requestId = crypto.randomUUID();
    const timeoutMs = getGenerationRequestTimeoutMs(params.mediaKind);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const requestHandler = this.generateHandlers.get(requestId);
        if (requestHandler) {
          this.generateHandlers.delete(requestId);
          reject(new Error('Generate request timed out'));
          return;
        }

        for (const [variantId, handler] of this.variantCompletionHandlers) {
          if (handler.requestId === requestId) {
            this.variantCompletionHandlers.delete(variantId);
            reject(new Error('Generate request timed out'));
            return;
          }
        }
      }, timeoutMs);

      // Set up handler for response
      this.generateHandlers.set(requestId, {
        onStarted: params.onStarted,
        onResult: resolve,
        reject,
        timeout,
      });

      // Send the request
      const message: GenerateRequestMessage = {
        type: 'generate:request',
        requestId,
        name: params.name,
        assetType: params.assetType,
        prompt: params.prompt,
        referenceAssetIds: params.referenceAssetIds,
        referenceVariantIds: params.referenceVariantIds,
        model: params.model,
        aspectRatio: params.aspectRatio,
        imageSize: params.imageSize,
        parentAssetId: params.parentAssetId,
        disableStyle: params.disableStyle,
        mediaKind: params.mediaKind,
        voiceId: params.voiceId,
        dialogueVoiceIds: params.dialogueVoiceIds,
        musicProvider: params.musicProvider,
        generateAudio: params.generateAudio,
        videoResolution: params.videoResolution,
        videoDurationSeconds: params.videoDurationSeconds,
        videoTier: params.videoTier,
      };

      try {
        this.send(message);
      } catch (err) {
        this.generateHandlers.delete(requestId);
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  async followVariant(params: {
    variantId: string;
    requestId?: string;
    timeoutMs?: number;
    onUpdate?: (variant: Variant) => void;
  }): Promise<GenerateResult> {
    const requestId = params.requestId || crypto.randomUUID();
    const timeoutMs = params.timeoutMs ?? GENERATION_REQUEST_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const handler = this.variantCompletionHandlers.get(params.variantId);
        if (handler?.requestId === requestId) {
          this.variantCompletionHandlers.delete(params.variantId);
          reject(new Error('Follow request timed out'));
        }
      }, timeoutMs);

      this.variantCompletionHandlers.set(params.variantId, {
        requestId,
        assetId: '',
        assetName: '',
        onUpdate: params.onUpdate,
        onResult: resolve,
        reject,
        timeout,
      });
    });
  }

  cancelFollowVariant(variantId: string, requestId?: string): void {
    const handler = this.variantCompletionHandlers.get(variantId);
    if (!handler) return;
    if (requestId && handler.requestId !== requestId) return;
    this.variantCompletionHandlers.delete(variantId);
    clearTimeout(handler.timeout);
  }

  /**
   * Send a refine request and wait for result
   */
  async sendRefineRequest(params: {
    assetId: string;
    prompt: string;
    sourceVariantId?: string;
    sourceVariantIds?: string[];
    referenceAssetIds?: string[];
    model?: string;
    aspectRatio?: string;
    imageSize?: string;
    disableStyle?: boolean;
    mediaKind?: MediaKind;
    voiceId?: string;
    dialogueVoiceIds?: string[];
    generateAudio?: boolean;
    videoResolution?: VideoGenerationResolution;
    videoDurationSeconds?: VideoGenerationDurationSeconds;
    videoTier?: VideoGenerationTier;
    onStarted?: (data: GenerateStarted) => void;
  }): Promise<GenerateResult> {
    const requestId = crypto.randomUUID();
    const timeoutMs = getGenerationRequestTimeoutMs(params.mediaKind);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const requestHandler = this.generateHandlers.get(requestId);
        if (requestHandler) {
          this.generateHandlers.delete(requestId);
          reject(new Error('Refine request timed out'));
          return;
        }

        for (const [variantId, handler] of this.variantCompletionHandlers) {
          if (handler.requestId === requestId) {
            this.variantCompletionHandlers.delete(variantId);
            reject(new Error('Refine request timed out'));
            return;
          }
        }
      }, timeoutMs);

      // Set up handler for response
      this.generateHandlers.set(requestId, {
        onStarted: params.onStarted,
        onResult: resolve,
        reject,
        timeout,
      });

      // Send the request
      const message: RefineRequestMessage = {
        type: 'refine:request',
        requestId,
        assetId: params.assetId,
        prompt: params.prompt,
        sourceVariantId: params.sourceVariantId,
        sourceVariantIds: params.sourceVariantIds,
        referenceAssetIds: params.referenceAssetIds,
        model: params.model,
        aspectRatio: params.aspectRatio,
        imageSize: params.imageSize,
        disableStyle: params.disableStyle,
        mediaKind: params.mediaKind,
        voiceId: params.voiceId,
        dialogueVoiceIds: params.dialogueVoiceIds,
        generateAudio: params.generateAudio,
        videoResolution: params.videoResolution,
        videoDurationSeconds: params.videoDurationSeconds,
        videoTier: params.videoTier,
      };

      try {
        this.send(message);
      } catch (err) {
        this.generateHandlers.delete(requestId);
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  /**
   * Send a batch generation request and wait for all variants to finish.
   */
  async sendBatchRequest(params: {
    name: string;
    assetType: string;
    prompt: string;
    count: number;
    mode: 'explore' | 'set';
    referenceVariantIds?: string[];
    model?: string;
    aspectRatio?: string;
    imageSize?: string;
    parentAssetId?: string;
    disableStyle?: boolean;
    mediaKind?: MediaKind;
    voiceId?: string;
    dialogueVoiceIds?: string[];
    musicProvider?: MusicGenerationProvider;
    onStarted?: (data: BatchStarted) => void;
  }): Promise<BatchResult> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const handler = this.batchHandlers.get(requestId);
        if (handler) {
          this.batchHandlers.delete(requestId);
          for (const variantId of handler.pending) {
            this.batchVariantToRequestId.delete(variantId);
          }
          reject(new Error('Batch request timed out'));
        }
      }, 300000);

      this.batchHandlers.set(requestId, {
        onStarted: params.onStarted,
        onResult: resolve,
        reject,
        timeout,
        pending: new Set(),
        completed: [],
        failed: [],
      });

      const message: BatchRequestMessage = {
        type: 'batch:request',
        requestId,
        name: params.name,
        assetType: params.assetType,
        prompt: params.prompt,
        count: params.count,
        mode: params.mode,
        referenceVariantIds: params.referenceVariantIds,
        model: params.model,
        aspectRatio: params.aspectRatio,
        imageSize: params.imageSize,
        parentAssetId: params.parentAssetId,
        disableStyle: params.disableStyle,
        mediaKind: params.mediaKind,
        voiceId: params.voiceId,
        dialogueVoiceIds: params.dialogueVoiceIds,
        musicProvider: params.musicProvider,
      };

      try {
        this.send(message);
      } catch (err) {
        this.batchHandlers.delete(requestId);
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  /**
   * Send a describe image request and wait for response
   */
  async sendDescribeRequest(params: {
    assetId: string;
    variantId: string;
    assetName: string;
    focus?: DescribeFocus;
    question?: string;
  }): Promise<DescribeResponse> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      // Set up handler for response
      this.describeHandlers.set(requestId, { resolve, reject });

      // Send the request
      const message: DescribeRequestMessage = {
        type: 'describe:request',
        requestId,
        assetId: params.assetId,
        variantId: params.variantId,
        assetName: params.assetName,
        focus: params.focus,
        question: params.question,
      };

      try {
        this.send(message);
      } catch (err) {
        this.describeHandlers.delete(requestId);
        reject(err);
      }

      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.describeHandlers.has(requestId)) {
          this.describeHandlers.delete(requestId);
          reject(new Error('Describe request timed out'));
        }
      }, 60000);
    });
  }

  /**
   * Send a compare images request and wait for response
   */
  async sendCompareRequest(params: {
    variantIds: string[];
    aspects?: string[];
  }): Promise<CompareResponse> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      // Set up handler for response
      this.compareHandlers.set(requestId, { resolve, reject });

      // Send the request
      const message: CompareRequestMessage = {
        type: 'compare:request',
        requestId,
        variantIds: params.variantIds,
        aspects: params.aspects,
      };

      try {
        this.send(message);
      } catch (err) {
        this.compareHandlers.delete(requestId);
        reject(err);
      }

      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.compareHandlers.has(requestId)) {
          this.compareHandlers.delete(requestId);
          reject(new Error('Compare request timed out'));
        }
      }, 60000);
    });
  }

  /**
   * Request sync state (initial state load)
   */
  requestSync(): void {
    this.send({ type: 'sync:request' });
  }

  // ==========================================================================
  // Approval Methods
  // ==========================================================================

  /**
   * Approve a pending approval
   */
  approveApproval(approvalId: string): void {
    this.send({ type: 'approval:approve', approvalId });
  }

  /**
   * Reject a pending approval
   */
  rejectApproval(approvalId: string): void {
    this.send({ type: 'approval:reject', approvalId });
  }

  /**
   * Request list of pending approvals
   */
  listApprovals(): void {
    this.send({ type: 'approval:list' });
  }

  // ==========================================================================
  // Session Methods
  // ==========================================================================

  /**
   * Get current session state
   */
  getSession(): void {
    this.send({ type: 'session:get' });
  }

  /**
   * Update session context (viewing, forge tray)
   */
  updateSession(data: {
    viewingAssetId?: string | null;
    viewingVariantId?: string | null;
    forgeContext?: string | null;
  }): void {
    this.send({ type: 'session:update', ...data });
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
