import { useState, useEffect, useCallback } from 'react';

export interface MeterStatus {
  name: string;
  consumed: number;
  credited: number;
  remaining: number;
  percentUsed: number;
  hasLimit: boolean;
  status: 'ok' | 'warning' | 'critical' | 'exceeded';
}

export interface BillingStatus {
  configured: boolean;
  hasSubscription: boolean;
  meters: MeterStatus[];
  subscription: {
    status: string;
    renewsAt: string | null;
  } | null;
  portalUrl: string | null;
}

interface UseBillingStatusResult {
  billing: BillingStatus | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useBillingStatus(): UseBillingStatusResult {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBillingStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/billing/status', {
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required');
        }
        throw new Error('Failed to fetch billing status');
      }

      const data = await response.json() as BillingStatus;
      setBilling(data);
    } catch (err) {
      console.error('Billing status fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load billing');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBillingStatus();
  }, [fetchBillingStatus]);

  return {
    billing,
    isLoading,
    error,
    refresh: fetchBillingStatus,
  };
}

// Helper to format meter names for display
export function formatMeterName(name: string): string {
  const nameMap: Record<string, string> = {
    'claude_input_tokens': 'Claude Input',
    'claude_output_tokens': 'Claude Output',
    'claude_usage': 'Claude Tokens',
    'gemini_images': 'Image Generations',
    'gemini_input_tokens': 'Gemini Input',
    'gemini_output_tokens': 'Gemini Output',
    'gemini_usage': 'Gemini Tokens',
  };
  return nameMap[name] || name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// Helper to format numbers with K/M suffixes
export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}
