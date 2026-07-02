import { DurableObject } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Env } from '../../core/types';
import { loggers } from '../../shared/logger';
import type {
  GenerateRequestMessage,
  RefineRequestMessage,
  DescribeRequestMessage,
  CompareRequestMessage,
  AutoDescribeRequestMessage,
  BatchRequestMessage,
} from '../workflows/types';
import type { WebSocketMeta, ClientMessage, ServerMessage } from './space/types';
import type { ErrorCode } from '../../shared/websocket-types';
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
  ConflictError,
  PresenceController,
  SyncController,
  LineageController,
  AssetController,
  VariantController,
  GenerationController,
  VisionController,
  StylePresetController,
  RotationController,
  OrganizationController,
} from './space/controllers';
import { ApprovalController } from './space/controllers/ApprovalController';
import { SessionController } from './space/controllers/SessionController';
import { ChatController } from './space/controllers/ChatController';

// ============================================================================
// SpaceDO - Durable Object for Space State & WebSocket Hub
// ============================================================================

const SPACE_ID_STORAGE_KEY = '_spaceId';
const ARCHIVED_STORAGE_KEY = '_archived';

export class SpaceDO extends DurableObject<Env> {
  private spaceId: string | null = null;
  private archived = false;
  private initialized = false;
  private repo!: SpaceRepository;
  private internalApi!: Hono;

  // Controllers
  private presenceCtrl!: PresenceController;
  private syncCtrl!: SyncController;
  private lineageCtrl!: LineageController;
  private assetCtrl!: AssetController;
  private variantCtrl!: VariantController;
  private generationCtrl!: GenerationController;
  private visionCtrl!: VisionController;
  private stylePresetCtrl!: StylePresetController;
  private approvalCtrl!: ApprovalController;
  private sessionCtrl!: SessionController;
  private chatCtrl!: ChatController;
  private rotationCtrl!: RotationController;
  private organizationCtrl!: OrganizationController;

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

  private extractInternalSpaceId(request: Request): string | null {
    const value = request.headers.get('X-Space-Id')?.trim();
    return value || null;
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
        this.archived = await this.recoverArchived();

        // Ensure spaceId is set before proceeding
        if (!this.spaceId) {
          throw new Error('SpaceId not available - cannot initialize DO');
        }

        // Initialize repository
        this.repo = new SpaceRepository(this.ctx.storage.sql, this.env.IMAGES);
        await this.repo.backfillLegacySpaceStyle();

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
      this.lineageCtrl = new LineageController(ctx);
      this.assetCtrl = new AssetController(ctx);
      this.variantCtrl = new VariantController(ctx);
      this.generationCtrl = new GenerationController(ctx);
      this.visionCtrl = new VisionController(ctx);
      this.stylePresetCtrl = new StylePresetController(ctx);
      this.approvalCtrl = new ApprovalController(ctx);
      this.sessionCtrl = new SessionController(ctx);
      this.chatCtrl = new ChatController(ctx);
      this.rotationCtrl = new RotationController(ctx);
      this.organizationCtrl = new OrganizationController(ctx);

      // Wire pipeline controllers to generation controller (avoids circular deps)
      this.generationCtrl.setPipelineControllers(this.rotationCtrl);

      // Initialize internal HTTP router
      this.internalApi = createInternalApi({
        asset: this.assetCtrl,
        variant: this.variantCtrl,
        lineage: this.lineageCtrl,
        sync: this.syncCtrl,
        generation: this.generationCtrl,
        approval: this.approvalCtrl,
        session: this.sessionCtrl,
        organization: this.organizationCtrl,
        stylePreset: this.stylePresetCtrl,
      });

      this.initialized = true;
      } catch (error) {
        loggers.spaceDO.error('Initialization failed', { spaceId: this.spaceId ?? undefined }, error instanceof Error ? error : new Error(String(error)));
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
    // Extract spaceId from external requests (not internal DO calls)
    const url = new URL(request.url);
    const isInternalRequest = url.hostname === 'do' || url.pathname.startsWith('/internal');

    if (!this.spaceId) {
      this.spaceId = isInternalRequest
        ? this.extractInternalSpaceId(request)
        : this.extractSpaceId(request);
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
    if (this.archived) {
      ws.close(1008, 'Space archived');
      return;
    }

    if (typeof message !== 'string') {
      this.sendError(ws, 'INVALID_MESSAGE', 'Expected JSON string');
      return;
    }

    // Ensure controllers are initialized (DO may have been restarted)
    await this.ensureInitialized();

    const meta = this.getWebSocketMeta(ws);
    let parsedMessage: ClientMessage | undefined;

    try {
      parsedMessage = JSON.parse(message) as ClientMessage;
      await this.routeWebSocketMessage(ws, meta, parsedMessage);
    } catch (error) {
      if (error instanceof PermissionError) {
        this.sendError(ws, 'PERMISSION_DENIED', error.message);
      } else if (error instanceof NotFoundError) {
        this.sendError(ws, 'NOT_FOUND', error.message);
      } else if (error instanceof ValidationError) {
        this.sendError(ws, 'VALIDATION_ERROR', error.message);
      } else if (error instanceof ConflictError) {
        this.sendError(ws, 'INVALID_STATE', error.message);
      } else {
        loggers.spaceDO.error('Error handling WebSocket message', {
          spaceId: this.spaceId ?? undefined,
          userId: meta.userId,
          messageType: parsedMessage?.type,
        }, error instanceof Error ? error : new Error(String(error)));
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
    const validCloseCode = code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000;
    ws.close(validCloseCode, reason);
  }

  /**
   * Handle WebSocket error
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const meta = this.getWebSocketMeta(ws);
    loggers.spaceDO.error('WebSocket error', {
      spaceId: this.spaceId ?? undefined,
      userId: meta.userId,
    }, error instanceof Error ? error : new Error(String(error)));
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
      case 'sync:overview':
        return this.syncCtrl.handleOverviewRequest(ws);

      // Asset
      case 'asset:create':
        return this.assetCtrl.handleCreate(ws, meta, msg.name, msg.assetType, msg.mediaKind);
      case 'asset:update':
        return this.assetCtrl.handleUpdate(ws, meta, msg.assetId, msg.changes);
      case 'asset:delete':
        return this.assetCtrl.handleDelete(ws, meta, msg.assetId);
      case 'asset:setActive':
        return this.assetCtrl.handleSetActive(ws, meta, msg.assetId, msg.variantId);
      case 'asset:fork':
        return this.assetCtrl.handleFork(
          ws,
          meta,
          msg.sourceAssetId,
          msg.sourceVariantId,
          msg.name,
          msg.assetType,
          msg.mediaKind
        );

      // Manual organization
      case 'collection:create':
        return this.organizationCtrl.handleCreateCollection(ws, meta, msg);
      case 'collection:update':
        return this.organizationCtrl.handleUpdateCollection(ws, meta, msg.collectionId, msg.changes);
      case 'collection:delete':
        return this.organizationCtrl.handleDeleteCollection(ws, meta, msg.collectionId);
      case 'collection_item:create':
        return this.organizationCtrl.handleCreateCollectionItem(ws, meta, msg.collectionId, msg);
      case 'collection_item:update':
        return this.organizationCtrl.handleUpdateCollectionItem(ws, meta, msg.collectionId, msg.itemId, msg.changes);
      case 'collection_items:reorder':
        return this.organizationCtrl.handleReorderCollectionItems(ws, meta, msg.collectionId, msg.itemIds);
      case 'collection_item:delete':
        return this.organizationCtrl.handleDeleteCollectionItem(ws, meta, msg.collectionId, msg.itemId);
      // Variant
      case 'variant:delete':
        return this.variantCtrl.handleDelete(ws, meta, msg.variantId);
      case 'variant:star':
        return this.variantCtrl.handleStar(ws, meta, msg.variantId, msg.starred);
      case 'variant:rate':
        return this.variantCtrl.handleRate(ws, meta, (msg as { type: 'variant:rate'; variantId: string; rating: 'approved' | 'rejected' }).variantId, (msg as { type: 'variant:rate'; variantId: string; rating: 'approved' | 'rejected' }).rating);
      case 'variant:retry':
        return this.generationCtrl.handleRetryRequest(ws, meta, msg.variantId);
      case 'variant:regenerate':
        return this.generationCtrl.handleRegenerateRequest(ws, meta, msg.variantId);

      // Lineage
      case 'lineage:sever':
        return this.lineageCtrl.handleSever(ws, meta, msg.lineageId);

      // Approval
      case 'approval:approve':
        await this.approvalCtrl.handleApprove(ws, meta, msg.approvalId);
        return;
      case 'approval:reject':
        await this.approvalCtrl.handleReject(ws, meta, msg.approvalId);
        return;
      case 'approval:list':
        return this.approvalCtrl.handleList(ws, meta);

      // Session
      case 'session:get':
        return this.sessionCtrl.handleGet(ws, meta);
      case 'session:update':
        await this.sessionCtrl.handleUpdate(ws, meta, {
          viewingAssetId: msg.viewingAssetId,
          viewingVariantId: msg.viewingVariantId,
          forgeContext: msg.forgeContext,
        });
        return;

      // Presence
      case 'presence:update':
        return this.presenceCtrl.handleUpdate(meta, msg.viewing);

      // Style presets and asset-backed style references
      case 'style_preset:create':
        return this.stylePresetCtrl.handleCreateStylePreset(ws, meta, msg);
      case 'style_preset:update':
        return this.stylePresetCtrl.handleUpdateStylePreset(ws, meta, msg.presetId, msg.changes);
      case 'style_preset:delete':
        return this.stylePresetCtrl.handleDeleteStylePreset(ws, meta, msg.presetId);

      // Workflow triggers
      case 'generation:estimate':
        return this.generationCtrl.handleGenerationEstimateRequest(ws, meta, msg);
      case 'generate:request':
        return this.generationCtrl.handleGenerateRequest(ws, meta, msg as GenerateRequestMessage);
      case 'refine:request':
        return this.generationCtrl.handleRefineRequest(ws, meta, msg as RefineRequestMessage);
      case 'batch:request':
        return this.generationCtrl.handleBatchRequest(ws, meta, msg as BatchRequestMessage);

      // Rotation pipeline
      case 'rotation:request':
        return this.rotationCtrl.handleRotationRequest(ws, meta, msg as ClientMessage & { type: 'rotation:request' });
      case 'rotation:cancel':
        return this.rotationCtrl.handleRotationCancel(ws, meta, (msg as { type: 'rotation:cancel'; rotationSetId: string }).rotationSetId);

      // Vision
      case 'describe:request':
        return this.visionCtrl.handleDescribe(ws, meta.userId, msg as DescribeRequestMessage);
      case 'compare:request':
        return this.visionCtrl.handleCompare(ws, meta.userId, msg as CompareRequestMessage);

      // Auto-describe (lazy description caching for ForgeTray)
      case 'auto-describe:request':
        return this.visionCtrl.handleAutoDescribe(ws, meta.userId, msg as AutoDescribeRequestMessage);

      // Chat (persistent space chat with ForgeTray context)
      case 'chat:history':
        return this.chatCtrl.handleChatHistory(ws, meta.userId);
      case 'chat:send':
        return this.chatCtrl.handleChatSend(ws, meta.userId, msg as { type: 'chat:send'; content: string; forgeContext?: { prompt: string; slotVariantIds: string[] } });
      case 'chat:clear':
        return this.chatCtrl.handleChatClear(ws, meta.userId);

      default:
        this.sendError(ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type: ${(msg as { type: string }).type}`);
    }
  }

  // ============================================================================
  // HTTP Routing (delegated to Hono-based InternalApi)
  // ============================================================================

  private async routeHttpRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/internal/archive' && request.method === 'POST') {
      await this.storeArchived(true);
      this.archived = true;
      const closed = this.closeActiveWebSockets(1008, 'Space archived');
      return Response.json({
        success: true,
        closed,
      });
    }

    if (url.pathname === '/internal/unarchive' && request.method === 'POST') {
      await this.storeArchived(false);
      this.archived = false;
      return Response.json({
        success: true,
      });
    }

    if (url.pathname === '/internal/purge' && request.method === 'DELETE') {
      try {
        await this.storeArchived(true);
        this.archived = true;
        const closed = this.closeActiveWebSockets(1008, 'Space purged');
        const purged = await this.repo.purgeAllData();
        this.initialized = false;
        return Response.json({
          success: true,
          closed,
          ...purged,
        });
      } catch (error) {
        return Response.json({
          error: error instanceof Error ? error.message : String(error),
        }, { status: 500 });
      }
    }

    if (this.archived) {
      return Response.json({
        error: 'Space archived',
      }, { status: 410 });
    }

    return this.internalApi.fetch(request);
  }

  // ============================================================================
  // WebSocket Upgrade
  // ============================================================================

  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    if (!this.spaceId) {
      return new Response('Invalid space', { status: 400 });
    }
    if (this.archived) {
      return new Response('Space archived', { status: 410 });
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

    // Accept with user metadata plus a per-WebSocket client session ID.
    this.ctx.acceptWebSocket(server, [JSON.stringify({
      ...result.meta,
      clientSessionId: crypto.randomUUID(),
    })]);

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

  private closeActiveWebSockets(code: number, reason: string): number {
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      ws.close(code, reason);
    }
    return sockets.length;
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      loggers.spaceDO.error('Failed to send WebSocket message', {
        spaceId: this.spaceId ?? undefined,
        messageType: message.type,
      }, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private sendError(ws: WebSocket, code: ErrorCode, message: string): void {
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
    await this.ctx.storage.put(SPACE_ID_STORAGE_KEY, spaceId);
  }

  private async recoverSpaceId(): Promise<string | null> {
    const stored = await this.ctx.storage.get<string>(SPACE_ID_STORAGE_KEY);
    if (stored) {
      return stored;
    }
    // Fallback: try ctx.id.name (works in production, not in local dev)
    if (this.ctx.id.name) {
      return this.ctx.id.name;
    }
    loggers.spaceDO.error('Cannot recover spaceId', {
      doId: this.ctx.id.toString(),
    });
    return null;
  }

  private async storeArchived(archived: boolean): Promise<void> {
    await this.ctx.storage.put(ARCHIVED_STORAGE_KEY, archived);
  }

  private async recoverArchived(): Promise<boolean> {
    return await this.ctx.storage.get<boolean>(ARCHIVED_STORAGE_KEY) === true;
  }

}
