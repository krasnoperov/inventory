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
  denyReason?: GenerationLimitDenyReason;
  denyMessage?: string;
}

export type GenerationLimitDenyReason =
  | 'quota_exceeded'
  | 'platform_limit_exceeded'
  | 'rate_limited'
  | 'paid_generation_required'
  | 'provider_key_required';

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

type GenerationBillingService = keyof typeof QUOTA_EVENT_NAMES;

type GenerationGuardrailMode = 'managed' | 'byok';

type GuardrailUsageScope = 'user' | 'space';

export interface PlatformGuardrailUsage {
  usageType: 'storage' | 'workflow' | 'delivery';
  quantity: number;
  scope?: GuardrailUsageScope;
}

export interface GenerationGuardrailCheckInput {
  userId: number;
  spaceId: string;
  mode: GenerationGuardrailMode;
  service: GenerationBillingService;
  requestedRateLimitQuantity?: number;
  requestedProviderCostMicroUsd?: number;
  requestedPlatformUsage?: PlatformGuardrailUsage[];
  mediaKind?: 'image' | 'audio' | 'video' | null;
  adminUserIds?: string;
  now?: Date;
}

export interface GenerationGuardrailCheckResult {
  allowed: boolean;
  denyReason?: GenerationLimitDenyReason;
  denyMessage?: string;
  limitKey?: string;
  used?: number;
  limit?: number;
  requested?: number;
}

const MANAGED_PROVIDER_SPEND_LIMIT_KEY = 'managed_provider_spend_micro_usd';
const MANAGED_PROVIDER_DAILY_SPEND_LIMIT_KEY = 'managed_provider_spend_daily_micro_usd';
const PLATFORM_LIMIT_KEYS = {
  user: {
    storage: 'platform_storage_bytes',
    workflow: 'platform_workflow_runs',
    delivery: 'platform_delivery_bytes',
  },
  space: {
    storage: 'space_platform_storage_bytes',
    workflow: 'space_platform_workflow_runs',
    delivery: 'space_platform_delivery_bytes',
  },
} as const;
const VIDEO_WORKFLOW_LIMIT_KEYS = {
  userPeriod: 'video_workflow_runs',
  userDaily: 'video_workflow_runs_daily',
  spacePeriod: 'space_video_workflow_runs',
  spaceDaily: 'space_video_workflow_runs_daily',
} as const;

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

function getDayBounds(now: Date): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function parseQuotaLimits(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function getPlanLimit(
  limits: Record<string, unknown>,
  key: string,
  internal: boolean
): { key: string; value: number } | null {
  const internalKey = `internal_${key}`;
  const raw = internal && Object.prototype.hasOwnProperty.call(limits, internalKey)
    ? limits[internalKey]
    : internal
      ? undefined
      : limits[key];
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return { key: internal && Object.prototype.hasOwnProperty.call(limits, internalKey) ? internalKey : key, value };
}

async function sumProviderSpend(
  db: D1Database,
  userId: number,
  from: string,
  to: string | null
): Promise<number> {
  const sql = to
    ? `
      SELECT COALESCE(SUM(COALESCE(amount_micro_usd, 0)), 0) AS total
      FROM provider_usage_ledger
      WHERE user_id = ? AND created_at >= ? AND created_at < ?
    `
    : `
      SELECT COALESCE(SUM(COALESCE(amount_micro_usd, 0)), 0) AS total
      FROM provider_usage_ledger
      WHERE user_id = ? AND created_at >= ?
    `;
  const bindings = to ? [userId, from, to] : [userId, from];
  const row = await db.prepare(sql).bind(...bindings).first<{ total: number }>();
  return Number(row?.total) || 0;
}

async function sumPlatformUsage(
  db: D1Database,
  input: {
    userId: number;
    spaceId: string;
    scope: GuardrailUsageScope;
    usageType: 'storage' | 'workflow' | 'delivery';
    from: string;
    to: string | null;
    mediaKind?: 'image' | 'audio' | 'video' | null;
  }
): Promise<number> {
  const subjectWhere = input.scope === 'space' ? 'space_id = ?' : 'user_id = ?';
  const subjectValue = input.scope === 'space' ? input.spaceId : input.userId;
  const mediaWhere = input.mediaKind ? ' AND media_kind = ?' : '';
  const toWhere = input.to ? ' AND created_at < ?' : '';
  const bindings: unknown[] = [
    subjectValue,
    input.usageType,
    input.from,
  ];
  if (input.to) bindings.push(input.to);
  if (input.mediaKind) bindings.push(input.mediaKind);

  const row = await db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS total
    FROM platform_usage_events
    WHERE ${subjectWhere}
      AND usage_type = ?
      AND created_at >= ?
      ${toWhere}
      ${mediaWhere}
  `).bind(...bindings).first<{ total: number }>();
  return Number(row?.total) || 0;
}

function denyGuardrail(input: {
  denyReason: GenerationLimitDenyReason;
  denyMessage: string;
  limitKey: string;
  used: number;
  requested: number;
  limit: number;
}): GenerationGuardrailCheckResult {
  return {
    allowed: false,
    denyReason: input.denyReason,
    denyMessage: input.denyMessage,
    limitKey: input.limitKey,
    used: input.used,
    requested: input.requested,
    limit: input.limit,
  };
}

async function checkPlatformLimit(
  db: D1Database,
  input: GenerationGuardrailCheckInput,
  limitKey: string,
  requested: number,
  period: { start: string; end: string | null },
  limits: Record<string, unknown>,
  internal: boolean,
  scope: GuardrailUsageScope,
  usageType: 'storage' | 'workflow' | 'delivery',
  mediaKind?: 'image' | 'audio' | 'video' | null,
): Promise<GenerationGuardrailCheckResult | null> {
  const limit = getPlanLimit(limits, limitKey, internal);
  if (!limit || requested <= 0) return null;

  const used = await sumPlatformUsage(db, {
    userId: input.userId,
    spaceId: input.spaceId,
    scope,
    usageType,
    from: period.start,
    to: period.end,
    mediaKind,
  });
  if (used + requested <= limit.value) return null;

  return denyGuardrail({
    denyReason: 'platform_limit_exceeded',
    denyMessage: `Platform ${usageType} limit exceeded.`,
    limitKey: limit.key,
    used,
    requested,
    limit: limit.value,
  });
}

export async function checkGenerationGuardrails(
  db: D1Database,
  input: GenerationGuardrailCheckInput
): Promise<GenerationGuardrailCheckResult> {
  const now = input.now ?? new Date();
  const user = await db.prepare(`
    SELECT
      paid_generation_entitlement,
      quota_limits,
      polar_current_period_start,
      polar_current_period_end,
      rate_limit_count,
      rate_limit_window_start
    FROM users WHERE id = ?
  `).bind(input.userId).first<{
    paid_generation_entitlement: string | null;
    quota_limits: string | null;
    polar_current_period_start: string | null;
    polar_current_period_end: string | null;
    rate_limit_count: number | null;
    rate_limit_window_start: string | null;
  }>();

  if (!user) {
    return denyGuardrail({
      denyReason: 'quota_exceeded',
      denyMessage: 'User not found',
      limitKey: 'user',
      used: 0,
      requested: 1,
      limit: 0,
    });
  }

  const entitlement = resolveEntitlement(user.paid_generation_entitlement, input.userId, input.adminUserIds);
  const internal = isNonBillablePaidGenerationEntitlement(entitlement);
  const limits = parseQuotaLimits(user.quota_limits);
  const period = getUsagePeriodBounds(now, user.polar_current_period_start, user.polar_current_period_end);
  const requestedProviderCost = Math.max(0, Math.trunc(input.requestedProviderCostMicroUsd ?? 0));
  const requestedRate = Math.max(0, Math.trunc(input.requestedRateLimitQuantity ?? 0));

  if (requestedRate > 0) {
    const rateLimitConfig = DEFAULT_RATE_LIMITS[input.service];
    const windowStart = new Date(now.getTime() - rateLimitConfig.windowSeconds * 1000).toISOString();
    const windowExpired = !user.rate_limit_window_start || user.rate_limit_window_start < windowStart;
    const rateLimitUsed = windowExpired ? 0 : (user.rate_limit_count || 0);
    if (rateLimitUsed + requestedRate > rateLimitConfig.maxRequests) {
      return denyGuardrail({
        denyReason: 'rate_limited',
        denyMessage: `Too many requests. Please wait ${rateLimitConfig.windowSeconds} seconds.`,
        limitKey: `${input.service}_rate_limit`,
        used: rateLimitUsed,
        requested: requestedRate,
        limit: rateLimitConfig.maxRequests,
      });
    }
  }

  if (input.mode === 'managed' && requestedProviderCost > 0) {
    const periodLimit = getPlanLimit(limits, MANAGED_PROVIDER_SPEND_LIMIT_KEY, internal);
    if (periodLimit) {
      const used = await sumProviderSpend(db, input.userId, period.start, period.end);
      if (used + requestedProviderCost > periodLimit.value) {
        return denyGuardrail({
          denyReason: 'quota_exceeded',
          denyMessage: 'Managed provider spend cap exceeded.',
          limitKey: periodLimit.key,
          used,
          requested: requestedProviderCost,
          limit: periodLimit.value,
        });
      }
    }

    const dailyLimit = getPlanLimit(limits, MANAGED_PROVIDER_DAILY_SPEND_LIMIT_KEY, internal);
    if (dailyLimit) {
      const day = getDayBounds(now);
      const used = await sumProviderSpend(db, input.userId, day.start, day.end);
      if (used + requestedProviderCost > dailyLimit.value) {
        return denyGuardrail({
          denyReason: 'quota_exceeded',
          denyMessage: 'Daily managed provider spend cap exceeded.',
          limitKey: dailyLimit.key,
          used,
          requested: requestedProviderCost,
          limit: dailyLimit.value,
        });
      }
    }
  }

  for (const usage of input.requestedPlatformUsage ?? []) {
    const requested = Math.max(0, Math.trunc(usage.quantity));
    const scopes: GuardrailUsageScope[] = usage.scope ? [usage.scope] : ['user', 'space'];
    for (const scope of scopes) {
      const result = await checkPlatformLimit(
        db,
        input,
        PLATFORM_LIMIT_KEYS[scope][usage.usageType],
        requested,
        period,
        limits,
        internal,
        scope,
        usage.usageType,
      );
      if (result) return result;
    }
  }

  if (input.mediaKind === 'video') {
    const videoRunRequest = (input.requestedPlatformUsage ?? [])
      .filter((usage) => usage.usageType === 'workflow')
      .reduce((sum, usage) => sum + Math.max(0, Math.trunc(usage.quantity)), 0);
    if (videoRunRequest > 0) {
      const userPeriod = await checkPlatformLimit(
        db, input, VIDEO_WORKFLOW_LIMIT_KEYS.userPeriod, videoRunRequest, period, limits, internal, 'user', 'workflow', 'video'
      );
      if (userPeriod) return userPeriod;

      const spacePeriod = await checkPlatformLimit(
        db, input, VIDEO_WORKFLOW_LIMIT_KEYS.spacePeriod, videoRunRequest, period, limits, internal, 'space', 'workflow', 'video'
      );
      if (spacePeriod) return spacePeriod;

      const day = getDayBounds(now);
      const dailyPeriod = { start: day.start, end: day.end };
      const userDaily = await checkPlatformLimit(
        db, input, VIDEO_WORKFLOW_LIMIT_KEYS.userDaily, videoRunRequest, dailyPeriod, limits, internal, 'user', 'workflow', 'video'
      );
      if (userDaily) return userDaily;

      const spaceDaily = await checkPlatformLimit(
        db, input, VIDEO_WORKFLOW_LIMIT_KEYS.spaceDaily, videoRunRequest, dailyPeriod, limits, internal, 'space', 'workflow', 'video'
      );
      if (spaceDaily) return spaceDaily;
    }
  }

  return { allowed: true };
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
