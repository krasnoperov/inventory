-- Durable Space sharing lifecycle state.
-- Active access remains sourced from space_members.

CREATE TABLE IF NOT EXISTS space_access_requests (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  requester_user_id TEXT NOT NULL REFERENCES users(id),
  requested_role TEXT NOT NULL CHECK (requested_role IN ('editor', 'viewer')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'canceled')),
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by_user_id TEXT REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_space_access_requests_one_pending
  ON space_access_requests(space_id, requester_user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_space_access_requests_space_status
  ON space_access_requests(space_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_space_access_requests_requester
  ON space_access_requests(requester_user_id, status, created_at);

CREATE TABLE IF NOT EXISTS space_invitations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by_user_id TEXT NOT NULL REFERENCES users(id),
  accepted_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  resolved_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_space_invitations_one_pending
  ON space_invitations(space_id, normalized_email)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_space_invitations_space_status
  ON space_invitations(space_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_space_invitations_email
  ON space_invitations(normalized_email, status, created_at);
