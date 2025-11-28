-- Polar.sh Billing Integration
-- Adds usage tracking and Polar customer linking

-- Add Polar customer ID to users table
ALTER TABLE users ADD COLUMN polar_customer_id TEXT;

-- Usage events table for local tracking and async sync to Polar
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,  -- 'claude_tokens', 'nanobanana_images'
  quantity INTEGER NOT NULL,
  metadata TEXT,  -- JSON: {model, tokens_in, tokens_out, etc}
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT  -- NULL until synced to Polar
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_usage_events_user ON usage_events(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_unsynced ON usage_events(synced_at) WHERE synced_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_polar_customer ON users(polar_customer_id);
