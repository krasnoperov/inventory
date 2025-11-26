-- Phase 1: Inventory Forge - Core tables for spaces, members, asset index, and job tracking

-- Spaces table
CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

-- Space members table
CREATE TABLE space_members (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, user_id)
);

-- Shadow index for cross-space search (best-effort, may lag)
CREATE TABLE asset_index (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  tags TEXT,
  thumb_key TEXT,
  updated_at INTEGER NOT NULL
);

-- Generation job tracking
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'generate', 'edit', 'compose'
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'processing', 'completed', 'failed', 'stuck'
  input TEXT NOT NULL,  -- JSON
  result_variant_id TEXT,
  error TEXT,
  attempts INTEGER DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Indexes
CREATE INDEX idx_spaces_owner ON spaces(owner_id);
CREATE INDEX idx_space_members_user ON space_members(user_id);
CREATE INDEX idx_asset_index_space ON asset_index(space_id);
CREATE INDEX idx_jobs_space_status ON jobs(space_id, status);
CREATE INDEX idx_jobs_created_by ON jobs(created_by);
