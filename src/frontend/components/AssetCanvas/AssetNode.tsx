import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { type Asset, type Variant, getVariantThumbnailUrl } from '../../hooks/useSpaceWebSocket';
import styles from './AssetNode.module.css';

export interface AssetNodeData extends Record<string, unknown> {
  asset: Asset;
  variant: Variant | null;
  isGenerating?: boolean;
  generatingStatus?: 'pending' | 'processing';
  onAssetClick?: (asset: Asset) => void;
  onAddToTray?: (variant: Variant, asset: Asset) => void;
}

export type AssetNodeType = Node<AssetNodeData, 'asset'>;

function AssetNodeComponent({ data, selected }: NodeProps<AssetNodeType>) {
  const { asset, variant, isGenerating, generatingStatus, onAssetClick, onAddToTray } = data;

  const handleClick = useCallback(() => {
    onAssetClick?.(asset);
  }, [asset, onAssetClick]);

  const handleAddToTray = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (variant) {
      onAddToTray?.(variant, asset);
    }
  }, [variant, asset, onAddToTray]);

  return (
    <div className={`${styles.node} ${selected ? styles.selected : ''}`}>
      {/* Input handle (for incoming edges from parents) */}
      <Handle type="target" position={Position.Top} className={styles.handle} />

      {/* Thumbnail */}
      <div className={styles.thumbnail} onClick={handleClick}>
        {isGenerating && !variant ? (
          <div className={styles.generating}>
            <div className={styles.spinner} />
            <span>{generatingStatus === 'pending' ? 'Queued' : 'Generating'}</span>
          </div>
        ) : variant ? (
          <img
            src={getVariantThumbnailUrl(variant)}
            alt={asset.name}
            className={styles.image}
            draggable={false}
          />
        ) : (
          <div className={styles.placeholder}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="24" height="24">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
        )}

        {/* Add to tray button on hover */}
        {variant && onAddToTray && (
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
        <span className={styles.type}>{asset.type}</span>
      </div>

      {/* Output handle (for outgoing edges to children) */}
      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </div>
  );
}

export const AssetNode = memo(AssetNodeComponent);
