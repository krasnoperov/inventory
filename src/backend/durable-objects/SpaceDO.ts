import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../../core/types';
import { AuthService } from '../features/auth/auth-service';

// ============================================================================
// Types for DO SQLite Schema
// ============================================================================

interface Asset {
  id: string;
  name: string;
  type: 'character' | 'item' | 'scene' | 'composite';
  tags: string; // JSON array
  active_variant_id: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

interface Variant {
  id: string;
  asset_id: string;
  job_id: string | null;
  image_key: string;
  thumb_key: string;
  recipe: string; // JSON
  created_by: string;
  created_at: number;
}

interface ImageRef {
  image_key: string;
  ref_count: number;
}

interface ChatMessage {
  id: string;
  sender_type: 'user' | 'bot';
  sender_id: string;
  content: string;
  metadata: string | null; // JSON
  created_at: number;
}

interface Lineage {
  id: string;
  parent_variant_id: string;
  child_variant_id: string;
  relation_type: 'derived' | 'composed';
  created_at: number;
}

// WebSocket client metadata
interface WebSocketMeta {
  userId: string;
  role: 'owner' | 'editor' | 'viewer';
}

// Presence data for a user
interface UserPresence {
  userId: string;
  viewing: string | null; // Asset ID being viewed
  lastSeen: number;
}

// ============================================================================
// Message Types (Client → Server)
// ============================================================================

type ClientMessage =
  | { type: 'sync:request' }
  | { type: 'asset:create'; name: string; assetType: 'character' | 'item' | 'scene' | 'composite' }
  | { type: 'asset:update'; assetId: string; changes: { name?: string; tags?: string[] } }
  | { type: 'asset:delete'; assetId: string }
  | { type: 'asset:setActive'; assetId: string; variantId: string }
  | { type: 'variant:delete'; variantId: string }
  | { type: 'presence:update'; viewing?: string }
  | { type: 'chat:send'; content: string };

// ============================================================================
// Message Types (Server → Client)
// ============================================================================

type ServerMessage =
  | { type: 'sync:state'; assets: Asset[]; variants: Variant[]; presence: UserPresence[] }
  | { type: 'asset:created'; asset: Asset }
  | { type: 'asset:updated'; asset: Asset }
  | { type: 'asset:deleted'; assetId: string }
  | { type: 'variant:created'; variant: Variant }
  | { type: 'variant:deleted'; variantId: string }
  | { type: 'job:progress'; jobId: string; status: string }
  | { type: 'job:completed'; jobId: string; variant: Variant }
  | { type: 'job:failed'; jobId: string; error: string }
  | { type: 'chat:message'; message: ChatMessage }
  | { type: 'presence:update'; presence: UserPresence[] }
  | { type: 'error'; code: string; message: string };

// ============================================================================
// SpaceDO - Durable Object for Space State & WebSocket Hub
// ============================================================================

export class SpaceDO extends DurableObject<Env> {
  private spaceId: string | null = null;
  private initialized = false;
  private presence: Map<string, UserPresence> = new Map(); // userId -> presence

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
   * Initialize SQLite schema on first access
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.initialized) return;

      // Create tables if they don't exist
      await this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS assets (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('character', 'item', 'scene', 'composite')),
          tags TEXT DEFAULT '[]',
          active_variant_id TEXT,
          created_by TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS variants (
          id TEXT PRIMARY KEY,
          asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          job_id TEXT UNIQUE,
          image_key TEXT NOT NULL,
          thumb_key TEXT NOT NULL,
          recipe TEXT NOT NULL,
          created_by TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS image_refs (
          image_key TEXT PRIMARY KEY,
          ref_count INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY,
          sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'bot')),
          sender_id TEXT NOT NULL,
          content TEXT NOT NULL,
          metadata TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS lineage (
          id TEXT PRIMARY KEY,
          parent_variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
          child_variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
          relation_type TEXT NOT NULL CHECK (relation_type IN ('derived', 'composed')),
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_variants_asset ON variants(asset_id);
        CREATE INDEX IF NOT EXISTS idx_assets_updated ON assets(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_lineage_parent ON lineage(parent_variant_id);
        CREATE INDEX IF NOT EXISTS idx_lineage_child ON lineage(child_variant_id);
      `);

      this.initialized = true;
    });
  }

  /**
   * Main fetch handler for WebSocket upgrades and internal HTTP endpoints
   */
  async fetch(request: Request): Promise<Response> {
    // Extract and store spaceId from the request URL if not already set
    if (!this.spaceId) {
      this.spaceId = this.extractSpaceId(request);
    }

    await this.ensureInitialized();

    const url = new URL(request.url);

    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request);
    }

    // Internal HTTP endpoints for worker communication
    if (url.pathname === '/internal/create-asset' && request.method === 'POST') {
      return this.handleCreateAsset(request);
    }

    if (url.pathname === '/internal/apply-variant' && request.method === 'POST') {
      return this.handleApplyVariant(request);
    }

    // Get lineage for a variant
    if (url.pathname.startsWith('/internal/lineage/') && request.method === 'GET') {
      const variantId = url.pathname.split('/internal/lineage/')[1];
      return this.handleGetLineage(variantId);
    }

    // Get asset details with variants
    if (url.pathname.startsWith('/internal/asset/') && request.method === 'GET') {
      const assetId = url.pathname.split('/internal/asset/')[1];
      return this.handleGetAssetDetails(assetId);
    }

    // Get full state (for bot context)
    if (url.pathname === '/internal/state' && request.method === 'GET') {
      return this.handleGetState();
    }

    // Chat endpoints
    if (url.pathname === '/internal/chat' && request.method === 'POST') {
      return this.handleStoreChatMessage(request);
    }

    if (url.pathname === '/internal/chat/history' && request.method === 'GET') {
      return this.handleGetChatHistory();
    }

    return new Response('Not found', { status: 404 });
  }

  /**
   * Handle WebSocket upgrade with cookie-based JWT authentication
   */
  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    if (!this.spaceId) {
      return new Response('Invalid space', { status: 400 });
    }

    // Extract JWT from cookie (same as REST API endpoints)
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
      console.log('WebSocket auth failed: not a member', { spaceId: this.spaceId, userId: payload.userId });
      return new Response('Not a member', { status: 403 });
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept WebSocket with user metadata
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

      switch (msg.type) {
        case 'sync:request':
          await this.handleSyncRequest(ws);
          break;

        case 'asset:create':
          await this.handleAssetCreate(ws, meta, msg.name, msg.assetType);
          break;

        case 'asset:update':
          await this.handleAssetUpdate(ws, meta, msg.assetId, msg.changes);
          break;

        case 'asset:delete':
          await this.handleAssetDelete(ws, meta, msg.assetId);
          break;

        case 'asset:setActive':
          await this.handleAssetSetActive(ws, meta, msg.assetId, msg.variantId);
          break;

        case 'variant:delete':
          await this.handleVariantDelete(ws, meta, msg.variantId);
          break;

        case 'chat:send':
          await this.handleChatSend(ws, meta, msg.content);
          break;

        case 'presence:update':
          this.handlePresenceUpdate(meta, msg.viewing);
          break;

        default:
          this.sendError(ws, 'UNKNOWN_MESSAGE_TYPE', 'Unknown message type');
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      this.sendError(ws, 'INTERNAL_ERROR', 'Failed to process message');
    }
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // Remove presence for disconnected user
    const meta = this.getWebSocketMeta(ws);
    if (this.presence.has(meta.userId)) {
      this.presence.delete(meta.userId);
      // Broadcast updated presence
      this.broadcast({
        type: 'presence:update',
        presence: Array.from(this.presence.values()),
      });
    }
    ws.close(code, reason);
  }

  /**
   * Handle WebSocket error
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('WebSocket error:', error);
  }

  // ============================================================================
  // WebSocket Message Handlers
  // ============================================================================

  private async handleSyncRequest(ws: WebSocket): Promise<void> {
    const state = await this.getFullState();
    const presence = this.getPresenceData();
    this.send(ws, {
      type: 'sync:state',
      assets: state.assets,
      variants: state.variants,
      presence,
    });
  }

  private async handleAssetCreate(
    ws: WebSocket,
    meta: WebSocketMeta,
    name: string,
    assetType: Asset['type']
  ): Promise<void> {
    // Only editors and owners can create assets
    if (meta.role === 'viewer') {
      this.sendError(ws, 'PERMISSION_DENIED', 'Viewers cannot create assets');
      return;
    }

    const asset = await this.createAsset({
      name,
      type: assetType,
      createdBy: meta.userId,
    });

    this.broadcast({ type: 'asset:created', asset });
  }

  private async handleAssetUpdate(
    ws: WebSocket,
    meta: WebSocketMeta,
    assetId: string,
    changes: { name?: string; tags?: string[] }
  ): Promise<void> {
    if (meta.role === 'viewer') {
      this.sendError(ws, 'PERMISSION_DENIED', 'Viewers cannot update assets');
      return;
    }

    const asset = await this.updateAsset(assetId, changes);
    if (!asset) {
      this.sendError(ws, 'NOT_FOUND', 'Asset not found');
      return;
    }

    this.broadcast({ type: 'asset:updated', asset });
  }

  private async handleAssetDelete(
    ws: WebSocket,
    meta: WebSocketMeta,
    assetId: string
  ): Promise<void> {
    if (meta.role !== 'owner') {
      this.sendError(ws, 'PERMISSION_DENIED', 'Only owners can delete assets');
      return;
    }

    await this.deleteAsset(assetId);
    this.broadcast({ type: 'asset:deleted', assetId });
  }

  private async handleAssetSetActive(
    ws: WebSocket,
    meta: WebSocketMeta,
    assetId: string,
    variantId: string
  ): Promise<void> {
    if (meta.role === 'viewer') {
      this.sendError(ws, 'PERMISSION_DENIED', 'Viewers cannot set active variant');
      return;
    }

    const asset = await this.updateAsset(assetId, { active_variant_id: variantId });
    if (!asset) {
      this.sendError(ws, 'NOT_FOUND', 'Asset not found');
      return;
    }

    this.broadcast({ type: 'asset:updated', asset });
  }

  private async handleVariantDelete(
    ws: WebSocket,
    meta: WebSocketMeta,
    variantId: string
  ): Promise<void> {
    if (meta.role !== 'owner') {
      this.sendError(ws, 'PERMISSION_DENIED', 'Only owners can delete variants');
      return;
    }

    await this.deleteVariant(variantId);
    this.broadcast({ type: 'variant:deleted', variantId });
  }

  private async handleChatSend(
    ws: WebSocket,
    meta: WebSocketMeta,
    content: string
  ): Promise<void> {
    const message = await this.createChatMessage({
      senderType: 'user',
      senderId: meta.userId,
      content,
    });

    this.broadcast({ type: 'chat:message', message });
  }

  private handlePresenceUpdate(
    meta: WebSocketMeta,
    viewing: string | undefined
  ): void {
    // Update presence for this user
    this.presence.set(meta.userId, {
      userId: meta.userId,
      viewing: viewing ?? null,
      lastSeen: Date.now(),
    });

    // Broadcast presence update to all clients
    this.broadcast({
      type: 'presence:update',
      presence: Array.from(this.presence.values()),
    });
  }

  /**
   * Get current presence data
   */
  private getPresenceData(): UserPresence[] {
    // Filter out stale presence (older than 5 minutes)
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000;

    const activePresence: UserPresence[] = [];
    for (const [userId, presence] of this.presence.entries()) {
      if (now - presence.lastSeen < staleThreshold) {
        activePresence.push(presence);
      } else {
        this.presence.delete(userId);
      }
    }

    return activePresence;
  }

  // ============================================================================
  // Internal HTTP Endpoint
  // ============================================================================

  /**
   * Handle apply-variant request from queue consumer
   * POST /internal/apply-variant
   */
  private async handleApplyVariant(request: Request): Promise<Response> {
    try {
      const data = (await request.json()) as {
        jobId: string;
        variantId: string;
        assetId: string;
        imageKey: string;
        thumbKey: string;
        recipe: string;
        createdBy: string;
      };

      const result = await this.applyVariant(data);

      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Error applying variant:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to apply variant' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  /**
   * Handle create-asset request from worker
   * POST /internal/create-asset
   */
  private async handleCreateAsset(request: Request): Promise<Response> {
    try {
      const data = (await request.json()) as {
        name: string;
        type: 'character' | 'item' | 'scene' | 'composite';
        createdBy: string;
      };

      const asset = await this.createAsset(data);

      // Broadcast to WebSocket clients
      this.broadcast({ type: 'asset:created', asset });

      return new Response(JSON.stringify({ success: true, asset }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Error creating asset:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to create asset' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  /**
   * Handle get lineage for a variant
   * GET /internal/lineage/:variantId
   */
  private async handleGetLineage(variantId: string): Promise<Response> {
    try {
      // Get ancestors (parents)
      const parentsResult = await this.ctx.storage.sql.exec(
        `SELECT l.*, v.asset_id, v.image_key, v.thumb_key, a.name as asset_name
         FROM lineage l
         JOIN variants v ON l.parent_variant_id = v.id
         JOIN assets a ON v.asset_id = a.id
         WHERE l.child_variant_id = ?`,
        variantId
      );

      // Get descendants (children)
      const childrenResult = await this.ctx.storage.sql.exec(
        `SELECT l.*, v.asset_id, v.image_key, v.thumb_key, a.name as asset_name
         FROM lineage l
         JOIN variants v ON l.child_variant_id = v.id
         JOIN assets a ON v.asset_id = a.id
         WHERE l.parent_variant_id = ?`,
        variantId
      );

      return new Response(JSON.stringify({
        success: true,
        parents: parentsResult.toArray(),
        children: childrenResult.toArray(),
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Error getting lineage:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to get lineage' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  /**
   * Handle get asset details with variants
   * GET /internal/asset/:assetId
   */
  private async handleGetAssetDetails(assetId: string): Promise<Response> {
    try {
      // Get asset
      const assetResult = await this.ctx.storage.sql.exec(
        'SELECT * FROM assets WHERE id = ?',
        assetId
      );
      const asset = assetResult.toArray()[0] as unknown as Asset | undefined;

      if (!asset) {
        return new Response(
          JSON.stringify({ error: 'Asset not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Get variants for this asset
      const variantsResult = await this.ctx.storage.sql.exec(
        'SELECT * FROM variants WHERE asset_id = ? ORDER BY created_at DESC',
        assetId
      );
      const variants = variantsResult.toArray() as unknown as Variant[];

      // Get lineage for all variants
      const variantIds = variants.map(v => v.id);
      let lineage: Lineage[] = [];

      if (variantIds.length > 0) {
        const placeholders = variantIds.map(() => '?').join(',');
        const lineageResult = await this.ctx.storage.sql.exec(
          `SELECT * FROM lineage WHERE parent_variant_id IN (${placeholders}) OR child_variant_id IN (${placeholders})`,
          ...variantIds,
          ...variantIds
        );
        lineage = lineageResult.toArray() as unknown as Lineage[];
      }

      return new Response(JSON.stringify({
        success: true,
        asset,
        variants,
        lineage,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Error getting asset details:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to get asset details' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  /**
   * Handle get full state
   * GET /internal/state
   */
  private async handleGetState(): Promise<Response> {
    try {
      const state = await this.getFullState();
      return new Response(JSON.stringify(state), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Error getting state:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to get state' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  /**
   * Handle store chat message
   * POST /internal/chat
   */
  private async handleStoreChatMessage(request: Request): Promise<Response> {
    try {
      const data = (await request.json()) as {
        senderType: 'user' | 'bot';
        senderId: string;
        content: string;
        metadata?: string;
      };

      const message = await this.createChatMessage(data);

      // Broadcast to all connected clients
      this.broadcast({ type: 'chat:message', message });

      return new Response(JSON.stringify({ success: true, message }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Error storing chat message:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to store chat message' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  /**
   * Handle get chat history
   * GET /internal/chat/history
   */
  private async handleGetChatHistory(): Promise<Response> {
    try {
      const result = await this.ctx.storage.sql.exec(
        'SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT 100'
      );
      const messages = result.toArray() as unknown as ChatMessage[];

      return new Response(JSON.stringify({
        success: true,
        messages: messages.reverse(), // Return in chronological order
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Error getting chat history:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to get chat history' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // ============================================================================
  // Core Methods
  // ============================================================================

  /**
   * Get full state (assets + variants)
   */
  private async getFullState(): Promise<{ assets: Asset[]; variants: Variant[] }> {
    const assetsResult = await this.ctx.storage.sql.exec(
      'SELECT * FROM assets ORDER BY updated_at DESC'
    );
    const variantsResult = await this.ctx.storage.sql.exec('SELECT * FROM variants');

    return {
      assets: assetsResult.toArray() as unknown as Asset[],
      variants: variantsResult.toArray() as unknown as Variant[],
    };
  }

  /**
   * Create a new asset
   */
  private async createAsset(data: {
    name: string;
    type: Asset['type'];
    createdBy: string;
  }): Promise<Asset> {
    const id = crypto.randomUUID();
    const now = Date.now();

    const asset: Asset = {
      id,
      name: data.name,
      type: data.type,
      tags: '[]',
      active_variant_id: null,
      created_by: data.createdBy,
      created_at: now,
      updated_at: now,
    };

    await this.ctx.storage.sql.exec(
      `INSERT INTO assets (id, name, type, tags, active_variant_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      asset.name,
      asset.type,
      asset.tags,
      asset.active_variant_id,
      asset.created_by,
      asset.created_at,
      asset.updated_at
    );

    return asset;
  }

  /**
   * Update an asset
   */
  private async updateAsset(
    id: string,
    changes: { name?: string; tags?: string[]; active_variant_id?: string | null }
  ): Promise<Asset | null> {
    const result = await this.ctx.storage.sql.exec(
      'SELECT * FROM assets WHERE id = ?',
      id
    );

    const asset = result.toArray()[0] as unknown as Asset | undefined;
    if (!asset) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (changes.name !== undefined) {
      updates.push('name = ?');
      values.push(changes.name);
    }

    if (changes.tags !== undefined) {
      updates.push('tags = ?');
      values.push(JSON.stringify(changes.tags));
    }

    if (changes.active_variant_id !== undefined) {
      updates.push('active_variant_id = ?');
      values.push(changes.active_variant_id);
    }

    updates.push('updated_at = ?');
    values.push(Date.now());

    values.push(id);

    await this.ctx.storage.sql.exec(
      `UPDATE assets SET ${updates.join(', ')} WHERE id = ?`,
      ...values
    );

    // Fetch updated asset
    const updatedResult = await this.ctx.storage.sql.exec(
      'SELECT * FROM assets WHERE id = ?',
      id
    );

    return updatedResult.toArray()[0] as unknown as Asset;
  }

  /**
   * Delete an asset (cascades to variants)
   */
  private async deleteAsset(id: string): Promise<void> {
    // Get all variants for this asset to decrement refs
    const variantsResult = await this.ctx.storage.sql.exec(
      'SELECT * FROM variants WHERE asset_id = ?',
      id
    );
    const variants = variantsResult.toArray() as unknown as Variant[];

    // Decrement refs for all images
    for (const variant of variants) {
      await this.decrementRef(variant.image_key);
      await this.decrementRef(variant.thumb_key);

      // Decrement refs for recipe inputs
      try {
        const recipe = JSON.parse(variant.recipe) as { inputs?: Array<{ imageKey: string }> };
        if (recipe.inputs) {
          for (const input of recipe.inputs) {
            await this.decrementRef(input.imageKey);
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
    }

    // Delete asset (cascades to variants)
    await this.ctx.storage.sql.exec('DELETE FROM assets WHERE id = ?', id);
  }

  /**
   * Apply a variant (idempotent, called by queue consumer)
   */
  private async applyVariant(data: {
    jobId: string;
    variantId: string;
    assetId: string;
    imageKey: string;
    thumbKey: string;
    recipe: string;
    createdBy: string;
    parentVariantIds?: string[]; // For lineage tracking
    relationType?: 'derived' | 'composed';
  }): Promise<{ created: boolean; variant: Variant }> {
    // Check if variant already exists (idempotency)
    const existingResult = await this.ctx.storage.sql.exec(
      'SELECT * FROM variants WHERE job_id = ?',
      data.jobId
    );

    const existing = existingResult.toArray()[0] as unknown as Variant | undefined;
    if (existing) {
      return { created: false, variant: existing };
    }

    const now = Date.now();

    const variant: Variant = {
      id: data.variantId,
      asset_id: data.assetId,
      job_id: data.jobId,
      image_key: data.imageKey,
      thumb_key: data.thumbKey,
      recipe: data.recipe,
      created_by: data.createdBy,
      created_at: now,
    };

    // Insert variant
    await this.ctx.storage.sql.exec(
      `INSERT INTO variants (id, asset_id, job_id, image_key, thumb_key, recipe, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      variant.id,
      variant.asset_id,
      variant.job_id,
      variant.image_key,
      variant.thumb_key,
      variant.recipe,
      variant.created_by,
      variant.created_at
    );

    // Increment refs for image and thumbnail
    await this.incrementRef(variant.image_key);
    await this.incrementRef(variant.thumb_key);

    // Increment refs for recipe inputs
    try {
      const recipe = JSON.parse(variant.recipe) as { inputs?: Array<{ imageKey: string }> };
      if (recipe.inputs) {
        for (const input of recipe.inputs) {
          await this.incrementRef(input.imageKey);
        }
      }
    } catch {
      // Ignore JSON parse errors
    }

    // Create lineage records if parent variants specified
    if (data.parentVariantIds && data.parentVariantIds.length > 0) {
      const relationType = data.relationType || 'derived';
      for (const parentId of data.parentVariantIds) {
        const lineageId = crypto.randomUUID();
        await this.ctx.storage.sql.exec(
          `INSERT INTO lineage (id, parent_variant_id, child_variant_id, relation_type, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          lineageId,
          parentId,
          variant.id,
          relationType,
          now
        );
      }
    }

    // If this is the first variant for the asset, set it as active
    const assetResult = await this.ctx.storage.sql.exec(
      'SELECT active_variant_id FROM assets WHERE id = ?',
      variant.asset_id
    );

    const asset = assetResult.toArray()[0] as { active_variant_id: string | null } | undefined;
    if (asset && !asset.active_variant_id) {
      await this.updateAsset(variant.asset_id, { active_variant_id: variant.id });
    }

    // Broadcast variant creation
    this.broadcast({ type: 'variant:created', variant });

    return { created: true, variant };
  }

  /**
   * Delete a variant
   */
  private async deleteVariant(id: string): Promise<void> {
    // Get variant to decrement refs
    const variantResult = await this.ctx.storage.sql.exec(
      'SELECT * FROM variants WHERE id = ?',
      id
    );

    const variant = variantResult.toArray()[0] as unknown as Variant | undefined;
    if (!variant) return;

    // Decrement refs
    await this.decrementRef(variant.image_key);
    await this.decrementRef(variant.thumb_key);

    // Decrement refs for recipe inputs
    try {
      const recipe = JSON.parse(variant.recipe) as { inputs?: Array<{ imageKey: string }> };
      if (recipe.inputs) {
        for (const input of recipe.inputs) {
          await this.decrementRef(input.imageKey);
        }
      }
    } catch {
      // Ignore JSON parse errors
    }

    // Delete variant
    await this.ctx.storage.sql.exec('DELETE FROM variants WHERE id = ?', id);
  }

  /**
   * Create a chat message
   */
  private async createChatMessage(data: {
    senderType: 'user' | 'bot';
    senderId: string;
    content: string;
    metadata?: string;
  }): Promise<ChatMessage> {
    const id = crypto.randomUUID();
    const now = Date.now();

    const message: ChatMessage = {
      id,
      sender_type: data.senderType,
      sender_id: data.senderId,
      content: data.content,
      metadata: data.metadata ?? null,
      created_at: now,
    };

    await this.ctx.storage.sql.exec(
      `INSERT INTO chat_messages (id, sender_type, sender_id, content, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      message.id,
      message.sender_type,
      message.sender_id,
      message.content,
      message.metadata,
      message.created_at
    );

    return message;
  }

  // ============================================================================
  // Image Reference Counting
  // ============================================================================

  private async incrementRef(imageKey: string): Promise<void> {
    await this.ctx.storage.sql.exec(
      `INSERT INTO image_refs (image_key, ref_count) VALUES (?, 1)
       ON CONFLICT(image_key) DO UPDATE SET ref_count = ref_count + 1`,
      imageKey
    );
  }

  private async decrementRef(imageKey: string): Promise<void> {
    const result = await this.ctx.storage.sql.exec(
      `UPDATE image_refs SET ref_count = ref_count - 1
       WHERE image_key = ?
       RETURNING ref_count`,
      imageKey
    );

    const row = result.toArray()[0] as unknown as { ref_count: number } | undefined;

    if (row && row.ref_count <= 0) {
      // Delete from R2
      try {
        await this.env.IMAGES.delete(imageKey);
      } catch (error) {
        console.error('Failed to delete image from R2:', error);
      }

      // Delete ref record
      await this.ctx.storage.sql.exec('DELETE FROM image_refs WHERE image_key = ?', imageKey);
    }
  }

  // ============================================================================
  // WebSocket Helpers
  // ============================================================================

  /**
   * Get WebSocket metadata
   */
  private getWebSocketMeta(ws: WebSocket): WebSocketMeta {
    const tags = this.ctx.getTags(ws);
    const metaStr = tags[0] || '{}';
    return JSON.parse(metaStr) as WebSocketMeta;
  }

  /**
   * Send message to a specific WebSocket
   */
  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('Failed to send WebSocket message:', error);
    }
  }

  /**
   * Send error message to a specific WebSocket
   */
  private sendError(ws: WebSocket, code: string, message: string): void {
    this.send(ws, { type: 'error', code, message });
  }

  /**
   * Broadcast message to all connected WebSockets
   */
  private broadcast(message: ServerMessage, excludeWs?: WebSocket): void {
    const connections = this.ctx.getWebSockets();
    for (const ws of connections) {
      if (ws !== excludeWs) {
        this.send(ws, message);
      }
    }
  }

  /**
   * Extract JWT token from cookie header
   */
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
}
