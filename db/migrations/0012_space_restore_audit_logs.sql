-- Trace support/operator restores of soft-deleted spaces.

CREATE TABLE IF NOT EXISTS space_restore_audit_logs (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  restored_by_user_id INTEGER NOT NULL,
  restored_at TEXT NOT NULL,
  previous_deleted_at TEXT NOT NULL,
  memberships_visible INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_space_restore_audit_logs_space
  ON space_restore_audit_logs(space_id, restored_at);
