/**
 * SQL Queries for SpaceDO
 *
 * Centralized SQL query constants for:
 * - Easier auditing and schema changes
 * - Consistent query patterns
 * - Testable query builders
 */

import type { AssetChanges } from './types';

// ============================================================================
// Asset Queries
// ============================================================================

export const AssetQueries = {
  /** Get all assets ordered by updated_at */
  GET_ALL: 'SELECT * FROM assets ORDER BY updated_at DESC',

  /** Get asset by ID */
  GET_BY_ID: 'SELECT * FROM assets WHERE id = ?',

  /** Get parent_asset_id for an asset */
  GET_PARENT_ID: 'SELECT parent_asset_id FROM assets WHERE id = ?',

  /** Get assets by parent ID */
  GET_BY_PARENT: 'SELECT * FROM assets WHERE parent_asset_id = ? ORDER BY updated_at DESC',

  /** Get children count for an asset */
  GET_CHILDREN_COUNT: 'SELECT COUNT(*) as count FROM assets WHERE parent_asset_id = ?',

  /** Insert new asset */
  INSERT: `INSERT INTO assets (id, name, type, tags, parent_asset_id, active_variant_id, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,

  /** Delete asset by ID */
  DELETE: 'DELETE FROM assets WHERE id = ?',

  /** Get assets with variant count (for bot context) */
  GET_WITH_VARIANT_COUNT: `
    SELECT a.id, a.name, a.type, COUNT(v.id) as variant_count
    FROM assets a
    LEFT JOIN variants v ON a.id = v.asset_id
    GROUP BY a.id`,
} as const;

// ============================================================================
// Variant Queries
// ============================================================================

export const VariantQueries = {
  /** Get all variants */
  GET_ALL: 'SELECT * FROM variants',

  /** Get variant by ID */
  GET_BY_ID: 'SELECT * FROM variants WHERE id = ?',

  /** Get variant by workflow ID (for idempotency check) */
  GET_BY_WORKFLOW_ID: 'SELECT * FROM variants WHERE workflow_id = ?',

  /** Get variants for an asset */
  GET_BY_ASSET: 'SELECT * FROM variants WHERE asset_id = ? ORDER BY created_at DESC',

  /** Get variant with asset name (for vision service) */
  GET_WITH_ASSET_NAME: `
    SELECT v.image_key, a.name as asset_name
    FROM variants v
    JOIN assets a ON v.asset_id = a.id
    WHERE v.id = ?`,

  /** Insert new placeholder variant (pending status) */
  INSERT_PLACEHOLDER: `INSERT INTO variants (id, asset_id, status, recipe, created_by, created_at, updated_at, plan_step_id)
                       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`,

  /** Insert new completed variant (legacy - for forks/imports) */
  INSERT: `INSERT INTO variants (id, asset_id, workflow_id, status, error_message, image_key, thumb_key, recipe, starred, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

  /** Update variant to completed status with images */
  COMPLETE: `UPDATE variants SET status = 'completed', image_key = ?, thumb_key = ?, updated_at = ? WHERE id = ?`,

  /** Update variant to failed status with error */
  FAIL: `UPDATE variants SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`,

  /** Reset variant for retry */
  RESET_FOR_RETRY: `UPDATE variants SET status = 'pending', error_message = NULL, workflow_id = NULL, updated_at = ? WHERE id = ?`,

  /** Update variant workflow_id and status */
  UPDATE_WORKFLOW: `UPDATE variants SET workflow_id = ?, status = ?, updated_at = ? WHERE id = ?`,

  /** Update variant status only */
  UPDATE_STATUS: `UPDATE variants SET status = ?, updated_at = ? WHERE id = ?`,

  /** Update variant starred status */
  UPDATE_STARRED: 'UPDATE variants SET starred = ? WHERE id = ?',

  /** Delete variant by ID */
  DELETE: 'DELETE FROM variants WHERE id = ?',
} as const;

// ============================================================================
// Lineage Queries
// ============================================================================

export const LineageQueries = {
  /** Get all lineage records */
  GET_ALL: 'SELECT * FROM lineage',

  /** Get lineage by ID */
  GET_BY_ID: 'SELECT * FROM lineage WHERE id = ?',

  /** Get lineage for a variant (both parent and child) */
  GET_FOR_VARIANT: 'SELECT * FROM lineage WHERE parent_variant_id = ? OR child_variant_id = ?',

  /** Get parent lineage with details */
  GET_PARENTS_WITH_DETAILS: `
    SELECT l.*, v.asset_id, v.image_key, v.thumb_key, a.name as asset_name
    FROM lineage l
    JOIN variants v ON l.parent_variant_id = v.id
    JOIN assets a ON v.asset_id = a.id
    WHERE l.child_variant_id = ?`,

  /** Get child lineage with details */
  GET_CHILDREN_WITH_DETAILS: `
    SELECT l.*, v.asset_id, v.image_key, v.thumb_key, a.name as asset_name
    FROM lineage l
    JOIN variants v ON l.child_variant_id = v.id
    JOIN assets a ON v.asset_id = a.id
    WHERE l.parent_variant_id = ?`,

  /** Insert new lineage */
  INSERT: `INSERT INTO lineage (id, parent_variant_id, child_variant_id, relation_type, severed, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,

  /** Update lineage severed status */
  UPDATE_SEVERED: 'UPDATE lineage SET severed = 1 WHERE id = ?',
} as const;

// ============================================================================
// Chat Queries
// ============================================================================

export const ChatQueries = {
  /** Get recent chat messages for a session */
  GET_BY_SESSION: 'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?',

  /** Get recent chat messages (legacy, all sessions) */
  GET_RECENT: 'SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT ?',

  /** Get all chat messages (limited) */
  GET_ALL: 'SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT 100',

  /** Insert new chat message */
  INSERT: `INSERT INTO chat_messages (id, session_id, sender_type, sender_id, content, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,

  /** Delete all chat messages for a session */
  DELETE_BY_SESSION: 'DELETE FROM chat_messages WHERE session_id = ?',

  /** Delete all chat messages */
  DELETE_ALL: 'DELETE FROM chat_messages',
} as const;

// ============================================================================
// Chat Session Queries
// ============================================================================

export const ChatSessionQueries = {
  /** Get session by ID */
  GET_BY_ID: 'SELECT * FROM chat_sessions WHERE id = ?',

  /** Get all sessions ordered by most recent */
  GET_ALL: 'SELECT * FROM chat_sessions ORDER BY updated_at DESC',

  /** Get recent sessions */
  GET_RECENT: 'SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT ?',

  /** Insert new session */
  INSERT: `INSERT INTO chat_sessions (id, title, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,

  /** Update session title */
  UPDATE_TITLE: 'UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?',

  /** Update session updated_at timestamp */
  TOUCH: 'UPDATE chat_sessions SET updated_at = ? WHERE id = ?',

  /** Delete session by ID (cascades to messages) */
  DELETE: 'DELETE FROM chat_sessions WHERE id = ?',
} as const;

// ============================================================================
// Image Reference Queries
// ============================================================================

export const ImageRefQueries = {
  /** Increment reference count (upsert) */
  INCREMENT: `INSERT INTO image_refs (image_key, ref_count) VALUES (?, 1)
              ON CONFLICT(image_key) DO UPDATE SET ref_count = ref_count + 1`,

  /** Decrement reference count and return new count */
  DECREMENT: `UPDATE image_refs SET ref_count = ref_count - 1
              WHERE image_key = ?
              RETURNING ref_count`,

  /** Delete image reference */
  DELETE: 'DELETE FROM image_refs WHERE image_key = ?',
} as const;

// ============================================================================
// Plan Queries
// ============================================================================

export const PlanQueries = {
  /** Get active plan (non-completed, non-cancelled) */
  GET_ACTIVE: `SELECT * FROM plans
               WHERE status NOT IN ('completed', 'cancelled', 'failed')
               ORDER BY created_at DESC LIMIT 1`,

  /** Get plan by ID */
  GET_BY_ID: 'SELECT * FROM plans WHERE id = ?',

  /** Get recent plans */
  GET_RECENT: 'SELECT * FROM plans ORDER BY created_at DESC LIMIT ?',

  /** Insert new plan (with auto-advance support) */
  INSERT: `INSERT INTO plans (id, goal, status, current_step_index, created_by, created_at, updated_at,
                              auto_advance, max_parallel, active_step_count, revision_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

  /** Update plan status */
  UPDATE_STATUS: 'UPDATE plans SET status = ?, updated_at = ? WHERE id = ?',

  /** Update plan step index */
  UPDATE_STEP_INDEX: 'UPDATE plans SET current_step_index = ?, updated_at = ? WHERE id = ?',

  /** Update plan status and step index */
  UPDATE_STATUS_AND_INDEX: 'UPDATE plans SET status = ?, current_step_index = ?, updated_at = ? WHERE id = ?',

  /** Update auto-advance setting */
  UPDATE_AUTO_ADVANCE: 'UPDATE plans SET auto_advance = ?, updated_at = ? WHERE id = ?',

  /** Increment active step count */
  INCREMENT_ACTIVE_STEPS: 'UPDATE plans SET active_step_count = active_step_count + 1, updated_at = ? WHERE id = ?',

  /** Decrement active step count */
  DECREMENT_ACTIVE_STEPS: 'UPDATE plans SET active_step_count = CASE WHEN active_step_count > 0 THEN active_step_count - 1 ELSE 0 END, updated_at = ? WHERE id = ?',

  /** Mark plan as revised */
  UPDATE_REVISION: 'UPDATE plans SET revised_at = ?, revision_count = revision_count + 1, updated_at = ? WHERE id = ?',

  /** Delete plan by ID */
  DELETE: 'DELETE FROM plans WHERE id = ?',
} as const;

// ============================================================================
// Plan Step Queries
// ============================================================================

export const PlanStepQueries = {
  /** Get steps for a plan */
  GET_BY_PLAN: 'SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY step_index ASC',

  /** Get step by ID */
  GET_BY_ID: 'SELECT * FROM plan_steps WHERE id = ?',

  /** Get next pending step for a plan (legacy - use GET_EXECUTABLE for dependency-aware) */
  GET_NEXT_PENDING: `SELECT * FROM plan_steps
                     WHERE plan_id = ? AND status = 'pending'
                     ORDER BY step_index ASC LIMIT 1`,

  /** Get all pending steps for a plan (for dependency checking) */
  GET_ALL_PENDING: `SELECT * FROM plan_steps
                    WHERE plan_id = ? AND status = 'pending'
                    ORDER BY step_index ASC`,

  /** Get steps by status */
  GET_BY_STATUS: `SELECT * FROM plan_steps
                  WHERE plan_id = ? AND status = ?
                  ORDER BY step_index ASC`,

  /** Insert new plan step (with dependencies support) */
  INSERT: `INSERT INTO plan_steps (id, plan_id, step_index, description, action, params, status, created_at, depends_on, skipped)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

  /** Update step status */
  UPDATE_STATUS: 'UPDATE plan_steps SET status = ?, updated_at = ? WHERE id = ?',

  /** Update step with result */
  UPDATE_RESULT: 'UPDATE plan_steps SET status = ?, result = ?, updated_at = ? WHERE id = ?',

  /** Update step with error */
  UPDATE_ERROR: 'UPDATE plan_steps SET status = ?, error = ?, updated_at = ? WHERE id = ?',

  /** Skip a step */
  SKIP: `UPDATE plan_steps SET status = 'skipped', skipped = 1, updated_at = ? WHERE id = ?`,

  /** Block a step (dependency failed) */
  BLOCK: `UPDATE plan_steps SET status = 'blocked', updated_at = ? WHERE id = ?`,

  /** Unblock a step (restore to pending) */
  UNBLOCK: `UPDATE plan_steps SET status = 'pending', updated_at = ? WHERE id = ?`,

  /** Update step params (for revision) */
  UPDATE_PARAMS: `UPDATE plan_steps SET params = ?, revised_at = ?, updated_at = ?,
                  original_description = CASE WHEN original_description IS NULL THEN description ELSE original_description END
                  WHERE id = ?`,

  /** Update step description (for revision) */
  UPDATE_DESCRIPTION: `UPDATE plan_steps SET description = ?, revised_at = ?, updated_at = ?,
                       original_description = CASE WHEN original_description IS NULL THEN description ELSE original_description END
                       WHERE id = ?`,

  /** Increment step_index for steps after a given index (for insertion) */
  REINDEX_AFTER: `UPDATE plan_steps SET step_index = step_index + 1, updated_at = ?
                  WHERE plan_id = ? AND step_index > ?`,

  /** Delete steps for a plan */
  DELETE_BY_PLAN: 'DELETE FROM plan_steps WHERE plan_id = ?',

  /** Get max step_index for a plan */
  GET_MAX_INDEX: 'SELECT MAX(step_index) as max_index FROM plan_steps WHERE plan_id = ?',
} as const;

// ============================================================================
// Approval Queries
// ============================================================================

export const ApprovalQueries = {
  /** Get pending approvals */
  GET_PENDING: `SELECT * FROM pending_approvals
                WHERE status = 'pending'
                ORDER BY created_at ASC`,

  /** Get all approvals for a request */
  GET_BY_REQUEST: 'SELECT * FROM pending_approvals WHERE request_id = ? ORDER BY created_at ASC',

  /** Get approval by ID */
  GET_BY_ID: 'SELECT * FROM pending_approvals WHERE id = ?',

  /** Get approvals for a plan */
  GET_BY_PLAN: 'SELECT * FROM pending_approvals WHERE plan_id = ? ORDER BY created_at ASC',

  /** Insert new approval */
  INSERT: `INSERT INTO pending_approvals
           (id, request_id, plan_id, plan_step_id, tool, params, description, status, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

  /** Approve an approval */
  APPROVE: `UPDATE pending_approvals SET status = 'approved', approved_by = ?, updated_at = ? WHERE id = ?`,

  /** Reject an approval */
  REJECT: `UPDATE pending_approvals SET status = 'rejected', rejected_by = ?, updated_at = ? WHERE id = ?`,

  /** Mark approval as executed */
  EXECUTE: `UPDATE pending_approvals SET status = 'executed', result_job_id = ?, updated_at = ? WHERE id = ?`,

  /** Mark approval as failed */
  FAIL: `UPDATE pending_approvals SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`,

  /** Delete old approvals (cleanup) */
  DELETE_OLD: `DELETE FROM pending_approvals
               WHERE status IN ('executed', 'rejected', 'failed')
               AND updated_at < ?`,
} as const;

// ============================================================================
// Auto-Executed Queries
// ============================================================================

export const AutoExecutedQueries = {
  /** Get by request ID */
  GET_BY_REQUEST: 'SELECT * FROM auto_executed WHERE request_id = ? ORDER BY created_at ASC',

  /** Get recent auto-executed */
  GET_RECENT: 'SELECT * FROM auto_executed ORDER BY created_at DESC LIMIT ?',

  /** Insert new auto-executed result */
  INSERT: `INSERT INTO auto_executed (id, request_id, tool, params, result, success, error, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,

  /** Delete old auto-executed (cleanup) */
  DELETE_OLD: 'DELETE FROM auto_executed WHERE created_at < ?',
} as const;

// ============================================================================
// User Session Queries
// ============================================================================

export const UserSessionQueries = {
  /** Get session by user ID */
  GET_BY_USER: 'SELECT * FROM user_sessions WHERE user_id = ?',

  /** Upsert user session */
  UPSERT: `INSERT INTO user_sessions (user_id, viewing_asset_id, viewing_variant_id, forge_context, active_chat_session_id, last_seen, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             viewing_asset_id = excluded.viewing_asset_id,
             viewing_variant_id = excluded.viewing_variant_id,
             forge_context = excluded.forge_context,
             active_chat_session_id = excluded.active_chat_session_id,
             last_seen = excluded.last_seen,
             updated_at = excluded.updated_at`,

  /** Update active chat session */
  UPDATE_CHAT_SESSION: 'UPDATE user_sessions SET active_chat_session_id = ?, updated_at = ? WHERE user_id = ?',

  /** Update last seen */
  UPDATE_LAST_SEEN: 'UPDATE user_sessions SET last_seen = ? WHERE user_id = ?',

  /** Delete old sessions (cleanup) */
  DELETE_OLD: 'DELETE FROM user_sessions WHERE last_seen < ?',
} as const;

// ============================================================================
// Query Builders
// ============================================================================

/**
 * Build dynamic UPDATE query for assets.
 * Only includes fields that are present in the changes object.
 */
export function buildAssetUpdateQuery(changes: AssetChanges): { sql: string; values: unknown[] } {
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

  if (changes.type !== undefined) {
    updates.push('type = ?');
    values.push(changes.type);
  }

  if (changes.parent_asset_id !== undefined) {
    updates.push('parent_asset_id = ?');
    values.push(changes.parent_asset_id);
  }

  if (changes.active_variant_id !== undefined) {
    updates.push('active_variant_id = ?');
    values.push(changes.active_variant_id);
  }

  // Always update the timestamp
  updates.push('updated_at = ?');
  values.push(Date.now());

  const sql = `UPDATE assets SET ${updates.join(', ')} WHERE id = ?`;

  return { sql, values };
}

/**
 * Build dynamic IN clause for multiple IDs.
 * Returns placeholders string and the IDs array.
 */
export function buildInClause(ids: string[]): { placeholders: string; values: string[] } {
  const placeholders = ids.map(() => '?').join(',');
  return { placeholders, values: ids };
}

/**
 * Get variant with lineage query for a set of variant IDs.
 */
export function buildVariantLineageQuery(variantIds: string[]): string {
  const { placeholders } = buildInClause(variantIds);
  return `
    SELECT v.id, v.asset_id, v.thumb_key, v.image_key, v.created_at,
           a.name as asset_name, a.type as asset_type
    FROM variants v
    JOIN assets a ON v.asset_id = a.id
    WHERE v.id IN (${placeholders})`;
}
