import { useBillingStatus, formatMeterName, formatNumber, type MeterStatus } from '../../hooks/useBillingStatus';
import styles from './BillingSection.module.css';

interface UsageBarProps {
  meter: MeterStatus;
}

function UsageBar({ meter }: UsageBarProps) {
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

export function BillingSection() {
  const { billing, isLoading, error } = useBillingStatus();

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
        <div className={styles.notConfigured}>
          <p>Billing is not configured for this account.</p>
        </div>
      </div>
    );
  }

  const formatRenewalDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Usage & Billing</h2>
        {billing.portalUrl && (
          <a
            href={billing.portalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.manageLink}
          >
            Manage Billing
          </a>
        )}
      </div>

      {/* Subscription Status */}
      <div className={styles.subscriptionCard}>
        <div className={styles.planInfo}>
          <span className={styles.planLabel}>Current Plan</span>
          <span className={styles.planName}>
            {billing.hasSubscription ? 'Pro Plan' : 'Free Tier'}
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

      {/* Usage Meters */}
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

      {/* Upgrade CTA for free users */}
      {!billing.hasSubscription && billing.portalUrl && (
        <a
          href={billing.portalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.upgradeButton}
        >
          Upgrade to Pro
        </a>
      )}
    </div>
  );
}
