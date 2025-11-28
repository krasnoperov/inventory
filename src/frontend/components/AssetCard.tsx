import { useState, useCallback, useMemo } from 'react';
import { type Asset, type Variant, getVariantThumbnailUrl } from '../hooks/useSpaceWebSocket';
import { AssetMenu } from './AssetMenu';
import styles from './AssetCard.module.css';

export interface AssetCardProps {
  asset: Asset;
  variants: Variant[];
  childAssets: Asset[];
  allAssets: Asset[];
  allVariants: Variant[];
  depth?: number;
  parentPath?: Asset[];  // Path of parent assets for breadcrumb display
  isGenerating?: boolean;
  generatingStatus?: 'pending' | 'processing';
  canEdit?: boolean;
  spaceId: string;
  onAssetClick?: (asset: Asset) => void;
  onAddToTray?: (variant: Variant, asset: Asset) => void;
  onAddChildAsset?: (asset: Asset) => void;
  onRenameAsset?: (asset: Asset) => void;
  onMoveAsset?: (asset: Asset) => void;
  onDeleteAsset?: (asset: Asset) => void;
}

export function AssetCard(props: AssetCardProps) {
  const {
    asset,
    variants,
    depth = 0,
    parentPath = [],
    isGenerating = false,
    generatingStatus,
    onAssetClick,
    onAddToTray,
    onAddChildAsset,
    onRenameAsset,
    onMoveAsset,
    onDeleteAsset,
  } = props;
  const [showAssetMenu, setShowAssetMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  // Get primary variant (active_variant_id or first variant)
  const primaryVariant = useMemo(() => {
    if (asset.active_variant_id) {
      return variants.find(v => v.id === asset.active_variant_id) || variants[0];
    }
    return variants[0] || null;
  }, [asset.active_variant_id, variants]);

  // Handle clicking on the card (navigate to detail)
  const handleCardClick = useCallback(() => {
    onAssetClick?.(asset);
  }, [asset, onAssetClick]);

  // Handle Add to Tray button click
  const handleAddToTray = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (primaryVariant) {
      onAddToTray?.(primaryVariant, asset);
    }
  }, [primaryVariant, asset, onAddToTray]);

  // Handle context menu (right-click)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPosition({ x: e.clientX, y: e.clientY });
    setShowAssetMenu(true);
  }, []);

  // Close asset menu
  const handleCloseMenu = useCallback(() => {
    setShowAssetMenu(false);
    setMenuPosition(null);
  }, []);

  const depthClass = `depth${Math.min(depth, 2)}`;

  return (
    <div
      className={`${styles.card} ${styles[depthClass]}`}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Thumbnail Area */}
      <div className={styles.thumbnailArea} onClick={handleCardClick}>
        {isGenerating && !primaryVariant ? (
          <div className={styles.generatingPlaceholder}>
            <div className={styles.spinner} />
            <span>{generatingStatus === 'pending' ? 'Queued' : 'Generating'}</span>
          </div>
        ) : primaryVariant ? (
          <div className={styles.thumbnailWrapper}>
            <img
              src={getVariantThumbnailUrl(primaryVariant)}
              alt={asset.name}
              className={styles.thumbnail}
            />
            {/* Hover overlay with actions */}
            {isHovered && (
              <div className={styles.hoverOverlay}>
                <div className={styles.overlayActions}>
                  <button
                    className={styles.overlayButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAssetClick?.(asset);
                    }}
                    title="View details"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    <span>View</span>
                  </button>
                  {onAddToTray && (
                    <button
                      className={styles.overlayButton}
                      onClick={handleAddToTray}
                      title="Add to Forge Tray"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      <span>Add</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className={styles.emptyThumbnail}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="24" height="24">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
        )}
      </div>

      {/* Asset Info Row */}
      <div className={styles.infoRow}>
        <div className={styles.nameRow} onClick={handleCardClick}>
          {/* Parent path breadcrumb */}
          {parentPath.length > 0 && (
            <span className={styles.parentPath}>
              {parentPath.map((p, i) => (
                <span key={p.id}>
                  {p.name}
                  {i < parentPath.length - 1 && ' / '}
                </span>
              ))}
              {' / '}
            </span>
          )}
          <span className={styles.name}>{asset.name}</span>
          <span className={styles.type}>{asset.type}</span>
        </div>
        {onAddToTray && primaryVariant && (
          <button
            className={styles.addButton}
            onClick={handleAddToTray}
            title="Add to Forge Tray"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M12 5v14" />
            </svg>
          </button>
        )}
      </div>

      {/* Asset Menu (context menu) */}
      {showAssetMenu && menuPosition && (
        <AssetMenu
          asset={asset}
          position={menuPosition}
          onClose={handleCloseMenu}
          onAddChild={onAddChildAsset ? () => onAddChildAsset(asset) : undefined}
          onRename={onRenameAsset ? () => onRenameAsset(asset) : undefined}
          onMove={onMoveAsset ? () => onMoveAsset(asset) : undefined}
          onDelete={onDeleteAsset ? () => onDeleteAsset(asset) : undefined}
        />
      )}
    </div>
  );
}

export default AssetCard;
