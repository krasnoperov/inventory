import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { type Asset, type Variant, isVariantForgeTrayReady } from '../../hooks/useSpaceWebSocket';
import { formatMediaKind } from '../../mediaKind';
import { Thumbnail } from '../Thumbnail';
import styles from './AssetNode.module.css';

/** Layout direction for handle positioning */
export type LayoutDirection = 'TB' | 'LR' | 'BT' | 'RL';

export interface AssetNodeData extends Record<string, unknown> {
  asset: Asset;
  variant: Variant | null;
  onAssetClick?: (asset: Asset) => void;
  onAddToTray?: (variant: Variant, asset: Asset) => void;
  /** Layout direction for handle positioning */
  layoutDirection?: LayoutDirection;
  /** Space ID for authenticated media preview URLs */
  spaceId?: string;
  /** Exact thumbnail width (px) so the card matches the image aspect ratio */
  thumbWidth?: number;
}

export type AssetNodeType = Node<AssetNodeData, 'asset'>;

function AssetNodeComponent({ data, selected }: NodeProps<AssetNodeType>) {
  const { asset, variant, onAssetClick, onAddToTray, layoutDirection = 'LR', spaceId, thumbWidth } = data;

  // Determine handle positions based on layout direction
  const getHandlePositions = () => {
    switch (layoutDirection) {
      case 'TB': return { target: Position.Top, source: Position.Bottom };
      case 'BT': return { target: Position.Bottom, source: Position.Top };
      case 'RL': return { target: Position.Right, source: Position.Left };
      case 'LR':
      default: return { target: Position.Left, source: Position.Right };
    }
  };
  const { target: targetPosition, source: sourcePosition } = getHandlePositions();

  const handleClick = useCallback(() => {
    onAssetClick?.(asset);
  }, [asset, onAssetClick]);

  const handleAddToTray = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (variant && isVariantForgeTrayReady(variant)) {
      onAddToTray?.(variant, asset);
    }
  }, [variant, asset, onAddToTray]);

  // Render thumbnail based on variant status and media kind
  const renderThumbnail = () => {
    return (
      <Thumbnail
        variant={variant}
        size="fill"
        spaceId={spaceId}
        showAudioControls
        showVideoControls
        className={`${styles.mediaPreview} nodrag nopan`}
      />
    );
  };

  return (
    <div className={`${styles.node} ${selected ? styles.selected : ''}`}>
      {/* Input handle (for incoming edges from parents) */}
      <Handle type="target" position={targetPosition} className={styles.handle} />

      {/* Thumbnail */}
      <div
        className={styles.thumbnail}
        onClick={handleClick}
        style={thumbWidth ? { width: thumbWidth } : undefined}
      >
        {renderThumbnail()}

        {/* Add to tray button on hover - only for ready variants */}
        {variant && isVariantForgeTrayReady(variant) && onAddToTray && (
          <button
            className={styles.addButton}
            onClick={handleAddToTray}
            title="Add to Forge Tray"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>

      {/* Name label */}
      <div className={styles.label}>
        <span className={styles.name}>{asset.name}</span>
        <span className={styles.type}>
          {asset.type} / {formatMediaKind(asset.media_kind)}
        </span>
      </div>

      {/* Output handle (for outgoing edges to children) */}
      <Handle type="source" position={sourcePosition} className={styles.handle} />
    </div>
  );
}

export const AssetNode = memo(AssetNodeComponent);
