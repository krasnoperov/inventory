/**
 * Space Repository - Data Access Layer
 *
 * Encapsulates all database operations for SpaceDO.
 * Uses dependency injection for the SQL storage interface.
 *
 * Benefits:
 * - Centralizes all data access logic
 * - Makes SpaceDO thinner (just orchestration)
 * - Testable with mock storage
 * - Clear separation of concerns
 */

import type {
  Asset,
  Variant,
  ChatSession,
  ChatMessage,
  Lineage,
  PendingApproval,
  AutoExecuted,
  UserSession,
  SpaceStyle,
  RotationSet,
  RotationView,
  TileSet,
  TilePosition,
} from '../types';
import type { SimplePlan } from '../../../../shared/websocket-types';
import {
  AssetQueries,
  VariantQueries,
  LineageQueries,
  ChatQueries,
  ChatSessionQueries,
  ApprovalQueries,
  AutoExecutedQueries,
  UserSessionQueries,
  RotationSetQueries,
  RotationViewQueries,
  TileSetQueries,
  TilePositionQueries,
  buildAssetUpdateQuery,
  buildInClause,
} from '../queries';
import {
  INCREMENT_REF_SQL,
  DECREMENT_REF_SQL,
  DELETE_REF_SQL,
  getVariantImageKeys,
} from '../variant/imageRefs';
import { loggers } from '../../../../shared/logger';

const log = loggers.spaceRepository;

// ============================================================================
// Types
// ============================================================================

/** SQL storage interface (subset of Cloudflare DO SqlStorage) */
export interface SqlStorage {
  exec(query: string, ...bindings: unknown[]): SqlStorageResult;
}

/** Result from SQL exec */
export interface SqlStorageResult {
  toArray(): unknown[];
}

/** R2 bucket interface for image storage */
export interface ImageStorage {
  delete(key: string): Promise<void>;
}

/** Full state of the space */
export interface SpaceState {
  assets: Asset[];
  variants: Variant[];
  lineage: Lineage[];
  rotationSets: RotationSet[];
  rotationViews: RotationView[];
  tileSets: TileSet[];
  tilePositions: TilePosition[];
}

/** Asset with variant count for bot context */
export interface AssetWithVariantCount {
  id: string;
  name: string;
  type: string;
  variantCount: number;
}

/** Lineage with full details */
export interface LineageWithDetails {
  id: string;
  parent_variant_id: string;
  child_variant_id: string;
  relation_type: string;
  severed: boolean;
  created_at: number;
  asset_id: string;
  image_key: string;
  thumb_key: string;
  asset_name: string;
}

// ============================================================================
// Repository
// ============================================================================

export class SpaceRepository {
  constructor(
    private sql: SqlStorage,
    private images?: ImageStorage
  ) {}

  // ==========================================================================
  // Asset Operations
  // ==========================================================================

  async getAllAssets(): Promise<Asset[]> {
    const result = await this.sql.exec(AssetQueries.GET_ALL);
    return result.toArray() as Asset[];
  }

  async getAssetById(id: string): Promise<Asset | null> {
    const result = await this.sql.exec(AssetQueries.GET_BY_ID, id);
    return (result.toArray()[0] as Asset) ?? null;
  }

  async getAssetsByParent(parentId: string | null): Promise<Asset[]> {
    if (parentId === null) {
      const result = await this.sql.exec(
        'SELECT * FROM assets WHERE parent_asset_id IS NULL ORDER BY updated_at DESC'
      );
      return result.toArray() as Asset[];
    }
    const result = await this.sql.exec(AssetQueries.GET_BY_PARENT, parentId);
    return result.toArray() as Asset[];
  }

  async getAssetsWithVariantCount(): Promise<AssetWithVariantCount[]> {
    const result = await this.sql.exec(AssetQueries.GET_WITH_VARIANT_COUNT);
    return (result.toArray() as Array<{ id: string; name: string; type: string; variant_count: number }>).map(
      (row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        variantCount: row.variant_count,
      })
    );
  }

  async createAsset(asset: {
    id: string;
    name: string;
    type: string;
    tags: string[];
    parentAssetId?: string | null;
    createdBy: string;
  }): Promise<Asset> {
    const now = Date.now();
    await this.sql.exec(
      AssetQueries.INSERT,
      asset.id,
      asset.name,
      asset.type,
      JSON.stringify(asset.tags),
      asset.parentAssetId ?? null,
      null, // active_variant_id
      asset.createdBy,
      now,
      now
    );
    return (await this.getAssetById(asset.id))!;
  }

  async updateAsset(
    id: string,
    changes: {
      name?: string;
      tags?: string[];
      type?: string;
      parent_asset_id?: string | null;
      active_variant_id?: string | null;
    }
  ): Promise<Asset | null> {
    const existing = await this.getAssetById(id);
    if (!existing) return null;

    const { sql, values } = buildAssetUpdateQuery(changes);
    await this.sql.exec(sql, ...values, id);

    return this.getAssetById(id);
  }

  async deleteAsset(id: string): Promise<void> {
    // Get all variants to decrement refs
    const variants = await this.getVariantsByAsset(id);

    // Decrement refs for all images
    for (const variant of variants) {
      const imageKeys = getVariantImageKeys(variant);
      for (const key of imageKeys) {
        await this.decrementImageRef(key);
      }
    }

    // Reparent child assets to root (set parent_asset_id to NULL)
    // This prevents orphaned children with invalid parent references
    await this.sql.exec(
      'UPDATE assets SET parent_asset_id = NULL, updated_at = ? WHERE parent_asset_id = ?',
      Date.now(),
      id
    );

    // Delete asset (cascades to variants via FK)
    await this.sql.exec(AssetQueries.DELETE, id);
  }

  async setActiveVariant(assetId: string, variantId: string): Promise<Asset | null> {
    return this.updateAsset(assetId, { active_variant_id: variantId });
  }

  // ==========================================================================
  // Variant Operations
  // ==========================================================================

  async getAllVariants(): Promise<Variant[]> {
    const result = await this.sql.exec(VariantQueries.GET_ALL);
    return result.toArray() as Variant[];
  }

  async getVariantById(id: string): Promise<Variant | null> {
    const result = await this.sql.exec(VariantQueries.GET_BY_ID, id);
    return (result.toArray()[0] as Variant) ?? null;
  }

  async getVariantByWorkflowId(workflowId: string): Promise<Variant | null> {
    const result = await this.sql.exec(VariantQueries.GET_BY_WORKFLOW_ID, workflowId);
    return (result.toArray()[0] as Variant) ?? null;
  }

  async getVariantsByAsset(assetId: string): Promise<Variant[]> {
    const result = await this.sql.exec(VariantQueries.GET_BY_ASSET, assetId);
    return result.toArray() as Variant[];
  }

  async getVariantImageKey(variantId: string): Promise<string | null> {
    const result = await this.sql.exec('SELECT image_key FROM variants WHERE id = ?', variantId);
    const row = result.toArray()[0] as { image_key: string } | undefined;
    return row?.image_key ?? null;
  }

  async getVariantWithAssetName(
    variantId: string
  ): Promise<{ image_key: string; asset_name: string } | null> {
    const result = await this.sql.exec(VariantQueries.GET_WITH_ASSET_NAME, variantId);
    return (result.toArray()[0] as { image_key: string; asset_name: string }) ?? null;
  }

  /**
   * Create a completed variant (for forks/imports where images already exist).
   * For generation workflows, use createPlaceholderVariant + completeVariant.
   */
  async createVariant(variant: {
    id: string;
    assetId: string;
    workflowId?: string | null;
    imageKey: string;
    thumbKey: string;
    recipe: string;
    createdBy: string;
  }): Promise<Variant> {
    const now = Date.now();
    await this.sql.exec(
      VariantQueries.INSERT,
      variant.id,
      variant.assetId,
      variant.workflowId ?? null,
      'completed', // status
      null, // error_message
      variant.imageKey,
      variant.thumbKey,
      variant.recipe,
      0, // starred = false
      variant.createdBy,
      now,
      now // updated_at
    );

    // Increment refs for all images
    const imageKeys = getVariantImageKeys({
      image_key: variant.imageKey,
      thumb_key: variant.thumbKey,
      recipe: variant.recipe,
    });
    for (const key of imageKeys) {
      await this.incrementImageRef(key);
    }

    return (await this.getVariantById(variant.id))!;
  }

  async updateVariantStarred(variantId: string, starred: boolean): Promise<Variant | null> {
    const existing = await this.getVariantById(variantId);
    if (!existing) return null;

    await this.sql.exec(VariantQueries.UPDATE_STARRED, starred ? 1 : 0, variantId);
    return this.getVariantById(variantId);
  }

  async deleteVariant(variantId: string): Promise<boolean> {
    const variant = await this.getVariantById(variantId);
    if (!variant) return false;

    // Only decrement refs for completed variants (pending/failed have no images)
    if (variant.status === 'completed') {
      const imageKeys = getVariantImageKeys(variant);
      for (const key of imageKeys) {
        await this.decrementImageRef(key);
      }
    }

    await this.sql.exec(VariantQueries.DELETE, variantId);
    return true;
  }

  // ==========================================================================
  // Placeholder Variant Lifecycle
  // ==========================================================================

  /**
   * Create a placeholder variant for a pending generation.
   * No image refs are incremented since there are no images yet.
   * If planStepId is provided, this variant is linked to a plan step.
   */
  async createPlaceholderVariant(data: {
    id: string;
    assetId: string;
    recipe: string;
    createdBy: string;
    planStepId?: string;
    batchId?: string;
  }): Promise<Variant> {
    const now = Date.now();
    if (data.batchId) {
      // Use extended INSERT with batch_id
      await this.sql.exec(
        `INSERT INTO variants (id, asset_id, status, recipe, created_by, created_at, updated_at, plan_step_id, batch_id)
         VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
        data.id,
        data.assetId,
        data.recipe,
        data.createdBy,
        now,
        now,
        data.planStepId ?? null,
        data.batchId
      );
    } else {
      await this.sql.exec(
        VariantQueries.INSERT_PLACEHOLDER,
        data.id,
        data.assetId,
        data.recipe,
        data.createdBy,
        now,
        now,
        data.planStepId ?? null
      );
    }
    return (await this.getVariantById(data.id))!;
  }

  /**
   * Update a placeholder variant with workflow info when generation starts.
   */
  async updateVariantWorkflow(
    variantId: string,
    workflowId: string,
    status: 'pending' | 'processing'
  ): Promise<Variant | null> {
    const existing = await this.getVariantById(variantId);
    if (!existing) return null;

    await this.sql.exec(VariantQueries.UPDATE_WORKFLOW, workflowId, status, Date.now(), variantId);
    return this.getVariantById(variantId);
  }

  /**
   * Update variant status only (e.g., pending → processing).
   * Called by workflow via internal endpoint.
   */
  async updateVariantStatus(
    variantId: string,
    status: string
  ): Promise<Variant | null> {
    const existing = await this.getVariantById(variantId);
    if (!existing) return null;

    await this.sql.exec(VariantQueries.UPDATE_STATUS, status, Date.now(), variantId);
    return this.getVariantById(variantId);
  }

  /**
   * Complete a variant with generated images.
   * Increments refs for all images (image_key, thumb_key, recipe inputs).
   */
  async completeVariant(
    variantId: string,
    imageKey: string,
    thumbKey: string
  ): Promise<Variant | null> {
    const existing = await this.getVariantById(variantId);
    if (!existing) return null;

    await this.sql.exec(VariantQueries.COMPLETE, imageKey, thumbKey, Date.now(), variantId);

    // Increment refs for new images
    const imageKeys = getVariantImageKeys({
      image_key: imageKey,
      thumb_key: thumbKey,
      recipe: existing.recipe,
    });
    for (const key of imageKeys) {
      await this.incrementImageRef(key);
    }

    return this.getVariantById(variantId);
  }

  /**
   * Mark a variant as failed with an error message.
   * No ref changes needed.
   */
  async failVariant(variantId: string, errorMessage: string): Promise<Variant | null> {
    const existing = await this.getVariantById(variantId);
    if (!existing) return null;

    await this.sql.exec(VariantQueries.FAIL, errorMessage, Date.now(), variantId);
    return this.getVariantById(variantId);
  }

  /**
   * Reset a failed variant for retry.
   * Clears error, workflow_id, resets status to pending.
   */
  async resetVariantForRetry(variantId: string): Promise<Variant | null> {
    const existing = await this.getVariantById(variantId);
    if (!existing) return null;

    await this.sql.exec(VariantQueries.RESET_FOR_RETRY, Date.now(), variantId);
    return this.getVariantById(variantId);
  }

  // ==========================================================================
  // Lineage Operations
  // ==========================================================================

  async getAllLineage(): Promise<Lineage[]> {
    const result = await this.sql.exec(LineageQueries.GET_ALL);
    return result.toArray() as Lineage[];
  }

  async getLineageById(id: string): Promise<Lineage | null> {
    const result = await this.sql.exec(LineageQueries.GET_BY_ID, id);
    return (result.toArray()[0] as Lineage) ?? null;
  }

  async getLineageForVariant(variantId: string): Promise<Lineage[]> {
    const result = await this.sql.exec(LineageQueries.GET_FOR_VARIANT, variantId, variantId);
    return result.toArray() as Lineage[];
  }

  async getLineageForVariants(variantIds: string[]): Promise<Lineage[]> {
    if (variantIds.length === 0) return [];
    const { placeholders } = buildInClause(variantIds);
    const result = await this.sql.exec(
      `SELECT * FROM lineage WHERE parent_variant_id IN (${placeholders}) OR child_variant_id IN (${placeholders})`,
      ...variantIds,
      ...variantIds
    );
    return result.toArray() as Lineage[];
  }

  async getParentLineageWithDetails(childVariantId: string): Promise<LineageWithDetails[]> {
    const result = await this.sql.exec(LineageQueries.GET_PARENTS_WITH_DETAILS, childVariantId);
    return (result.toArray() as Array<Omit<LineageWithDetails, 'severed'> & { severed: number }>).map((row) => ({
      ...row,
      severed: Boolean(row.severed),
    }));
  }

  async getChildLineageWithDetails(parentVariantId: string): Promise<LineageWithDetails[]> {
    const result = await this.sql.exec(LineageQueries.GET_CHILDREN_WITH_DETAILS, parentVariantId);
    return (result.toArray() as Array<Omit<LineageWithDetails, 'severed'> & { severed: number }>).map((row) => ({
      ...row,
      severed: Boolean(row.severed),
    }));
  }

  async createLineage(lineage: {
    id: string;
    parentVariantId: string;
    childVariantId: string;
    relationType: 'derived' | 'refined' | 'forked';
  }): Promise<Lineage> {
    const now = Date.now();

    // Verify parent and child variants exist before insert
    const parentExists = await this.getVariantById(lineage.parentVariantId);
    const childExists = await this.getVariantById(lineage.childVariantId);

    if (!parentExists || !childExists) {
      log.error('createLineage FK violation - variant does not exist', {
        lineageId: lineage.id,
        parentExists: !!parentExists,
        childExists: !!childExists,
      });
      throw new Error(`Cannot create lineage: parent=${!!parentExists}, child=${!!childExists}`);
    }

    await this.sql.exec(
      LineageQueries.INSERT,
      lineage.id,
      lineage.parentVariantId,
      lineage.childVariantId,
      lineage.relationType,
      0, // severed = false
      now
    );

    // Verify insert succeeded (minimal logging)
    const created = await this.getLineageById(lineage.id);
    if (!created) {
      log.error('createLineage failed - record not found after INSERT', { lineageId: lineage.id });
      throw new Error(`Lineage INSERT failed: ${lineage.id}`);
    }
    return created;
  }

  async severLineage(lineageId: string): Promise<boolean> {
    const existing = await this.getLineageById(lineageId);
    if (!existing) return false;

    await this.sql.exec(LineageQueries.UPDATE_SEVERED, lineageId);
    return true;
  }

  // ==========================================================================
  // Chat Session Operations
  // ==========================================================================

  async getChatSessionById(id: string): Promise<ChatSession | null> {
    const result = await this.sql.exec(ChatSessionQueries.GET_BY_ID, id);
    return (result.toArray()[0] as ChatSession) ?? null;
  }

  async getAllChatSessions(): Promise<ChatSession[]> {
    const result = await this.sql.exec(ChatSessionQueries.GET_ALL);
    return result.toArray() as ChatSession[];
  }

  async getRecentChatSessions(limit: number = 10): Promise<ChatSession[]> {
    const result = await this.sql.exec(ChatSessionQueries.GET_RECENT, limit);
    return result.toArray() as ChatSession[];
  }

  async createChatSession(session: {
    id: string;
    title?: string | null;
    createdBy: string;
  }): Promise<ChatSession> {
    const now = Date.now();
    await this.sql.exec(
      ChatSessionQueries.INSERT,
      session.id,
      session.title ?? null,
      session.createdBy,
      now,
      now
    );
    return (await this.getChatSessionById(session.id))!;
  }

  async updateChatSessionTitle(sessionId: string, title: string): Promise<ChatSession | null> {
    const existing = await this.getChatSessionById(sessionId);
    if (!existing) return null;

    await this.sql.exec(ChatSessionQueries.UPDATE_TITLE, title, Date.now(), sessionId);
    return this.getChatSessionById(sessionId);
  }

  async touchChatSession(sessionId: string): Promise<void> {
    await this.sql.exec(ChatSessionQueries.TOUCH, Date.now(), sessionId);
  }

  async deleteChatSession(sessionId: string): Promise<boolean> {
    const existing = await this.getChatSessionById(sessionId);
    if (!existing) return false;

    await this.sql.exec(ChatSessionQueries.DELETE, sessionId);
    return true;
  }

  // ==========================================================================
  // Chat Message Operations
  // ==========================================================================

  async getChatHistoryBySession(sessionId: string, limit: number = 100): Promise<ChatMessage[]> {
    const result = await this.sql.exec(ChatQueries.GET_BY_SESSION, sessionId, limit);
    return result.toArray() as ChatMessage[];
  }

  async getChatHistory(limit: number = 20): Promise<ChatMessage[]> {
    const result = await this.sql.exec(ChatQueries.GET_RECENT, limit);
    return result.toArray() as ChatMessage[];
  }

  async createChatMessage(message: {
    id: string;
    sessionId?: string | null;
    senderType: 'user' | 'bot';
    senderId: string;
    content: string;
    metadata?: string | null;
  }): Promise<ChatMessage> {
    const now = Date.now();
    await this.sql.exec(
      ChatQueries.INSERT,
      message.id,
      message.sessionId ?? null,
      message.senderType,
      message.senderId,
      message.content,
      message.metadata ?? null,
      now
    );

    // Touch the session to update its timestamp
    if (message.sessionId) {
      await this.touchChatSession(message.sessionId);
    }

    return {
      id: message.id,
      session_id: message.sessionId ?? null,
      sender_type: message.senderType,
      sender_id: message.senderId,
      content: message.content,
      metadata: message.metadata ?? null,
      created_at: now,
    };
  }

  async clearChatHistoryBySession(sessionId: string): Promise<void> {
    await this.sql.exec(ChatQueries.DELETE_BY_SESSION, sessionId);
  }

  async clearChatHistory(): Promise<void> {
    await this.sql.exec(ChatQueries.DELETE_ALL);
  }

  // ==========================================================================
  // State Operations
  // ==========================================================================

  async getFullState(): Promise<SpaceState> {
    const [assets, variants, lineage, rotationSets, rotationViews, tileSets, tilePositions] = await Promise.all([
      this.getAllAssets(),
      this.getAllVariants(),
      this.getAllLineage(),
      this.getAllRotationSets(),
      this.getAllRotationViews(),
      this.getAllTileSets(),
      this.getAllTilePositions(),
    ]);
    return { assets, variants, lineage, rotationSets, rotationViews, tileSets, tilePositions };
  }

  // ==========================================================================
  // Plan Operations (SimplePlan - markdown-based)
  // ==========================================================================

  /**
   * Map database row (snake_case) to SimplePlan interface (camelCase)
   */
  private mapDbRowToSimplePlan(row: Record<string, unknown>): SimplePlan {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      content: row.content as string,
      status: row.status as SimplePlan['status'],
      createdBy: row.created_by as string,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  /**
   * Get the active plan for the current chat session.
   * Plans are per-session, linked by session_id.
   */
  async getActivePlan(sessionId?: string): Promise<SimplePlan | null> {
    if (!sessionId) return null;
    const result = await this.sql.exec(
      `SELECT * FROM simple_plans WHERE session_id = ? AND status != 'archived' ORDER BY updated_at DESC LIMIT 1`,
      sessionId
    );
    const row = result.toArray()[0] as Record<string, unknown> | undefined;
    return row ? this.mapDbRowToSimplePlan(row) : null;
  }

  /**
   * Create or update a plan for a session
   */
  async upsertPlan(plan: {
    sessionId: string;
    content: string;
    createdBy: string;
  }): Promise<SimplePlan> {
    const existing = await this.getActivePlan(plan.sessionId);
    const now = Date.now();

    if (existing) {
      // Update existing plan
      await this.sql.exec(
        `UPDATE simple_plans SET content = ?, updated_at = ? WHERE id = ?`,
        plan.content,
        now,
        existing.id
      );
      return { ...existing, content: plan.content, updatedAt: now };
    } else {
      // Create new plan
      const id = crypto.randomUUID();
      await this.sql.exec(
        `INSERT INTO simple_plans (id, session_id, content, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
        id,
        plan.sessionId,
        plan.content,
        plan.createdBy,
        now,
        now
      );
      return {
        id,
        sessionId: plan.sessionId,
        content: plan.content,
        status: 'draft',
        createdBy: plan.createdBy,
        createdAt: now,
        updatedAt: now,
      };
    }
  }

  /**
   * Update plan status (draft -> approved -> archived)
   */
  async updatePlanStatus(planId: string, status: SimplePlan['status']): Promise<SimplePlan | null> {
    const now = Date.now();
    await this.sql.exec(
      `UPDATE simple_plans SET status = ?, updated_at = ? WHERE id = ?`,
      status,
      now,
      planId
    );
    const result = await this.sql.exec(`SELECT * FROM simple_plans WHERE id = ?`, planId);
    const row = result.toArray()[0] as Record<string, unknown> | undefined;
    return row ? this.mapDbRowToSimplePlan(row) : null;
  }

  /**
   * Archive plan (mark as done/dismissed)
   */
  async archivePlan(planId: string): Promise<void> {
    await this.updatePlanStatus(planId, 'archived');
  }

  // ==========================================================================
  // Approval Operations
  // ==========================================================================

  async getPendingApprovals(): Promise<PendingApproval[]> {
    const result = await this.sql.exec(ApprovalQueries.GET_PENDING);
    return result.toArray() as PendingApproval[];
  }

  async getApprovalById(id: string): Promise<PendingApproval | null> {
    const result = await this.sql.exec(ApprovalQueries.GET_BY_ID, id);
    return (result.toArray()[0] as PendingApproval) ?? null;
  }

  async getApprovalsByRequest(requestId: string): Promise<PendingApproval[]> {
    const result = await this.sql.exec(ApprovalQueries.GET_BY_REQUEST, requestId);
    return result.toArray() as PendingApproval[];
  }

  async getApprovalsByPlan(planId: string): Promise<PendingApproval[]> {
    const result = await this.sql.exec(ApprovalQueries.GET_BY_PLAN, planId);
    return result.toArray() as PendingApproval[];
  }

  async createApproval(approval: {
    id: string;
    requestId: string;
    planId?: string | null;
    planStepId?: string | null;
    tool: string;
    params: string; // JSON
    description: string;
    createdBy: string;
  }): Promise<PendingApproval> {
    const now = Date.now();
    await this.sql.exec(
      ApprovalQueries.INSERT,
      approval.id,
      approval.requestId,
      approval.planId ?? null,
      approval.planStepId ?? null,
      approval.tool,
      approval.params,
      approval.description,
      'pending',
      approval.createdBy,
      now,
      now
    );
    return (await this.getApprovalById(approval.id))!;
  }

  async approveApproval(approvalId: string, approvedBy: string): Promise<PendingApproval | null> {
    const existing = await this.getApprovalById(approvalId);
    if (!existing) return null;

    await this.sql.exec(ApprovalQueries.APPROVE, approvedBy, Date.now(), approvalId);
    return this.getApprovalById(approvalId);
  }

  async rejectApproval(approvalId: string, rejectedBy: string): Promise<PendingApproval | null> {
    const existing = await this.getApprovalById(approvalId);
    if (!existing) return null;

    await this.sql.exec(ApprovalQueries.REJECT, rejectedBy, Date.now(), approvalId);
    return this.getApprovalById(approvalId);
  }

  async executeApproval(approvalId: string, resultJobId: string): Promise<PendingApproval | null> {
    const existing = await this.getApprovalById(approvalId);
    if (!existing) return null;

    await this.sql.exec(ApprovalQueries.EXECUTE, resultJobId, Date.now(), approvalId);
    return this.getApprovalById(approvalId);
  }

  async failApproval(approvalId: string, errorMessage: string): Promise<PendingApproval | null> {
    const existing = await this.getApprovalById(approvalId);
    if (!existing) return null;

    await this.sql.exec(ApprovalQueries.FAIL, errorMessage, Date.now(), approvalId);
    return this.getApprovalById(approvalId);
  }

  // ==========================================================================
  // Auto-Executed Operations
  // ==========================================================================

  async getAutoExecutedByRequest(requestId: string): Promise<AutoExecuted[]> {
    const result = await this.sql.exec(AutoExecutedQueries.GET_BY_REQUEST, requestId);
    return (result.toArray() as Array<Omit<AutoExecuted, 'success'> & { success: number }>).map((row) => ({
      ...row,
      success: Boolean(row.success),
    }));
  }

  async getRecentAutoExecuted(limit: number = 20): Promise<AutoExecuted[]> {
    const result = await this.sql.exec(AutoExecutedQueries.GET_RECENT, limit);
    return (result.toArray() as Array<Omit<AutoExecuted, 'success'> & { success: number }>).map((row) => ({
      ...row,
      success: Boolean(row.success),
    }));
  }

  async createAutoExecuted(autoExecuted: {
    id: string;
    requestId: string;
    tool: string;
    params: string;
    result: string;
    success: boolean;
    error?: string | null;
  }): Promise<AutoExecuted> {
    const now = Date.now();
    await this.sql.exec(
      AutoExecutedQueries.INSERT,
      autoExecuted.id,
      autoExecuted.requestId,
      autoExecuted.tool,
      autoExecuted.params,
      autoExecuted.result,
      autoExecuted.success ? 1 : 0,
      autoExecuted.error ?? null,
      now
    );
    return {
      id: autoExecuted.id,
      request_id: autoExecuted.requestId,
      tool: autoExecuted.tool,
      params: autoExecuted.params,
      result: autoExecuted.result,
      success: autoExecuted.success,
      error: autoExecuted.error ?? null,
      created_at: now,
    };
  }

  // ==========================================================================
  // User Session Operations
  // ==========================================================================

  async getUserSession(userId: string): Promise<UserSession | null> {
    const result = await this.sql.exec(UserSessionQueries.GET_BY_USER, userId);
    return (result.toArray()[0] as UserSession) ?? null;
  }

  async upsertUserSession(session: {
    userId: string;
    viewingAssetId?: string | null;
    viewingVariantId?: string | null;
    forgeContext?: string | null;
    activeChatSessionId?: string | null;
  }): Promise<UserSession> {
    const now = Date.now();
    await this.sql.exec(
      UserSessionQueries.UPSERT,
      session.userId,
      session.viewingAssetId ?? null,
      session.viewingVariantId ?? null,
      session.forgeContext ?? null,
      session.activeChatSessionId ?? null,
      now,
      now
    );
    return (await this.getUserSession(session.userId))!;
  }

  async updateUserActiveChatSession(userId: string, sessionId: string | null): Promise<UserSession | null> {
    const existing = await this.getUserSession(userId);
    if (!existing) return null;

    await this.sql.exec(UserSessionQueries.UPDATE_CHAT_SESSION, sessionId, Date.now(), userId);
    return this.getUserSession(userId);
  }

  async updateUserLastSeen(userId: string): Promise<void> {
    await this.sql.exec(UserSessionQueries.UPDATE_LAST_SEEN, Date.now(), userId);
  }

  // ==========================================================================
  // Style Operations
  // ==========================================================================

  async getActiveStyle(): Promise<SpaceStyle | null> {
    const result = await this.sql.exec('SELECT * FROM space_styles LIMIT 1');
    return (result.toArray()[0] as SpaceStyle) ?? null;
  }

  async getStyleById(id: string): Promise<SpaceStyle | null> {
    const result = await this.sql.exec('SELECT * FROM space_styles WHERE id = ?', id);
    return (result.toArray()[0] as SpaceStyle) ?? null;
  }

  async createStyle(data: {
    id: string;
    name?: string;
    description: string;
    imageKeys: string[];
    enabled?: boolean;
    createdBy: string;
  }): Promise<SpaceStyle> {
    const now = Date.now();
    await this.sql.exec(
      `INSERT INTO space_styles (id, name, description, image_keys, enabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      data.id,
      data.name || 'Default Style',
      data.description,
      JSON.stringify(data.imageKeys),
      data.enabled !== false ? 1 : 0,
      data.createdBy,
      now,
      now
    );

    // Increment image refs for style images
    for (const key of data.imageKeys) {
      await this.incrementImageRef(key);
    }

    return (await this.getStyleById(data.id))!;
  }

  async updateStyle(id: string, changes: {
    name?: string;
    description?: string;
    imageKeys?: string[];
    enabled?: boolean;
  }): Promise<SpaceStyle | null> {
    const existing = await this.getStyleById(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (changes.name !== undefined) {
      updates.push('name = ?');
      values.push(changes.name);
    }
    if (changes.description !== undefined) {
      updates.push('description = ?');
      values.push(changes.description);
    }
    if (changes.imageKeys !== undefined) {
      updates.push('image_keys = ?');
      values.push(JSON.stringify(changes.imageKeys));

      // Diff old vs new image keys for ref counting
      const oldKeys: string[] = JSON.parse(existing.image_keys);
      const newKeys = changes.imageKeys;
      const added = newKeys.filter(k => !oldKeys.includes(k));
      const removed = oldKeys.filter(k => !newKeys.includes(k));

      for (const key of added) {
        await this.incrementImageRef(key);
      }
      for (const key of removed) {
        await this.decrementImageRef(key);
      }
    }
    if (changes.enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(changes.enabled ? 1 : 0);
    }

    if (updates.length === 0) return existing;

    updates.push('updated_at = ?');
    values.push(Date.now());

    await this.sql.exec(
      `UPDATE space_styles SET ${updates.join(', ')} WHERE id = ?`,
      ...values,
      id
    );

    return this.getStyleById(id);
  }

  async deleteStyle(id: string): Promise<boolean> {
    const existing = await this.getStyleById(id);
    if (!existing) return false;

    // Decrement image refs for style images
    const imageKeys: string[] = JSON.parse(existing.image_keys);
    for (const key of imageKeys) {
      await this.decrementImageRef(key);
    }

    await this.sql.exec('DELETE FROM space_styles WHERE id = ?', id);
    return true;
  }

  async toggleStyle(id: string, enabled: boolean): Promise<SpaceStyle | null> {
    return this.updateStyle(id, { enabled });
  }

  // ==========================================================================
  // Batch Operations
  // ==========================================================================

  async getBatchProgress(batchId: string): Promise<{
    totalCount: number;
    completedCount: number;
    failedCount: number;
    pendingCount: number;
  }> {
    const result = await this.sql.exec(
      `SELECT status, COUNT(*) as count FROM variants WHERE batch_id = ? GROUP BY status`,
      batchId
    );
    const rows = result.toArray() as Array<{ status: string; count: number }>;

    let totalCount = 0;
    let completedCount = 0;
    let failedCount = 0;
    let pendingCount = 0;

    for (const row of rows) {
      totalCount += row.count;
      if (row.status === 'completed') completedCount = row.count;
      else if (row.status === 'failed') failedCount = row.count;
      else pendingCount += row.count; // pending, processing, uploading
    }

    return { totalCount, completedCount, failedCount, pendingCount };
  }

  // ==========================================================================
  // Rotation Set Operations
  // ==========================================================================

  async getAllRotationSets(): Promise<RotationSet[]> {
    try {
      const result = await this.sql.exec(RotationSetQueries.GET_ALL);
      return result.toArray() as RotationSet[];
    } catch {
      // Table may not exist yet (pre-migration)
      return [];
    }
  }

  async getRotationSetById(id: string): Promise<RotationSet | null> {
    const result = await this.sql.exec(RotationSetQueries.GET_BY_ID, id);
    return (result.toArray()[0] as RotationSet) ?? null;
  }

  async createRotationSet(data: {
    id: string;
    assetId: string;
    sourceVariantId: string;
    config: string;
    totalSteps: number;
    createdBy: string;
  }): Promise<RotationSet> {
    const now = Date.now();
    await this.sql.exec(
      RotationSetQueries.INSERT,
      data.id,
      data.assetId,
      data.sourceVariantId,
      data.config,
      'generating',
      0,
      data.totalSteps,
      null,
      data.createdBy,
      now,
      now
    );
    return (await this.getRotationSetById(data.id))!;
  }

  async updateRotationSetStatus(id: string, status: string): Promise<RotationSet | null> {
    await this.sql.exec(RotationSetQueries.UPDATE_STATUS, status, Date.now(), id);
    return this.getRotationSetById(id);
  }

  async updateRotationSetStep(id: string, step: number): Promise<RotationSet | null> {
    await this.sql.exec(RotationSetQueries.UPDATE_STEP, step, Date.now(), id);
    return this.getRotationSetById(id);
  }

  async failRotationSet(id: string, error: string): Promise<RotationSet | null> {
    await this.sql.exec(RotationSetQueries.FAIL, error, Date.now(), id);
    return this.getRotationSetById(id);
  }

  async cancelRotationSet(id: string): Promise<RotationSet | null> {
    await this.sql.exec(RotationSetQueries.CANCEL, Date.now(), id);
    return this.getRotationSetById(id);
  }

  // ==========================================================================
  // Rotation View Operations
  // ==========================================================================

  async getAllRotationViews(): Promise<RotationView[]> {
    try {
      const result = await this.sql.exec(RotationViewQueries.GET_ALL);
      return result.toArray() as RotationView[];
    } catch {
      return [];
    }
  }

  async getRotationViewsBySet(setId: string): Promise<RotationView[]> {
    const result = await this.sql.exec(RotationViewQueries.GET_BY_SET, setId);
    return result.toArray() as RotationView[];
  }

  async getRotationViewByVariant(variantId: string): Promise<RotationView | null> {
    const result = await this.sql.exec(RotationViewQueries.GET_BY_VARIANT, variantId);
    return (result.toArray()[0] as RotationView) ?? null;
  }

  async getCompletedRotationViews(setId: string): Promise<Array<RotationView & { image_key: string; thumb_key: string }>> {
    const result = await this.sql.exec(RotationViewQueries.GET_COMPLETED_WITH_IMAGES, setId);
    return result.toArray() as Array<RotationView & { image_key: string; thumb_key: string }>;
  }

  async createRotationView(data: {
    id: string;
    rotationSetId: string;
    variantId: string;
    direction: string;
    stepIndex: number;
  }): Promise<RotationView> {
    const now = Date.now();
    await this.sql.exec(
      RotationViewQueries.INSERT,
      data.id,
      data.rotationSetId,
      data.variantId,
      data.direction,
      data.stepIndex,
      now
    );
    return {
      id: data.id,
      rotation_set_id: data.rotationSetId,
      variant_id: data.variantId,
      direction: data.direction,
      step_index: data.stepIndex,
      created_at: now,
    };
  }

  // ==========================================================================
  // Tile Set Operations
  // ==========================================================================

  async getAllTileSets(): Promise<TileSet[]> {
    try {
      const result = await this.sql.exec(TileSetQueries.GET_ALL);
      return result.toArray() as TileSet[];
    } catch {
      return [];
    }
  }

  async getTileSetById(id: string): Promise<TileSet | null> {
    const result = await this.sql.exec(TileSetQueries.GET_BY_ID, id);
    return (result.toArray()[0] as TileSet) ?? null;
  }

  async createTileSet(data: {
    id: string;
    assetId: string;
    tileType: string;
    gridWidth: number;
    gridHeight: number;
    seedVariantId?: string;
    config: string;
    totalSteps: number;
    createdBy: string;
  }): Promise<TileSet> {
    const now = Date.now();
    await this.sql.exec(
      TileSetQueries.INSERT,
      data.id,
      data.assetId,
      data.tileType,
      data.gridWidth,
      data.gridHeight,
      'generating',
      data.seedVariantId ?? null,
      data.config,
      0,
      data.totalSteps,
      null,
      data.createdBy,
      now,
      now
    );
    return (await this.getTileSetById(data.id))!;
  }

  async updateTileSetStatus(id: string, status: string): Promise<TileSet | null> {
    await this.sql.exec(TileSetQueries.UPDATE_STATUS, status, Date.now(), id);
    return this.getTileSetById(id);
  }

  async updateTileSetStep(id: string, step: number): Promise<TileSet | null> {
    await this.sql.exec(TileSetQueries.UPDATE_STEP, step, Date.now(), id);
    return this.getTileSetById(id);
  }

  async failTileSet(id: string, error: string): Promise<TileSet | null> {
    await this.sql.exec(TileSetQueries.FAIL, error, Date.now(), id);
    return this.getTileSetById(id);
  }

  async cancelTileSet(id: string): Promise<TileSet | null> {
    await this.sql.exec(TileSetQueries.CANCEL, Date.now(), id);
    return this.getTileSetById(id);
  }

  // ==========================================================================
  // Tile Position Operations
  // ==========================================================================

  async getAllTilePositions(): Promise<TilePosition[]> {
    try {
      const result = await this.sql.exec(TilePositionQueries.GET_ALL);
      return result.toArray() as TilePosition[];
    } catch {
      return [];
    }
  }

  async getTilePositionsBySet(setId: string): Promise<TilePosition[]> {
    const result = await this.sql.exec(TilePositionQueries.GET_BY_SET, setId);
    return result.toArray() as TilePosition[];
  }

  async getTilePositionByVariant(variantId: string): Promise<TilePosition | null> {
    const result = await this.sql.exec(TilePositionQueries.GET_BY_VARIANT, variantId);
    return (result.toArray()[0] as TilePosition) ?? null;
  }

  async getAdjacentTiles(setId: string, x: number, y: number): Promise<Array<TilePosition & { image_key: string; thumb_key: string; direction: string }>> {
    const result = await this.sql.exec(
      TilePositionQueries.GET_ADJACENT,
      // CASE params: N(y,x), E(x,y), S(y,x), W(x,y)
      y, x, x, y, y, x, x, y,
      // WHERE params: setId, then N(x,y-1), E(x+1,y), S(x,y+1), W(x-1,y)
      setId, x, y, x, y, x, y, x, y
    );
    return result.toArray() as Array<TilePosition & { image_key: string; thumb_key: string; direction: string }>;
  }

  async createTilePosition(data: {
    id: string;
    tileSetId: string;
    variantId: string;
    gridX: number;
    gridY: number;
  }): Promise<TilePosition> {
    const now = Date.now();
    await this.sql.exec(
      TilePositionQueries.INSERT,
      data.id,
      data.tileSetId,
      data.variantId,
      data.gridX,
      data.gridY,
      now
    );
    return {
      id: data.id,
      tile_set_id: data.tileSetId,
      variant_id: data.variantId,
      grid_x: data.gridX,
      grid_y: data.gridY,
      created_at: now,
    };
  }

  // ==========================================================================
  // Image Reference Counting
  // ==========================================================================

  private async incrementImageRef(imageKey: string): Promise<void> {
    await this.sql.exec(INCREMENT_REF_SQL, imageKey);
  }

  private async decrementImageRef(imageKey: string): Promise<void> {
    const result = await this.sql.exec(DECREMENT_REF_SQL, imageKey);
    const row = result.toArray()[0] as { ref_count: number } | undefined;

    if (row && row.ref_count <= 0) {
      // Delete from R2 if storage is available
      if (this.images) {
        try {
          await this.images.delete(imageKey);
        } catch (error) {
          log.error('Failed to delete image from R2', {
            imageKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      // Delete ref record
      await this.sql.exec(DELETE_REF_SQL, imageKey);
    }
  }
}
