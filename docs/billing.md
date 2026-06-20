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

## Polar Metering Contract

Each billable local `usage_events` row is synced to Polar as one immutable event.
The Polar event name must match the local `event_name`, and each meter must
filter on `name == <event_name>` and aggregate `SUM(quantity)`.

| Meter / Event Name | Aggregation | Unit | Purpose |
|--------------------|-------------|------|---------|
| `claude_input_tokens` | `SUM(quantity)` | token | Claude API input tokens. |
| `claude_output_tokens` | `SUM(quantity)` | token | Claude API output tokens. |
| `gemini_images` | `SUM(quantity)` | image | Generated Gemini image outputs. |
| `gemini_videos` | `SUM(quantity)` | video unit | Generated Gemini/Veo video units; Veo-native soundtrack requests count as two units and include `generate_audio: true`. |
| `gemini_audio` | `SUM(quantity)` | audio generation | Lyria-generated music outputs. |
| `gemini_input_tokens` | `SUM(quantity)` | token | Gemini image API input tokens when reported by the provider. |
| `gemini_output_tokens` | `SUM(quantity)` | token | Gemini image API output tokens when reported by the provider. |
| `elevenlabs_audio` | `SUM(quantity)` | audio unit | ElevenLabs provider usage units. |

The canonical code copy of this contract is
`src/backend/billing/polarMeteringContract.ts`. Operational checks must fail if
the active Polar meters do not match these names, filters, aggregation function,
and aggregation property.

The configured `POLAR_PAID_GENERATION_PRODUCT_ID` product must be active,
recurring, and include a non-archived `metered_unit` price for every canonical
meter above. Meter-credit benefits on the product are used to expose customer
quota balances locally when the plan has finite included usage.

## Paid Generation Entitlements

Generation access is controlled by `users.paid_generation_entitlement`:

| Value | Meaning |
|-------|---------|
| `none` | No paid-generation access. Generation pre-checks fail before provider calls. |
| `paid` | Billable customer access. Quota/rate checks apply and usage events sync to Polar. |
| `internal` | Non-billable internal access. Rate limits still apply, and usage is recorded locally with Polar sync disabled. |

Polar subscription webhooks set active subscribers to `paid` and canceled/no-active-subscription users to `none`.
Canceled subscriptions keep paid access until the cached Polar billing period
ends. Local quota checks use `users.polar_current_period_start` and
`users.polar_current_period_end` when available, falling back to the calendar
month only before Polar period data has been cached.
Local dev-auth users are marked `internal`.

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/billing/status` | Meter usage + limits (for healthbar UI) |
| `GET /api/billing/checkout` | Polar checkout URL for first-time paid generation access |
| `GET /api/billing/portal` | Polar customer portal URL |
| `GET /api/billing/operational-checks` | Admin check for Polar meter readiness and local sync health |
| `GET /api/billing/reconcile?user_id=:id` | Admin local-vs-Polar usage reconciliation for one customer billing period |

### Status Response

```
entitlement: none | paid | internal
portalUrl: string | null
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
| `POLAR_PAID_GENERATION_PRODUCT_ID` | Product ID used for paid generation checkout |
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

## Provider Spend Ledger

`usage_events` remains the customer-metering source of truth synced to Polar.
Provider-side spend attribution is stored separately in `provider_usage_ledger`
so raw provider cost can be reconciled without changing customer meter totals.
Each row has a unique `attribution_key` plus optional keys for `usage_event_id`,
`space_id`, `asset_id`, `variant_id`, `workflow_id`, `request_id`, and provider
request/usage IDs. Total spend is stored as integer micro-USD.

## Operational Checks

Run production billing checks from an authenticated admin CLI session:

```bash
makefx billing check
```

The command verifies:

- application, processing, and Polar worker `/api/health` endpoints
- required Polar meters exist for all billable usage event names
- each Polar meter filters on the matching event name and uses `SUM(quantity)`
- the configured paid-generation product is active, recurring, and has metered prices for every canonical meter
- local usage sync has no failed events and no pending billable event older than 15 minutes
- non-internal users waiting on Polar customer backfill
- internal users have zero billable usage events and their local usage remains non-billable

Reconcile a specific customer's local billable usage against Polar's current
meter totals:

```bash
makefx billing reconcile --user-id 42 --env stage
```

The reconciliation uses cached Polar billing period bounds when available and
compares each canonical meter's local total with Polar's reported total. Any
nonzero delta must be explained by pending sync, failed sync, or Polar meter
configuration before the billing period is considered reconciled.

### Stage Verification

Stage billing cannot be considered verified until the stage workers have Polar
secrets and an admin user configured.

Configure the application worker:

```bash
pnpm exec wrangler secret put POLAR_ACCESS_TOKEN --config wrangler.toml
pnpm exec wrangler secret put POLAR_ORGANIZATION_ID --config wrangler.toml
pnpm exec wrangler secret put POLAR_PAID_GENERATION_PRODUCT_ID --config wrangler.toml
pnpm exec wrangler secret put POLAR_WEBHOOK_SECRET --config wrangler.toml
pnpm exec wrangler secret put ADMIN_USER_IDS --config wrangler.toml
```

Configure the billing sync worker:

```bash
pnpm exec wrangler secret put POLAR_ACCESS_TOKEN --config wrangler.polar.toml
pnpm exec wrangler secret put POLAR_ORGANIZATION_ID --config wrangler.polar.toml
```

Then deploy and verify:

```bash
pnpm run db:migrate:stage
pnpm run deploy:stage
pnpm exec wrangler deploy --config wrangler.generation.toml
pnpm exec wrangler deploy --config wrangler.polar.toml
makefx login --env stage
makefx billing check --env stage
makefx billing reconcile --user-id <paid-stage-user-id> --env stage
```

---

## References

- `src/backend/services/usageService.ts` — Usage tracking, quota checks
- `src/backend/services/polarService.ts` — Polar SDK wrapper
- `src/backend/routes/billing.ts` — Billing API endpoints
- `src/dao/usage-event-dao.ts` — Local event storage
- `db/migrations/0001_initial_schema.sql` — Schema (billing tables included)
