-- Store account-scoped BYOK provider API keys encrypted at rest.

CREATE TABLE IF NOT EXISTS user_provider_keys (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google_ai', 'anthropic', 'elevenlabs', 'lyria')),
  encrypted_api_key TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_provider_keys_user_updated
  ON user_provider_keys(user_id, updated_at);
