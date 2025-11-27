import { useState, useCallback } from 'react';
import type { Variant } from '../hooks/useSpaceWebSocket';
import styles from './VariantThumbnail.module.css';

export interface LineageInfo {
  parentCount: number;
  childCount: number;
  relationTypes: ('derived' | 'composed' | 'spawned')[];
}

export interface VariantThumbnailProps {
  variant: Variant;
  size?: 'small' | 'medium' | 'large';
  isActive?: boolean;
  isStarred?: boolean;
  hasLineage?: boolean;
  lineageInfo?: LineageInfo;
  onClick?: (variant: Variant) => void;
  onDoubleClick?: (variant: Variant) => void;
}

// Build tooltip text from lineage info
const buildLineageTooltip = (info: LineageInfo): string => {
  const parts: string[] = [];

  if (info.parentCount > 0) {
    parts.push(`Created from ${info.parentCount} source${info.parentCount > 1 ? 's' : ''}`);
  }
  if (info.childCount > 0) {
    parts.push(`Used to create ${info.childCount} variant${info.childCount > 1 ? 's' : ''}`);
  }

  return parts.join('\n');
};

export function VariantThumbnail({
  variant,
  size = 'medium',
  isActive = false,
  isStarred = false,
  hasLineage = false,
  lineageInfo,
  onClick,
  onDoubleClick,
}: VariantThumbnailProps) {
  const [imageError, setImageError] = useState(false);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(variant);
  }, [onClick, variant]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDoubleClick?.(variant);
  }, [onDoubleClick, variant]);

  const handleImageError = useCallback(() => {
    setImageError(true);
  }, []);

  return (
    <div
      className={`${styles.thumbnail} ${styles[size]} ${isActive ? styles.active : ''} ${onClick ? styles.clickable : ''}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title={isActive ? 'Active variant' : undefined}
    >
      {!imageError ? (
        <img
          src={`/api/images/${variant.thumb_key}`}
          alt="Variant"
          className={styles.image}
          onError={handleImageError}
          loading="lazy"
        />
      ) : (
        <div className={styles.placeholder}>
          <span>?</span>
        </div>
      )}

      {/* Indicators */}
      <div className={styles.indicators}>
        {isStarred && (
          <span className={styles.starIndicator} title="Starred">
            <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </span>
        )}
        {hasLineage && lineageInfo && (
          <span
            className={styles.lineageIndicator}
            title={buildLineageTooltip(lineageInfo)}
          >
            {/* Show parent arrow if has parents */}
            {lineageInfo.parentCount > 0 && (
              <svg viewBox="0 0 10 10" fill="currentColor" width="6" height="6" className={styles.lineageArrowUp}>
                <path d="M5 0L10 6H0z" />
              </svg>
            )}
            {/* Show child arrow if has children */}
            {lineageInfo.childCount > 0 && (
              <svg viewBox="0 0 10 10" fill="currentColor" width="6" height="6" className={styles.lineageArrowDown}>
                <path d="M5 10L0 4H10z" />
              </svg>
            )}
          </span>
        )}
        {hasLineage && !lineageInfo && (
          <span className={styles.lineageIndicator} title="Has lineage">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </span>
        )}
      </div>

      {/* Active badge */}
      {isActive && (
        <span className={styles.activeBadge}>
          <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
          </svg>
        </span>
      )}
    </div>
  );
}

export default VariantThumbnail;
