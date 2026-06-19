/**
 * Usage Check Utility for SpaceDO
 *
 * Lightweight quota and rate limit checking using D1.
 * Used before triggering workflows to prevent abuse.
 */

import type { D1Database } from '@cloudflare/workers-types';
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
): Promise<void> {
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
  adminUserIds?: string
): Promise<void> {
  await trackUsage(db, userId, 'gemini_images', imageCount, { model, operation, imageSize }, adminUserIds);
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
): Promise<void> {
  await trackUsage(db, userId, 'elevenlabs_audio', quantity, {
    provider: 'elevenlabs',
    model,
    operation,
    asset_type: assetType,
    input_tokens: usage?.inputTokens,
    output_tokens: usage?.outputTokens,
    total_tokens: usage?.totalTokens,
  }, adminUserIds);
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
): Promise<void> {
  await trackUsage(db, userId, 'gemini_audio', audioCount, {
    provider: 'lyria',
    model,
    operation,
    asset_type: assetType,
    duration_ms: durationMs ?? undefined,
    input_tokens: usage?.inputTokens,
    output_tokens: usage?.outputTokens,
    total_tokens: usage?.totalTokens,
  }, adminUserIds);
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
  adminUserIds?: string
): Promise<void> {
  await trackUsage(db, userId, 'gemini_videos', getVideoQuotaUnits(videoCount, generateAudio), {
    model,
    operation,
    resolution,
    duration_seconds: durationSeconds,
    generate_audio: generateAudio === true,
    video_count: videoCount,
  }, adminUserIds);
}
