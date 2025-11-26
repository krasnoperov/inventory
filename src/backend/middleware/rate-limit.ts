import type { Context, Next } from 'hono';
import type { Env } from '../../core/types';

interface RateLimitConfig {
  windowMs: number;  // Time window in milliseconds
  maxRequests: number;  // Max requests per window
  keyPrefix?: string;  // Optional prefix for KV keys
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Create a rate limiting middleware using KV storage
 * Falls back to allowing requests if KV is not available
 */
export function createRateLimitMiddleware(config: RateLimitConfig) {
  const { windowMs, maxRequests, keyPrefix = 'rl' } = config;

  return async (c: Context<{ Bindings: Env; Variables: { userId?: number } }>, next: Next) => {
    const kv = c.env.RATE_LIMIT_KV;

    // If KV not available, skip rate limiting
    if (!kv) {
      console.warn('RATE_LIMIT_KV not configured, skipping rate limit');
      return next();
    }

    // Get user ID from context or use IP as fallback
    const userId = c.get('userId');
    const clientId = userId
      ? `user:${userId}`
      : `ip:${c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown'}`;

    // Build the rate limit key
    const key = `${keyPrefix}:${clientId}`;
    const now = Date.now();

    try {
      // Get current rate limit entry
      const entryStr = await kv.get(key);
      let entry: RateLimitEntry;

      if (entryStr) {
        entry = JSON.parse(entryStr);

        // Check if window has expired
        if (now >= entry.resetAt) {
          // Start new window
          entry = { count: 1, resetAt: now + windowMs };
        } else {
          // Increment count
          entry.count++;
        }
      } else {
        // First request in this window
        entry = { count: 1, resetAt: now + windowMs };
      }

      // Check if rate limit exceeded
      if (entry.count > maxRequests) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);

        c.header('X-RateLimit-Limit', String(maxRequests));
        c.header('X-RateLimit-Remaining', '0');
        c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
        c.header('Retry-After', String(retryAfter));

        return c.json({
          error: 'Too many requests',
          message: `Rate limit exceeded. Please try again in ${retryAfter} seconds.`,
          retryAfter,
        }, 429);
      }

      // Store updated entry (use TTL based on window)
      const ttlSeconds = Math.ceil(windowMs / 1000);
      await kv.put(key, JSON.stringify(entry), { expirationTtl: ttlSeconds });

      // Set rate limit headers
      c.header('X-RateLimit-Limit', String(maxRequests));
      c.header('X-RateLimit-Remaining', String(maxRequests - entry.count));
      c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

      return next();
    } catch (error) {
      // If rate limiting fails, log and allow the request
      console.error('Rate limit check failed:', error);
      return next();
    }
  };
}

// Pre-configured rate limiters for different use cases
export const chatRateLimiter = createRateLimitMiddleware({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 20,     // 20 requests per minute
  keyPrefix: 'rl:chat',
});

export const suggestionRateLimiter = createRateLimitMiddleware({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30,     // 30 requests per minute
  keyPrefix: 'rl:suggest',
});

export const generationRateLimiter = createRateLimitMiddleware({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10,     // 10 generations per minute
  keyPrefix: 'rl:gen',
});
