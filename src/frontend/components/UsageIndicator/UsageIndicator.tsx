import { useLimitedUsage, formatMeterName } from '../../hooks/useLimitedUsage';
import { Link } from '../Link';
import styles from './UsageIndicator.module.css';

/**
 * Compact usage indicator for the header.
 * Shows the most constrained resource (highest % used).
 *
 * States:
 * - ok (<90%): muted gray, minimal footprint
 * - warning (90-99%): amber highlight
 * - exceeded (100%+): red with subtle pulse
 *
 * Clicking links to the Profile page where full billing details are shown.
 */
export function UsageIndicator() {
  const { mostConstrained, isWarning, isExceeded, isLoading } = useLimitedUsage();

  // Don't show anything while loading or if no meters
  if (isLoading || !mostConstrained) {
    return null;
  }

  // Don't show if usage is very low (< 10%) - no need to distract
  if (mostConstrained.percentUsed < 10) {
    return null;
  }

  const status = isExceeded ? 'exceeded' : isWarning ? 'warning' : 'ok';
  const percentage = Math.round(mostConstrained.percentUsed);
  const meterLabel = formatMeterName(mostConstrained.name);

  // Shorten label for compact display
  const shortLabel = meterLabel
    .replace(' Input', '')
    .replace(' Output', '')
    .replace(' Tokens', '')
    .replace('Image Generations', 'Images');

  return (
    <Link to="/profile" className={`${styles.indicator} ${styles[status]}`} title={`${percentage}% of ${meterLabel} used this month`}>
      <div className={styles.bar}>
        <div
          className={styles.fill}
          style={{ width: `${Math.min(100, percentage)}%` }}
        />
      </div>
      <span className={styles.label}>
        {percentage}% {shortLabel}
      </span>
    </Link>
  );
}
