import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../../core/types';
import { AuthService } from '../features/auth/auth-service';
import type {
  ChatRequestMessage,
  GenerateRequestMessage,
  RefineRequestMessage,
  DescribeRequestMessage,
  CompareRequestMessage,
  ChatWorkflowOutput,
  GenerationWorkflowOutput,
} from '../workflows/types';
import type {
  Asset,
  Variant,
  WebSocketMeta,
  ClientMessage,
  ServerMessage,
} from './space/types';
import { SpaceRepository } from './space/repository/SpaceRepository';
import { SchemaManager } from './space/schema/SchemaManager';

// Import controllers
import {
  type ControllerContext,
  PermissionError,
  NotFoundError,
  ValidationError,
  PresenceController,
  SyncController,
  ChatController,
  LineageController,
  AssetController,
  VariantController,
  GenerationController,
  VisionController,
} from './space/controllers';

// ============================================================================
// SpaceDO - Durable Object for Space State & WebSocket Hub
// ============================================================================

export class SpaceDO extends DurableObject<Env> {
  private spaceId: string | null = null;
  private initialized = false;
  private repo!: SpaceRepository;

  // Controllers
  private presenceCtrl!: PresenceController;
  private syncCtrl!: SyncController;
  private chatCtrl!: ChatController;
  private lineageCtrl!: LineageController;
  private assetCtrl!: AssetController;
  private variantCtrl!: VariantController;
  private generationCtrl!: GenerationController;
  private visionCtrl!: VisionController;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /**
   * Extract spaceId from the request URL
   * The URL pattern is /api/spaces/:spaceId/ws
   */
  private extractSpaceId(request: Request): string | null {
    const url = new URL(request.url);
    const match = url.pathname.match(/\/api\/spaces\/([^/]+)/);
    return match ? match[1] : null;
  }

  /**
   * Initialize SQLite schema and controllers on first access
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.initialized) return;

      // Initialize schema and run migrations
      const schemaManager = new SchemaManager(this.ctx.storage.sql);
      await schemaManager.initialize();

      // Initialize repository
      this.repo = new SpaceRepository(this.ctx.storage.sql, this.env.IMAGES);

      // Create controller context
      const ctx: ControllerContext = {
        spaceId: this.spaceId!,
        repo: this.repo,
        env: this.env,
        sql: this.ctx.storage.sql,
        broadcast: this.broadcast.bind(this),
        send: this.send.bind(this),
        sendError: this.sendError.bind(this),
      };

      // Initialize controllers
      this.presenceCtrl = new PresenceController(ctx);
      this.syncCtrl = new SyncController(ctx, this.presenceCtrl);
      this.chatCtrl = new ChatController(ctx);
      this.lineageCtrl = new LineageController(ctx);
      this.assetCtrl = new AssetController(ctx);
      this.variantCtrl = new VariantController(ctx);
      this.generationCtrl = new GenerationController(ctx);
      this.visionCtrl = new VisionController(ctx);

      this.initialized = true;
    });
  }

  // ============================================================================
  // Main Entry Points
  // ============================================================================

  /**
   * Main fetch handler for WebSocket upgrades and internal HTTP endpoints
   */
  async fetch(request: Request): Promise<Response> {
    if (!this.spaceId) {
      this.spaceId = this.extractSpaceId(request);
    }

    await this.ensureInitialized();

    const url = new URL(request.url);

    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request);
    }

    // Route to controllers
    return this.routeHttpRequest(url, request);
  }

  /**
   * Handle incoming WebSocket messages
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') {
      this.sendError(ws, 'INVALID_MESSAGE', 'Expected JSON string');
      return;
    }

    try {
      const msg = JSON.parse(message) as ClientMessage;
      const meta = this.getWebSocketMeta(ws);
      await this.routeWebSocketMessage(ws, meta, msg);
    } catch (error) {
      if (error instanceof PermissionError) {
        this.sendError(ws, 'PERMISSION_DENIED', error.message);
      } else if (error instanceof NotFoundError) {
        this.sendError(ws, 'NOT_FOUND', error.message);
      } else if (error instanceof ValidationError) {
        this.sendError(ws, 'VALIDATION_ERROR', error.message);
      } else {
        console.error('[SpaceDO] Error handling WebSocket message:', error);
        this.sendError(ws, 'INTERNAL_ERROR', 'Failed to process message');
      }
    }
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const meta = this.getWebSocketMeta(ws);
    this.presenceCtrl.handleDisconnect(meta);
    ws.close(code, reason);
  }

  /**
   * Handle WebSocket error
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('[SpaceDO] WebSocket error:', error);
  }

  // ============================================================================
  // WebSocket Routing
  // ============================================================================

  private async routeWebSocketMessage(
    ws: WebSocket,
    meta: WebSocketMeta,
    msg: ClientMessage
  ): Promise<void> {
    switch (msg.type) {
      // Sync
      case 'sync:request':
        return this.syncCtrl.handleSyncRequest(ws);

      // Asset
      case 'asset:create':
        return this.assetCtrl.handleCreate(ws, meta, msg.name, msg.assetType, msg.parentAssetId);
      case 'asset:update':
        return this.assetCtrl.handleUpdate(ws, meta, msg.assetId, msg.changes);
      case 'asset:delete':
        return this.assetCtrl.handleDelete(ws, meta, msg.assetId);
      case 'asset:setActive':
        return this.assetCtrl.handleSetActive(ws, meta, msg.assetId, msg.variantId);
      case 'asset:spawn':
        return this.assetCtrl.handleSpawn(
          ws,
          meta,
          msg.sourceVariantId,
          msg.name,
          msg.assetType,
          msg.parentAssetId
        );

      // Variant
      case 'variant:delete':
        return this.variantCtrl.handleDelete(ws, meta, msg.variantId);
      case 'variant:star':
        return this.variantCtrl.handleStar(ws, meta, msg.variantId, msg.starred);

      // Lineage
      case 'lineage:sever':
        return this.lineageCtrl.handleSever(ws, meta, msg.lineageId);

      // Chat
      case 'chat:send':
        return this.chatCtrl.handleSend(ws, meta, msg.content);

      // Presence
      case 'presence:update':
        return this.presenceCtrl.handleUpdate(meta, msg.viewing);

      // Workflow triggers
      case 'chat:request':
        return this.generationCtrl.handleChatRequest(ws, meta, msg as ChatRequestMessage);
      case 'generate:request':
        return this.generationCtrl.handleGenerateRequest(ws, meta, msg as GenerateRequestMessage);
      case 'refine:request':
        return this.generationCtrl.handleRefineRequest(ws, meta, msg as RefineRequestMessage);

      // Vision
      case 'describe:request':
        return this.visionCtrl.handleDescribe(ws, msg as DescribeRequestMessage);
      case 'compare:request':
        return this.visionCtrl.handleCompare(ws, msg as CompareRequestMessage);

      default:
        this.sendError(ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type: ${(msg as { type: string }).type}`);
    }
  }

  // ============================================================================
  // HTTP Routing
  // ============================================================================

  private async routeHttpRequest(url: URL, request: Request): Promise<Response> {
    try {
      // Asset endpoints
      if (url.pathname === '/internal/create-asset' && request.method === 'POST') {
        const data = await request.json();
        const asset = await this.assetCtrl.httpCreate(data as any);
        return this.jsonResponse({ success: true, asset });
      }

      if (url.pathname.match(/^\/internal\/asset\/[^/]+\/children$/) && request.method === 'GET') {
        const assetId = url.pathname.split('/internal/asset/')[1].split('/children')[0];
        const children = await this.assetCtrl.httpGetChildren(assetId);
        return this.jsonResponse({ success: true, children });
      }

      if (url.pathname.match(/^\/internal\/asset\/[^/]+\/ancestors$/) && request.method === 'GET') {
        const assetId = url.pathname.split('/internal/asset/')[1].split('/ancestors')[0];
        const ancestors = await this.assetCtrl.httpGetAncestors(assetId);
        return this.jsonResponse({ success: true, ancestors });
      }

      if (url.pathname.match(/^\/internal\/asset\/[^/]+\/parent$/) && request.method === 'PATCH') {
        const assetId = url.pathname.split('/internal/asset/')[1].split('/parent')[0];
        const data = (await request.json()) as { parentAssetId: string | null };
        const asset = await this.assetCtrl.httpReparent(assetId, data.parentAssetId);
        return this.jsonResponse({ success: true, asset });
      }

      if (url.pathname.startsWith('/internal/asset/') && request.method === 'GET') {
        const assetId = url.pathname.split('/internal/asset/')[1];
        const result = await this.assetCtrl.httpGetDetails(assetId);
        return this.jsonResponse({ success: true, ...result });
      }

      if (url.pathname === '/internal/spawn' && request.method === 'POST') {
        const data = await request.json();
        const result = await this.assetCtrl.httpSpawn(data as any);
        return this.jsonResponse({ success: true, ...result });
      }

      if (url.pathname === '/internal/set-active' && request.method === 'POST') {
        const data = (await request.json()) as { assetId: string; variantId: string };
        const asset = await this.assetCtrl.httpSetActive(data.assetId, data.variantId);
        return this.jsonResponse({ success: true });
      }

      // Variant endpoints
      if (url.pathname === '/internal/apply-variant' && request.method === 'POST') {
        const data = await request.json();
        const result = await this.variantCtrl.httpApplyVariant(data as any);
        return this.jsonResponse(result);
      }

      if (url.pathname.match(/^\/internal\/variant\/[^/]+\/star$/) && request.method === 'PATCH') {
        const variantId = url.pathname.split('/internal/variant/')[1].split('/star')[0];
        const data = (await request.json()) as { starred: boolean };
        const variant = await this.variantCtrl.httpStar(variantId, data.starred);
        return this.jsonResponse({ success: true, variant });
      }

      // Lineage endpoints
      if (url.pathname.match(/^\/internal\/lineage\/[^/]+\/graph$/) && request.method === 'GET') {
        const variantId = url.pathname.split('/internal/lineage/')[1].split('/graph')[0];
        const graph = await this.lineageCtrl.httpGetGraph(variantId);
        return this.jsonResponse({ success: true, ...graph });
      }

      if (url.pathname.match(/^\/internal\/lineage\/[^/]+\/sever$/) && request.method === 'PATCH') {
        const lineageId = url.pathname.split('/internal/lineage/')[1].split('/sever')[0];
        await this.lineageCtrl.httpSever(lineageId);
        return this.jsonResponse({ success: true });
      }

      if (url.pathname.startsWith('/internal/lineage/') && request.method === 'GET') {
        const variantId = url.pathname.split('/internal/lineage/')[1];
        const result = await this.lineageCtrl.httpGetLineage(variantId);
        return this.jsonResponse({ success: true, ...result });
      }

      if (url.pathname === '/internal/add-lineage' && request.method === 'POST') {
        const data = await request.json();
        const lineage = await this.lineageCtrl.httpAddLineage(data as any);
        return this.jsonResponse({ success: true, id: lineage.id });
      }

      // Chat endpoints
      if (url.pathname === '/internal/chat' && request.method === 'POST') {
        const data = await request.json();
        const message = await this.chatCtrl.httpStoreMessage(data as any);
        return this.jsonResponse({ success: true, message });
      }

      if (url.pathname === '/internal/chat/history' && request.method === 'GET') {
        const messages = await this.chatCtrl.httpGetHistory();
        return this.jsonResponse({ success: true, messages });
      }

      if (url.pathname === '/internal/chat/history' && request.method === 'DELETE') {
        await this.chatCtrl.httpClearHistory();
        return this.jsonResponse({ success: true });
      }

      // State endpoint
      if (url.pathname === '/internal/state' && request.method === 'GET') {
        const state = await this.syncCtrl.httpGetState();
        return this.jsonResponse(state);
      }

      // Job status endpoints
      if (url.pathname === '/internal/job/progress' && request.method === 'POST') {
        const data = (await request.json()) as { jobId: string; status: string };
        this.generationCtrl.httpJobProgress(data.jobId, data.status);
        return this.jsonResponse({ success: true });
      }

      if (url.pathname === '/internal/job/completed' && request.method === 'POST') {
        const data = (await request.json()) as { jobId: string; variant: Variant };
        this.generationCtrl.httpJobCompleted(data.jobId, data.variant);
        return this.jsonResponse({ success: true });
      }

      if (url.pathname === '/internal/job/failed' && request.method === 'POST') {
        const data = (await request.json()) as { jobId: string; error: string };
        this.generationCtrl.httpJobFailed(data.jobId, data.error);
        return this.jsonResponse({ success: true });
      }

      // Workflow result endpoints
      if (url.pathname === '/internal/chat-result' && request.method === 'POST') {
        const result = (await request.json()) as ChatWorkflowOutput;
        this.generationCtrl.httpChatResult(result);
        return this.jsonResponse({ success: true });
      }

      if (url.pathname === '/internal/generation-result' && request.method === 'POST') {
        const result = (await request.json()) as GenerationWorkflowOutput;
        this.generationCtrl.httpGenerationResult(result);
        return this.jsonResponse({ success: true });
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return this.jsonResponse({ error: error.message }, 404);
      }
      if (error instanceof ValidationError) {
        return this.jsonResponse({ error: error.message }, 400);
      }
      console.error('[SpaceDO] HTTP error:', error);
      return this.jsonResponse({ error: 'Internal server error' }, 500);
    }
  }

  // ============================================================================
  // WebSocket Upgrade
  // ============================================================================

  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    if (!this.spaceId) {
      return new Response('Invalid space', { status: 400 });
    }

    // Extract JWT from cookie
    const cookieHeader = request.headers.get('Cookie');
    const token = this.getAuthToken(cookieHeader);

    if (!token) {
      return new Response('Missing authentication', { status: 401 });
    }

    // Verify JWT
    const authService = new AuthService(this.env);
    const payload = await authService.verifyJWT(token);

    if (!payload) {
      return new Response('Invalid token', { status: 401 });
    }

    // Check membership in D1
    const member = await this.env.DB.prepare(
      'SELECT role FROM space_members WHERE space_id = ? AND user_id = ?'
    )
      .bind(this.spaceId, String(payload.userId))
      .first<{ role: 'owner' | 'editor' | 'viewer' }>();

    if (!member) {
      console.log('WebSocket auth failed: not a member', {
        spaceId: this.spaceId,
        userId: payload.userId,
      });
      return new Response('Not a member', { status: 403 });
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept with user metadata
    const meta: WebSocketMeta = {
      userId: String(payload.userId),
      role: member.role,
    };

    this.ctx.acceptWebSocket(server, [JSON.stringify(meta)]);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  // ============================================================================
  // WebSocket Helpers
  // ============================================================================

  private getWebSocketMeta(ws: WebSocket): WebSocketMeta {
    const tags = this.ctx.getTags(ws);
    const metaStr = tags[0] || '{}';
    return JSON.parse(metaStr) as WebSocketMeta;
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('[SpaceDO] Failed to send WebSocket message:', error);
    }
  }

  private sendError(ws: WebSocket, code: string, message: string): void {
    this.send(ws, { type: 'error', code, message });
  }

  private broadcast(message: ServerMessage, excludeWs?: WebSocket): void {
    const connections = this.ctx.getWebSockets();
    for (const ws of connections) {
      if (ws !== excludeWs) {
        this.send(ws, message);
      }
    }
  }

  // ============================================================================
  // Utility Helpers
  // ============================================================================

  private getAuthToken(cookieHeader: string | null): string | null {
    if (!cookieHeader) return null;

    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith('auth_token=')) {
        return cookie.substring('auth_token='.length);
      }
    }

    return null;
  }

  private jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
