-- =============================================================================
-- Inventory Forge - Complete Schema
-- =============================================================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  google_id TEXT UNIQUE,
  polar_customer_id TEXT,
  -- Quota limits cached from Polar webhooks (JSON)
  quota_limits TEXT,
  quota_limits_updated_at TEXT,
  -- Rate limiting
  rate_limit_count INTEGER NOT NULL DEFAULT 0,
  rate_limit_window_start TEXT,
  -- Timestamps
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_polar_customer ON users(polar_customer_id);

-- Spaces table
CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spaces_owner ON spaces(owner_id);

-- Space members table
CREATE TABLE IF NOT EXISTS space_members (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_space_members_user ON space_members(user_id);

-- =============================================================================
-- Polar Billing - Usage Tracking
-- =============================================================================

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,  -- 'claude_tokens', 'nanobanana_images'
  quantity INTEGER NOT NULL,
  metadata TEXT,  -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Sync tracking
  synced_at TEXT,
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  last_sync_error TEXT,
  last_sync_attempt_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_events_user ON usage_events(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_unsynced ON usage_events(synced_at) WHERE synced_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_usage_events_failed ON usage_events(sync_attempts) WHERE synced_at IS NULL AND sync_attempts > 0;
CREATE INDEX IF NOT EXISTS idx_usage_events_user_event_period ON usage_events(user_id, event_name, created_at);

-- =============================================================================
-- Assistant Memory & Personalization
-- =============================================================================

-- User patterns - learns from successful prompts
CREATE TABLE IF NOT EXISTS user_patterns (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id TEXT,
  asset_type TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  success_count INTEGER DEFAULT 1,
  total_uses INTEGER DEFAULT 1,
  style_tags TEXT,  -- JSON array
  last_used_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_patterns_user ON user_patterns(user_id);
CREATE INDEX IF NOT EXISTS idx_patterns_user_type ON user_patterns(user_id, asset_type);
CREATE INDEX IF NOT EXISTS idx_patterns_hash ON user_patterns(user_id, prompt_hash);

-- User feedback on variants
CREATE TABLE IF NOT EXISTS user_feedback (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('positive', 'negative')),
  prompt TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_user ON user_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_variant ON user_feedback(variant_id);

-- User preferences
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_art_style TEXT,
  default_aspect_ratio TEXT,
  auto_execute_safe BOOLEAN DEFAULT TRUE,
  auto_approve_low_cost BOOLEAN DEFAULT FALSE,
  inject_patterns BOOLEAN DEFAULT TRUE,
  max_patterns_context INTEGER DEFAULT 5,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
