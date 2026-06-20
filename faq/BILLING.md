# Billing FAQ

## How does billing work?

Make Effects supports two generation paths:

- **Paid Generation** uses the hosted Make Effects provider configuration and is managed through [Polar](https://polar.sh).
- **BYOK** uses provider keys you add in your Profile. Provider usage is billed by that provider account, while Make Effects still applies platform guardrails such as workflow, storage, delivery, video, and rate limits.

### Paid Generation Includes:

- **Current-period usage meters** for AI features such as Claude tokens, Gemini image/video/audio usage, and ElevenLabs audio usage
- **Real-time usage tracking** so you always know where you stand
- **Automatic renewal** while your subscription is active
- **Access through the Polar checkout and customer portal**

---

## Understanding Your Usage

### Where can I see my usage?

Visit your **Profile** page to view the **Billing** section. Here you'll find:

- Your current plan name
- Usage meters showing how much you've consumed and, when your plan has a finite meter credit, the current-period limit
- Visual progress bars with color-coded status
- Your renewal or access-end date when a subscription is active
- Estimated provider cost for usage attribution. This is not the same thing as your customer invoice.

### What do the usage colors mean?

| Color | Status | Meaning |
|-------|--------|---------|
| Green | OK | You have plenty of usage remaining |
| Yellow | Getting Low | You've used over 70% of your allowance |
| Orange | Almost Full | You've used over 90% of your allowance |
| Red | Limit Reached | You've reached your limit for this period |

### What happens when I reach my limit?

When you hit your usage limit, that feature will be temporarily unavailable until:
- Your billing cycle resets (usage allowances renew monthly), or
- Your account receives a different entitlement or meter-credit configuration

You'll see a message explaining the limit and linking to Profile when billing action is available.

---

## Managing Your Subscription

### How do I view or change my subscription?

Click **"Manage plan"** in your Profile's Billing section when it is available. This opens the Polar customer portal where you can:

- View your current subscription details
- See your complete invoice history
- Update your payment method
- Change or cancel your subscription

### When does my usage reset?

Your usage allowances reset at the start of each billing cycle. The exact renewal date is shown in your Billing section.

### How do I start Paid Generation?

1. Go to your **Profile** page
2. Click **"Start Paid Generation"** when checkout is available
3. Complete Polar checkout

### How do I cancel?

1. Click **"Manage plan"** in your Profile
2. In the customer portal, find your subscription
3. Click "Cancel subscription"
4. You'll retain access until the end of your current billing period

---

## What Gets Tracked?

### AI Chat (Claude)

Every conversation with the AI assistant uses tokens. We track:
- **Input tokens** — the messages you send
- **Output tokens** — the AI's responses

Longer conversations use more tokens. The token count depends on the complexity and length of your prompts and responses.

### Managed Generation

Managed generation tracks provider-specific meters such as Gemini images, videos, audio, input tokens, output tokens, and ElevenLabs audio units. The exact meters shown depend on the active plan configuration.

### BYOK Provider Keys

When you add a matching provider key in Profile, supported generation can use that key without requiring Paid Generation. Provider usage is billed by your provider account. Make Effects still records platform usage and may block requests when platform or rate limits are exhausted.

---

## Common Questions

### Why was I charged?

Subscription charges and invoices are managed by Polar for Paid Generation. Visit the customer portal via **"Manage plan"** to see invoice history.

### Is my payment information secure?

Yes. All payment processing is handled by Polar, a secure payment platform. We never see or store your credit card details.

### Can I get a refund?

Refund policies are managed through Polar. Contact support through the customer portal for refund requests.

### What if I don't want to pay?

You can add supported provider keys in Profile and use BYOK where available. Otherwise, hosted provider generation requires Paid Generation or internal access.

### I'm having billing issues. Who do I contact?

For billing-related issues:
1. First, check the customer portal via **"Manage plan"** for answers
2. Use the support options available in the Polar customer portal

---

## Technical Notes

- Usage events are synced to our billing system periodically
- There may be a brief delay (up to 5 minutes) between using a feature and seeing it reflected in your usage stats
- Your usage meters show real-time data from both local tracking and the billing system
