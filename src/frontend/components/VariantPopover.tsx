import { useEffect, useRef, useCallback } from 'react';
import type { Asset, Variant } from '../hooks/useSpaceWebSocket';
import styles from './VariantPopover.module.css';

export interface LineageSummary {
  parentCount: number;
  childCount: number;
}

export interface VariantPopoverProps {
  variant: Variant;
  asset: Asset;
  position: { x: number; y: number };
  canEdit?: boolean;
  isActive?: boolean;
  isStarred?: boolean;
  lineageSummary?: LineageSummary;
  onClose: () => void;
  onRefine?: (variant: Variant) => void;
  onNewAsset?: (variant: Variant) => void;
  onAddReference?: (variant: Variant) => void;
  onStar?: (variant: Variant, starred: boolean) => void;
  onSetActive?: (variant: Variant) => void;
  onDelete?: (variant: Variant) => void;
  onViewLineage?: (variant: Variant) => void;
}

export function VariantPopover({
  variant,
  asset,
  position,
  canEdit = false,
  isActive = false,
  isStarred = false,
  lineageSummary,
  onClose,
  onRefine,
  onNewAsset,
  onAddReference,
  onStar,
  onSetActive,
  onDelete,
  onViewLineage,
}: VariantPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position to stay in viewport
  useEffect(() => {
    if (popoverRef.current) {
      const rect = popoverRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = position.x - rect.width / 2;
      let adjustedY = position.y;

      // Keep within horizontal bounds
      if (adjustedX < 8) adjustedX = 8;
      if (adjustedX + rect.width > viewportWidth - 8) {
        adjustedX = viewportWidth - rect.width - 8;
      }

      // Keep within vertical bounds
      if (adjustedY + rect.height > viewportHeight - 8) {
        adjustedY = position.y - rect.height - 80; // Show above the thumbnail
      }

      popoverRef.current.style.left = `${adjustedX}px`;
      popoverRef.current.style.top = `${adjustedY}px`;
    }
  }, [position]);

  const handleAction = useCallback((action: () => void) => {
    action();
    onClose();
  }, [onClose]);

  // Format date
  const createdDate = new Date(variant.created_at).toLocaleDateString();

  return (
    <div
      ref={popoverRef}
      className={styles.popover}
      style={{ left: position.x, top: position.y }}
    >
      {/* Header with preview */}
      <div className={styles.header}>
        <img
          src={`/api/images/${variant.thumb_key}`}
          alt="Variant preview"
          className={styles.preview}
        />
        <div className={styles.info}>
          <span className={styles.assetName}>{asset.name}</span>
          <span className={styles.date}>Created {createdDate}</span>
          {lineageSummary && (lineageSummary.parentCount > 0 || lineageSummary.childCount > 0) && (
            <span className={styles.lineageSummary}>
              {lineageSummary.parentCount > 0 && (
                <span className={styles.lineageItem} title="Created from these sources">
                  <svg viewBox="0 0 10 10" fill="currentColor" width="8" height="8">
                    <path d="M5 0L10 6H0z" />
                  </svg>
                  {lineageSummary.parentCount}
                </span>
              )}
              {lineageSummary.childCount > 0 && (
                <span className={styles.lineageItem} title="Used to create these">
                  <svg viewBox="0 0 10 10" fill="currentColor" width="8" height="8">
                    <path d="M5 10L0 4H10z" />
                  </svg>
                  {lineageSummary.childCount}
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Primary Actions */}
      {canEdit && (
        <div className={styles.section}>
          {onRefine && (
            <button
              className={styles.action}
              onClick={() => handleAction(() => onRefine(variant))}
            >
              <span className={styles.actionIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </span>
              <span className={styles.actionLabel}>Refine</span>
              <span className={styles.actionHint}>new variant here</span>
            </button>
          )}

          {onNewAsset && (
            <button
              className={styles.action}
              onClick={() => handleAction(() => onNewAsset(variant))}
            >
              <span className={styles.actionIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
              </span>
              <span className={styles.actionLabel}>New Asset</span>
              <span className={styles.actionHint}>from this image</span>
            </button>
          )}

          {onAddReference && (
            <button
              className={styles.action}
              onClick={() => handleAction(() => onAddReference(variant))}
            >
              <span className={styles.actionIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </span>
              <span className={styles.actionLabel}>Use as Reference</span>
            </button>
          )}
        </div>
      )}

      {/* Secondary Actions */}
      <div className={styles.section}>
        {canEdit && onStar && (
          <button
            className={styles.action}
            onClick={() => handleAction(() => onStar(variant, !isStarred))}
          >
            <span className={styles.actionIcon}>
              <svg viewBox="0 0 24 24" fill={isStarred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </span>
            <span className={styles.actionLabel}>{isStarred ? 'Unstar' : 'Star'}</span>
          </button>
        )}

        {canEdit && onSetActive && !isActive && (
          <button
            className={styles.action}
            onClick={() => handleAction(() => onSetActive(variant))}
          >
            <span className={styles.actionIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </span>
            <span className={styles.actionLabel}>Set as Active</span>
          </button>
        )}

        {onViewLineage && (
          <button
            className={styles.action}
            onClick={() => handleAction(() => onViewLineage(variant))}
          >
            <span className={styles.actionIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </span>
            <span className={styles.actionLabel}>View Lineage</span>
          </button>
        )}
      </div>

      {/* Danger Actions */}
      {canEdit && onDelete && (
        <div className={styles.section}>
          <button
            className={`${styles.action} ${styles.danger}`}
            onClick={() => handleAction(() => onDelete(variant))}
          >
            <span className={styles.actionIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </span>
            <span className={styles.actionLabel}>Delete Variant</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default VariantPopover;
