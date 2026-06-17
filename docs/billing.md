# Polar.sh Billing Integration

Usage-based billing via [Polar.sh](https://polar.sh) as Merchant of Record.

---

## Why Polar?

| Feature | Benefit |
|---------|---------|
| **Merchant of Record** | Handles EU VAT, US sales tax globally |
| **Usage-based billing** | Native metering for AI token/image usage |
| **Developer-focused** | TypeScript SDK, webhooks, customer portal |

---

## Architecture

```
User Request → Worker
                 │
                 ▼
         UsageService.preCheck()
         • Check quota (local D1)
         • Check rate limit
         → 402/429 if blocked
                 │
                 ▼
         AI Service (Claude/Gemini)
                 │
                 ▼
         UsageService.trackX()
         → Save to usage_events (D1)
                 │
                 ▼
         Cron (every 5 min)
         → Sync to Polar
         → Mark synced_at
                 │
                 ▼
              Polar.sh
         • Aggregate usage
         • Generate invoices
         • Handle payments/taxes
         • Send webhooks
                 │
                 ▼
         Webhook Handler
         → Cache limits in D1
```

---

## Usage Meters

| Meter | Aggregation | Purpose |
|-------|-------------|---------|
| `claude_input_tokens` | SUM | Claude API input |
| `claude_output_tokens` | SUM | Claude API output (5x cost) |
| `gemini_images` | COUNT | Generated images |
| `gemini_videos` | COUNT | Generated videos |
| `gemini_input_tokens` | SUM | Gemini API input |
| `gemini_output_tokens` | SUM | Gemini API output |

## Paid Generation Entitlements

Generation access is controlled by `users.paid_generation_entitlement`:

| Value | Meaning |
|-------|---------|
| `none` | No paid-generation access. Generation pre-checks fail before provider calls. |
| `paid` | Billable customer access. Quota/rate checks apply and usage events sync to Polar. |
| `internal` | Non-billable internal access. Rate limits still apply, and usage is recorded locally with Polar sync disabled. |

Polar subscription webhooks set active subscribers to `paid` and canceled/no-active-subscription users to `none`.
Local dev-auth users are marked `internal`.

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/billing/status` | Meter usage + limits (for healthbar UI) |
| `GET /api/billing/portal` | Polar customer portal URL |
| `GET /api/billing/operational-checks` | Admin check for Polar meter readiness and local sync health |

### Status Response

```
entitlement: none | paid | internal
meters: [
  { name, consumed, credited, remaining, percentUsed, status }
]
status: ok | warning | critical | exceeded
```

### Error Responses

- **402 Payment Required** — Quota exceeded
- **429 Too Many Requests** — Rate limited

---

## Configuration

| Variable | Description |
|----------|-------------|
| `POLAR_ACCESS_TOKEN` | API token from Polar dashboard |
| `POLAR_ORGANIZATION_ID` | Organization ID |
| `POLAR_WEBHOOK_SECRET` | Webhook endpoint secret used for Standard Webhooks verification |
| `POLAR_ENVIRONMENT` | `sandbox` or `production` |

### Environments

- **Sandbox**: `sandbox.polar.sh` — for dev/staging
- **Production**: `polar.sh` — separate account required

---

## Sync Strategy

1. **Local-first**: Events saved to D1 before Polar sync
2. **Deduplication**: Deterministic `externalId` prevents duplicates
3. **Retry**: Cron job syncs pending events (max 3 attempts)
4. **Eventual consistency**: User requests never blocked by sync failures

## Operational Checks

Run production billing checks from an authenticated admin CLI session:

```bash
pnpm run cli billing check
```

The command verifies:

- application, processing, and Polar worker `/api/health` endpoints
- required Polar meters exist for all billable usage event names
- local usage sync has no failed events and no pending billable event older than 15 minutes
- non-internal users waiting on Polar customer backfill

---

## References

- `src/backend/services/usageService.ts` — Usage tracking, quota checks
- `src/backend/services/polarService.ts` — Polar SDK wrapper
- `src/backend/routes/billing.ts` — Billing API endpoints
- `src/dao/usage-event-dao.ts` — Local event storage
- `db/migrations/0001_initial_schema.sql` — Schema (billing tables included)
