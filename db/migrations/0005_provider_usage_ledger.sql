-- Track raw provider-side usage and spend separately from Polar customer meters.
--
-- usage_events remains the customer-metering source synced to Polar. This ledger
-- is for provider cost attribution by user, space, workflow, and generated
-- artifact.

CREATE TABLE IF NOT EXISTS provider_usage_ledger (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  attribution_key TEXT NOT NULL UNIQUE,
  usage_event_id TEXT REFERENCES usage_events(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id TEXT,
  asset_id TEXT,
  variant_id TEXT,
  workflow_id TEXT,
  request_id TEXT,
  provider TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  operation TEXT,
  media_kind TEXT CHECK (media_kind IS NULL OR media_kind IN ('image', 'audio', 'video')),
  meter_event_name TEXT,
  usage_unit TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity >= 0),
  unit_price_usd REAL CHECK (unit_price_usd IS NULL OR unit_price_usd >= 0),
  amount_micro_usd INTEGER CHECK (amount_micro_usd IS NULL OR amount_micro_usd >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  pricing_source TEXT,
  provider_request_id TEXT,
  provider_response_id TEXT,
  provider_usage_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_provider_usage_user_created
  ON provider_usage_ledger(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_provider_usage_space_created
  ON provider_usage_ledger(space_id, created_at)
  WHERE space_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_usage_variant
  ON provider_usage_ledger(variant_id)
  WHERE variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_usage_workflow
  ON provider_usage_ledger(workflow_id)
  WHERE workflow_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_usage_request
  ON provider_usage_ledger(request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_usage_event
  ON provider_usage_ledger(usage_event_id)
  WHERE usage_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_usage_provider_created
  ON provider_usage_ledger(provider, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_usage_provider_usage_id
  ON provider_usage_ledger(provider, provider_usage_id)
  WHERE provider_usage_id IS NOT NULL;
