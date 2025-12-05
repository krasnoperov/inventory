import { useState, useCallback, useMemo } from 'react';
import { type Asset, type Variant, getVariantThumbnailUrl, isVariantReady, isVariantLoading, isVariantFailed } from '../hooks/useSpaceWebSocket';
import { AssetMenu } from './AssetMenu';
import styles from './AssetCard.module.css';

export interface AssetCardProps {
  asset: Asset;
  variants: Variant[];
  childAssets: Asset[];
  allAssets: Asset[];
  allVariants: Variant[];
  depth?: number;
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
    childAssets,
    allVariants,
    depth = 0,
    isGenerating: _isGenerating = false, // eslint-disable-line @typescript-eslint/no-unused-vars
    generatingStatus: _generatingStatus, // eslint-disable-line @typescript-eslint/no-unused-vars
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
  const [hoveredChildId, setHoveredChildId] = useState<string | null>(null);

  // Get primary variant (active_variant_id or first variant)
  const primaryVariant = useMemo(() => {
    if (asset.active_variant_id) {
      return variants.find(v => v.id === asset.active_variant_id) || variants[0];
    }
    return variants[0] || null;
  }, [asset.active_variant_id, variants]);

  // Get variant for a child asset
  const getChildVariant = useCallback((child: Asset): Variant | null => {
    if (child.active_variant_id) {
      return allVariants.find(v => v.id === child.active_variant_id) || null;
    }
    return allVariants.find(v => v.asset_id === child.id) || null;
  }, [allVariants]);

  // Get grandchildren for a child asset
  const getGrandchildren = useCallback((childId: string): Asset[] => {
    return props.allAssets
      .filter(a => a.parent_asset_id === childId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [props.allAssets]);

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
        {/* Show loading state for pending/processing/uploading variants */}
        {primaryVariant && isVariantLoading(primaryVariant) ? (
          <div className={styles.generatingPlaceholder}>
            <div className={styles.spinner} />
            <span>
              {({ pending: 'Queued', processing: 'Generating', uploading: 'Uploading' } as Record<string, string>)[primaryVariant.status] || 'Loading'}
            </span>
          </div>
        ) : primaryVariant && isVariantFailed(primaryVariant) ? (
          <div className={styles.generatingPlaceholder}>
            <span className={styles.errorIcon}>⚠</span>
            <span>Failed</span>
          </div>
        ) : primaryVariant && isVariantReady(primaryVariant) ? (
          <div className={styles.thumbnailWrapper}>
            <img
              src={getVariantThumbnailUrl(primaryVariant)!}
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

      {/* Children Thumbnails - Level 2 (larger) with Level 3 nested */}
      {childAssets.length > 0 && (
        <div className={styles.childrenSection}>
          <div className={styles.childrenGrid}>
            {childAssets.map((child) => {
              const childVariant = getChildVariant(child);
              const isChildHovered = hoveredChildId === child.id;
              const grandchildren = getGrandchildren(child.id);

              return (
                <div key={child.id} className={styles.childCard}>
                  {/* Child thumbnail (Level 2) */}
                  <div
                    className={styles.childThumb}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAssetClick?.(child);
                    }}
                    onMouseEnter={() => setHoveredChildId(child.id)}
                    onMouseLeave={() => setHoveredChildId(null)}
                    title={child.name}
                  >
                    {childVariant ? (
                      <img
                        src={getVariantThumbnailUrl(childVariant)}
                        alt={child.name}
                        className={styles.childThumbImg}
                      />
                    ) : (
                      <div className={styles.childThumbEmpty}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="21 15 16 10 5 21" />
                        </svg>
                      </div>
                    )}
                    {/* Add to tray on hover */}
                    {isChildHovered && onAddToTray && childVariant && (
                      <button
                        className={styles.childAddButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddToTray(childVariant, child);
                        }}
                        title="Add to Forge Tray"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <span className={styles.childName}>{child.name}</span>

                  {/* Grandchildren (Level 3) */}
                  {grandchildren.length > 0 && (
                    <div className={styles.grandchildrenGrid}>
                      {grandchildren.map((grandchild) => {
                        const grandchildVariant = getChildVariant(grandchild);
                        const isGrandchildHovered = hoveredChildId === grandchild.id;

                        return (
                          <div
                            key={grandchild.id}
                            className={styles.grandchildThumb}
                            onClick={(e) => {
                              e.stopPropagation();
                              onAssetClick?.(grandchild);
                            }}
                            onMouseEnter={() => setHoveredChildId(grandchild.id)}
                            onMouseLeave={() => setHoveredChildId(null)}
                            title={grandchild.name}
                          >
                            {grandchildVariant ? (
                              <img
                                src={getVariantThumbnailUrl(grandchildVariant)}
                                alt={grandchild.name}
                                className={styles.grandchildThumbImg}
                              />
                            ) : (
                              <div className={styles.grandchildThumbEmpty}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="12" height="12">
                                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                </svg>
                              </div>
                            )}
                            {/* Add to tray on hover */}
                            {isGrandchildHovered && onAddToTray && grandchildVariant && (
                              <button
                                className={styles.grandchildAddButton}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAddToTray(grandchildVariant, grandchild);
                                }}
                                title="Add to Forge Tray"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="8" height="8">
                                  <path d="M12 5v14M5 12h14" />
                                </svg>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

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
