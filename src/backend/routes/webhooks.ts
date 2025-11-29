import { Hono } from 'hono';
import type { AppContext } from './types';

const webhookRoutes = new Hono<AppContext>();

// =============================================================================
// Polar Webhook Event Types
// =============================================================================

interface SubscriptionEventData {
  customer: {
    id: string;
    email: string;
    external_id?: string;
  };
  subscription: {
    id: string;
    status: 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid';
    product_id: string;
    current_period_start: string;
    current_period_end: string;
    canceled_at?: string;
  };
}

interface CustomerStateEventData {
  customer: {
    id: string;
    email: string;
    external_id?: string;
    active_subscriptions: number;
  };
}

interface PolarWebhookEvent {
  type: string;
  data: unknown;
}

/**
 * Polar.sh Webhook Handler
 * POST /api/webhooks/polar
 *
 * Receives webhook events from Polar for subscription lifecycle management.
 * See: https://polar.sh/docs/features/webhooks
 *
 * Events handled:
 * - subscription.created: New subscription started
 * - subscription.active: Subscription became active
 * - subscription.updated: Subscription modified
 * - subscription.canceled: Subscription canceled
 * - customer.state_changed: Customer state updated
 */
webhookRoutes.post('/api/webhooks/polar', async (c) => {
  try {
    const webhookSecret = c.env.POLAR_WEBHOOK_SECRET;

    // Verify webhook signature if secret is configured
    if (webhookSecret) {
      const signature = c.req.header('Polar-Signature');
      if (!signature) {
        console.warn('[Polar Webhook] Missing signature header');
        return c.json({ error: 'Missing signature' }, 401);
      }

      // Get raw body for signature verification
      const rawBody = await c.req.text();

      // Verify HMAC signature
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(webhookSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signatureBuffer = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(rawBody)
      );
      const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      if (signature !== expectedSignature) {
        console.warn('[Polar Webhook] Invalid signature');
        return c.json({ error: 'Invalid signature' }, 401);
      }

      // Parse the verified body
      const event = JSON.parse(rawBody) as PolarWebhookEvent;
      return handlePolarEvent(event);
    }

    // No webhook secret configured - parse body directly (dev mode)
    const event = await c.req.json() as PolarWebhookEvent;
    return handlePolarEvent(event);
  } catch (error) {
    console.error('[Polar Webhook] Error processing webhook:', error);
    return c.json({ error: 'Webhook processing failed' }, 500);
  }

  /**
   * Handle Polar webhook event inline
   */
  function handlePolarEvent(event: PolarWebhookEvent) {
    const { type, data } = event;

    console.log(`[Polar Webhook] Received event: ${type}`);

    switch (type) {
      case 'subscription.created':
        handleSubscriptionCreated(data as SubscriptionEventData);
        break;

      case 'subscription.active':
        handleSubscriptionActive(data as SubscriptionEventData);
        break;

      case 'subscription.updated':
        handleSubscriptionUpdated(data as SubscriptionEventData);
        break;

      case 'subscription.canceled':
        handleSubscriptionCanceled(data as SubscriptionEventData);
        break;

      case 'customer.state_changed':
        handleCustomerStateChanged(data as CustomerStateEventData);
        break;

      default:
        console.log(`[Polar Webhook] Unhandled event type: ${type}`);
    }

    // Always return 200 to acknowledge receipt
    return c.json({ received: true });
  }
});

/**
 * Handle subscription.created event
 * A new subscription has been created (may not be active yet)
 */
function handleSubscriptionCreated(data: SubscriptionEventData): void {
  const { customer, subscription } = data;
  console.log(`[Polar Webhook] Subscription created for customer ${customer.id}`, {
    subscriptionId: subscription.id,
    status: subscription.status,
    productId: subscription.product_id,
  });

  // Optionally update user record or trigger notifications
  // For now, just log - the subscription.active event will handle activation
}

/**
 * Handle subscription.active event
 * The subscription is now active and benefits should be granted
 */
function handleSubscriptionActive(data: SubscriptionEventData): void {
  const { customer, subscription } = data;
  console.log(`[Polar Webhook] Subscription active for customer ${customer.id}`, {
    subscriptionId: subscription.id,
    currentPeriodEnd: subscription.current_period_end,
  });

  // Could update user tier/benefits here
  // For usage-based billing, credits are handled by Polar's meter credit benefits
}

/**
 * Handle subscription.updated event
 * The subscription was modified (e.g., plan change)
 */
function handleSubscriptionUpdated(data: SubscriptionEventData): void {
  const { customer, subscription } = data;
  console.log(`[Polar Webhook] Subscription updated for customer ${customer.id}`, {
    subscriptionId: subscription.id,
    status: subscription.status,
  });
}

/**
 * Handle subscription.canceled event
 * The subscription has been canceled (may still be active until period end)
 */
function handleSubscriptionCanceled(data: SubscriptionEventData): void {
  const { customer, subscription } = data;
  console.log(`[Polar Webhook] Subscription canceled for customer ${customer.id}`, {
    subscriptionId: subscription.id,
    canceledAt: subscription.canceled_at,
    endsAt: subscription.current_period_end,
  });

  // Could send notification to user, update UI state, etc.
}

/**
 * Handle customer.state_changed event
 * Customer's overall state has changed (e.g., active subscriptions changed)
 */
function handleCustomerStateChanged(data: CustomerStateEventData): void {
  const { customer } = data;
  console.log(`[Polar Webhook] Customer state changed: ${customer.id}`, {
    activeSubscriptions: customer.active_subscriptions,
  });

  // Could update cached customer state for faster UI responses
}

export { webhookRoutes };
