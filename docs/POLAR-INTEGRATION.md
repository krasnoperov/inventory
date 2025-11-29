# Polar.sh Billing Integration

## Overview

This application uses [Polar.sh](https://polar.sh) as our Merchant of Record (MoR) for usage-based billing. Polar handles:

- Payment processing (via Stripe)
- Customer invoicing
- VAT/sales tax collection and remittance globally
- Usage metering and billing

### Why Polar?

| Feature | Benefit |
|---------|---------|
| Merchant of Record | Polar handles EU VAT, US sales tax - we don't need to register in 27+ countries |
| Usage-based billing | Native support for metering AI token/image usage |
| Lower fees | 4% + €0.40 per transaction vs 5-8% for competitors |
| Developer-focused | TypeScript SDK, webhooks, customer portal |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      User Makes AI Request                       │
└─────────────────────────────────────┬───────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Our Cloudflare Worker                        │
│  ┌────────────────┐         ┌─────────────────┐                 │
│  │ ClaudeService  │         │ NanoBananaService│                │
│  │ (Anthropic)    │         │ (Gemini Images)  │                │
│  └───────┬────────┘         └────────┬─────────┘                │
│          │                           │                          │
│          └─────────┬─────────────────┘                          │
│                    ▼                                            │
│          ┌─────────────────┐                                    │
│          │  UsageService   │                                    │
│          │  (tracks usage) │                                    │
│          └────────┬────────┘                                    │
│                   │                                             │
│    ┌──────────────┼──────────────┐                              │
│    ▼              ▼              ▼                              │
│ ┌──────┐    ┌──────────┐   ┌──────────┐                        │
│ │ D1   │    │ Polar    │   │ Response │                        │
│ │Cache │    │ Events   │   │ to User  │                        │
│ └──────┘    │ API      │   └──────────┘                        │
│             └────┬─────┘                                        │
└──────────────────┼──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Polar.sh                                 │
│  - Aggregates usage into meters                                  │
│  - Applies pricing rules                                         │
│  - Generates invoices                                           │
│  - Collects payment                                             │
│  - Handles VAT/taxes                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Usage Meters

We track **granular meters** for accurate cost attribution:

### Claude (Anthropic) - Separate Input/Output

| Meter | Aggregation | Unit | Pricing Basis |
|-------|-------------|------|---------------|
| `claude_input_tokens` | SUM | tokens | ~$3/MTok |
| `claude_output_tokens` | SUM | tokens | ~$15/MTok |

**Why separate?** Output tokens cost 5x more than input tokens. Combined tracking loses pricing accuracy.

**Metadata:** `{ model, token_type, request_id }`

### Gemini (NanoBanana) - Images + Tokens

| Meter | Aggregation | Unit | Pricing Basis |
|-------|-------------|------|---------------|
| `gemini_images` | COUNT | images | ~$0.02-0.04/image |
| `gemini_input_tokens` | SUM | tokens | (optional, for analysis) |
| `gemini_output_tokens` | SUM | tokens | (optional, for analysis) |

**Metadata:** `{ model, operation, aspect_ratio, token_type }`

### Billing Flexibility

Track everything now, decide billing later:
- Bill per image only? Use `gemini_images` meter
- Bill per token? Use token meters
- Blended rate? Create composite pricing in Polar

---

## Customer Lifecycle

### 1. User Signs Up
```
User registers → AuthController creates user in DB
                            ↓
              PolarService.createCustomer()
                            ↓
              Store polar_customer_id in users table
```

### 2. User Makes AI Requests
```
AI request → Service executes → UsageService.trackX()
                                        ↓
                          Save to usage_events (D1) [always succeeds]
                                        ↓
                          Try async sync to Polar [may fail]
                                        ↓
                          If failed: synced_at stays NULL
                                        ↓
                          Cron job retries every 5 minutes
```

### Sync Reliability

Events are **never lost** because:
1. **Local-first**: Events always saved to D1 before Polar sync attempt
2. **Idempotent retry**: Cron job syncs `synced_at IS NULL` events in batches
3. **Eventual consistency**: Failed syncs retry automatically

```toml
# wrangler.toml - Cron trigger every 5 minutes
[triggers]
crons = ["*/5 * * * *"]
```

### 3. Billing Cycle (Monthly)
```
Polar aggregates usage_events into meters
                    ↓
        Applies pricing from product config
                    ↓
        Generates invoice with line items
                    ↓
        Charges customer's payment method
                    ↓
        Sends receipt, handles taxes
```

---

## Healthbar UI

The `/api/billing/status` endpoint provides all data needed for a usage healthbar:

### Meter Credits (Prepaid)

Polar supports **Meter Credits Benefit** which gives customers a quota per billing cycle:
- Subscribe to a plan → get N credits for each meter
- Credits reset each billing cycle
- Overage billing when credits exhausted (if configured)

### Healthbar Display

```
Claude Input Tokens     [██████████░░░░░░░░░░] 50% (50K / 100K)
Claude Output Tokens    [████████████████░░░░] 80% (40K / 50K)  ⚠️
Gemini Images          [██████████████████░░] 90% (90 / 100)   🔴
```

### Status Indicators

| Status | Percentage | UI Treatment |
|--------|------------|--------------|
| `ok` | < 75% | Green/normal |
| `warning` | 75-89% | Yellow/amber |
| `critical` | 90-99% | Red/urgent |
| `exceeded` | 100%+ | Red + disabled |

### Frontend Integration

```typescript
const { meters, subscription, portalUrl } = await fetch('/api/billing/status').then(r => r.json());

// Render healthbars
for (const meter of meters) {
  const color = meter.status === 'ok' ? 'green' :
                meter.status === 'warning' ? 'yellow' : 'red';
  renderProgressBar(meter.name, meter.percentUsed, color);
}

// Show upgrade prompt when critical
if (meters.some(m => m.status === 'critical' || m.status === 'exceeded')) {
  showUpgradePrompt(portalUrl);
}
```

---

## API Endpoints

### User-Facing (requires JWT auth)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/billing/usage` | GET | Current billing period usage |
| `/api/billing/status` | GET | Billing status with meter info (for healthbar UI) |
| `/api/billing/portal` | GET | Get Polar customer portal URL |
| `/api/billing/quota/:service` | GET | Check quota for `claude` or `nanobanana` |

### Internal (requires `X-Internal-Secret` header)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/internal/billing/sync` | POST | Manually trigger event sync to Polar |
| `/api/internal/billing/cleanup` | POST | Remove old synced events (default: 90 days) |

**Note:** Internal endpoints are also called automatically by the cron trigger.

### Response Examples

**GET /api/billing/usage**
```json
{
  "period": {
    "start": "2025-11-01T00:00:00Z",
    "end": "2025-11-30T23:59:59Z"
  },
  "usage": {
    "claude_input_tokens": { "used": 50000, "limit": null, "remaining": null },
    "claude_output_tokens": { "used": 12000, "limit": null, "remaining": null },
    "gemini_images": { "used": 42, "limit": 100, "remaining": 58 },
    "gemini_input_tokens": { "used": 8500, "limit": null, "remaining": null },
    "gemini_output_tokens": { "used": 2100, "limit": null, "remaining": null }
  },
  "estimatedCost": {
    "amount": 4.50,
    "currency": "EUR"
  }
}
```

**GET /api/billing/status** (for healthbar UI)
```json
{
  "configured": true,
  "hasSubscription": true,
  "meters": [
    {
      "name": "claude_input_tokens",
      "consumed": 50000,
      "credited": 100000,
      "remaining": 50000,
      "percentUsed": 50.0,
      "hasLimit": true,
      "status": "ok"
    },
    {
      "name": "gemini_images",
      "consumed": 85,
      "credited": 100,
      "remaining": 15,
      "percentUsed": 85.0,
      "hasLimit": true,
      "status": "warning"
    }
  ],
  "subscription": {
    "status": "active",
    "renewsAt": "2025-12-01T00:00:00Z"
  },
  "portalUrl": "https://polar.sh/checkout/xxx/portal"
}
```

**Status values for meters:**
- `ok` - usage below 75%
- `warning` - usage 75-89%
- `critical` - usage 90-99%
- `exceeded` - usage 100%+

**GET /api/billing/portal**
```json
{
  "url": "https://polar.sh/checkout/xxx/portal"
}
```

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `POLAR_ACCESS_TOKEN` | Yes | API token from Polar dashboard |
| `POLAR_ORGANIZATION_ID` | No | Your organization ID (optional) |
| `POLAR_ENVIRONMENT` | No | `sandbox` or `production` (default: `production`) |
| `POLAR_WEBHOOK_SECRET` | No | Secret for webhook signature verification |
| `INTERNAL_API_SECRET` | No | Secret for internal billing sync endpoint |

### Sandbox vs Production

Polar uses **completely separate environments** for testing:

| Environment | Dashboard | API Base URL | Use For |
|-------------|-----------|--------------|---------|
| Sandbox | [sandbox.polar.sh](https://sandbox.polar.sh) | `sandbox-api.polar.sh` | Local dev, staging |
| Production | [polar.sh](https://polar.sh) | `api.polar.sh` | Production |

**Important:**
- Sandbox and production require **separate accounts and organizations**
- API tokens from one environment **do not work** in the other
- Sandbox subscriptions **auto-cancel after 90 days**

### Setting Up Sandbox (Recommended First)

1. **Create sandbox account** at [sandbox.polar.sh/start](https://sandbox.polar.sh/start)
2. **Create organization** (e.g., "inventory-sandbox")
3. **Create meters** (see Usage Meters section above)
4. **Create products** with meter credits
5. **Generate API token**: Settings → API Access → Create token

### Testing Payments in Sandbox

Use Stripe test cards:
- **Success**: `4242 4242 4242 4242`
- **Expiry**: Any future date
- **CVC**: Any 3 digits

### Polar Dashboard Setup

1. **Create Organization** at polar.sh
2. **Create Meters:**
   - Name: `claude_tokens`, Aggregation: SUM
   - Name: `nanobanana_images`, Aggregation: COUNT
3. **Create Products:**
   - Free Tier: 10K tokens, 5 images/month
   - Pro Tier: 500K tokens, 100 images/month + overage
4. **Configure Pricing:**
   - Pro: €9.99/month base
   - Overage: €0.002/1K tokens, €0.05/image

### Setting Secrets

```bash
# Local development (.env) - Use sandbox credentials
POLAR_ACCESS_TOKEN=polar_at_sandbox_xxx
POLAR_ORGANIZATION_ID=org_sandbox_xxx
POLAR_ENVIRONMENT=sandbox

# Stage environment (Cloudflare secrets) - Also uses sandbox
wrangler secret put POLAR_ACCESS_TOKEN        # Enter sandbox token
wrangler secret put POLAR_ORGANIZATION_ID     # Enter sandbox org ID

# Production environment (Cloudflare secrets) - Uses production Polar
wrangler secret put POLAR_ACCESS_TOKEN --env production        # Enter production token
wrangler secret put POLAR_ORGANIZATION_ID --env production     # Enter production org ID
```

**Note:** `POLAR_ENVIRONMENT` is set via `wrangler.toml` vars, not secrets:
- Stage: `POLAR_ENVIRONMENT = "sandbox"` (in `[vars]`)
- Production: `POLAR_ENVIRONMENT = "production"` (in `[env.production.vars]`)

---

## Local Development

Usage tracking works locally even without Polar - events are saved to the local D1 database.

```bash
# Run without Polar (usage still tracked in D1)
npm run dev

# Run with Polar sandbox integration
# First, set up your .env with sandbox credentials:
#   POLAR_ACCESS_TOKEN=polar_at_sandbox_xxx
#   POLAR_ORGANIZATION_ID=org_sandbox_xxx
#   POLAR_ENVIRONMENT=sandbox
npm run dev
```

The `POLAR_ENVIRONMENT=sandbox` is already set in `wrangler.dev.toml`, so local dev automatically uses the sandbox API endpoint (`sandbox-api.polar.sh`).

### Testing Usage Tracking

```bash
# Check local usage events
wrangler d1 execute DB --local --command "SELECT * FROM usage_events ORDER BY created_at DESC LIMIT 10"

# Check unsynced events
wrangler d1 execute DB --local --command "SELECT COUNT(*) FROM usage_events WHERE synced_at IS NULL"
```

---

## Implementation Details

### Files Created/Modified

| File | Purpose |
|------|---------|
| `src/backend/services/polarService.ts` | Polar SDK wrapper |
| `src/backend/services/usageService.ts` | Usage tracking orchestration |
| `src/backend/routes/billing.ts` | Billing API endpoints |
| `src/dao/usage-event-dao.ts` | Local usage event storage |
| `db/migrations/0004_polar_billing.sql` | Schema changes |
| `src/backend/services/claudeService.ts` | Added usage return from Anthropic API |

### Database Schema

```sql
-- Added to users table
ALTER TABLE users ADD COLUMN polar_customer_id TEXT;

-- New table for local usage tracking
CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  event_name TEXT NOT NULL,  -- 'claude_tokens', 'nanobanana_images'
  quantity INTEGER NOT NULL,
  metadata TEXT,  -- JSON with details
  created_at TEXT DEFAULT (datetime('now')),
  synced_at TEXT  -- NULL until synced to Polar
);
```

---

## Error Handling

### Polar API Failures

If Polar API is unavailable:
1. Usage event is saved locally in `usage_events` table
2. `synced_at` remains NULL
3. Background job retries sync periodically
4. User requests are NOT blocked

### Quota Exceeded

When user exceeds their plan limits:
1. `UsageService.checkQuota()` returns `{ allowed: false }`
2. API can return 429 with upgrade prompt
3. User can still access read-only features

---

## Tax Handling (for Spanish Autónomo)

As Polar is Merchant of Record:

| Responsibility | Who Handles |
|----------------|-------------|
| Customer VAT collection | Polar |
| Customer invoices | Polar (their name on invoice) |
| EU VAT registration | Polar |
| Tax remittance | Polar |
| **Your income tax (IRPF)** | **You** |
| **Your social security** | **You** |

### Accounting

1. Polar sends you payouts (net of fees and taxes they collected)
2. You receive "Reverse Invoice" from Polar for your records
3. Report payouts as income on Modelo 130/100
4. Polar fees are deductible expenses

---

## Troubleshooting

### "Customer not found" errors
- Check `polar_customer_id` in users table
- Verify customer exists in Polar dashboard
- May need to re-create customer via signup flow

### Usage not appearing in Polar
- Check `usage_events` table for `synced_at IS NULL`
- Verify `POLAR_ACCESS_TOKEN` is valid
- Check Polar API status

### Invoice discrepancies
- Compare local `usage_events` with Polar dashboard
- Check event timestamps vs billing period
- Verify meter aggregation settings in Polar
