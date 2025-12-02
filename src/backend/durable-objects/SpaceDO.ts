import { DurableObject } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Env } from '../../core/types';
import type {
  ChatRequestMessage,
  GenerateRequestMessage,
  RefineRequestMessage,
  DescribeRequestMessage,
  CompareRequestMessage,
} from '../workflows/types';
import type { WebSocketMeta, ClientMessage, ServerMessage } from './space/types';
import { SpaceRepository } from './space/repository/SpaceRepository';
import { SchemaManager } from './space/schema/SchemaManager';
import { createInternalApi } from './space/InternalApi';
import { AuthHandler } from './space/AuthHandler';

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
  private internalApi!: Hono;

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

      try {
        // Initialize schema first
        const schemaManager = new SchemaManager(this.ctx.storage.sql);
        await schemaManager.initialize();

        // Recover spaceId from storage if not set (happens after DO restart)
        if (!this.spaceId) {
          this.spaceId = await this.recoverSpaceId();
        }

        // Store spaceId for future recovery (first access)
        if (this.spaceId) {
          await this.storeSpaceId(this.spaceId);
        }

        // Ensure spaceId is set before proceeding
        if (!this.spaceId) {
          throw new Error('SpaceId not available - cannot initialize DO');
        }

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

      // Initialize internal HTTP router
      this.internalApi = createInternalApi({
        asset: this.assetCtrl,
        variant: this.variantCtrl,
        lineage: this.lineageCtrl,
        chat: this.chatCtrl,
        sync: this.syncCtrl,
        generation: this.generationCtrl,
      });

      this.initialized = true;
      } catch (error) {
        console.error('[SpaceDO] Initialization failed:', error);
        throw error;
      }
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
      console.log('[SpaceDO] Extracted spaceId from URL:', this.spaceId, 'URL:', request.url);
    }

    await this.ensureInitialized();

    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request);
    }

    // Route to internal HTTP API (Hono-based)
    return this.routeHttpRequest(request);
  }

  /**
   * Handle incoming WebSocket messages
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') {
      this.sendError(ws, 'INVALID_MESSAGE', 'Expected JSON string');
      return;
    }

    // Ensure controllers are initialized (DO may have been restarted)
    await this.ensureInitialized();

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
    // Ensure controllers are initialized (DO may have been restarted)
    await this.ensureInitialized();

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
      case 'variant:retry':
        return this.generationCtrl.handleRetryRequest(ws, meta, msg.variantId);

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
  // HTTP Routing (delegated to Hono-based InternalApi)
  // ============================================================================

  private async routeHttpRequest(request: Request): Promise<Response> {
    return this.internalApi.fetch(request);
  }

  // ============================================================================
  // WebSocket Upgrade
  // ============================================================================

  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    if (!this.spaceId) {
      return new Response('Invalid space', { status: 400 });
    }

    // Authenticate the WebSocket upgrade request
    const authHandler = new AuthHandler(this.env, this.spaceId);
    const result = await authHandler.authenticate(request);

    if (!result.success) {
      return new Response(result.message, { status: result.status });
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept with user metadata
    this.ctx.acceptWebSocket(server, [JSON.stringify(result.meta)]);

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
  // SpaceId Persistence (for DO restart recovery)
  // ============================================================================

  private async storeSpaceId(spaceId: string): Promise<void> {
    await this.ctx.storage.put('_spaceId', spaceId);
  }

  private async recoverSpaceId(): Promise<string | null> {
    const stored = await this.ctx.storage.get<string>('_spaceId');
    if (stored) {
      return stored;
    }
    // Fallback: try ctx.id.name (works in production, not in local dev)
    if (this.ctx.id.name) {
      return this.ctx.id.name;
    }
    console.error('[SpaceDO] Cannot recover spaceId - neither storage nor id.name available');
    return null;
  }

}
