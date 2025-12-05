/**
 * Thumbnail - Unified thumbnail component for variant display
 *
 * Handles all variant states consistently across the app:
 * - loading (pending, processing, uploading)
 * - failed
 * - completed (with image)
 * - empty (no variant)
 */

import { memo, useCallback } from 'react';
import {
  type Variant,
  isVariantReady,
  isVariantLoading,
  isVariantFailed,
  getVariantThumbnailUrl,
} from '../../hooks/useSpaceWebSocket';
import styles from './Thumbnail.module.css';

export type ThumbnailSize = 'xs' | 'sm' | 'md' | 'lg';

export interface ThumbnailProps {
  /** Variant to display (null/undefined shows empty state) */
  variant?: Variant | null;
  /** Size variant using design system tokens */
  size?: ThumbnailSize;
  /** Show active/starred badges */
  showBadges?: boolean;
  /** Whether this variant is the active one for its asset */
  isActive?: boolean;
  /** Callback for retry button on failed variants */
  onRetry?: () => void;
  /** Callback for clicking the thumbnail */
  onClick?: () => void;
  /** Additional CSS class */
  className?: string;
}

/** Status labels for loading states */
const LOADING_LABELS: Record<string, string> = {
  pending: 'Queued',
  processing: 'Generating',
  uploading: 'Uploading',
};

function ThumbnailComponent({
  variant,
  size = 'sm',
  showBadges = false,
  isActive = false,
  onRetry,
  onClick,
  className,
}: ThumbnailProps) {
  const handleRetryClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRetry?.();
    },
    [onRetry]
  );

  const baseClasses = [styles.thumbnail, styles[size], className].filter(Boolean).join(' ');

  // Empty state - no variant provided
  if (!variant) {
    return (
      <div className={`${baseClasses} ${styles.empty}`} onClick={onClick}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className={styles.emptyIcon}
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </div>
    );
  }

  // Loading state (pending, processing, uploading)
  if (isVariantLoading(variant)) {
    const label = LOADING_LABELS[variant.status] || 'Loading';
    return (
      <div className={`${baseClasses} ${styles.loading}`}>
        <div className={styles.spinner} />
        <span className={styles.loadingLabel}>{label}</span>
      </div>
    );
  }

  // Failed state
  if (isVariantFailed(variant)) {
    return (
      <div className={`${baseClasses} ${styles.failed}`} onClick={onClick}>
        <span className={styles.errorIcon}>⚠</span>
        <span className={styles.errorLabel}>Failed</span>
        {onRetry && (
          <button className={styles.retryButton} onClick={handleRetryClick}>
            Retry
          </button>
        )}
      </div>
    );
  }

  // Completed state
  const url = getVariantThumbnailUrl(variant);

  return (
    <div className={baseClasses} onClick={onClick}>
      {url ? (
        <img src={url} alt="" className={styles.image} draggable={false} />
      ) : (
        <div className={styles.placeholder}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className={styles.placeholderIcon}
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
      )}

      {/* Badges - only for completed variants */}
      {showBadges && isVariantReady(variant) && (
        <>
          {isActive && <span className={styles.activeBadge}>Active</span>}
          {variant.starred && <span className={styles.starBadge}>★</span>}
        </>
      )}
    </div>
  );
}

export const Thumbnail = memo(ThumbnailComponent);
export default Thumbnail;
