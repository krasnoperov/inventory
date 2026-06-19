-- Cache the active Polar subscription period used for local quota checks.

ALTER TABLE users
ADD COLUMN polar_current_period_start TEXT;

ALTER TABLE users
ADD COLUMN polar_current_period_end TEXT;

CREATE INDEX IF NOT EXISTS idx_users_polar_current_period
  ON users(polar_current_period_start, polar_current_period_end);
