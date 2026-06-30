import { useState } from 'react';
import { apiFetch } from '../../../api/client';
import { useBillingStatus, formatBillingPlanStatus, formatMeterName, formatNumber, type MeterStatus } from '../../hooks/useBillingStatus';
import { calculateGeminiSpend, formatBillingPeriod, formatUsd, useBillingUsage } from '../../hooks/useBillingUsage';
import { formatUtcDate } from '../../lib/dates';
import { Button } from '../../ui';
import styles from './BillingSection.module.css';

interface UsageBarProps {
  meter: MeterStatus;
}

interface BillingPlanActionsProps {
  canManagePlan: boolean;
  canStartPlan: boolean;
  isOpeningPortal: boolean;
  isStartingCheckout: boolean;
  onManageBilling: () => void;
  onUpgrade: () => void;
  planDisplayName: string;
}

export function UsageBar({ meter }: UsageBarProps) {
  const displayName = formatMeterName(meter.name);
  const percentage = Math.min(100, meter.percentUsed);

  return (
    <div className={styles.meterRow}>
      <div className={styles.meterHeader}>
        <span className={styles.meterName}>{displayName}</span>
        <span className={styles.meterValues}>
          {formatNumber(meter.consumed)}
          {meter.hasLimit && (
            <> / {formatNumber(meter.credited)}</>
          )}
        </span>
      </div>
      <div className={styles.progressTrack}>
        <div
          className={`${styles.progressBar} ${styles[meter.status]}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {meter.hasLimit && (
        <div className={styles.meterFooter}>
          <span className={`${styles.statusBadge} ${styles[meter.status]}`}>
            {meter.status === 'exceeded' ? 'Limit reached' :
             meter.status === 'critical' ? 'Almost full' :
             meter.status === 'warning' ? 'Getting low' :
             `${meter.remaining >= 0 ? formatNumber(meter.remaining) : 'Unlimited'} remaining`}
          </span>
          <span className={styles.percentage}>{Math.round(meter.percentUsed)}%</span>
        </div>
      )}
    </div>
  );
}

export function BillingPlanActions({
  canManagePlan,
  canStartPlan,
  isOpeningPortal,
  isStartingCheckout,
  onManageBilling,
  onUpgrade,
  planDisplayName,
}: BillingPlanActionsProps) {
  if (!canManagePlan && !canStartPlan) return null;

  return (
    <div className={styles.planActions}>
      {canManagePlan && (
        <Button
          className={styles.planAction}
          variant="secondary"
          onClick={() => onManageBilling()}
          disabled={isOpeningPortal}
        >
          {isOpeningPortal ? 'Opening portal...' : 'Manage plan'}
        </Button>
      )}
      {canStartPlan && (
        <Button
          className={styles.planAction}
          variant="primary"
          onClick={() => onUpgrade()}
          disabled={isStartingCheckout}
        >
          {isStartingCheckout ? 'Opening checkout...' : `Start ${planDisplayName}`}
        </Button>
      )}
    </div>
  );
}

export function BillingSection() {
  const {
    billing,
    isLoading,
    error,
    refresh: refreshBilling,
  } = useBillingStatus();
  const {
    usage,
    isLoading: isUsageLoading,
    error: usageError,
    refresh: refreshUsage,
  } = useBillingUsage();
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);
  const geminiSpend = calculateGeminiSpend(usage);
  const geminiSpendDisplay = isUsageLoading
    ? 'Loading...'
    : usageError && !usage
      ? 'Unavailable'
      : formatUsd(geminiSpend);
  const totalSpendDisplay = isUsageLoading
    ? 'Loading...'
    : usageError && !usage
      ? 'Unavailable'
      : usage?.estimatedCost
      ? formatUsd(usage.estimatedCost.amount)
      : formatUsd(0);
  const geminiSpendCard = (
    <div className={styles.spendCard}>
      <div className={styles.spendInfo}>
        <span className={styles.spendLabel}>Estimated Gemini provider cost</span>
        <span className={styles.spendValue}>{geminiSpendDisplay}</span>
      </div>
      {usageError && (
        <span className={styles.spendNote}>{usageError}</span>
      )}
    </div>
  );

  const getBillingActionError = (err: unknown, fallback: string): string => {
    if (err instanceof Error) return err.message;
    return fallback;
  };

  const handleUpgrade = async () => {
    setIsStartingCheckout(true);
    setCheckoutError(null);
    setPortalError(null);

    try {
      const data = await apiFetch('GET /api/billing/checkout', {
        query: {
          return_url: '/profile',
          success_url: '/profile?billing=checkout_success',
        },
      });
      window.location.assign(data.url);
    } catch (err) {
      console.error('Checkout start error:', err);
      setCheckoutError(getBillingActionError(err, 'Checkout is not available'));
    } finally {
      setIsStartingCheckout(false);
    }
  };

  const handleManageBilling = async () => {
    setIsOpeningPortal(true);
    setPortalError(null);
    setCheckoutError(null);

    try {
      const data = await apiFetch('GET /api/billing/portal', {
        query: { return_url: '/profile' },
      });
      window.location.assign(data.url);
    } catch (err) {
      console.error('Billing portal error:', err);
      setPortalError(getBillingActionError(err, 'Billing portal is not available'));
    } finally {
      setIsOpeningPortal(false);
    }
  };

  const handleRefreshUsage = async () => {
    await Promise.all([refreshBilling(), refreshUsage()]);
  };

  if (isLoading) {
    return (
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Usage & Billing</h2>
        </div>
        <div className={styles.loading}>Loading billing information...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Usage & Billing</h2>
        </div>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  if (!billing || !billing.configured) {
    return (
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Usage & Billing</h2>
        </div>
        {geminiSpendCard}
        <div className={styles.usageSummaryGrid}>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Estimated provider cost</span>
            <span className={styles.summaryValue}>{totalSpendDisplay}</span>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Usage period</span>
            <span className={styles.summaryValue}>{formatBillingPeriod(usage)}</span>
          </div>
        </div>
        <div className={styles.notConfigured}>
          <p>Billing is not configured for this account.</p>
        </div>
      </div>
    );
  }

  const formatRenewalDate = (dateStr: string | null) =>
    dateStr ? formatUtcDate(dateStr) : null;
  const planDisplay = formatBillingPlanStatus(billing);
  const planStatusLabel = billing.plan.status === 'active'
    ? 'Active'
    : billing.plan.status === 'internal'
      ? 'Internal'
      : 'Inactive';
  const canManagePlan = billing.plan.portalAvailable;
  const canStartPlan = billing.plan.checkoutAvailable && billing.entitlement !== 'internal';

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Usage & Billing</h2>
        <Button
          size="sm"
          className={styles.refreshAction}
          onClick={() => void handleRefreshUsage()}
          disabled={isLoading || isUsageLoading}
        >
          Refresh
        </Button>
      </div>

      <div className={styles.subscriptionCard}>
        <div className={styles.planInfo}>
          <span className={styles.planLabel}>Current Plan</span>
          <span className={styles.planName}>{planDisplay}</span>
          <span className={`${styles.planStatusBadge} ${styles[billing.plan.status]}`}>
            {planStatusLabel}
          </span>
        </div>
        {billing.subscription && (
          <div className={styles.renewalInfo}>
            <span className={styles.renewalLabel}>
              {billing.subscription.status === 'active' ? 'Renews' :
               billing.subscription.status === 'canceled' ? 'Ends' :
               billing.subscription.status}
            </span>
            <span className={styles.renewalDate}>
              {formatRenewalDate(billing.subscription.renewsAt) || 'N/A'}
            </span>
          </div>
        )}
      </div>

      <BillingPlanActions
        canManagePlan={canManagePlan}
        canStartPlan={canStartPlan}
        isOpeningPortal={isOpeningPortal}
        isStartingCheckout={isStartingCheckout}
        onManageBilling={() => void handleManageBilling()}
        onUpgrade={() => void handleUpgrade()}
        planDisplayName={billing.plan.displayName}
      />

      {geminiSpendCard}

      <div className={styles.usageSummaryGrid}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Estimated provider cost</span>
          <span className={styles.summaryValue}>{totalSpendDisplay}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Usage period</span>
          <span className={styles.summaryValue}>{formatBillingPeriod(usage)}</span>
        </div>
      </div>

      {billing.meters.length > 0 ? (
        <div className={styles.metersContainer}>
          <h3 className={styles.metersTitle}>Current Usage</h3>
          {billing.meters.map((meter) => (
            <UsageBar key={meter.name} meter={meter} />
          ))}
        </div>
      ) : (
        <div className={styles.noMeters}>
          <p>No usage data available yet. Start using the app to see your usage here.</p>
        </div>
      )}

      {(checkoutError || portalError) && (
        <div className={styles.checkoutUnavailable}>{checkoutError || portalError}</div>
      )}
    </div>
  );
}
