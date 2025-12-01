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

  /** Get variant by job ID (for idempotency check) */
  GET_BY_JOB_ID: 'SELECT * FROM variants WHERE job_id = ?',

  /** Get variants for an asset */
  GET_BY_ASSET: 'SELECT * FROM variants WHERE asset_id = ? ORDER BY created_at DESC',

  /** Get variant with asset name (for vision service) */
  GET_WITH_ASSET_NAME: `
    SELECT v.image_key, a.name as asset_name
    FROM variants v
    JOIN assets a ON v.asset_id = a.id
    WHERE v.id = ?`,

  /** Insert new variant */
  INSERT: `INSERT INTO variants (id, asset_id, job_id, image_key, thumb_key, recipe, starred, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,

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
  /** Get recent chat messages */
  GET_RECENT: 'SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT ?',

  /** Get all chat messages (limited) */
  GET_ALL: 'SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT 100',

  /** Insert new chat message */
  INSERT: `INSERT INTO chat_messages (id, sender_type, sender_id, content, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,

  /** Delete all chat messages */
  DELETE_ALL: 'DELETE FROM chat_messages',
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
