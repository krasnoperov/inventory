import { Hono } from 'hono';
import type { AppContext } from './types';
import { UserDAO } from '../../dao/user-dao';
import { PolarService } from '../services/polarService';

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
 * Updates local quota_limits cache when subscriptions change.
 *
 * Events handled:
 * - subscription.created: New subscription started
 * - subscription.active: Subscription became active → fetch and cache limits
 * - subscription.updated: Subscription modified → refresh limits
 * - subscription.canceled: Subscription canceled → revoke limits
 * - customer.state_changed: Customer state updated
 *
 * @see https://docs.polar.sh/api-reference/webhooks/create
 * @see https://docs.polar.sh/features/webhooks
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
      return await handlePolarEvent(event);
    }

    // No webhook secret configured - parse body directly (dev mode)
    const event = await c.req.json() as PolarWebhookEvent;
    return await handlePolarEvent(event);
  } catch (error) {
    console.error('[Polar Webhook] Error processing webhook:', error);
    return c.json({ error: 'Webhook processing failed' }, 500);
  }

  /**
   * Handle Polar webhook event
   */
  async function handlePolarEvent(event: PolarWebhookEvent) {
    const { type, data } = event;

    console.log(`[Polar Webhook] Received event: ${type}`);

    const container = c.get('container');
    const userDAO = container.get(UserDAO);
    const polarService = container.get(PolarService);

    switch (type) {
      case 'subscription.created':
        await handleSubscriptionCreated(data as SubscriptionEventData, userDAO);
        break;

      case 'subscription.active':
        await handleSubscriptionActive(data as SubscriptionEventData, userDAO, polarService);
        break;

      case 'subscription.updated':
        await handleSubscriptionUpdated(data as SubscriptionEventData, userDAO, polarService);
        break;

      case 'subscription.canceled':
        await handleSubscriptionCanceled(data as SubscriptionEventData, userDAO);
        break;

      case 'customer.state_changed':
        await handleCustomerStateChanged(data as CustomerStateEventData, userDAO, polarService);
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
async function handleSubscriptionCreated(
  data: SubscriptionEventData
): Promise<void> {
  const { customer, subscription } = data;
  console.log(`[Polar Webhook] Subscription created for customer ${customer.id}`, {
    subscriptionId: subscription.id,
    status: subscription.status,
    productId: subscription.product_id,
  });

  // Don't update limits yet - wait for subscription.active
}

/**
 * Handle subscription.active event
 * The subscription is now active - fetch and cache quota limits
 *
 * @see https://docs.polar.sh/features/usage-based-billing/meters
 */
async function handleSubscriptionActive(
  data: SubscriptionEventData,
  userDAO: UserDAO,
  polarService: PolarService
): Promise<void> {
  const { customer, subscription } = data;
  console.log(`[Polar Webhook] Subscription active for customer ${customer.id}`, {
    subscriptionId: subscription.id,
    currentPeriodEnd: subscription.current_period_end,
  });

  if (!customer.external_id) {
    console.warn('[Polar Webhook] No external_id on customer, cannot update local limits');
    return;
  }

  const userId = parseInt(customer.external_id);
  await fetchAndCacheLimits(userId, userDAO, polarService);
}

/**
 * Handle subscription.updated event
 * The subscription was modified (e.g., plan change) - refresh limits
 */
async function handleSubscriptionUpdated(
  data: SubscriptionEventData,
  userDAO: UserDAO,
  polarService: PolarService
): Promise<void> {
  const { customer, subscription } = data;
  console.log(`[Polar Webhook] Subscription updated for customer ${customer.id}`, {
    subscriptionId: subscription.id,
    status: subscription.status,
  });

  if (!customer.external_id) {
    console.warn('[Polar Webhook] No external_id on customer, cannot update local limits');
    return;
  }

  // Only refresh limits if subscription is still active
  if (subscription.status === 'active') {
    const userId = parseInt(customer.external_id);
    await fetchAndCacheLimits(userId, userDAO, polarService);
  }
}

/**
 * Handle subscription.canceled event
 * The subscription has been canceled - revoke quota limits
 */
async function handleSubscriptionCanceled(
  data: SubscriptionEventData,
  userDAO: UserDAO
): Promise<void> {
  const { customer, subscription } = data;
  console.log(`[Polar Webhook] Subscription canceled for customer ${customer.id}`, {
    subscriptionId: subscription.id,
    canceledAt: subscription.canceled_at,
    endsAt: subscription.current_period_end,
  });

  if (!customer.external_id) {
    console.warn('[Polar Webhook] No external_id on customer, cannot revoke limits');
    return;
  }

  const userId = parseInt(customer.external_id);

  // Set all limits to 0 (user can still see usage but can't make new requests)
  const revokedLimits = {
    claude_input_tokens: 0,
    claude_output_tokens: 0,
    gemini_images: 0,
    gemini_input_tokens: 0,
    gemini_output_tokens: 0,
  };

  await userDAO.update(userId, {
    quota_limits: JSON.stringify(revokedLimits),
    quota_limits_updated_at: new Date().toISOString(),
  });

  console.log(`[Polar Webhook] Revoked quota limits for user ${userId}`);
}

/**
 * Handle customer.state_changed event
 * Customer's overall state has changed - refresh limits if they have active subscriptions
 */
async function handleCustomerStateChanged(
  data: CustomerStateEventData,
  userDAO: UserDAO,
  polarService: PolarService
): Promise<void> {
  const { customer } = data;
  console.log(`[Polar Webhook] Customer state changed: ${customer.id}`, {
    activeSubscriptions: customer.active_subscriptions,
  });

  if (!customer.external_id) {
    console.warn('[Polar Webhook] No external_id on customer, cannot update state');
    return;
  }

  const userId = parseInt(customer.external_id);

  if (customer.active_subscriptions > 0) {
    // Has active subscriptions - refresh limits
    await fetchAndCacheLimits(userId, userDAO, polarService);
  } else {
    // No active subscriptions - revoke limits
    const revokedLimits = {
      claude_input_tokens: 0,
      claude_output_tokens: 0,
      gemini_images: 0,
      gemini_input_tokens: 0,
      gemini_output_tokens: 0,
    };

    await userDAO.update(userId, {
      quota_limits: JSON.stringify(revokedLimits),
      quota_limits_updated_at: new Date().toISOString(),
    });

    console.log(`[Polar Webhook] Revoked quota limits for user ${userId} (no active subscriptions)`);
  }
}

/**
 * Fetch meter limits from Polar API and cache in local DB
 * This is called when subscriptions become active or are updated
 *
 * @see https://docs.polar.sh/api-reference/customer-meters/list
 */
async function fetchAndCacheLimits(
  userId: number,
  userDAO: UserDAO,
  polarService: PolarService
): Promise<void> {
  try {
    // Fetch current meter credits from Polar
    const meters = await polarService.getCustomerMeters(userId);

    // Convert to limits object (use credited amount as the limit)
    const limits: Record<string, number | null> = {};
    for (const meter of meters) {
      limits[meter.meterSlug] = meter.hasLimit ? meter.credited : null;
    }

    // Update user's cached limits
    await userDAO.update(userId, {
      quota_limits: JSON.stringify(limits),
      quota_limits_updated_at: new Date().toISOString(),
    });

    console.log(`[Polar Webhook] Updated quota limits for user ${userId}:`, limits);
  } catch (error) {
    console.error(`[Polar Webhook] Failed to fetch/cache limits for user ${userId}:`, error);
    // Don't throw - webhook should still return 200
  }
}

export { webhookRoutes };
