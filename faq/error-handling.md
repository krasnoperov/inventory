# Error Handling in Chat

This document explains how the Forge Assistant handles errors, particularly billing-related errors like quota limits and rate limiting.

## Error Types

### Quota Exceeded (HTTP 402)

When you've used all of your monthly quota for a service (like Claude AI chat), you'll see a message like:

> "Monthly quota exceeded for claude. Please upgrade your plan."

**What you'll see:**
- Your current usage (e.g., "You've used 50,000 of your 50,000 monthly quota")
- An **Upgrade Plan** button that takes you to the billing portal

**What to do:**
1. Click "Upgrade Plan" to view subscription options
2. Or wait until the next billing cycle when your quota resets

### Rate Limited (HTTP 429)

When you're making requests too quickly, you'll see a message like:

> "Too many requests. Please wait 60 seconds."

**What you'll see:**
- A countdown timer showing seconds remaining
- A progress bar showing time until reset

**What to do:**
- Wait for the countdown to complete
- The timer shows "Ready to try again" when you can make another request

## Technical Details

For developers integrating with the API, here's the error response format:

```typescript
// HTTP 402 (Quota Exceeded) or HTTP 429 (Rate Limited)
{
  "error": "Rate limited" | "Quota exceeded",
  "message": "Human-readable error message",
  "denyReason": "quota_exceeded" | "rate_limited",
  "quota": {
    "used": 50000,      // Current usage this period
    "limit": 50000,     // Quota limit (null = unlimited)
    "remaining": 0      // Remaining quota (null = unlimited)
  },
  "rateLimit": {
    "used": 20,         // Requests in current window
    "limit": 20,        // Max requests per window
    "remaining": 0,     // Remaining requests
    "resetsAt": "2024-01-15T10:30:00Z"  // When window resets (ISO string)
  }
}
```

### Frontend Implementation

The frontend handles these errors specially:

1. **Quota errors (402)**: Display upgrade CTA with link to `/api/billing/portal`
2. **Rate limit errors (429)**: Display countdown timer based on `rateLimit.resetsAt`

See the following files for implementation details:
- `src/api/types.ts` - `LimitErrorResponse` type definition
- `src/frontend/stores/chatStore.ts` - `ChatMessage.quotaError` and `rateLimitError` fields
- `src/frontend/components/ChatSidebar/MessageList.tsx` - Error card rendering
- `src/frontend/components/ChatSidebar/RateLimitCountdown.tsx` - Countdown timer component
- `src/backend/services/usageService.ts` - `PreCheckResult` and `preCheck()` function

### Backend Implementation

The backend enforces limits using:

1. **Quota checking**: Compares current period usage against cached limits
2. **Rate limiting**: Fixed-window counter per user (default: 20 requests/minute for Claude)

See `src/backend/services/usageService.ts`:
- `preCheck()` - Combined quota + rate limit check before API calls
- `DEFAULT_RATE_LIMITS` - Rate limit configuration per service

## Related Documentation

- [Billing FAQ](./BILLING.md) - Subscription and usage information
- [Trust Zones](./trust-zones.md) - Action approval settings
