import { memo, useCallback } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { type Asset, type Variant } from '../../hooks/useSpaceWebSocket';
import { formatMediaKind } from '../../mediaKind';
import { Thumbnail } from '../Thumbnail';
import styles from './AssetNode.module.css';

export type LayoutDirection = 'TB' | 'LR' | 'BT' | 'RL';

export interface AssetNodeData extends Record<string, unknown> {
  asset: Asset;
  variant: Variant | null;
  onAssetClick?: (asset: Asset) => void;
  /** Layout direction retained for layout calculation by the canvas */
  layoutDirection?: LayoutDirection;
  /** Space ID for authenticated media preview URLs */
  spaceId?: string;
  /** Exact thumbnail width (px) so the card matches the image aspect ratio */
  thumbWidth?: number;
}

export type AssetNodeType = Node<AssetNodeData, 'asset'>;

function AssetNodeComponent({ data, selected }: NodeProps<AssetNodeType>) {
  const { asset, variant, onAssetClick, spaceId, thumbWidth } = data;

  const handleClick = useCallback(() => {
    onAssetClick?.(asset);
  }, [asset, onAssetClick]);

  // Render thumbnail based on variant status and media kind
  const renderThumbnail = () => {
    return (
      <Thumbnail
        variant={variant}
        size="fill"
        spaceId={spaceId}
        className={`${styles.mediaPreview} nodrag nopan`}
      />
    );
  };

  return (
    <div className={`${styles.node} ${selected ? styles.selected : ''}`}>
      {/* Thumbnail */}
      <div
        className={styles.thumbnail}
        onClick={handleClick}
        style={thumbWidth ? { width: thumbWidth } : undefined}
      >
        {renderThumbnail()}
      </div>

      {/* Name label */}
      <div className={styles.label} onClick={handleClick}>
        <span className={styles.name}>{asset.name}</span>
        <span className={styles.type}>
          {asset.type} / {formatMediaKind(asset.media_kind)}
        </span>
      </div>

    </div>
  );
}

export const AssetNode = memo(AssetNodeComponent);
