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
  GET_ALL: 'SELECT * FROM assets WHERE deleted_at IS NULL ORDER BY updated_at DESC',

  /** Get asset by ID */
  GET_BY_ID: 'SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL',

  /** Get assets by parent ID */
  GET_BY_PARENT: 'SELECT * FROM assets WHERE parent_asset_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC',

  /** Insert new asset */
  INSERT: `INSERT INTO assets (id, name, type, media_kind, tags, parent_asset_id, active_variant_id, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

  /** Delete asset by ID */
  DELETE: 'UPDATE assets SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',

  /** Get assets with variant count (for bot context) */
  GET_WITH_VARIANT_COUNT: `
    SELECT a.id, a.name, a.type, COUNT(v.id) as variant_count
    FROM assets a
    LEFT JOIN variants v ON a.id = v.asset_id AND v.deleted_at IS NULL
    WHERE a.deleted_at IS NULL
    GROUP BY a.id`,
} as const;

// ============================================================================
// Variant Queries
// ============================================================================

export const VariantQueries = {
  /** Get all variants */
  GET_ALL: 'SELECT * FROM variants WHERE deleted_at IS NULL',

  /** Get one overview variant per asset: the active variant, or the newest variant when no active variant is set */
  GET_OVERVIEW: `
    SELECT *
    FROM (
      SELECT
        v.*,
        ROW_NUMBER() OVER (
          PARTITION BY v.asset_id
          ORDER BY
            CASE WHEN v.id = a.active_variant_id THEN 0 ELSE 1 END,
            v.created_at DESC
        ) as overview_rank
      FROM variants v
      JOIN assets a ON a.id = v.asset_id AND a.deleted_at IS NULL
      WHERE v.deleted_at IS NULL
    )
    WHERE overview_rank = 1`,

  /** Get variant by ID */
  GET_BY_ID: 'SELECT * FROM variants WHERE id = ? AND deleted_at IS NULL',

  /** Get variant by workflow ID (for idempotency check) */
  GET_BY_WORKFLOW_ID: 'SELECT * FROM variants WHERE workflow_id = ? AND deleted_at IS NULL',

  /** Get variants for an asset */
  GET_BY_ASSET: 'SELECT * FROM variants WHERE asset_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',

  /** Get variant with asset name (for vision service) */
  GET_WITH_ASSET_NAME: `
    SELECT v.image_key, a.name as asset_name
    FROM variants v
    JOIN assets a ON v.asset_id = a.id
    WHERE v.id = ? AND v.deleted_at IS NULL AND a.deleted_at IS NULL`,

  /** Insert new placeholder variant (pending status) */
  INSERT_PLACEHOLDER: `INSERT INTO variants (id, asset_id, media_kind, status, recipe, generation_provenance, created_by, created_at, updated_at, plan_step_id)
                       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,

  /** Insert new completed variant (legacy - for forks/imports) */
  INSERT: `INSERT INTO variants (id, asset_id, media_kind, workflow_id, status, error_message, image_key, thumb_key, media_key, media_mime_type, media_size_bytes, media_width, media_height, media_duration_ms, transcript_key, transcript_mime_type, transcript_size_bytes, word_timings_key, word_timings_mime_type, word_timings_size_bytes, render_metadata_key, render_metadata_mime_type, render_metadata_size_bytes, generation_provenance, provider_metadata, recipe, starred, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

  /** Update variant to completed status with images */
  COMPLETE: `UPDATE variants SET status = 'completed', image_key = ?, thumb_key = ?, media_key = ?, media_mime_type = ?, media_size_bytes = ?, media_width = ?, media_height = ?, media_duration_ms = ?, transcript_key = ?, transcript_mime_type = ?, transcript_size_bytes = ?, word_timings_key = ?, word_timings_mime_type = ?, word_timings_size_bytes = ?, render_metadata_key = ?, render_metadata_mime_type = ?, render_metadata_size_bytes = ?, provider_metadata = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,

  /** Update variant to failed status with error */
  FAIL: `UPDATE variants SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,

  /** Reset variant for retry */
  RESET_FOR_RETRY: `UPDATE variants SET status = 'pending', error_message = NULL, workflow_id = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,

  /** Update variant workflow_id and status */
  UPDATE_WORKFLOW: `UPDATE variants SET workflow_id = ?, status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,

  /** Update variant status only */
  UPDATE_STATUS: `UPDATE variants SET status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,

  /** Update variant starred status */
  UPDATE_STARRED: 'UPDATE variants SET starred = ? WHERE id = ? AND deleted_at IS NULL',

  /** Delete variant by ID */
  DELETE: 'UPDATE variants SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
} as const;

// ============================================================================
// Lineage Queries
// ============================================================================

export const LineageQueries = {
  /** Get all lineage records */
  GET_ALL: `
    SELECT l.*
    FROM lineage l
    JOIN variants parent ON parent.id = l.parent_variant_id AND parent.deleted_at IS NULL
    JOIN variants child ON child.id = l.child_variant_id AND child.deleted_at IS NULL`,

  /** Get lineage by ID */
  GET_BY_ID: `
    SELECT l.*
    FROM lineage l
    JOIN variants parent ON parent.id = l.parent_variant_id AND parent.deleted_at IS NULL
    JOIN variants child ON child.id = l.child_variant_id AND child.deleted_at IS NULL
    WHERE l.id = ?`,

  /** Get lineage for a variant (both parent and child) */
  GET_FOR_VARIANT: `
    SELECT l.*
    FROM lineage l
    JOIN variants parent ON parent.id = l.parent_variant_id AND parent.deleted_at IS NULL
    JOIN variants child ON child.id = l.child_variant_id AND child.deleted_at IS NULL
    WHERE (l.parent_variant_id = ? OR l.child_variant_id = ?)`,

  /** Get parent lineage with details */
  GET_PARENTS_WITH_DETAILS: `
    SELECT l.*, v.asset_id, v.image_key, v.thumb_key, a.name as asset_name
    FROM lineage l
    JOIN variants v ON l.parent_variant_id = v.id AND v.deleted_at IS NULL
    JOIN assets a ON v.asset_id = a.id AND a.deleted_at IS NULL
    JOIN variants child ON child.id = l.child_variant_id AND child.deleted_at IS NULL
    WHERE l.child_variant_id = ?`,

  /** Get child lineage with details */
  GET_CHILDREN_WITH_DETAILS: `
    SELECT l.*, v.asset_id, v.image_key, v.thumb_key, a.name as asset_name
    FROM lineage l
    JOIN variants v ON l.child_variant_id = v.id AND v.deleted_at IS NULL
    JOIN assets a ON v.asset_id = a.id AND a.deleted_at IS NULL
    JOIN variants parent ON parent.id = l.parent_variant_id AND parent.deleted_at IS NULL
    WHERE l.parent_variant_id = ?`,

  /** Insert new lineage */
  INSERT: `INSERT INTO lineage (id, parent_variant_id, child_variant_id, relation_type, severed, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,

  /** Update lineage severed status */
  UPDATE_SEVERED: 'UPDATE lineage SET severed = 1 WHERE id = ?',
} as const;

// ============================================================================
// Space Organization Queries
// ============================================================================

export const SpaceCollectionQueries = {
  GET_ALL: 'SELECT * FROM space_collections WHERE deleted_at IS NULL ORDER BY sort_index ASC, created_at ASC',
  GET_BY_ID: 'SELECT * FROM space_collections WHERE id = ? AND deleted_at IS NULL',
  INSERT: `INSERT INTO space_collections
           (id, name, kind, color, description, sort_index, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  DELETE: 'UPDATE space_collections SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
} as const;

export const CollectionItemQueries = {
  GET_ALL: 'SELECT * FROM collection_items WHERE deleted_at IS NULL ORDER BY collection_id ASC, sort_index ASC, created_at ASC',
  GET_BY_ID: 'SELECT * FROM collection_items WHERE id = ? AND deleted_at IS NULL',
  GET_BY_COLLECTION: 'SELECT * FROM collection_items WHERE collection_id = ? AND deleted_at IS NULL ORDER BY sort_index ASC, created_at ASC',
  INSERT: `INSERT INTO collection_items
           (id, collection_id, subject_type, asset_id, variant_id, role, pinned_variant_id, sort_index, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  DELETE: 'UPDATE collection_items SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
} as const;

export const SpaceRelationQueries = {
  GET_ALL: 'SELECT * FROM space_relations WHERE deleted_at IS NULL ORDER BY sort_index ASC, created_at ASC',
  GET_BY_ID: 'SELECT * FROM space_relations WHERE id = ? AND deleted_at IS NULL',
  INSERT: `INSERT INTO space_relations
           (id, subject_type, subject_asset_id, subject_variant_id, object_type, object_asset_id, object_variant_id, relation_type, label, context, metadata, sort_index, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  DELETE: 'UPDATE space_relations SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
} as const;

export const CompositionQueries = {
  GET_ALL: 'SELECT * FROM compositions WHERE deleted_at IS NULL ORDER BY sort_index ASC, created_at ASC',
  GET_BY_ID: 'SELECT * FROM compositions WHERE id = ? AND deleted_at IS NULL',
  INSERT: `INSERT INTO compositions
           (id, name, description, status, output_asset_id, output_variant_id, metadata, sort_index, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  DELETE: 'UPDATE compositions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
} as const;

export const CompositionItemQueries = {
  GET_ALL: 'SELECT * FROM composition_items WHERE deleted_at IS NULL ORDER BY composition_id ASC, sort_index ASC, created_at ASC',
  GET_BY_ID: 'SELECT * FROM composition_items WHERE id = ? AND deleted_at IS NULL',
  GET_BY_COMPOSITION: 'SELECT * FROM composition_items WHERE composition_id = ? AND deleted_at IS NULL ORDER BY sort_index ASC, created_at ASC',
  INSERT: `INSERT INTO composition_items
           (id, composition_id, role, label, asset_id, variant_id, metadata, sort_index, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  DELETE: 'UPDATE composition_items SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
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

  /** Upsert user session
   * Note: active_chat_session_id uses COALESCE to preserve existing value when NULL is passed.
   * This prevents updateSession() calls (e.g., on connect) from wiping out the chat session.
   */
  UPSERT: `INSERT INTO user_sessions (user_id, viewing_asset_id, viewing_variant_id, forge_context, active_chat_session_id, last_seen, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             viewing_asset_id = excluded.viewing_asset_id,
             viewing_variant_id = excluded.viewing_variant_id,
             forge_context = excluded.forge_context,
             active_chat_session_id = COALESCE(excluded.active_chat_session_id, user_sessions.active_chat_session_id),
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
// Rotation Set Queries
// ============================================================================

export const RotationSetQueries = {
  GET_ALL: `
    SELECT rs.*
    FROM rotation_sets rs
    JOIN assets a ON a.id = rs.asset_id AND a.deleted_at IS NULL
    JOIN variants v ON v.id = rs.source_variant_id AND v.deleted_at IS NULL
    WHERE rs.deleted_at IS NULL
    ORDER BY rs.created_at DESC`,
  GET_BY_ID: `
    SELECT rs.*
    FROM rotation_sets rs
    JOIN assets a ON a.id = rs.asset_id AND a.deleted_at IS NULL
    JOIN variants v ON v.id = rs.source_variant_id AND v.deleted_at IS NULL
    WHERE rs.id = ? AND rs.deleted_at IS NULL`,
  INSERT: `INSERT INTO rotation_sets (id, asset_id, source_variant_id, config, status, current_step, total_steps, error_message, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  UPDATE_STATUS: 'UPDATE rotation_sets SET status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
  UPDATE_STEP: 'UPDATE rotation_sets SET current_step = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
  FAIL: `UPDATE rotation_sets SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
  CANCEL: `UPDATE rotation_sets SET status = 'cancelled', updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
} as const;

// ============================================================================
// Rotation View Queries
// ============================================================================

export const RotationViewQueries = {
  GET_BY_SET: `
    SELECT rv.*
    FROM rotation_views rv
    JOIN rotation_sets rs ON rs.id = rv.rotation_set_id AND rs.deleted_at IS NULL
    JOIN variants v ON v.id = rv.variant_id AND v.deleted_at IS NULL
    JOIN assets a ON a.id = v.asset_id AND a.deleted_at IS NULL
    WHERE rv.rotation_set_id = ? AND rv.deleted_at IS NULL
    ORDER BY rv.step_index ASC`,
  GET_ALL: `
    SELECT rv.*
    FROM rotation_views rv
    JOIN rotation_sets rs ON rs.id = rv.rotation_set_id AND rs.deleted_at IS NULL
    JOIN variants v ON v.id = rv.variant_id AND v.deleted_at IS NULL
    JOIN assets a ON a.id = v.asset_id AND a.deleted_at IS NULL
    WHERE rv.deleted_at IS NULL
    ORDER BY rv.created_at DESC`,
  GET_BY_VARIANT: `
    SELECT rv.*
    FROM rotation_views rv
    JOIN rotation_sets rs ON rs.id = rv.rotation_set_id AND rs.deleted_at IS NULL
    JOIN variants v ON v.id = rv.variant_id AND v.deleted_at IS NULL
    JOIN assets a ON a.id = v.asset_id AND a.deleted_at IS NULL
    WHERE rv.variant_id = ? AND rv.deleted_at IS NULL`,
  GET_COMPLETED_WITH_IMAGES: `
    SELECT rv.*, v.image_key, v.thumb_key, v.status as variant_status
    FROM rotation_views rv
    JOIN rotation_sets rs ON rs.id = rv.rotation_set_id AND rs.deleted_at IS NULL
    JOIN variants v ON rv.variant_id = v.id AND v.deleted_at IS NULL
    JOIN assets a ON a.id = v.asset_id AND a.deleted_at IS NULL
    WHERE rv.rotation_set_id = ? AND rv.deleted_at IS NULL AND v.status = 'completed'
    ORDER BY rv.step_index ASC`,
  INSERT: `INSERT INTO rotation_views (id, rotation_set_id, variant_id, direction, step_index, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
} as const;

// ============================================================================
// Tile Set Queries
// ============================================================================

export const TileSetQueries = {
  GET_ALL: `
    SELECT ts.*
    FROM tile_sets ts
    JOIN assets a ON a.id = ts.asset_id AND a.deleted_at IS NULL
    LEFT JOIN variants seed ON seed.id = ts.seed_variant_id
    WHERE ts.deleted_at IS NULL
      AND (ts.seed_variant_id IS NULL OR (seed.id IS NOT NULL AND seed.deleted_at IS NULL))
    ORDER BY ts.created_at DESC`,
  GET_BY_ID: `
    SELECT ts.*
    FROM tile_sets ts
    JOIN assets a ON a.id = ts.asset_id AND a.deleted_at IS NULL
    LEFT JOIN variants seed ON seed.id = ts.seed_variant_id
    WHERE ts.id = ? AND ts.deleted_at IS NULL
      AND (ts.seed_variant_id IS NULL OR (seed.id IS NOT NULL AND seed.deleted_at IS NULL))`,
  INSERT: `INSERT INTO tile_sets (id, asset_id, tile_type, grid_width, grid_height, status, seed_variant_id, config, current_step, total_steps, error_message, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  UPDATE_STATUS: 'UPDATE tile_sets SET status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
  UPDATE_STEP: 'UPDATE tile_sets SET current_step = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
  FAIL: `UPDATE tile_sets SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
  CANCEL: `UPDATE tile_sets SET status = 'cancelled', updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
} as const;

// ============================================================================
// Tile Position Queries
// ============================================================================

export const TilePositionQueries = {
  GET_BY_SET: `
    SELECT tp.*
    FROM tile_positions tp
    JOIN tile_sets ts ON ts.id = tp.tile_set_id AND ts.deleted_at IS NULL
    JOIN variants v ON v.id = tp.variant_id AND v.deleted_at IS NULL
    JOIN assets a ON a.id = v.asset_id AND a.deleted_at IS NULL
    WHERE tp.tile_set_id = ? AND tp.deleted_at IS NULL
    ORDER BY tp.grid_y, tp.grid_x`,
  GET_ALL: `
    SELECT tp.*
    FROM tile_positions tp
    JOIN tile_sets ts ON ts.id = tp.tile_set_id AND ts.deleted_at IS NULL
    JOIN variants v ON v.id = tp.variant_id AND v.deleted_at IS NULL
    JOIN assets a ON a.id = v.asset_id AND a.deleted_at IS NULL
    WHERE tp.deleted_at IS NULL
    ORDER BY tp.created_at DESC`,
  GET_BY_VARIANT: `
    SELECT tp.*
    FROM tile_positions tp
    JOIN tile_sets ts ON ts.id = tp.tile_set_id AND ts.deleted_at IS NULL
    JOIN variants v ON v.id = tp.variant_id AND v.deleted_at IS NULL
    JOIN assets a ON a.id = v.asset_id AND a.deleted_at IS NULL
    WHERE tp.variant_id = ? AND tp.deleted_at IS NULL`,
  GET_ADJACENT: `
    SELECT tp.*, v.image_key, v.thumb_key,
      CASE
        WHEN tp.grid_y = ? - 1 AND tp.grid_x = ? THEN 'N'
        WHEN tp.grid_x = ? + 1 AND tp.grid_y = ? THEN 'E'
        WHEN tp.grid_y = ? + 1 AND tp.grid_x = ? THEN 'S'
        WHEN tp.grid_x = ? - 1 AND tp.grid_y = ? THEN 'W'
      END as direction
    FROM tile_positions tp
    JOIN tile_sets ts ON ts.id = tp.tile_set_id AND ts.deleted_at IS NULL
    JOIN variants v ON tp.variant_id = v.id AND v.deleted_at IS NULL
    JOIN assets a ON a.id = v.asset_id AND a.deleted_at IS NULL
    WHERE tp.tile_set_id = ? AND tp.deleted_at IS NULL AND v.status = 'completed'
      AND ((tp.grid_x = ? AND tp.grid_y = ? - 1)
        OR (tp.grid_x = ? + 1 AND tp.grid_y = ?)
        OR (tp.grid_x = ? AND tp.grid_y = ? + 1)
        OR (tp.grid_x = ? - 1 AND tp.grid_y = ?))`,
  INSERT: `INSERT INTO tile_positions (id, tile_set_id, variant_id, grid_x, grid_y, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
} as const;

// ============================================================================
// Production Record Queries
// ============================================================================

export const ProductionRecordQueries = {
  GET_BY_ID: 'SELECT * FROM production_records WHERE id = ? AND deleted_at IS NULL',
  GET_BY_PRODUCTION: 'SELECT * FROM production_records WHERE production_id = ? AND deleted_at IS NULL ORDER BY timeline_start_ms ASC, shot_id ASC, created_at ASC',
  UPSERT: `INSERT INTO production_records
           (id, production_id, variant_id, asset_id, media_kind, shot_id, scene_label, timeline_start_ms, duration_ms, motion_prompt, source_refs, source_variant_ids, metadata, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             production_id = excluded.production_id,
             variant_id = excluded.variant_id,
             asset_id = excluded.asset_id,
             media_kind = excluded.media_kind,
             shot_id = excluded.shot_id,
             scene_label = excluded.scene_label,
             timeline_start_ms = excluded.timeline_start_ms,
             duration_ms = excluded.duration_ms,
             motion_prompt = excluded.motion_prompt,
             source_refs = excluded.source_refs,
             source_variant_ids = excluded.source_variant_ids,
             metadata = excluded.metadata,
             updated_at = excluded.updated_at,
             deleted_at = NULL`,
  DELETE: 'UPDATE production_records SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
  DELETE_BY_PRODUCTION: 'UPDATE production_records SET deleted_at = ?, updated_at = ? WHERE production_id = ? AND deleted_at IS NULL',
} as const;

export const ProductionQueries = {
  GET_ALL: 'SELECT * FROM productions WHERE deleted_at IS NULL ORDER BY updated_at DESC',
  GET_BY_ID: 'SELECT * FROM productions WHERE id = ? AND deleted_at IS NULL',
  UPSERT: `INSERT INTO productions (id, name, description, metadata, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             description = excluded.description,
             metadata = excluded.metadata,
             updated_at = excluded.updated_at,
             deleted_at = NULL`,
  DELETE: 'UPDATE productions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
} as const;

export const ProductionShotQueries = {
  GET_BY_ID: 'SELECT * FROM production_shots WHERE id = ? AND deleted_at IS NULL',
  GET_BY_PRODUCTION: 'SELECT * FROM production_shots WHERE production_id = ? AND deleted_at IS NULL ORDER BY timeline_start_ms ASC, shot_id ASC, created_at ASC',
  UPSERT: `INSERT INTO production_shots (id, production_id, shot_id, label, timeline_start_ms, duration_ms, metadata, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             production_id = excluded.production_id,
             shot_id = excluded.shot_id,
             label = excluded.label,
             timeline_start_ms = excluded.timeline_start_ms,
             duration_ms = excluded.duration_ms,
             metadata = excluded.metadata,
             updated_at = excluded.updated_at,
             deleted_at = NULL`,
  DELETE: 'UPDATE production_shots SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
  DELETE_BY_PRODUCTION: 'UPDATE production_shots SET deleted_at = ?, updated_at = ? WHERE production_id = ? AND deleted_at IS NULL',
} as const;

export const ProductionCueQueries = {
  GET_BY_ID: 'SELECT * FROM production_cues WHERE id = ? AND deleted_at IS NULL',
  GET_BY_PRODUCTION: 'SELECT * FROM production_cues WHERE production_id = ? AND deleted_at IS NULL ORDER BY timeline_start_ms ASC, cue_type ASC, created_at ASC',
  UPSERT: `INSERT INTO production_cues (id, production_id, cue_type, label, timeline_start_ms, duration_ms, metadata, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             production_id = excluded.production_id,
             cue_type = excluded.cue_type,
             label = excluded.label,
             timeline_start_ms = excluded.timeline_start_ms,
             duration_ms = excluded.duration_ms,
             metadata = excluded.metadata,
             updated_at = excluded.updated_at,
             deleted_at = NULL`,
  DELETE: 'UPDATE production_cues SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
  DELETE_BY_PRODUCTION: 'UPDATE production_cues SET deleted_at = ?, updated_at = ? WHERE production_id = ? AND deleted_at IS NULL',
} as const;

export const ProductionPlacementQueries = {
  GET_BY_ID: 'SELECT * FROM production_placements WHERE id = ? AND deleted_at IS NULL',
  GET_BY_PRODUCTION: 'SELECT * FROM production_placements WHERE production_id = ? AND deleted_at IS NULL ORDER BY created_at ASC',
  GET_BY_TARGET: 'SELECT * FROM production_placements WHERE target_kind = ? AND target_id = ? AND deleted_at IS NULL ORDER BY created_at ASC',
  UPSERT: `INSERT INTO production_placements
           (id, production_id, target_kind, target_id, variant_id, asset_id, media_kind, role, source_refs, source_variant_ids, metadata, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             production_id = excluded.production_id,
             target_kind = excluded.target_kind,
             target_id = excluded.target_id,
             variant_id = excluded.variant_id,
             asset_id = excluded.asset_id,
             media_kind = excluded.media_kind,
             role = excluded.role,
             source_refs = excluded.source_refs,
             source_variant_ids = excluded.source_variant_ids,
             metadata = excluded.metadata,
             updated_at = excluded.updated_at,
             deleted_at = NULL`,
  DELETE: 'UPDATE production_placements SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
  DELETE_BY_PRODUCTION: 'UPDATE production_placements SET deleted_at = ?, updated_at = ? WHERE production_id = ? AND deleted_at IS NULL',
  DELETE_BY_TARGET: 'UPDATE production_placements SET deleted_at = ?, updated_at = ? WHERE target_kind = ? AND target_id = ? AND deleted_at IS NULL',
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
