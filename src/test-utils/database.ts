import { Kysely, sql } from 'kysely';
import { SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';
import type { Database as DatabaseSchema } from '../db/types';

export async function createTestDatabase(): Promise<Kysely<DatabaseSchema>> {
  const sqlite = new Database(':memory:');

  const db = new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database: sqlite,
    }),
  });

  await sql`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      google_id TEXT UNIQUE,
      polar_customer_id TEXT,
      paid_generation_entitlement TEXT NOT NULL DEFAULT 'none',
      quota_limits TEXT,
      quota_limits_updated_at TEXT,
      polar_current_period_start TEXT,
      polar_current_period_end TEXT,
      polar_paid_access_expires_at TEXT,
      rate_limit_count INTEGER NOT NULL DEFAULT 0,
      rate_limit_window_start TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `.execute(db);

  // Usage events table for Polar billing integration
  await sql`
    CREATE TABLE usage_events (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      metadata TEXT,
      polar_billable INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at TEXT,
      sync_attempts INTEGER NOT NULL DEFAULT 0,
      last_sync_error TEXT,
      last_sync_attempt_at TEXT
    )
  `.execute(db);

  // Optimized index for usage aggregation queries
  await sql`
    CREATE INDEX idx_usage_events_user_event_period
      ON usage_events(user_id, event_name, created_at)
  `.execute(db);

  await sql`
    CREATE TABLE provider_usage_ledger (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      attribution_key TEXT NOT NULL UNIQUE,
      usage_event_id TEXT REFERENCES usage_events(id) ON DELETE SET NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      space_id TEXT,
      asset_id TEXT,
      variant_id TEXT,
      workflow_id TEXT,
      request_id TEXT,
      provider TEXT NOT NULL,
      provider_model TEXT NOT NULL,
      operation TEXT,
      media_kind TEXT CHECK (media_kind IS NULL OR media_kind IN ('image', 'audio', 'video')),
      meter_event_name TEXT,
      usage_unit TEXT NOT NULL,
      quantity REAL NOT NULL CHECK (quantity >= 0),
      unit_price_usd REAL CHECK (unit_price_usd IS NULL OR unit_price_usd >= 0),
      amount_micro_usd INTEGER CHECK (amount_micro_usd IS NULL OR amount_micro_usd >= 0),
      currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
      pricing_source TEXT,
      provider_request_id TEXT,
      provider_response_id TEXT,
      provider_usage_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `.execute(db);

  await sql`
    CREATE TABLE customer_charge_ledger (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      charge_key TEXT NOT NULL UNIQUE,
      usage_event_id TEXT REFERENCES usage_events(id) ON DELETE SET NULL,
      provider_usage_ledger_id TEXT REFERENCES provider_usage_ledger(id) ON DELETE SET NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      meter_event_name TEXT NOT NULL,
      charge_unit TEXT NOT NULL,
      quantity REAL NOT NULL CHECK (quantity >= 0),
      polar_billable INTEGER NOT NULL DEFAULT 1 CHECK (polar_billable IN (0, 1)),
      billing_provider TEXT NOT NULL DEFAULT 'polar' CHECK (billing_provider = 'polar'),
      billing_external_id TEXT NOT NULL,
      customer_amount_micro_usd INTEGER CHECK (customer_amount_micro_usd IS NULL OR customer_amount_micro_usd >= 0),
      currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `.execute(db);

  await sql`
    CREATE TABLE spaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      deleted_at TEXT
    )
  `.execute(db);

  await sql`
    CREATE TABLE space_members (
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
      joined_at INTEGER NOT NULL,
      deleted_at TEXT,
      PRIMARY KEY (space_id, user_id)
    )
  `.execute(db);

  await sql`
    CREATE TABLE space_access_requests (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      requester_user_id TEXT NOT NULL REFERENCES users(id),
      requested_role TEXT NOT NULL CHECK (requested_role IN ('editor', 'viewer')),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'canceled')),
      message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      resolved_by_user_id TEXT REFERENCES users(id)
    )
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX idx_space_access_requests_one_pending
      ON space_access_requests(space_id, requester_user_id)
      WHERE status = 'pending'
  `.execute(db);

  await sql`
    CREATE INDEX idx_space_access_requests_space_status
      ON space_access_requests(space_id, status, created_at)
  `.execute(db);

  await sql`
    CREATE INDEX idx_space_access_requests_requester
      ON space_access_requests(requester_user_id, status, created_at)
  `.execute(db);

  await sql`
    CREATE TABLE space_invitations (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      normalized_email TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
      invited_by_user_id TEXT NOT NULL REFERENCES users(id),
      accepted_by_user_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      resolved_at TEXT
    )
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX idx_space_invitations_one_pending
      ON space_invitations(space_id, normalized_email)
      WHERE status = 'pending'
  `.execute(db);

  await sql`
    CREATE INDEX idx_space_invitations_space_status
      ON space_invitations(space_id, status, created_at)
  `.execute(db);

  await sql`
    CREATE INDEX idx_space_invitations_email
      ON space_invitations(normalized_email, status, created_at)
  `.execute(db);

  await sql`
    CREATE TABLE space_restore_audit_logs (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      restored_by_user_id INTEGER NOT NULL,
      restored_at TEXT NOT NULL,
      previous_deleted_at TEXT NOT NULL,
      memberships_visible INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'attempted'
        CHECK (status IN ('attempted', 'restored'))
    )
  `.execute(db);

  await sql`
    CREATE TABLE platform_usage_events (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      idempotency_key TEXT NOT NULL UNIQUE,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      usage_type TEXT NOT NULL CHECK (usage_type IN ('storage', 'workflow', 'delivery')),
      quantity INTEGER NOT NULL,
      unit TEXT NOT NULL CHECK (unit IN ('byte', 'run')),
      asset_id TEXT,
      variant_id TEXT,
      workflow_id TEXT,
      request_id TEXT,
      artifact_key TEXT,
      operation TEXT,
      media_kind TEXT CHECK (media_kind IS NULL OR media_kind IN ('image', 'audio', 'video')),
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `.execute(db);

  await sql`
    CREATE INDEX idx_platform_usage_space_type_created
      ON platform_usage_events(space_id, usage_type, created_at)
  `.execute(db);

  await sql`
    CREATE INDEX idx_provider_usage_user_created
      ON provider_usage_ledger(user_id, created_at)
  `.execute(db);

  await sql`
    CREATE INDEX idx_provider_usage_variant
      ON provider_usage_ledger(variant_id)
      WHERE variant_id IS NOT NULL
  `.execute(db);

  await sql`
    CREATE TABLE user_provider_keys (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK (provider IN ('google_ai', 'anthropic', 'elevenlabs', 'lyria')),
      encrypted_api_key TEXT NOT NULL,
      key_hint TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, provider)
    )
  `.execute(db);

  await sql`
    CREATE TABLE key_envelopes (
      scope_id TEXT PRIMARY KEY,
      wrapped_dek TEXT NOT NULL,
      dek_version INTEGER NOT NULL,
      kek_version INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `.execute(db);

  await sql`
    CREATE TABLE account_deletion_tombstones (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'self_service',
      owned_spaces_purged INTEGER NOT NULL DEFAULT 0,
      owned_space_ids TEXT NOT NULL DEFAULT '[]',
      r2_key TEXT,
      deleted_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `.execute(db);

  await sql`
    CREATE TABLE user_patterns (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      space_id TEXT,
      asset_type TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      success_count INTEGER DEFAULT 1,
      total_uses INTEGER DEFAULT 1,
      style_tags TEXT,
      last_used_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `.execute(db);

  await sql`
    CREATE TABLE user_feedback (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      variant_id TEXT NOT NULL,
      rating TEXT NOT NULL,
      prompt TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `.execute(db);

  await sql`
    CREATE TABLE user_preferences (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      default_art_style TEXT,
      default_aspect_ratio TEXT,
      auto_execute_safe BOOLEAN DEFAULT TRUE,
      auto_approve_low_cost BOOLEAN DEFAULT FALSE,
      inject_patterns BOOLEAN DEFAULT TRUE,
      max_patterns_context INTEGER DEFAULT 5,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `.execute(db);

  await sql`
    CREATE INDEX idx_customer_charge_user_created
      ON customer_charge_ledger(user_id, created_at)
  `.execute(db);

  // --- FUTURE: Add your domain-specific test tables here ---
  // Example:
  // await sql`
  //   CREATE TABLE assets (
  //     id TEXT PRIMARY KEY,
  //     title TEXT NOT NULL,
  //     user_id INTEGER NOT NULL,
  //     created_at INTEGER NOT NULL,
  //     FOREIGN KEY (user_id) REFERENCES users(id)
  //   )
  // `.execute(db);

  return db;
}

export async function cleanupTestDatabase(db: Kysely<DatabaseSchema>) {
  await db.deleteFrom('platform_usage_events').execute();
  await db.deleteFrom('customer_charge_ledger').execute();
  await db.deleteFrom('provider_usage_ledger').execute();
  await db.deleteFrom('user_provider_keys').execute();
  await db.deleteFrom('key_envelopes').execute();
  await db.deleteFrom('account_deletion_tombstones').execute();
  await db.deleteFrom('user_preferences').execute();
  await db.deleteFrom('user_feedback').execute();
  await db.deleteFrom('user_patterns').execute();
  await db.deleteFrom('usage_events').execute();
  await db.deleteFrom('space_invitations').execute();
  await db.deleteFrom('space_access_requests').execute();
  await db.deleteFrom('space_members').execute();
  await db.deleteFrom('spaces').execute();
  await db.deleteFrom('users').execute();
  // --- FUTURE: Add cleanup for your domain tables here ---
  // Example:
  // await db.deleteFrom('assets').execute();

  await db.destroy();
}
