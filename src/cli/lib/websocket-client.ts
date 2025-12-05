/**
 * WebSocket Client for CLI
 *
 * Provides WebSocket-based communication with the Space Durable Object.
 * Replaces HTTP API calls with WebSocket messages for chat and generation.
 */

import process from 'node:process';
import https from 'node:https';
import WebSocket from 'ws';
import { loadStoredConfig, resolveBaseUrl } from './config';
import type { DescribeFocus, ClaudeUsage, SimplePlan } from '../../shared/websocket-types';

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
  aspectRatio?: string;
  parentAssetId?: string;
}

interface RefineRequestMessage {
  type: 'refine:request';
  requestId: string;
  assetId: string;
  prompt: string;
  sourceVariantId?: string;
  referenceAssetIds?: string[];
  aspectRatio?: string;
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
}

/** Variant status lifecycle */
type VariantStatus = 'pending' | 'processing' | 'uploading' | 'completed' | 'failed';

/** Variant from backend (placeholder variants architecture) */
interface Variant {
  id: string;
  asset_id: string;
  workflow_id: string | null;
  status: VariantStatus;
  error_message: string | null;
  image_key: string | null;
  thumb_key: string | null;
  recipe: string;
  starred: boolean;
  created_by: string;
  created_at: number;
  updated_at: number | null;
}

interface GenerateStarted {
  type: 'generate:started';
  requestId: string;
  jobId: string; // This is the variantId
  assetId: string;
  assetName: string;
}

interface RefineStarted {
  type: 'refine:started';
  requestId: string;
  jobId: string; // This is the variantId
  assetId: string;
  assetName: string;
}

interface VariantUpdated {
  type: 'variant:updated';
  variant: Variant;
}

// Legacy result types (deprecated, but kept for compatibility)
interface GenerateResult {
  type: 'generate:result';
  requestId: string;
  jobId: string;
  success: boolean;
  variant?: Variant;
  error?: string;
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

// Server message type union (discriminated union for type narrowing)
type ServerMessage =
  | ChatResponse
  | GenerateStarted
  | RefineStarted
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
  | SessionStateMessage;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private baseUrl: string;
  private accessToken: string;
  private env: string;
  private spaceId: string;

  // Pending request handlers
  private chatHandlers: Map<string, {
    resolve: (response: ChatResponse) => void;
    reject: (error: Error) => void;
  }> = new Map();

  private generateHandlers: Map<string, {
    onStarted?: (data: GenerateStarted) => void;
    onResult: (result: GenerateResult) => void;
    reject: (error: Error) => void;
  }> = new Map();

  // Track pending variant completions (variantId → callbacks)
  private variantCompletionHandlers: Map<string, {
    requestId: string;
    assetId: string;
    assetName: string;
    onResult: (result: GenerateResult) => void;
    reject: (error: Error) => void;
  }> = new Map();

  private describeHandlers: Map<string, {
    resolve: (response: DescribeResponse) => void;
    reject: (error: Error) => void;
  }> = new Map();

  private compareHandlers: Map<string, {
    resolve: (response: CompareResponse) => void;
    reject: (error: Error) => void;
  }> = new Map();

  // Event handlers
  private onError?: (error: Error) => void;
  private onSyncState?: (data: { assets: unknown[]; variants: unknown[]; lineage: unknown[] }) => void;

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

  /**
   * Create a WebSocketClient for a given environment and space
   */
  static async create(env: string, spaceId: string): Promise<WebSocketClient> {
    const config = await loadStoredConfig(env);
    if (!config) {
      throw new Error(
        `Not logged in to ${env} environment.\n` +
        `Run: npm run cli login --env ${env}`
      );
    }

    if (config.token.expiresAt < Date.now()) {
      throw new Error(
        `Token expired for ${env} environment.\n` +
        `Run: npm run cli login --env ${env}`
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
      if (this.env === 'local') {
        wsOptions.agent = new https.Agent({ rejectUnauthorized: false });
      }

      this.ws = new WebSocket(url, wsOptions);

      this.ws.on('open', () => {
        console.log(`[WebSocketClient] Connected to space ${this.spaceId}`);
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
        console.log(`[WebSocketClient] Disconnected: ${code} - ${reason}`);
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
          });
          // Remove from request-based handlers (we'll resolve via variant:updated)
          this.generateHandlers.delete(startedMsg.requestId);
        }
        break;
      }

      case 'variant:updated': {
        const updateMsg = message as VariantUpdated;
        const variant = updateMsg.variant;
        const handler = this.variantCompletionHandlers.get(variant.id);
        if (handler && (variant.status === 'completed' || variant.status === 'failed')) {
          this.variantCompletionHandlers.delete(variant.id);
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
        break;
      }

      case 'generate:result':
      case 'refine:result': {
        // Legacy handler for backwards compatibility
        const resultMsg = message as GenerateResult;
        const handler = this.generateHandlers.get(resultMsg.requestId);
        if (handler) {
          this.generateHandlers.delete(resultMsg.requestId);
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
        console.error(`[WebSocketClient] Server error: ${errorMsg.code} - ${errorMsg.message}`);
        this.onError?.(new Error(errorMsg.message));
        break;
      }

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
    aspectRatio?: string;
    parentAssetId?: string;
    onStarted?: (data: GenerateStarted) => void;
  }): Promise<GenerateResult> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      // Set up handler for response
      this.generateHandlers.set(requestId, {
        onStarted: params.onStarted,
        onResult: resolve,
        reject,
      });

      // Send the request
      const message: GenerateRequestMessage = {
        type: 'generate:request',
        requestId,
        name: params.name,
        assetType: params.assetType,
        prompt: params.prompt,
        referenceAssetIds: params.referenceAssetIds,
        aspectRatio: params.aspectRatio,
        parentAssetId: params.parentAssetId,
      };

      try {
        this.send(message);
      } catch (err) {
        this.generateHandlers.delete(requestId);
        reject(err);
      }

      // Timeout after 5 minutes (generation can take a while)
      setTimeout(() => {
        if (this.generateHandlers.has(requestId)) {
          this.generateHandlers.delete(requestId);
          reject(new Error('Generate request timed out'));
        }
      }, 300000);
    });
  }

  /**
   * Send a refine request and wait for result
   */
  async sendRefineRequest(params: {
    assetId: string;
    prompt: string;
    sourceVariantId?: string;
    referenceAssetIds?: string[];
    aspectRatio?: string;
    onStarted?: (data: GenerateStarted) => void;
  }): Promise<GenerateResult> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      // Set up handler for response
      this.generateHandlers.set(requestId, {
        onStarted: params.onStarted,
        onResult: resolve,
        reject,
      });

      // Send the request
      const message: RefineRequestMessage = {
        type: 'refine:request',
        requestId,
        assetId: params.assetId,
        prompt: params.prompt,
        sourceVariantId: params.sourceVariantId,
        referenceAssetIds: params.referenceAssetIds,
        aspectRatio: params.aspectRatio,
      };

      try {
        this.send(message);
      } catch (err) {
        this.generateHandlers.delete(requestId);
        reject(err);
      }

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.generateHandlers.has(requestId)) {
          this.generateHandlers.delete(requestId);
          reject(new Error('Refine request timed out'));
        }
      }, 300000);
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
