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
    await this.createTables();
    await this.runMigrations();
  }

  private async createTables(): Promise<void> {
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

      -- Chat sessions (conversation threads)
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Chat messages (linked to sessions)
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE,
        sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'bot')),
        sender_id TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );

      -- Variant lineage (parent-child relationships)
      -- relation_type matches user operations: derived, refined, forked
      CREATE TABLE IF NOT EXISTS lineage (
        id TEXT PRIMARY KEY,
        parent_variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
        child_variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL CHECK (relation_type IN ('derived', 'refined', 'forked')),
        severed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      -- Simple plans (markdown-based, per-session)
      CREATE TABLE IF NOT EXISTS simple_plans (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'approved', 'archived')),
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Pending approvals (trust zones - actions awaiting user approval)
      CREATE TABLE IF NOT EXISTS pending_approvals (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
        plan_step_id TEXT REFERENCES plan_steps(id) ON DELETE SET NULL,
        tool TEXT NOT NULL,
        params TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'failed')),
        created_by TEXT NOT NULL,
        approved_by TEXT,
        rejected_by TEXT,
        error_message TEXT,
        result_job_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Auto-executed safe tool results (describe, search, compare)
      CREATE TABLE IF NOT EXISTS auto_executed (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        params TEXT NOT NULL,
        result TEXT NOT NULL,
        success INTEGER NOT NULL DEFAULT 1,
        error TEXT,
        created_at INTEGER NOT NULL
      );

      -- User session context (for stateless CLI and cross-client sync)
      CREATE TABLE IF NOT EXISTS user_sessions (
        user_id TEXT PRIMARY KEY,
        viewing_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
        viewing_variant_id TEXT,
        forge_context TEXT,
        active_chat_session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
        last_seen INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_variants_asset ON variants(asset_id);
      CREATE INDEX IF NOT EXISTS idx_variants_status ON variants(status);
      CREATE INDEX IF NOT EXISTS idx_variants_workflow ON variants(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_assets_updated ON assets(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_assets_parent ON assets(parent_asset_id);
      CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_lineage_parent ON lineage(parent_variant_id);
      CREATE INDEX IF NOT EXISTS idx_lineage_child ON lineage(child_variant_id);
      CREATE INDEX IF NOT EXISTS idx_simple_plans_session ON simple_plans(session_id);
      CREATE INDEX IF NOT EXISTS idx_simple_plans_status ON simple_plans(status);
      CREATE INDEX IF NOT EXISTS idx_approvals_status ON pending_approvals(status);
      CREATE INDEX IF NOT EXISTS idx_approvals_request ON pending_approvals(request_id);
      CREATE INDEX IF NOT EXISTS idx_approvals_plan ON pending_approvals(plan_id);
      CREATE INDEX IF NOT EXISTS idx_auto_executed_request ON auto_executed(request_id);
    `);
  }

  /**
   * Run data migrations for schema changes.
   * Migrations are idempotent and safe to run multiple times.
   */
  private async runMigrations(): Promise<void> {
    // Migration: Add plan_step_id to variants for tracking plan-triggered generations
    await this.addPlanStepIdToVariants();

    // Migration: Add chat sessions support
    await this.addChatSessions();

    // Migration: Add plan improvements (auto-advance, dependencies, revisions)
    await this.addPlanImprovements();

    // Migration: Simplify relation_type to 3 values: derived, refined, forked
    // SQLite doesn't support ALTER CONSTRAINT, so we recreate the table
    // Conversions:
    //   'spawned' → 'forked' (legacy)
    //   'created' → 'derived'
    //   'combined' → 'derived' (combine into new asset now uses derive)
    await this.sql.exec(`
      -- Create new table with updated constraint
      CREATE TABLE IF NOT EXISTS lineage_new (
        id TEXT PRIMARY KEY,
        parent_variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
        child_variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL CHECK (relation_type IN ('derived', 'refined', 'forked')),
        severed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      -- Copy data, converting legacy values
      INSERT OR IGNORE INTO lineage_new (id, parent_variant_id, child_variant_id, relation_type, severed, created_at)
      SELECT id, parent_variant_id, child_variant_id,
             CASE
               WHEN relation_type = 'spawned' THEN 'forked'
               WHEN relation_type = 'created' THEN 'derived'
               WHEN relation_type = 'combined' THEN 'derived'
               ELSE relation_type
             END,
             severed, created_at
      FROM lineage;

      -- Drop old table and rename new one
      DROP TABLE IF EXISTS lineage;
      ALTER TABLE lineage_new RENAME TO lineage;

      -- Recreate indexes
      CREATE INDEX IF NOT EXISTS idx_lineage_parent ON lineage(parent_variant_id);
      CREATE INDEX IF NOT EXISTS idx_lineage_child ON lineage(child_variant_id);
    `);
  }

  /**
   * Add plan_step_id column to variants table for tracking plan-triggered generations.
   * When a variant is generated as part of a plan step, we store the step ID
   * so we can update the step when the generation completes.
   */
  private async addPlanStepIdToVariants(): Promise<void> {
    // Check if column already exists
    const result = await this.sql.exec(`PRAGMA table_info(variants)`);
    const columns = result.toArray() as Array<{ name: string }>;
    const hasColumn = columns.some(col => col.name === 'plan_step_id');

    if (!hasColumn) {
      await this.sql.exec(`
        ALTER TABLE variants ADD COLUMN plan_step_id TEXT REFERENCES plan_steps(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_variants_plan_step ON variants(plan_step_id);
      `);
    }
  }

  /**
   * Add chat sessions support:
   * - Add session_id column to chat_messages
   * - Add active_chat_session_id to user_sessions
   * - Create default session for orphaned messages
   */
  private async addChatSessions(): Promise<void> {
    // Check if session_id column exists in chat_messages
    const msgResult = await this.sql.exec(`PRAGMA table_info(chat_messages)`);
    const msgColumns = msgResult.toArray() as Array<{ name: string }>;
    const hasSessionId = msgColumns.some(col => col.name === 'session_id');

    if (!hasSessionId) {
      // Add session_id column
      await this.sql.exec(`
        ALTER TABLE chat_messages ADD COLUMN session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE;
        CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id);
      `);

      // Check if there are orphaned messages
      const orphanedResult = await this.sql.exec(
        `SELECT COUNT(*) as count FROM chat_messages WHERE session_id IS NULL`
      );
      const orphanedCount = (orphanedResult.toArray()[0] as { count: number })?.count ?? 0;

      if (orphanedCount > 0) {
        // Create a default session for orphaned messages
        const now = Date.now();
        const defaultSessionId = 'default-session';
        await this.sql.exec(
          `INSERT OR IGNORE INTO chat_sessions (id, title, created_by, created_at, updated_at)
           VALUES (?, 'Previous Conversation', 'system', ?, ?)`,
          defaultSessionId,
          now,
          now
        );

        // Link orphaned messages to default session
        await this.sql.exec(
          `UPDATE chat_messages SET session_id = ? WHERE session_id IS NULL`,
          defaultSessionId
        );
      }
    }

    // Check if active_chat_session_id exists in user_sessions
    const sessResult = await this.sql.exec(`PRAGMA table_info(user_sessions)`);
    const sessColumns = sessResult.toArray() as Array<{ name: string }>;
    const hasActiveChatSession = sessColumns.some(col => col.name === 'active_chat_session_id');

    if (!hasActiveChatSession) {
      await this.sql.exec(`
        ALTER TABLE user_sessions ADD COLUMN active_chat_session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL;
      `);
    }
  }

  /**
   * Add plan improvements:
   * - auto_advance, max_parallel, active_step_count on plans
   * - revised_at, revision_count on plans
   * - depends_on, skipped, original_description, revised_at on plan_steps
   */
  private async addPlanImprovements(): Promise<void> {
    // Check plans table columns
    const plansResult = await this.sql.exec(`PRAGMA table_info(plans)`);
    const plansColumns = plansResult.toArray() as Array<{ name: string }>;
    const planColumnNames = new Set(plansColumns.map(col => col.name));

    // Add auto_advance column
    if (!planColumnNames.has('auto_advance')) {
      await this.sql.exec(`ALTER TABLE plans ADD COLUMN auto_advance INTEGER NOT NULL DEFAULT 0`);
    }

    // Add max_parallel column (default 3)
    if (!planColumnNames.has('max_parallel')) {
      await this.sql.exec(`ALTER TABLE plans ADD COLUMN max_parallel INTEGER NOT NULL DEFAULT 3`);
    }

    // Add active_step_count column
    if (!planColumnNames.has('active_step_count')) {
      await this.sql.exec(`ALTER TABLE plans ADD COLUMN active_step_count INTEGER NOT NULL DEFAULT 0`);
    }

    // Add revised_at column
    if (!planColumnNames.has('revised_at')) {
      await this.sql.exec(`ALTER TABLE plans ADD COLUMN revised_at INTEGER`);
    }

    // Add revision_count column
    if (!planColumnNames.has('revision_count')) {
      await this.sql.exec(`ALTER TABLE plans ADD COLUMN revision_count INTEGER NOT NULL DEFAULT 0`);
    }

    // Check plan_steps table columns
    const stepsResult = await this.sql.exec(`PRAGMA table_info(plan_steps)`);
    const stepsColumns = stepsResult.toArray() as Array<{ name: string }>;
    const stepColumnNames = new Set(stepsColumns.map(col => col.name));

    // Add depends_on column (JSON array of step IDs)
    if (!stepColumnNames.has('depends_on')) {
      await this.sql.exec(`ALTER TABLE plan_steps ADD COLUMN depends_on TEXT`);
    }

    // Add skipped column
    if (!stepColumnNames.has('skipped')) {
      await this.sql.exec(`ALTER TABLE plan_steps ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0`);
    }

    // Add original_description column (for tracking revisions)
    if (!stepColumnNames.has('original_description')) {
      await this.sql.exec(`ALTER TABLE plan_steps ADD COLUMN original_description TEXT`);
    }

    // Add revised_at column
    if (!stepColumnNames.has('revised_at')) {
      await this.sql.exec(`ALTER TABLE plan_steps ADD COLUMN revised_at INTEGER`);
    }

    // Update the CHECK constraint for plan_steps.status to include 'skipped' and 'blocked'
    // SQLite doesn't support ALTER CONSTRAINT, but the existing constraint won't reject
    // new values if we insert them - we'll handle validation in application code
    // and update the constraint in the next major schema version
  }
}
