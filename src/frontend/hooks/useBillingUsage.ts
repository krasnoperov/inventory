import { useCallback, useEffect, useState } from 'react';

export interface BillingUsageMeter {
  used: number;
  limit: number | null;
  remaining: number | null;
  costUsd?: number;
}

export interface BillingUsage {
  period: {
    start: string;
    end: string;
  };
  usage: Record<string, BillingUsageMeter>;
  estimatedCost?: {
    amount: number;
    currency: string;
  };
}

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

      const response = await fetch('/api/billing/usage', {
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required');
        }
        throw new Error('Failed to fetch billing usage');
      }

      const data = await response.json() as BillingUsage;
      setUsage(data);
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
