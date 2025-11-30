import { useState, useEffect, useCallback, useRef } from 'react';
import { type MeterStatus, type BillingStatus, formatMeterName } from './useBillingStatus';

// Re-export for convenience
export { formatMeterName };
export type { MeterStatus };

// Module-level cache shared across all hook instances
let cachedData: BillingStatus | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export interface UseLimitedUsageResult {
  /** All meters from billing status */
  meters: MeterStatus[];
  /** The meter with highest percentage used (most constrained) */
  mostConstrained: MeterStatus | null;
  /** True if any meter is at or above 90% */
  isWarning: boolean;
  /** True if any meter is at or above 100% */
  isExceeded: boolean;
  /** Loading state (only true on first fetch, not cache hits) */
  isLoading: boolean;
  /** Force refresh the cache */
  refresh: () => Promise<void>;
}

/**
 * Lightweight hook for usage awareness in the header.
 * Uses module-level caching to avoid repeated API calls across components.
 *
 * @param skipInitialFetch - If true, won't fetch on mount (useful for conditional rendering)
 */
export function useLimitedUsage(skipInitialFetch = false): UseLimitedUsageResult {
  const [meters, setMeters] = useState<MeterStatus[]>(cachedData?.meters ?? []);
  const [isLoading, setIsLoading] = useState(!cachedData);
  const mountedRef = useRef(true);

  const fetchUsage = useCallback(async (force = false) => {
    const now = Date.now();

    // Use cache if valid and not forcing refresh
    if (!force && cachedData && now - cacheTimestamp < CACHE_DURATION_MS) {
      setMeters(cachedData.meters);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      const response = await fetch('/api/billing/status', {
        credentials: 'include',
      });

      if (!response.ok) {
        // Don't update cache on error, keep showing stale data if available
        return;
      }

      const data = await response.json() as BillingStatus;

      // Update module-level cache
      cachedData = data;
      cacheTimestamp = Date.now();

      if (mountedRef.current) {
        setMeters(data.meters);
      }
    } catch (err) {
      console.error('Usage fetch error:', err);
      // Keep showing cached data on error
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (!skipInitialFetch) {
      fetchUsage();
    }

    return () => {
      mountedRef.current = false;
    };
  }, [fetchUsage, skipInitialFetch]);

  // Find the most constrained meter (highest % used)
  const mostConstrained = meters.length > 0
    ? meters.reduce((max, m) => (m.percentUsed > max.percentUsed ? m : max), meters[0])
    : null;

  // Check warning/exceeded states
  const isWarning = meters.some(m => m.percentUsed >= 90);
  const isExceeded = meters.some(m => m.percentUsed >= 100);

  const refresh = useCallback(async () => {
    await fetchUsage(true);
  }, [fetchUsage]);

  return {
    meters,
    mostConstrained,
    isWarning,
    isExceeded,
    isLoading,
    refresh,
  };
}

/**
 * Invalidate the cache (call after operations that consume quota)
 * This allows the next useLimitedUsage call to fetch fresh data
 */
export function invalidateUsageCache(): void {
  cacheTimestamp = 0;
}
