-- PII-free account deletion tombstones.
-- These let backup/restore jobs re-apply irreversible self-service account
-- deletions instead of reviving users that explicitly deleted themselves.

CREATE TABLE IF NOT EXISTS account_deletion_tombstones (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'self_service'
    CHECK (source IN ('self_service', 'restore_reapply')),
  owned_spaces_purged INTEGER NOT NULL DEFAULT 0,
  owned_space_ids TEXT NOT NULL DEFAULT '[]',
  r2_key TEXT,
  deleted_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_tombstones_user
  ON account_deletion_tombstones(user_id);
CREATE INDEX IF NOT EXISTS idx_account_deletion_tombstones_deleted
  ON account_deletion_tombstones(deleted_at);
