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
      CREATE INDEX IF NOT EXISTS idx_variants_status ON variants(status);
      CREATE INDEX IF NOT EXISTS idx_variants_workflow ON variants(workflow_id);
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
    await this.migratePlaceholderVariants();
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
   * Migrate variants table to support placeholder variants.
   *
   * Changes:
   * - Rename job_id → workflow_id
   * - Add status column (pending/processing/completed/failed)
   * - Add error_message column
   * - Make image_key and thumb_key nullable
   * - Add updated_at column
   *
   * Uses table swap because SQLite doesn't support ALTER COLUMN for nullability.
   * Also recreates lineage table to avoid FK constraint issues during migration.
   */
  private async migratePlaceholderVariants(): Promise<void> {
    // Check if migration already applied (status column exists)
    if (await this.columnExists('variants', 'status')) return;

    // Step 1: Backup lineage data (it references variants via FK)
    await this.sql.exec(`
      CREATE TABLE IF NOT EXISTS lineage_backup AS SELECT * FROM lineage
    `);

    // Step 2: Drop lineage table to remove FK references to variants
    await this.sql.exec('DROP TABLE IF EXISTS lineage');

    // Step 3: Create new variants table with updated schema
    await this.sql.exec(`
      CREATE TABLE variants_new (
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
      )
    `);

    // Step 4: Copy existing data with status='completed' (all existing variants have images)
    await this.sql.exec(`
      INSERT INTO variants_new
        (id, asset_id, workflow_id, status, error_message, image_key, thumb_key,
         recipe, starred, created_by, created_at, updated_at)
      SELECT
        id, asset_id, job_id, 'completed', NULL, image_key, thumb_key,
        recipe, starred, created_by, created_at, created_at
      FROM variants
    `);

    // Step 5: Drop old variants table and rename new one
    await this.sql.exec('DROP TABLE variants');
    await this.sql.exec('ALTER TABLE variants_new RENAME TO variants');

    // Step 6: Recreate lineage table with FK to new variants table
    await this.sql.exec(`
      CREATE TABLE lineage (
        id TEXT PRIMARY KEY,
        parent_variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
        child_variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL CHECK (relation_type IN ('derived', 'composed', 'spawned')),
        severed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `);

    // Step 7: Restore lineage data from backup
    await this.sql.exec(`
      INSERT INTO lineage SELECT * FROM lineage_backup
    `);

    // Step 8: Clean up backup table
    await this.sql.exec('DROP TABLE lineage_backup');

    // Note: Indexes will be recreated by createIndexes() which runs after migrations
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
