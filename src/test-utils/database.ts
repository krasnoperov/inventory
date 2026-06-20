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
    CREATE TABLE spaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL
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
  await db.deleteFrom('provider_usage_ledger').execute();
  await db.deleteFrom('user_provider_keys').execute();
  await db.deleteFrom('usage_events').execute();
  await db.deleteFrom('spaces').execute();
  await db.deleteFrom('users').execute();
  // --- FUTURE: Add cleanup for your domain tables here ---
  // Example:
  // await db.deleteFrom('assets').execute();

  await db.destroy();
}
