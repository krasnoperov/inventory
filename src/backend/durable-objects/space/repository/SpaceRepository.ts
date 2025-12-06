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
  }): Promise<Variant> {
    const now = Date.now();
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
    await this.sql.exec(
      LineageQueries.INSERT,
      lineage.id,
      lineage.parentVariantId,
      lineage.childVariantId,
      lineage.relationType,
      0, // severed = false
      now
    );
    return (await this.getLineageById(lineage.id))!;
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
    const [assets, variants, lineage] = await Promise.all([
      this.getAllAssets(),
      this.getAllVariants(),
      this.getAllLineage(),
    ]);
    return { assets, variants, lineage };
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
