/**
 * Schema Manager
 *
 * Handles SQLite schema initialization for SpaceDO.
 * Creates all tables and indexes on first access.
 */

import type { SqlStorage } from '../repository/SpaceRepository';

export class SchemaManager {
  constructor(private sql: SqlStorage) {}

  /**
   * Initialize the database schema.
   * Creates all tables and indexes if they don't exist.
   */
  async initialize(): Promise<void> {
    await this.sql.exec(`
      -- Assets table
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        tags TEXT DEFAULT '[]',
        parent_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
        active_variant_id TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Variants table (placeholder variants with status lifecycle)
      CREATE TABLE IF NOT EXISTS variants (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        workflow_id TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        error_message TEXT,
        image_key TEXT,
        thumb_key TEXT,
        recipe TEXT NOT NULL,
        starred INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER
      );

      -- Image reference counting for cleanup
      CREATE TABLE IF NOT EXISTS image_refs (
        image_key TEXT PRIMARY KEY,
        ref_count INTEGER NOT NULL DEFAULT 1
      );

      -- Chat messages
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'bot')),
        sender_id TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );

      -- Variant lineage (parent-child relationships)
      CREATE TABLE IF NOT EXISTS lineage (
        id TEXT PRIMARY KEY,
        parent_variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
        child_variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL CHECK (relation_type IN ('refined', 'combined', 'forked')),
        severed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_variants_asset ON variants(asset_id);
      CREATE INDEX IF NOT EXISTS idx_variants_status ON variants(status);
      CREATE INDEX IF NOT EXISTS idx_variants_workflow ON variants(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_assets_updated ON assets(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_assets_parent ON assets(parent_asset_id);
      CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_lineage_parent ON lineage(parent_variant_id);
      CREATE INDEX IF NOT EXISTS idx_lineage_child ON lineage(child_variant_id);
    `);
  }
}
