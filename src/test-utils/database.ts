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
      quota_limits TEXT,
      quota_limits_updated_at TEXT,
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
  await db.deleteFrom('usage_events').execute();
  await db.deleteFrom('users').execute();
  // --- FUTURE: Add cleanup for your domain tables here ---
  // Example:
  // await db.deleteFrom('assets').execute();

  await db.destroy();
}
