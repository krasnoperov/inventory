/**
 * Usage Check Utility for SpaceDO
 *
 * Lightweight quota and rate limit checking using D1.
 * Used before triggering workflows to prevent abuse.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { priceProviderUsageEvent } from '../../../billing/providerPricing';
import {
  buildCustomerChargeKey,
  inferCustomerChargeUnit,
} from '../../../billing/customerChargeLedger';
import {
  hasPaidGenerationAccess,
  isPaidGenerationAccessExpired,
  isNonBillablePaidGenerationEntitlement,
  normalizePaidGenerationEntitlement,
  resolveEntitlement,
  PAID_GENERATION_REQUIRED_MESSAGE,
} from '../../../billing/paidGenerationEntitlement';

export interface PreCheckResult {
  allowed: boolean;
  quotaUsed: number;
  quotaLimit: number | null;
  quotaRemaining: number | null;
  rateLimitUsed: number;
  rateLimitMax: number;
  rateLimitRemaining: number;
  denyReason?: 'quota_exceeded' | 'rate_limited' | 'paid_generation_required';
  denyMessage?: string;
}

export interface RateLimitConfig {
  windowSeconds: number;
  maxRequests: number;
}

// Default rate limits per service
const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  claude: { windowSeconds: 60, maxRequests: 20 },
  nanobanana: { windowSeconds: 60, maxRequests: 10 },
  lyria: { windowSeconds: 60, maxRequests: 10 },
  elevenlabs: { windowSeconds: 60, maxRequests: 10 },
  veo: { windowSeconds: 60, maxRequests: 10 },
};

// Event names for quota checking
const QUOTA_EVENT_NAMES: Record<string, string> = {
  claude: 'claude_output_tokens',
  nanobanana: 'gemini_images',
  lyria: 'gemini_audio',
  elevenlabs: 'elevenlabs_audio',
  veo: 'gemini_videos',
};

export const VIDEO_WITH_AUDIO_QUOTA_UNITS = 2;

export function getVideoQuotaUnits(videoCount: number, generateAudio = true): number {
  return videoCount * (generateAudio ? VIDEO_WITH_AUDIO_QUOTA_UNITS : 1);
}

export interface UsageTrackingResult {
  usageEventId: string;
  eventName: string;
  quantity: number;
  metadata: Record<string, unknown> | undefined;
  createdAt: string;
}

export interface ProviderUsageAttribution {
  spaceId: string;
  assetId?: string | null;
  variantId?: string | null;
  workflowId?: string | null;
  requestId?: string | null;
  provider?: string | null;
  providerModel?: string | null;
  providerRequestId?: string | null;
  providerResponseId?: string | null;
  providerUsageId?: string | null;
  mediaKind?: 'image' | 'audio' | 'video' | null;
}

function isUsableIsoDate(value: string | null | undefined): value is string {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function getUsagePeriodBounds(now: Date, periodStart?: string | null, periodEnd?: string | null): {
  start: string;
  end: string | null;
} {
  const calendarStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  return {
    start: isUsableIsoDate(periodStart) ? periodStart : calendarStart,
    end: isUsableIsoDate(periodEnd) ? periodEnd : null,
  };
}

/**
 * Pre-check quota and rate limits before performing a limited action.
 * Uses D1 for fast local checks.
 */
export async function preCheck(
  db: D1Database,
  userId: number,
  service: 'claude' | 'nanobanana' | 'lyria' | 'elevenlabs' | 'veo',
  rateLimit?: RateLimitConfig,
  requestedQuantity = 1,
  rateLimitQuantity = 1,
  adminUserIds?: string
): Promise<PreCheckResult> {
  const eventName = QUOTA_EVENT_NAMES[service];
  const rateLimitConfig = rateLimit || DEFAULT_RATE_LIMITS[service];
  const requested = Math.max(1, Math.floor(requestedQuantity));
  const rateRequested = Math.max(1, Math.floor(rateLimitQuantity));

  const now = new Date();

  // Get user quota limits and rate limit state
  const userResult = await db.prepare(`
    SELECT
      paid_generation_entitlement,
      quota_limits,
      polar_current_period_start,
      polar_current_period_end,
      polar_paid_access_expires_at,
      rate_limit_count,
      rate_limit_window_start
    FROM users WHERE id = ?
  `).bind(userId).first<{
    paid_generation_entitlement: string | null;
    quota_limits: string | null;
    polar_current_period_start: string | null;
    polar_current_period_end: string | null;
    polar_paid_access_expires_at: string | null;
    rate_limit_count: number | null;
    rate_limit_window_start: string | null;
  }>();

  if (!userResult) {
    return {
      allowed: false,
      quotaUsed: 0,
      quotaLimit: null,
      quotaRemaining: null,
      rateLimitUsed: 0,
      rateLimitMax: rateLimitConfig.maxRequests,
      rateLimitRemaining: 0,
      denyReason: 'quota_exceeded',
      denyMessage: 'User not found',
    };
  }

  // Get usage for current period
  const usagePeriod = getUsagePeriodBounds(
    now,
    userResult.polar_current_period_start,
    userResult.polar_current_period_end
  );
  const usageSql = usagePeriod.end
    ? `
      SELECT COALESCE(SUM(quantity), 0) as total_used
      FROM usage_events
      WHERE user_id = ? AND event_name = ? AND created_at >= ? AND created_at < ? AND polar_billable = 1
    `
    : `
      SELECT COALESCE(SUM(quantity), 0) as total_used
      FROM usage_events
      WHERE user_id = ? AND event_name = ? AND created_at >= ? AND polar_billable = 1
    `;
  const usageBindings = usagePeriod.end
    ? [userId, eventName, usagePeriod.start, usagePeriod.end]
    : [userId, eventName, usagePeriod.start];
  const usageResult = await db.prepare(usageSql).bind(...usageBindings).first<{ total_used: number }>();

  const quotaUsed = usageResult?.total_used || 0;

  const entitlement = resolveEntitlement(userResult.paid_generation_entitlement, userId, adminUserIds);
  const isNonBillable = isNonBillablePaidGenerationEntitlement(entitlement);

  // Check rate limit (fixed window)
  const windowStart = new Date(now.getTime() - rateLimitConfig.windowSeconds * 1000).toISOString();
  const windowExpired = !userResult.rate_limit_window_start ||
    userResult.rate_limit_window_start < windowStart;
  const rateLimitUsed = windowExpired ? 0 : (userResult.rate_limit_count || 0);
  const rateLimitRemaining = Math.max(0, rateLimitConfig.maxRequests - rateLimitUsed);

  if (
    !hasPaidGenerationAccess(entitlement) ||
    isPaidGenerationAccessExpired(entitlement, userResult.polar_paid_access_expires_at, now)
  ) {
    return {
      allowed: false,
      quotaUsed,
      quotaLimit: null,
      quotaRemaining: null,
      rateLimitUsed,
      rateLimitMax: rateLimitConfig.maxRequests,
      rateLimitRemaining,
      denyReason: 'paid_generation_required',
      denyMessage: PAID_GENERATION_REQUIRED_MESSAGE,
    };
  }

  // Parse quota limits. Internal users are explicitly non-billable, so they
  // bypass quota while still using the fixed-window rate limiter below.
  const limits: Record<string, number | null> = userResult.quota_limits && !isNonBillable
    ? JSON.parse(userResult.quota_limits)
    : {};
  const quotaLimit = isNonBillable ? null : (limits[eventName] ?? null);
  const quotaRemaining = quotaLimit !== null ? Math.max(0, quotaLimit - quotaUsed) : null;

  // Check quota exceeded
  if (quotaLimit !== null && quotaUsed + requested > quotaLimit) {
    return {
      allowed: false,
      quotaUsed,
      quotaLimit,
      quotaRemaining: 0,
      rateLimitUsed,
      rateLimitMax: rateLimitConfig.maxRequests,
      rateLimitRemaining,
      denyReason: 'quota_exceeded',
      denyMessage: `Monthly quota exceeded for ${service}. Please upgrade your plan.`,
    };
  }

  // Check rate limit exceeded
  if (rateLimitUsed + rateRequested > rateLimitConfig.maxRequests) {
    return {
      allowed: false,
      quotaUsed,
      quotaLimit,
      quotaRemaining,
      rateLimitUsed,
      rateLimitMax: rateLimitConfig.maxRequests,
      rateLimitRemaining: 0,
      denyReason: 'rate_limited',
      denyMessage: `Too many requests. Please wait ${rateLimitConfig.windowSeconds} seconds.`,
    };
  }

  return {
    allowed: true,
    quotaUsed,
    quotaLimit,
    quotaRemaining,
    rateLimitUsed,
    rateLimitMax: rateLimitConfig.maxRequests,
    rateLimitRemaining: Math.max(0, rateLimitRemaining - rateRequested),
  };
}

/**
 * Increment rate limit counter after successful preCheck.
 */
export async function incrementRateLimit(db: D1Database, userId: number, amount = 1): Promise<void> {
  const now = new Date().toISOString();
  const incrementBy = Math.max(1, Math.floor(amount));

  await db.prepare(`
    UPDATE users SET
      rate_limit_count = CASE
        WHEN rate_limit_window_start IS NULL OR rate_limit_window_start < datetime('now', '-60 seconds')
        THEN ?
        ELSE rate_limit_count + ?
      END,
      rate_limit_window_start = CASE
        WHEN rate_limit_window_start IS NULL OR rate_limit_window_start < datetime('now', '-60 seconds')
        THEN ?
        ELSE rate_limit_window_start
      END
    WHERE id = ?
  `).bind(incrementBy, incrementBy, now, userId).run();
}

/**
 * Track successful usage event.
 * Called AFTER workflow completes successfully.
 */
export async function trackUsage(
  db: D1Database,
  userId: number,
  eventName: string,
  quantity: number,
  metadata?: Record<string, unknown>,
  adminUserIds?: string
): Promise<UsageTrackingResult> {
  const polarBillable = await isBillableUser(db, userId, adminUserIds);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO usage_events (id, user_id, event_name, quantity, metadata, polar_billable, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    userId,
    eventName,
    quantity,
    metadata ? JSON.stringify(metadata) : null,
    polarBillable ? 1 : 0,
    now
  ).run();

  await db.prepare(`
    INSERT OR IGNORE INTO customer_charge_ledger (
      id,
      charge_key,
      usage_event_id,
      provider_usage_ledger_id,
      user_id,
      meter_event_name,
      charge_unit,
      quantity,
      polar_billable,
      billing_external_id,
      customer_amount_micro_usd,
      metadata,
      created_at
    )
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).bind(
    crypto.randomUUID(),
    buildCustomerChargeKey(id),
    id,
    userId,
    eventName,
    inferCustomerChargeUnit(eventName),
    quantity,
    polarBillable ? 1 : 0,
    id,
    metadata ? JSON.stringify(metadata) : null,
    now
  ).run();

  return {
    usageEventId: id,
    eventName,
    quantity,
    metadata,
    createdAt: now,
  };
}

async function trackProviderUsageLedger(
  db: D1Database,
  userId: number,
  usage: UsageTrackingResult,
  attribution?: ProviderUsageAttribution
): Promise<void> {
  if (!attribution) return;

  const customProvider = attribution.provider === 'custom';
  const price = customProvider
    ? null
    : priceProviderUsageEvent({
      eventName: usage.eventName,
      quantity: usage.quantity,
      metadata: usage.metadata,
    });
  const provider = customProvider
    ? 'custom'
    : price?.provider ?? inferProviderFromEventName(usage.eventName);
  const providerModel = customProvider
    ? attribution.providerModel ?? getMetadataString(usage.metadata, 'model') ?? 'unknown'
    : price?.model ?? getMetadataString(usage.metadata, 'model') ?? 'unknown';
  const usageUnit = price?.unit ?? inferUsageUnitFromEventName(usage.eventName);
  const attributionKey = buildProviderUsageAttributionKey(usage, attribution);
  const providerUsageLedgerId = crypto.randomUUID();
  const metadata = {
    ...usage.metadata,
    provider: attribution.provider ?? undefined,
    provider_model: attribution.providerModel ?? undefined,
    catalog_version: price?.catalogVersion,
    pricing_status: !price || 'reason' in price ? 'miss' : 'priced',
    pricing_reason: !price ? 'unsupported_provider' : ('reason' in price ? price.reason : undefined),
    rate_table: price && 'rateTable' in price ? price.rateTable : undefined,
  };

  await db.prepare(`
    INSERT OR IGNORE INTO provider_usage_ledger (
      id,
      attribution_key,
      usage_event_id,
      user_id,
      space_id,
      asset_id,
      variant_id,
      workflow_id,
      request_id,
      provider,
      provider_model,
      operation,
      media_kind,
      meter_event_name,
      usage_unit,
      quantity,
      unit_price_usd,
      amount_micro_usd,
      currency,
      pricing_source,
      provider_request_id,
      provider_response_id,
      provider_usage_id,
      metadata,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?)
  `).bind(
    providerUsageLedgerId,
    attributionKey,
    usage.usageEventId,
    userId,
    attribution.spaceId,
    attribution.assetId ?? null,
    attribution.variantId ?? null,
    attribution.workflowId ?? null,
    attribution.requestId ?? null,
    provider,
    providerModel,
    getMetadataString(usage.metadata, 'operation'),
    attribution.mediaKind ?? null,
    usage.eventName,
    usageUnit,
    price?.quantity ?? usage.quantity,
    price && 'unitPriceUsd' in price ? price.unitPriceUsd : null,
    price?.amountMicroUsd ?? 0,
    price && 'pricingSource' in price ? price.pricingSource : null,
    attribution.providerRequestId ?? null,
    attribution.providerResponseId ?? null,
    attribution.providerUsageId ?? null,
    JSON.stringify(metadata),
    usage.createdAt
  ).run();

  await db.prepare(`
    UPDATE customer_charge_ledger
    SET provider_usage_ledger_id = (
      SELECT id FROM provider_usage_ledger WHERE attribution_key = ?
    )
    WHERE usage_event_id = ?
      AND provider_usage_ledger_id IS NULL
  `).bind(attributionKey, usage.usageEventId).run();
}

function buildProviderUsageAttributionKey(
  usage: UsageTrackingResult,
  attribution: ProviderUsageAttribution
): string {
  if (attribution.workflowId) {
    return `workflow:${attribution.workflowId}:meter:${usage.eventName}`;
  }
  if (attribution.variantId) {
    return `variant:${attribution.variantId}:meter:${usage.eventName}`;
  }
  return `usage_event:${usage.usageEventId}`;
}

function inferProviderFromEventName(eventName: string): string {
  if (eventName.startsWith('elevenlabs_')) return 'elevenlabs';
  if (eventName.startsWith('claude_')) return 'claude';
  return 'gemini';
}

function inferUsageUnitFromEventName(eventName: string): string {
  if (eventName === 'gemini_images') return 'image';
  if (eventName === 'gemini_videos') return 'video';
  if (eventName === 'gemini_audio' || eventName === 'elevenlabs_audio') return 'generation';
  if (eventName.endsWith('_tokens')) return 'token';
  return eventName;
}

function getMetadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function isBillableUser(db: D1Database, userId: number, adminUserIds?: string): Promise<boolean> {
  const userResult = await db.prepare(`
    SELECT paid_generation_entitlement
    FROM users WHERE id = ?
  `).bind(userId).first<{ paid_generation_entitlement: string | null }>();

  const entitlement = resolveEntitlement(
    normalizePaidGenerationEntitlement(userResult?.paid_generation_entitlement),
    userId,
    adminUserIds
  );
  return !isNonBillablePaidGenerationEntitlement(entitlement);
}

/**
 * Track Claude usage (input + output tokens).
 */
export async function trackClaudeUsage(
  db: D1Database,
  userId: number,
  inputTokens: number,
  outputTokens: number,
  model: string,
  requestId?: string,
  adminUserIds?: string
): Promise<void> {
  const metadata = { model, request_id: requestId };

  if (inputTokens > 0) {
    await trackUsage(db, userId, 'claude_input_tokens', inputTokens, { ...metadata, token_type: 'input' }, adminUserIds);
  }

  if (outputTokens > 0) {
    await trackUsage(db, userId, 'claude_output_tokens', outputTokens, { ...metadata, token_type: 'output' }, adminUserIds);
  }
}

/**
 * Track Gemini image generation.
 */
export async function trackImageGeneration(
  db: D1Database,
  userId: number,
  imageCount: number,
  model: string,
  operation?: string,
  imageSize?: string,
  adminUserIds?: string,
  attribution?: ProviderUsageAttribution
): Promise<UsageTrackingResult> {
  const usage = await trackUsage(db, userId, 'gemini_images', imageCount, { model, operation, imageSize }, adminUserIds);
  await trackProviderUsageLedger(db, userId, usage, attribution);
  return usage;
}

/**
 * Track ElevenLabs audio generation.
 */
export async function trackElevenLabsAudioGeneration(
  db: D1Database,
  userId: number,
  quantity: number,
  model: string,
  operation?: string,
  assetType?: string,
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number },
  adminUserIds?: string,
  attribution?: ProviderUsageAttribution,
): Promise<UsageTrackingResult> {
  const trackedUsage = await trackUsage(db, userId, 'elevenlabs_audio', quantity, {
    provider: 'elevenlabs',
    model,
    operation,
    asset_type: assetType,
    input_tokens: usage?.inputTokens,
    output_tokens: usage?.outputTokens,
    total_tokens: usage?.totalTokens,
  }, adminUserIds);
  await trackProviderUsageLedger(db, userId, trackedUsage, attribution);
  return trackedUsage;
}

/**
 * Track Lyria music generation as Gemini audio.
 */
export async function trackGeminiAudioGeneration(
  db: D1Database,
  userId: number,
  audioCount: number,
  model: string,
  operation?: string,
  assetType?: string,
  durationMs?: number | null,
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number },
  adminUserIds?: string,
  attribution?: ProviderUsageAttribution,
): Promise<UsageTrackingResult> {
  const trackedUsage = await trackUsage(db, userId, 'gemini_audio', audioCount, {
    provider: 'lyria',
    model,
    operation,
    asset_type: assetType,
    duration_ms: durationMs ?? undefined,
    input_tokens: usage?.inputTokens,
    output_tokens: usage?.outputTokens,
    total_tokens: usage?.totalTokens,
  }, adminUserIds);
  await trackProviderUsageLedger(db, userId, trackedUsage, attribution);
  return trackedUsage;
}

/**
 * Track Gemini/Veo video generation.
 */
export async function trackVideoGeneration(
  db: D1Database,
  userId: number,
  videoCount: number,
  model: string,
  operation?: string,
  resolution?: string,
  durationSeconds?: number,
  generateAudio = true,
  adminUserIds?: string,
  attribution?: ProviderUsageAttribution
): Promise<UsageTrackingResult> {
  const usage = await trackUsage(db, userId, 'gemini_videos', getVideoQuotaUnits(videoCount, generateAudio), {
    model,
    operation,
    resolution,
    duration_seconds: durationSeconds,
    generate_audio: generateAudio === true,
    video_count: videoCount,
  }, adminUserIds);
  await trackProviderUsageLedger(db, userId, usage, attribution);
  return usage;
}
