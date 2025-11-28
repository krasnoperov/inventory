import { useEffect, useRef, useCallback } from 'react';
import type { Asset } from '../hooks/useSpaceWebSocket';
import styles from './AssetMenu.module.css';

export interface AssetMenuProps {
  asset: Asset;
  position: { x: number; y: number };
  onClose: () => void;
  onAddChild?: () => void;
  onRename?: () => void;
  onMove?: () => void;
  onDelete?: () => void;
}

export function AssetMenu({
  asset,
  position,
  onClose,
  onAddChild,
  onRename,
  onMove,
  onDelete,
}: AssetMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
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
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = position.x;
      let adjustedY = position.y;

      // Keep within horizontal bounds
      if (adjustedX + rect.width > viewportWidth - 8) {
        adjustedX = position.x - rect.width;
      }

      // Keep within vertical bounds
      if (adjustedY + rect.height > viewportHeight - 8) {
        adjustedY = viewportHeight - rect.height - 8;
      }

      menuRef.current.style.left = `${adjustedX}px`;
      menuRef.current.style.top = `${adjustedY}px`;
    }
  }, [position]);

  const handleAction = useCallback((action: () => void) => {
    action();
    onClose();
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: position.x, top: position.y }}
    >
      <div className={styles.header}>
        <span className={styles.assetName}>{asset.name}</span>
        <span className={styles.assetType}>{asset.type}</span>
      </div>

      <div className={styles.section}>
        {onAddChild && (
          <button
            className={styles.action}
            onClick={() => handleAction(onAddChild)}
          >
            <span className={styles.actionIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className={styles.actionLabel}>Add Child Asset</span>
          </button>
        )}
      </div>

      <div className={styles.section}>
        {onRename && (
          <button
            className={styles.action}
            onClick={() => handleAction(onRename)}
          >
            <span className={styles.actionIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </span>
            <span className={styles.actionLabel}>Rename</span>
          </button>
        )}

        {onMove && (
          <button
            className={styles.action}
            onClick={() => handleAction(onMove)}
          >
            <span className={styles.actionIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M5 9l-3 3 3 3" />
                <path d="M9 5l3-3 3 3" />
                <path d="M15 19l3 3 3-3" />
                <path d="M19 9l3 3-3 3" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <line x1="12" y1="2" x2="12" y2="22" />
              </svg>
            </span>
            <span className={styles.actionLabel}>Move to...</span>
          </button>
        )}
      </div>

      {onDelete && (
        <div className={styles.section}>
          <button
            className={`${styles.action} ${styles.danger}`}
            onClick={() => handleAction(onDelete)}
          >
            <span className={styles.actionIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </span>
            <span className={styles.actionLabel}>Delete Asset</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default AssetMenu;
