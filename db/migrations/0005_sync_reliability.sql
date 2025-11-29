-- Polar Sync Reliability Improvements
-- Adds tracking columns for sync attempts and errors

-- Add sync tracking columns to usage_events
ALTER TABLE usage_events ADD COLUMN sync_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_events ADD COLUMN last_sync_error TEXT;
ALTER TABLE usage_events ADD COLUMN last_sync_attempt_at TEXT;

-- Index for finding failed events (sync_attempts >= 3 and not yet synced)
CREATE INDEX IF NOT EXISTS idx_usage_events_failed
  ON usage_events(sync_attempts)
  WHERE synced_at IS NULL AND sync_attempts > 0;
