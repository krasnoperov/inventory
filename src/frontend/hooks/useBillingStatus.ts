import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../api/client';
import type { BillingStatusResponse, BillingMeterStatus } from '../../api/types';

export type MeterStatus = BillingMeterStatus;
export type BillingStatus = BillingStatusResponse;

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

      setBilling(await apiFetch('GET /api/billing/status'));
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
    'gemini_images': 'Image Generations',
    'gemini_videos': 'Video Generations',
    'gemini_audio': 'Lyria Music',
    'gemini_input_tokens': 'Gemini Input',
    'gemini_output_tokens': 'Gemini Output',
    'elevenlabs_audio': 'Audio Generations',
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

export function formatBillingPlanStatus(billing: BillingStatus): string {
  if (billing.plan.status === 'internal') return 'Internal access';
  if (billing.plan.status === 'active') return billing.plan.displayName;
  return 'No paid generation plan';
}
