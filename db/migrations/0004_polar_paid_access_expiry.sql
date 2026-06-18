-- Cache scheduled-cancellation grace expiry separately from active billing periods.

ALTER TABLE users
ADD COLUMN polar_paid_access_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_users_polar_paid_access_expires_at
  ON users(polar_paid_access_expires_at);
