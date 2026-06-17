-- Make paid-generation access explicit and support non-billable internal users.

ALTER TABLE users
ADD COLUMN paid_generation_entitlement TEXT NOT NULL DEFAULT 'none'
  CHECK (paid_generation_entitlement IN ('none', 'paid', 'internal'));

UPDATE users
SET paid_generation_entitlement = 'paid'
WHERE quota_limits IS NOT NULL
  AND quota_limits != ''
  AND EXISTS (
    SELECT 1
    FROM json_each(users.quota_limits)
    WHERE json_each.value IS NULL
      OR CAST(json_each.value AS REAL) > 0
  );

CREATE INDEX IF NOT EXISTS idx_users_paid_generation_entitlement
  ON users(paid_generation_entitlement);
