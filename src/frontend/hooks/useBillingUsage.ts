import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import type { BillingUsageMeter, BillingUsageResponse } from '../../api/types';

export type { BillingUsageMeter };
export type BillingUsage = BillingUsageResponse;

interface UseBillingUsageResult {
  usage: BillingUsage | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function calculateGeminiSpend(usage: BillingUsage | null): number {
  if (!usage) return 0;

  return Object.entries(usage.usage).reduce((total, [meterName, meter]) => {
    if (!meterName.startsWith('gemini_')) {
      return total;
    }

    const costUsd = meter.costUsd ?? 0;
    return Number.isFinite(costUsd) ? total + costUsd : total;
  }, 0);
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: amount > 0 && amount < 0.01 ? 4 : 2,
  }).format(amount);
}

export function useBillingUsage(): UseBillingUsageResult {
  const [usage, setUsage] = useState<BillingUsage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBillingUsage = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      setUsage(await apiFetch('GET /api/billing/usage'));
    } catch (err) {
      console.error('Billing usage fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load usage');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBillingUsage();
  }, [fetchBillingUsage]);

  return {
    usage,
    isLoading,
    error,
    refresh: fetchBillingUsage,
  };
}

export function formatBillingPeriod(usage: BillingUsage | null): string {
  if (!usage) return 'Current billing period';

  const start = new Date(usage.period.start);
  const end = new Date(usage.period.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return 'Current billing period';
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}
