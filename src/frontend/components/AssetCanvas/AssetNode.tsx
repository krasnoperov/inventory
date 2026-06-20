import { memo, useCallback } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { type Asset, type SpaceSubject, type Variant, isVariantForgeTrayReady } from '../../hooks/useSpaceWebSocket';
import { formatMediaKind } from '../../mediaKind';
import { Thumbnail } from '../Thumbnail';
import styles from './AssetNode.module.css';

export type LayoutDirection = 'TB' | 'LR' | 'BT' | 'RL';

export interface AssetNodeData extends Record<string, unknown> {
  asset: Asset;
  variant: Variant | null;
  onAssetClick?: (asset: Asset) => void;
  onAddToTray?: (variant: Variant, asset: Asset) => void;
  onCreateRelation?: (subject: SpaceSubject) => void;
  /** Layout direction retained for layout calculation by the canvas */
  layoutDirection?: LayoutDirection;
  /** Space ID for authenticated media preview URLs */
  spaceId?: string;
  /** Exact thumbnail width (px) so the card matches the image aspect ratio */
  thumbWidth?: number;
}

export type AssetNodeType = Node<AssetNodeData, 'asset'>;

function AssetNodeComponent({ data, selected }: NodeProps<AssetNodeType>) {
  const { asset, variant, onAssetClick, onAddToTray, onCreateRelation, spaceId, thumbWidth } = data;

  const handleClick = useCallback(() => {
    onAssetClick?.(asset);
  }, [asset, onAssetClick]);

  const handleAddToTray = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (variant && isVariantForgeTrayReady(variant)) {
      onAddToTray?.(variant, asset);
    }
  }, [variant, asset, onAddToTray]);

  const handleCreateRelation = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onCreateRelation?.({ subjectType: 'asset', assetId: asset.id });
  }, [asset.id, onCreateRelation]);

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
      {/* Thumbnail */}
      <div
        className={styles.thumbnail}
        onClick={handleClick}
        style={thumbWidth ? { width: thumbWidth } : undefined}
      >
        {renderThumbnail()}

        {/* Add to tray button on hover - only for ready variants */}
        <div className={styles.actions}>
          {variant && isVariantForgeTrayReady(variant) && onAddToTray && (
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
          {onCreateRelation && (
            <button
              className={styles.actionButton}
              onClick={handleCreateRelation}
              title="Create relation"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4.93" />
                <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L13 19.07" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Name label */}
      <div className={styles.label}>
        <span className={styles.name}>{asset.name}</span>
        <span className={styles.type}>
          {asset.type} / {formatMediaKind(asset.media_kind)}
        </span>
      </div>

    </div>
  );
}

export const AssetNode = memo(AssetNodeComponent);
