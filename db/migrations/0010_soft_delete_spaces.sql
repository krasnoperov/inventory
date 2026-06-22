-- Soft-delete space metadata so support can restore accidental removals.
-- Hard purge is handled separately after the retention grace period.

ALTER TABLE spaces ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_spaces_active_owner
  ON spaces(owner_id, deleted_at, created_at);

ALTER TABLE space_members ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_space_members_active_user
  ON space_members(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_space_members_active_space
  ON space_members(space_id, deleted_at);
