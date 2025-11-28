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

We track two types of usage:

### 1. Claude Tokens (`claude_tokens`)
- **Aggregation:** SUM
- **Unit:** tokens
- **Tracked on:** Every chat/assistant API call
- **Metadata:** `{ model, tokens_in, tokens_out, request_id }`

### 2. Image Generation (`nanobanana_images`)
- **Aggregation:** COUNT
- **Unit:** images
- **Tracked on:** Every successful image generation
- **Metadata:** `{ model, operation, aspect_ratio }`

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
                          Save to usage_events (D1)
                                        ↓
                          Async sync to Polar Events API
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

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/billing/usage` | GET | Required | Current billing period usage |
| `/api/billing/portal` | GET | Required | Get Polar customer portal URL |
| `/api/billing/quota/:service` | GET | Required | Check quota for claude or nanobanana |

### Response Examples

**GET /api/billing/usage**
```json
{
  "period": {
    "start": "2025-11-01T00:00:00Z",
    "end": "2025-11-30T23:59:59Z"
  },
  "usage": {
    "claude_tokens": {
      "used": 125000,
      "limit": 500000,
      "remaining": 375000
    },
    "nanobanana_images": {
      "used": 42,
      "limit": 100,
      "remaining": 58
    }
  },
  "estimatedCost": {
    "amount": 4.50,
    "currency": "EUR"
  }
}
```

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
# Local development (.env)
POLAR_ACCESS_TOKEN=polar_at_xxx
POLAR_ORGANIZATION_ID=org_xxx

# Production (Cloudflare secrets)
wrangler secret put POLAR_ACCESS_TOKEN
wrangler secret put POLAR_ORGANIZATION_ID
```

---

## Local Development

Usage tracking works locally even without Polar - events are saved to the local D1 database.

```bash
# Run without Polar (usage still tracked in D1)
npm run dev

# Run with Polar integration
POLAR_ACCESS_TOKEN=polar_at_xxx npm run dev
```

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
