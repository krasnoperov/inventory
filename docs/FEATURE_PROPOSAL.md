# Feature Proposals: Polar.sh Integration Improvements

---

## Proposal: Failure Rate Alerting System

### Problem

Sync failures are only logged to console - no proactive notifications, easy to miss, and no historical tracking.

### Options

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A. Analytics Engine** | Cloudflare's built-in metrics | Native integration, 90-day retention, GraphQL queryable | Cloudflare-specific |
| **B. Webhook Alerts** | Send to Slack/Discord/email | Immediate visibility, easy setup | No historical data |
| **C. D1 Metrics Table** | Store sync metrics in database | Queryable history, admin dashboard | Extra DB writes |

### Recommendation

Start with **Option B (webhook alerts)** for immediate visibility, then add **Option A (Analytics Engine)** for historical metrics.

### Alert Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Events failed per sync | > 5 | > 20 |
| Customers failed per sync | > 2 | > 10 |
| Consecutive sync failures | > 3 | > 10 |
| Failed events in DB | > 50 | > 200 |

### Implementation Checklist

- [ ] Add `ALERT_WEBHOOK_URL` environment variable
- [ ] Implement `sendAlert()` function in polar.ts
- [ ] Add consecutive failure tracking (store in KV)
- [ ] Add `/api/billing/metrics` endpoint for admin dashboard
- [ ] Configure Cloudflare Analytics Engine binding (optional)

### References

- https://developers.cloudflare.com/analytics/analytics-engine/
- https://developers.cloudflare.com/workers/observability/
