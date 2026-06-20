-- Store wrapped data-encryption keys for scoped envelope encryption.

CREATE TABLE IF NOT EXISTS key_envelopes (
  scope_id TEXT PRIMARY KEY,
  wrapped_dek TEXT NOT NULL,
  dek_version INTEGER NOT NULL,
  kek_version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

