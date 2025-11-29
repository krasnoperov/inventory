-- Local Quota and Rate Limit Tracking
-- Enables fast D1-based quota checks without Polar API calls
--
-- Quota limits are cached from Polar webhooks (subscription.active, etc)
-- Rate limits use a fixed-window counter per user
--
-- @see https://docs.polar.sh/features/webhooks
-- @see https://docs.polar.sh/features/usage-based-billing/meters

-- Add quota limits (cached from Polar webhooks)
-- JSON format: {"claude_output_tokens": 100000, "gemini_images": 50}
ALTER TABLE users ADD COLUMN quota_limits TEXT;

-- Track when limits were last updated (for staleness detection)
ALTER TABLE users ADD COLUMN quota_limits_updated_at TEXT;

-- Rate limiting: fixed window counter
-- Resets when rate_limit_window_start is older than window duration
ALTER TABLE users ADD COLUMN rate_limit_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN rate_limit_window_start TEXT;

-- Optimized index for usage aggregation queries
-- Covers the common query: SUM(quantity) WHERE user_id = ? AND event_name = ? AND created_at >= ?
CREATE INDEX IF NOT EXISTS idx_usage_events_user_event_period
  ON usage_events(user_id, event_name, created_at);
