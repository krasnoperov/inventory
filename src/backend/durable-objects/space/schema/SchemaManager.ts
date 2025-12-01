/**
 * Schema Manager
 *
 * Handles SQLite schema initialization and migrations for SpaceDO.
 * Centralizes all DDL operations to keep SpaceDO focused on routing.
 */

import type { SqlStorage } from '../repository/SpaceRepository';

export class SchemaManager {
  constructor(private sql: SqlStorage) {}

  /**
   * Initialize the database schema.
   * Creates all tables and indexes if they don't exist.
   */
  async initialize(): Promise<void> {
    await this.createTables();
    await this.runMigrations();
    await this.createIndexes();
  }

  /**
   * Create all tables if they don't exist
   */
  private async createTables(): Promise<void> {
    await this.sql.exec(`
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

      CREATE TABLE IF NOT EXISTS variants (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        job_id TEXT UNIQUE,
        image_key TEXT NOT NULL,
        thumb_key TEXT NOT NULL,
        recipe TEXT NOT NULL,
        starred INTEGER NOT NULL DEFAULT 0,
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
        relation_type TEXT NOT NULL CHECK (relation_type IN ('derived', 'composed', 'spawned')),
        severed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
    `);
  }

  /**
   * Create indexes for performance
   */
  private async createIndexes(): Promise<void> {
    await this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_variants_asset ON variants(asset_id);
      CREATE INDEX IF NOT EXISTS idx_assets_updated ON assets(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_lineage_parent ON lineage(parent_variant_id);
      CREATE INDEX IF NOT EXISTS idx_lineage_child ON lineage(child_variant_id);
      CREATE INDEX IF NOT EXISTS idx_assets_parent ON assets(parent_asset_id);
    `);
  }

  /**
   * Run migrations for existing databases.
   * Adds new columns to existing tables.
   */
  private async runMigrations(): Promise<void> {
    await this.migrateParentAssetId();
    await this.migrateStarred();
    await this.migrateSevered();
  }

  /**
   * Add parent_asset_id column to assets table
   */
  private async migrateParentAssetId(): Promise<void> {
    if (await this.columnExists('assets', 'parent_asset_id')) return;

    await this.sql.exec(
      'ALTER TABLE assets ADD COLUMN parent_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL'
    );
  }

  /**
   * Add starred column to variants table
   */
  private async migrateStarred(): Promise<void> {
    if (await this.columnExists('variants', 'starred')) return;

    await this.sql.exec('ALTER TABLE variants ADD COLUMN starred INTEGER NOT NULL DEFAULT 0');
  }

  /**
   * Add severed column to lineage table
   */
  private async migrateSevered(): Promise<void> {
    if (await this.columnExists('lineage', 'severed')) return;

    await this.sql.exec('ALTER TABLE lineage ADD COLUMN severed INTEGER NOT NULL DEFAULT 0');
  }

  /**
   * Check if a column exists in a table
   */
  private async columnExists(table: string, column: string): Promise<boolean> {
    try {
      await this.sql.exec(`SELECT ${column} FROM ${table} LIMIT 1`);
      return true;
    } catch {
      return false;
    }
  }
}
