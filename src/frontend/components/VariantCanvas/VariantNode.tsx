import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { type Asset, type Variant, getVariantThumbnailUrl, isVariantReady, isVariantLoading, isVariantFailed } from '../../hooks/useSpaceWebSocket';
import styles from './VariantNode.module.css';

export interface VariantNodeData extends Record<string, unknown> {
  variant: Variant;
  asset: Asset;
  isActive?: boolean;
  isSelected?: boolean;
  onVariantClick?: (variant: Variant) => void;
  onAddToTray?: (variant: Variant, asset: Asset) => void;
  onSetActive?: (variantId: string) => void;
  onRetry?: (variantId: string) => void;
  /** Ghost node: parent variant from another asset */
  isGhost?: boolean;
  /** Callback for ghost node click (navigate to source asset) */
  onGhostClick?: (assetId: string) => void;
  /** Scale factor for active variant (default 1) */
  scale?: number;
  /** Whether this node has incoming edges */
  hasIncoming?: boolean;
  /** Whether this node has outgoing edges */
  hasOutgoing?: boolean;
}

export type VariantNodeType = Node<VariantNodeData, 'variant'>;

function VariantNodeComponent({ data, selected }: NodeProps<VariantNodeType>) {
  const {
    variant,
    asset,
    isActive,
    isSelected,
    onVariantClick,
    onAddToTray,
    onSetActive,
    onRetry,
    isGhost,
    onGhostClick,
    scale = 1,
    hasIncoming,
    hasOutgoing,
  } = data;

  const handleClick = useCallback(() => {
    if (isGhost && onGhostClick) {
      onGhostClick(asset.id);
    } else {
      onVariantClick?.(variant);
    }
  }, [variant, isGhost, asset.id, onVariantClick, onGhostClick]);

  const handleAddToTray = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isVariantReady(variant)) {
      onAddToTray?.(variant, asset);
    }
  }, [variant, asset, onAddToTray]);

  const handleSetActive = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isVariantReady(variant)) {
      onSetActive?.(variant.id);
    }
  }, [variant, onSetActive]);

  const handleRetry = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isVariantFailed(variant) && onRetry) {
      onRetry(variant.id);
    }
  }, [variant, onRetry]);

  const nodeClasses = [
    styles.node,
    selected ? styles.selected : '',
    isActive ? styles.active : '',
    isSelected ? styles.highlighted : '',
    variant.starred ? styles.starred : '',
    isGhost ? styles.ghost : '',
    isVariantLoading(variant) ? styles.loading : '',
    isVariantFailed(variant) ? styles.failed : '',
  ].filter(Boolean).join(' ');

  // Render thumbnail based on variant status
  const renderThumbnail = () => {
    if (isVariantLoading(variant)) {
      return (
        <div className={styles.generating}>
          <div className={styles.spinner} />
          <span>{variant.status === 'pending' ? 'Queued' : 'Generating'}</span>
        </div>
      );
    }

    if (isVariantFailed(variant)) {
      return (
        <div className={`${styles.generating} ${styles.failedContent}`}>
          <span className={styles.errorIcon}>⚠</span>
          <span>Failed</span>
          {onRetry && (
            <button className={styles.retryButton} onClick={handleRetry}>
              Retry
            </button>
          )}
        </div>
      );
    }

    const url = getVariantThumbnailUrl(variant);
    if (!url) {
      return (
        <div className={styles.placeholder}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="24" height="24">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
      );
    }

    return (
      <img
        src={url}
        alt={`Variant ${variant.id.slice(0, 8)}`}
        className={styles.image}
        draggable={false}
      />
    );
  };

  // Determine if we should show handles (only when connected or for potential connections)
  // Always show handles for ghost nodes (they have connections by definition)
  const showTopHandle = hasIncoming || isGhost;
  const showBottomHandle = hasOutgoing || !isGhost; // Non-ghost nodes can have children

  // Apply CSS custom property for scaling (used by CSS for proportional sizing)
  const nodeStyle = scale !== 1 ? { '--node-scale': scale } as React.CSSProperties : undefined;

  return (
    <div className={nodeClasses} onClick={handleClick} style={nodeStyle}>
      {/* Input handle (for incoming edges from parent variants) - hidden when no connections */}
      {showTopHandle && (
        <Handle type="target" position={Position.Top} className={styles.handle} />
      )}

      {/* Thumbnail */}
      <div className={styles.thumbnail}>
        {renderThumbnail()}

        {/* Indicators - only for completed variants */}
        {isVariantReady(variant) && isActive ? (
          <span className={styles.activeIndicator}>Active</span>
        ) : null}
        {isVariantReady(variant) && variant.starred ? (
          <span className={styles.starIndicator}>★</span>
        ) : null}

        {/* Hover actions - only for completed variants */}
        {isVariantReady(variant) ? (
          <div className={styles.actions}>
            {onAddToTray && (
              <button
                className={styles.actionButton}
                onClick={handleAddToTray}
                title="Add to Forge Tray"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            )}
            {!isActive && onSetActive && (
              <button
                className={styles.actionButton}
                onClick={handleSetActive}
                title="Set as Active"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            )}
          </div>
        ) : null}
      </div>

      {/* Label - only for ghost nodes (shows source asset name) */}
      {isGhost && (
        <div className={styles.label}>
          <span className={styles.ghostLabel} title={`From: ${asset.name}`}>
            ↗ {asset.name}
          </span>
        </div>
      )}

      {/* Output handle (for outgoing edges to child variants) - hidden for ghost nodes */}
      {showBottomHandle && (
        <Handle type="source" position={Position.Bottom} className={styles.handle} />
      )}
    </div>
  );
}

export const VariantNode = memo(VariantNodeComponent);
