import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { type Asset, type Variant, getVariantThumbnailUrl } from '../../hooks/useSpaceWebSocket';
import styles from './VariantNode.module.css';

export interface VariantNodeData extends Record<string, unknown> {
  variant: Variant;
  asset: Asset;
  isActive?: boolean;
  isSelected?: boolean;
  isGenerating?: boolean;
  generatingStatus?: 'pending' | 'processing';
  onVariantClick?: (variant: Variant) => void;
  onAddToTray?: (variant: Variant, asset: Asset) => void;
  onSetActive?: (variantId: string) => void;
}

export type VariantNodeType = Node<VariantNodeData, 'variant'>;

function VariantNodeComponent({ data, selected }: NodeProps<VariantNodeType>) {
  const {
    variant,
    asset,
    isActive,
    isSelected,
    isGenerating,
    generatingStatus,
    onVariantClick,
    onAddToTray,
    onSetActive,
  } = data;

  const handleClick = useCallback(() => {
    onVariantClick?.(variant);
  }, [variant, onVariantClick]);

  const handleAddToTray = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onAddToTray?.(variant, asset);
  }, [variant, asset, onAddToTray]);

  const handleSetActive = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSetActive?.(variant.id);
  }, [variant.id, onSetActive]);

  const nodeClasses = [
    styles.node,
    selected ? styles.selected : '',
    isActive ? styles.active : '',
    isSelected ? styles.highlighted : '',
    variant.starred ? styles.starred : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={nodeClasses} onClick={handleClick}>
      {/* Input handle (for incoming edges from parent variants) */}
      <Handle type="target" position={Position.Top} className={styles.handle} />

      {/* Thumbnail */}
      <div className={styles.thumbnail}>
        {isGenerating && !variant.image_key ? (
          <div className={styles.generating}>
            <div className={styles.spinner} />
            <span>{generatingStatus === 'pending' ? 'Queued' : 'Generating'}</span>
          </div>
        ) : (
          <img
            src={getVariantThumbnailUrl(variant)}
            alt={`Variant ${variant.id.slice(0, 8)}`}
            className={styles.image}
            draggable={false}
          />
        )}

        {/* Indicators */}
        {isActive && (
          <span className={styles.activeIndicator}>Active</span>
        )}
        {variant.starred && (
          <span className={styles.starIndicator}>★</span>
        )}

        {/* Hover actions */}
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
      </div>

      {/* Label */}
      <div className={styles.label}>
        <span className={styles.variantId}>v{variant.id.slice(0, 6)}</span>
        {variant.starred && <span className={styles.starBadge}>★</span>}
      </div>

      {/* Output handle (for outgoing edges to child variants) */}
      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </div>
  );
}

export const VariantNode = memo(VariantNodeComponent);
