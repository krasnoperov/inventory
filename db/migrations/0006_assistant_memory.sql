-- =============================================================================
-- 0006_assistant_memory.sql
-- Assistant Memory & Personalization
-- Captures user patterns and preferences for smarter AI assistance
-- =============================================================================

-- =============================================================================
-- USER PATTERNS
-- Learns from successful prompts to suggest better ones
-- =============================================================================

CREATE TABLE user_patterns (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id TEXT,  -- NULL = global pattern (applies across all spaces)
  asset_type TEXT NOT NULL,  -- 'character', 'scene', 'object', etc.
  prompt_text TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,  -- For deduplication
  success_count INTEGER DEFAULT 1,
  total_uses INTEGER DEFAULT 1,
  style_tags TEXT,  -- JSON array of extracted style tags
  last_used_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_patterns_user ON user_patterns(user_id);
CREATE INDEX idx_patterns_user_type ON user_patterns(user_id, asset_type);
CREATE INDEX idx_patterns_hash ON user_patterns(user_id, prompt_hash);

-- =============================================================================
-- USER FEEDBACK
-- Tracks thumbs up/down on generated variants
-- =============================================================================

CREATE TABLE user_feedback (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('positive', 'negative')),
  prompt TEXT,  -- The prompt that generated this variant
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_feedback_user ON user_feedback(user_id);
CREATE INDEX idx_feedback_variant ON user_feedback(variant_id);

-- =============================================================================
-- USER PREFERENCES
-- User-configurable assistant settings
-- =============================================================================

CREATE TABLE user_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Default generation settings
  default_art_style TEXT,  -- 'pixel_art', 'fantasy_realism', 'anime', etc.
  default_aspect_ratio TEXT,  -- '1:1', '16:9', '4:3', etc.
  -- Trust zone settings
  auto_execute_safe BOOLEAN DEFAULT TRUE,
  auto_approve_low_cost BOOLEAN DEFAULT FALSE,
  -- Personalization
  inject_patterns BOOLEAN DEFAULT TRUE,  -- Whether to inject learned patterns into context
  max_patterns_context INTEGER DEFAULT 5,  -- How many patterns to inject
  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
