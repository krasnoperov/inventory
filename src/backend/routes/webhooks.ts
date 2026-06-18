import { Hono } from 'hono';
import { Webhook, WebhookVerificationError } from 'standardwebhooks';
import type { AppContext } from './types';
import { UserDAO } from '../../dao/user-dao';
import { PolarService } from '../services/polarService';
import {
  isNonBillablePaidGenerationEntitlement,
  normalizePaidGenerationEntitlement,
} from '../billing/paidGenerationEntitlement';

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
    status: 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | string;
    product_id?: string;
    current_period_start?: string | null;
    current_period_end?: string | null;
    canceled_at?: string | null;
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

class WebhookPayloadError extends Error {}

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
    const rawBody = await c.req.text();
    let event: PolarWebhookEvent;

    // Verify Standard Webhooks signature if secret is configured.
    if (webhookSecret) {
      event = verifyPolarWebhook(rawBody, c.req.raw.headers, webhookSecret);
    } else {
      // No webhook secret configured - parse body directly (dev mode)
      event = parsePolarWebhookPayload(JSON.parse(rawBody));
    }

    return await handlePolarEvent(event);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      console.warn('[Polar Webhook] Invalid signature:', error.message);
      return c.json({ error: 'Invalid signature' }, 401);
    }

    if (error instanceof SyntaxError || error instanceof WebhookPayloadError) {
      console.warn('[Polar Webhook] Invalid payload:', error);
      return c.json({ error: 'Invalid payload' }, 400);
    }

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
        await handleSubscriptionCreated(normalizeSubscriptionEventData(data));
        break;

      case 'subscription.active':
        await handleSubscriptionActive(normalizeSubscriptionEventData(data), userDAO, polarService);
        break;

      case 'subscription.updated':
        await handleSubscriptionUpdated(normalizeSubscriptionEventData(data), userDAO, polarService);
        break;

      case 'subscription.canceled':
        await handleSubscriptionCanceled(normalizeSubscriptionEventData(data), userDAO, polarService);
        break;

      case 'customer.state_changed':
        await handleCustomerStateChanged(normalizeCustomerStateEventData(data), userDAO, polarService);
        break;

      default:
        console.log(`[Polar Webhook] Unhandled event type: ${type}`);
    }

    // Always return 200 to acknowledge receipt
    return c.json({ received: true });
  }
});

function verifyPolarWebhook(rawBody: string, headers: Headers, webhookSecret: string): PolarWebhookEvent {
  const webhook = new Webhook(encodeStandardWebhookSecret(webhookSecret));
  const payload = webhook.verify(rawBody, Object.fromEntries(headers.entries()));
  return parsePolarWebhookPayload(payload);
}

function encodeStandardWebhookSecret(secret: string): string {
  const bytes = new TextEncoder().encode(secret);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function parsePolarWebhookPayload(payload: unknown): PolarWebhookEvent {
  if (!isRecord(payload) || typeof payload.type !== 'string' || !('data' in payload)) {
    throw new WebhookPayloadError('Polar webhook payload must include type and data');
  }

  return {
    type: payload.type,
    data: payload.data,
  };
}

function normalizeSubscriptionEventData(data: unknown): SubscriptionEventData {
  if (!isRecord(data)) {
    throw new WebhookPayloadError('Subscription webhook data must be an object');
  }

  const nestedSubscription = isRecord(data.subscription) ? data.subscription : data;
  const nestedCustomer = isRecord(data.customer) ? data.customer : undefined;
  if (!nestedCustomer) {
    throw new WebhookPayloadError('Subscription webhook data must include customer');
  }

  return {
    customer: {
      id: requireString(nestedCustomer.id, 'customer.id'),
      email: requireString(nestedCustomer.email, 'customer.email'),
      external_id: optionalString(nestedCustomer.external_id ?? nestedCustomer.externalId),
    },
    subscription: {
      id: requireString(nestedSubscription.id, 'subscription.id'),
      status: requireString(nestedSubscription.status, 'subscription.status'),
      product_id: optionalString(nestedSubscription.product_id ?? nestedSubscription.productId),
      current_period_start: optionalDateString(nestedSubscription.current_period_start ?? nestedSubscription.currentPeriodStart),
      current_period_end: optionalDateString(nestedSubscription.current_period_end ?? nestedSubscription.currentPeriodEnd),
      canceled_at: optionalDateString(nestedSubscription.canceled_at ?? nestedSubscription.canceledAt),
    },
  };
}

function normalizeCustomerStateEventData(data: unknown): CustomerStateEventData {
  if (!isRecord(data)) {
    throw new WebhookPayloadError('Customer state webhook data must be an object');
  }

  const customer = isRecord(data.customer) ? data.customer : data;
  const activeSubscriptions = countActiveCustomerSubscriptions(data, customer);

  return {
    customer: {
      id: requireString(customer.id, 'customer.id'),
      email: requireString(customer.email, 'customer.email'),
      external_id: optionalString(customer.external_id ?? customer.externalId),
      active_subscriptions: Number.isFinite(activeSubscriptions) ? activeSubscriptions : 0,
    },
  };
}

function countActiveCustomerSubscriptions(data: Record<string, unknown>, customer: Record<string, unknown>): number {
  const activeSubscriptionSource =
    customer.active_subscriptions ??
    customer.activeSubscriptions ??
    data.active_subscriptions ??
    data.activeSubscriptions;

  if (Array.isArray(activeSubscriptionSource)) {
    return activeSubscriptionSource.length;
  }

  if (activeSubscriptionSource !== undefined && activeSubscriptionSource !== null) {
    const explicitActiveCount = Number(activeSubscriptionSource);
    return Number.isFinite(explicitActiveCount) && explicitActiveCount > 0 ? explicitActiveCount : 0;
  }

  const subscriptions = data.subscriptions;
  if (!Array.isArray(subscriptions)) {
    return 0;
  }

  return subscriptions.filter((subscription) => {
    if (!isRecord(subscription)) return false;
    const status = subscription.status;
    return status === 'active' || status === 'trialing';
  }).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new WebhookPayloadError(`Polar webhook ${field} must be a string`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalDateString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : undefined;
}

function parseExternalUserId(externalId: string | undefined, action: string): number | null {
  if (!externalId) {
    console.warn(`[Polar Webhook] No external_id on customer, cannot ${action}`);
    return null;
  }

  if (!/^\d+$/.test(externalId)) {
    console.warn(`[Polar Webhook] Invalid external_id on customer, cannot ${action}`, { externalId });
    return null;
  }

  const userId = Number.parseInt(externalId, 10);
  if (!Number.isSafeInteger(userId)) {
    console.warn(`[Polar Webhook] external_id exceeds safe integer range, cannot ${action}`, { externalId });
    return null;
  }

  return userId;
}

function isFutureDate(value: string | null | undefined, now = new Date()): boolean {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

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

  const userId = parseExternalUserId(customer.external_id, 'update local limits');
  if (userId === null) return;

  await fetchAndCacheLimits(userId, userDAO, polarService, {
    periodStart: subscription.current_period_start ?? null,
    periodEnd: subscription.current_period_end ?? null,
    paidAccessExpiresAt: null,
  });
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

  // Only refresh limits if subscription is still active
  if (subscription.status === 'active') {
    const userId = parseExternalUserId(customer.external_id, 'update local limits');
    if (userId === null) return;

    await fetchAndCacheLimits(userId, userDAO, polarService, {
      periodStart: subscription.current_period_start ?? null,
      periodEnd: subscription.current_period_end ?? null,
      paidAccessExpiresAt: subscription.canceled_at && isFutureDate(subscription.current_period_end)
        ? subscription.current_period_end ?? null
        : null,
    });
  }
}

/**
 * Handle subscription.canceled event
 * The subscription has been canceled - revoke quota limits
 */
async function handleSubscriptionCanceled(
  data: SubscriptionEventData,
  userDAO: UserDAO,
  polarService: PolarService
): Promise<void> {
  const { customer, subscription } = data;
  console.log(`[Polar Webhook] Subscription canceled for customer ${customer.id}`, {
    subscriptionId: subscription.id,
    status: subscription.status,
    canceledAt: subscription.canceled_at,
    endsAt: subscription.current_period_end,
  });

  const userId = parseExternalUserId(customer.external_id, 'revoke limits');
  if (userId === null) return;

  const graceEndsAt = isFutureDate(subscription.current_period_end)
    ? subscription.current_period_end ?? null
    : null;
  if (
    subscription.status === 'active' ||
    subscription.status === 'trialing' ||
    graceEndsAt !== null
  ) {
    await fetchAndCacheLimits(userId, userDAO, polarService, {
      periodStart: subscription.current_period_start ?? null,
      periodEnd: subscription.current_period_end ?? null,
      paidAccessExpiresAt: graceEndsAt,
    });
    return;
  }

  // Set all limits to 0 (user can still see usage but can't make new requests)
  const revokedLimits = {
    claude_input_tokens: 0,
    claude_output_tokens: 0,
    gemini_images: 0,
    gemini_videos: 0,
    gemini_audio: 0,
    gemini_input_tokens: 0,
    gemini_output_tokens: 0,
    elevenlabs_audio: 0,
  };

  if (await shouldPreserveInternalEntitlement(userId, userDAO, 'revoke limits')) return;

  await userDAO.update(userId, {
    paid_generation_entitlement: 'none',
    quota_limits: JSON.stringify(revokedLimits),
    quota_limits_updated_at: new Date().toISOString(),
    polar_current_period_start: null,
    polar_current_period_end: null,
    polar_paid_access_expires_at: null,
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

  const userId = parseExternalUserId(customer.external_id, 'update state');
  if (userId === null) return;

  if (customer.active_subscriptions > 0) {
    // Has active subscriptions - refresh limits
    await fetchAndCacheLimits(userId, userDAO, polarService);
  } else {
    // No active subscriptions - revoke limits
    const revokedLimits = {
      claude_input_tokens: 0,
      claude_output_tokens: 0,
      gemini_images: 0,
      gemini_videos: 0,
      gemini_audio: 0,
      gemini_input_tokens: 0,
      gemini_output_tokens: 0,
      elevenlabs_audio: 0,
    };

    if (await shouldPreserveInternalEntitlement(userId, userDAO, 'revoke limits')) return;

    await userDAO.update(userId, {
      paid_generation_entitlement: 'none',
      quota_limits: JSON.stringify(revokedLimits),
      quota_limits_updated_at: new Date().toISOString(),
      polar_current_period_start: null,
      polar_current_period_end: null,
      polar_paid_access_expires_at: null,
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
  polarService: PolarService,
  period: {
    periodStart?: string | null;
    periodEnd?: string | null;
    paidAccessExpiresAt?: string | null;
  } = {}
): Promise<void> {
  try {
    if (await shouldPreserveInternalEntitlement(userId, userDAO, 'update local limits')) return;

    // Fetch current meter credits from Polar
    const meters = await polarService.getCustomerMeters(userId);
    if (meters.length === 0) {
      if ('paidAccessExpiresAt' in period && period.paidAccessExpiresAt) {
        const update = {
          paid_generation_entitlement: 'paid',
        } as Parameters<UserDAO['update']>[1];

        if ('periodStart' in period) {
          update.polar_current_period_start = period.periodStart ?? null;
        }
        if ('periodEnd' in period) {
          update.polar_current_period_end = period.periodEnd ?? null;
        }
        update.polar_paid_access_expires_at = period.paidAccessExpiresAt;

        await userDAO.update(userId, update);
        console.warn(
          `[Polar Webhook] Preserved cached quota limits for user ${userId}; ` +
          'updated scheduled-cancellation access expiry without meter refresh'
        );
        return;
      }

      throw new Error('No Polar customer meters returned; preserving cached quota limits');
    }

    // Convert to limits object (use credited amount as the limit)
    const limits: Record<string, number | null> = {};
    for (const meter of meters) {
      limits[meter.meterSlug] = meter.hasLimit ? meter.credited : null;
    }

    // Update user's cached limits
    const update = {
      paid_generation_entitlement: 'paid',
      quota_limits: JSON.stringify(limits),
      quota_limits_updated_at: new Date().toISOString(),
    } as Parameters<UserDAO['update']>[1];

    if ('periodStart' in period) {
      update.polar_current_period_start = period.periodStart ?? null;
    }
    if ('periodEnd' in period) {
      update.polar_current_period_end = period.periodEnd ?? null;
    }
    if ('paidAccessExpiresAt' in period) {
      update.polar_paid_access_expires_at = period.paidAccessExpiresAt ?? null;
    }

    await userDAO.update(userId, update);

    console.log(`[Polar Webhook] Updated quota limits for user ${userId}:`, limits);
  } catch (error) {
    console.error(`[Polar Webhook] Failed to fetch/cache limits for user ${userId}:`, error);
    // Don't throw - webhook should still return 200
  }
}

async function shouldPreserveInternalEntitlement(
  userId: number,
  userDAO: UserDAO,
  action: string
): Promise<boolean> {
  const user = await userDAO.findById(userId);
  const entitlement = normalizePaidGenerationEntitlement(user?.paid_generation_entitlement);
  if (!isNonBillablePaidGenerationEntitlement(entitlement)) {
    return false;
  }

  console.log(`[Polar Webhook] Preserving internal entitlement for user ${userId}; skipping ${action}`);
  return true;
}

export { webhookRoutes };
