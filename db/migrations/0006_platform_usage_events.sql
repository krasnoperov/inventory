-- Track platform-side usage by space.
--
-- This is intentionally separate from usage_events (customer billing meters)
-- and provider_usage_ledger (provider spend). It records infrastructure usage
-- such as stored bytes, workflow runs, and delivered bytes.

CREATE TABLE IF NOT EXISTS platform_usage_events (
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
);

CREATE INDEX IF NOT EXISTS idx_platform_usage_space_created
  ON platform_usage_events(space_id, created_at);

CREATE INDEX IF NOT EXISTS idx_platform_usage_space_type_created
  ON platform_usage_events(space_id, usage_type, created_at);

CREATE INDEX IF NOT EXISTS idx_platform_usage_variant
  ON platform_usage_events(variant_id)
  WHERE variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_platform_usage_workflow
  ON platform_usage_events(workflow_id)
  WHERE workflow_id IS NOT NULL;
