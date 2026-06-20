-- Track customer-facing metered charges separately from provider-side spend.
--
-- usage_events remains the source synced to Polar. This ledger preserves the
-- local customer charge record and links it to provider_usage_ledger when raw
-- provider attribution exists.

CREATE TABLE IF NOT EXISTS customer_charge_ledger (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  charge_key TEXT NOT NULL UNIQUE,
  usage_event_id TEXT REFERENCES usage_events(id) ON DELETE SET NULL,
  provider_usage_ledger_id TEXT REFERENCES provider_usage_ledger(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meter_event_name TEXT NOT NULL,
  charge_unit TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity >= 0),
  polar_billable INTEGER NOT NULL DEFAULT 1 CHECK (polar_billable IN (0, 1)),
  billing_provider TEXT NOT NULL DEFAULT 'polar' CHECK (billing_provider = 'polar'),
  billing_external_id TEXT NOT NULL,
  customer_amount_micro_usd INTEGER CHECK (customer_amount_micro_usd IS NULL OR customer_amount_micro_usd >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_charge_usage_event
  ON customer_charge_ledger(usage_event_id)
  WHERE usage_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_charge_user_created
  ON customer_charge_ledger(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_customer_charge_provider_usage
  ON customer_charge_ledger(provider_usage_ledger_id)
  WHERE provider_usage_ledger_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_charge_meter_created
  ON customer_charge_ledger(meter_event_name, created_at);

CREATE INDEX IF NOT EXISTS idx_customer_charge_billable_created
  ON customer_charge_ledger(polar_billable, created_at);
