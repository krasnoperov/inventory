import { useState, useCallback, useMemo } from 'react';
import type { Asset, Variant, Lineage } from '../hooks/useSpaceWebSocket';
import { VariantThumbnail, type LineageInfo } from './VariantThumbnail';
import { VariantPopover, type LineageSummary } from './VariantPopover';
import { AssetMenu } from './AssetMenu';
import styles from './AssetCard.module.css';

export interface AssetCardProps {
  asset: Asset;
  variants: Variant[];
  lineage: Lineage[];
  childAssets: Asset[];
  allAssets: Asset[];
  allVariants: Variant[];
  depth?: number;
  isGenerating?: boolean;
  generatingStatus?: 'pending' | 'processing';
  canEdit?: boolean;
  spaceId: string;
  onVariantClick?: (variant: Variant, asset: Asset) => void;
  onAssetClick?: (asset: Asset) => void;
  onRefine?: (variant: Variant, asset: Asset) => void;
  onNewAsset?: (variant: Variant, asset: Asset) => void;
  onAddReference?: (variant: Variant) => void;
  onStarVariant?: (variant: Variant, starred: boolean) => void;
  onSetActiveVariant?: (asset: Asset, variant: Variant) => void;
  onDeleteVariant?: (variant: Variant) => void;
  onGenerateVariant?: (asset: Asset) => void;
  onAddChildAsset?: (asset: Asset) => void;
  onRenameAsset?: (asset: Asset) => void;
  onMoveAsset?: (asset: Asset) => void;
  onDeleteAsset?: (asset: Asset) => void;
  onViewLineage?: (variant: Variant) => void;
}

const MAX_DEPTH = 3;

export function AssetCard({
  asset,
  variants,
  lineage,
  childAssets,
  allAssets,
  allVariants,
  depth = 0,
  isGenerating = false,
  generatingStatus,
  canEdit = false,
  spaceId,
  onVariantClick,
  onAssetClick,
  onRefine,
  onNewAsset,
  onAddReference,
  onStarVariant,
  onSetActiveVariant,
  onDeleteVariant,
  onGenerateVariant,
  onAddChildAsset,
  onRenameAsset,
  onMoveAsset,
  onDeleteAsset,
  onViewLineage,
}: AssetCardProps) {
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ x: number; y: number } | null>(null);
  const [showAssetMenu, setShowAssetMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);

  // Determine variant size based on depth
  const variantSize = depth === 0 ? 'large' : depth === 1 ? 'medium' : 'small';

  // Build lineage info for each variant
  const variantLineageInfo = useMemo(() => {
    const info = new Map<string, LineageInfo>();

    // Count parents and children for each variant
    lineage.forEach(l => {
      // Parent count for child variant
      const childInfo = info.get(l.child_variant_id) || { parentCount: 0, childCount: 0, relationTypes: [] };
      childInfo.parentCount++;
      if (!childInfo.relationTypes.includes(l.relation_type as 'derived' | 'composed' | 'spawned')) {
        childInfo.relationTypes.push(l.relation_type as 'derived' | 'composed' | 'spawned');
      }
      info.set(l.child_variant_id, childInfo);

      // Child count for parent variant
      const parentInfo = info.get(l.parent_variant_id) || { parentCount: 0, childCount: 0, relationTypes: [] };
      parentInfo.childCount++;
      info.set(l.parent_variant_id, parentInfo);
    });

    return info;
  }, [lineage]);

  // Check which variants have lineage
  const variantsWithLineage = useMemo(() => {
    const set = new Set<string>();
    lineage.forEach(l => {
      set.add(l.parent_variant_id);
      set.add(l.child_variant_id);
    });
    return set;
  }, [lineage]);

  // Handle variant click - show popover
  const handleVariantClick = useCallback((variant: Variant, e?: React.MouseEvent) => {
    if (e) {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      setPopoverPosition({
        x: rect.left + rect.width / 2,
        y: rect.bottom + 8,
      });
    }
    setSelectedVariant(variant);
    onVariantClick?.(variant, asset);
  }, [asset, onVariantClick]);

  // Handle variant double-click - navigate to detail
  const handleVariantDoubleClick = useCallback((variant: Variant) => {
    onAssetClick?.(asset);
  }, [asset, onAssetClick]);

  // Close popover
  const handleClosePopover = useCallback(() => {
    setSelectedVariant(null);
    setPopoverPosition(null);
  }, []);

  // Handle asset menu click
  const handleMenuClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setMenuPosition({
      x: rect.right,
      y: rect.bottom + 4,
    });
    setShowAssetMenu(true);
  }, []);

  // Close asset menu
  const handleCloseMenu = useCallback(() => {
    setShowAssetMenu(false);
    setMenuPosition(null);
  }, []);

  // Handle add variant button
  const handleAddVariant = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onGenerateVariant?.(asset);
  }, [asset, onGenerateVariant]);

  // Get child assets for this asset
  const children = useMemo(() => {
    return childAssets.filter(a => a.parent_asset_id === asset.id);
  }, [childAssets, asset.id]);

  // Don't render deeper than MAX_DEPTH
  if (depth > MAX_DEPTH) {
    return null;
  }

  const depthClass = `depth${Math.min(depth, 2)}`;

  return (
    <div className={`${styles.card} ${styles[depthClass]}`}>
      {/* Asset Header */}
      <div className={styles.header} onClick={() => onAssetClick?.(asset)}>
        <div className={styles.titleRow}>
          <h3 className={styles.name}>{asset.name}</h3>
          <span className={styles.type}>{asset.type}</span>
        </div>
        {canEdit && (
          <button
            className={styles.menuButton}
            onClick={handleMenuClick}
            title="Asset options"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>
        )}
      </div>

      {/* Variants Row */}
      <div className={styles.variantsRow}>
        {isGenerating && variants.length === 0 ? (
          <div className={styles.generatingPlaceholder}>
            <div className={styles.spinner} />
            <span>{generatingStatus === 'pending' ? 'Queued' : 'Generating'}</span>
          </div>
        ) : (
          <>
            {variants.map((variant) => (
              <VariantThumbnail
                key={variant.id}
                variant={variant}
                size={variantSize}
                isActive={asset.active_variant_id === variant.id}
                isStarred={variant.starred}
                hasLineage={variantsWithLineage.has(variant.id)}
                lineageInfo={variantLineageInfo.get(variant.id)}
                onClick={(v) => handleVariantClick(v)}
                onDoubleClick={handleVariantDoubleClick}
              />
            ))}
            {canEdit && (
              <button
                className={`${styles.addVariantButton} ${styles[variantSize]}`}
                onClick={handleAddVariant}
                title="Generate new variant"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>

      {/* Child Assets */}
      {children.length > 0 && depth < MAX_DEPTH && (
        <div className={styles.children}>
          {children.map((child) => {
            const childVariants = allVariants.filter(v => v.asset_id === child.id);
            const grandchildren = allAssets.filter(a => a.parent_asset_id === child.id);

            return (
              <AssetCard
                key={child.id}
                asset={child}
                variants={childVariants}
                lineage={lineage}
                childAssets={grandchildren}
                allAssets={allAssets}
                allVariants={allVariants}
                depth={depth + 1}
                canEdit={canEdit}
                spaceId={spaceId}
                onVariantClick={onVariantClick}
                onAssetClick={onAssetClick}
                onRefine={onRefine}
                onNewAsset={onNewAsset}
                onAddReference={onAddReference}
                onStarVariant={onStarVariant}
                onSetActiveVariant={onSetActiveVariant}
                onDeleteVariant={onDeleteVariant}
                onGenerateVariant={onGenerateVariant}
                onAddChildAsset={onAddChildAsset}
                onRenameAsset={onRenameAsset}
                onMoveAsset={onMoveAsset}
                onDeleteAsset={onDeleteAsset}
                onViewLineage={onViewLineage}
              />
            );
          })}
        </div>
      )}

      {/* Variant Popover */}
      {selectedVariant && popoverPosition && (
        <VariantPopover
          variant={selectedVariant}
          asset={asset}
          position={popoverPosition}
          canEdit={canEdit}
          onClose={handleClosePopover}
          onRefine={onRefine ? (v) => onRefine(v, asset) : undefined}
          onNewAsset={onNewAsset ? (v) => onNewAsset(v, asset) : undefined}
          onAddReference={onAddReference}
          onStar={onStarVariant}
          onSetActive={onSetActiveVariant ? (v) => onSetActiveVariant(asset, v) : undefined}
          onDelete={onDeleteVariant}
          onViewLineage={onViewLineage}
          isActive={asset.active_variant_id === selectedVariant.id}
          isStarred={selectedVariant.starred}
          lineageSummary={variantLineageInfo.get(selectedVariant.id) as LineageSummary | undefined}
        />
      )}

      {/* Asset Menu */}
      {showAssetMenu && menuPosition && (
        <AssetMenu
          asset={asset}
          position={menuPosition}
          onClose={handleCloseMenu}
          onGenerateVariant={onGenerateVariant ? () => onGenerateVariant(asset) : undefined}
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
