import { useState, useCallback, useMemo } from 'react';
import type { Asset, Variant } from '../hooks/useSpaceWebSocket';
import styles from './AssetPicker.module.css';

export interface AssetPickerProps {
  assets: Asset[];
  variants: Variant[];
  selectedAssetId?: string | null;
  allowRoot?: boolean;
  rootLabel?: string;
  onSelect: (assetId: string | null) => void;
}

export function AssetPicker({
  assets,
  variants,
  selectedAssetId,
  allowRoot = true,
  rootLabel = 'Root (no parent)',
  onSelect,
}: AssetPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter assets based on search
  const filteredAssets = useMemo(() => {
    if (!searchQuery.trim()) return assets;
    const query = searchQuery.toLowerCase();
    return assets.filter(a =>
      a.name.toLowerCase().includes(query) ||
      a.type.toLowerCase().includes(query)
    );
  }, [assets, searchQuery]);

  // Group assets by parent for tree structure
  const rootAssets = useMemo(() => {
    return filteredAssets.filter(a => !a.parent_asset_id);
  }, [filteredAssets]);

  // Get the active variant thumbnail for an asset
  const getAssetThumbnail = useCallback((asset: Asset) => {
    const activeVariant = variants.find(v => v.id === asset.active_variant_id);
    if (activeVariant) {
      return `/api/images/${activeVariant.thumb_key}`;
    }
    const anyVariant = variants.find(v => v.asset_id === asset.id);
    if (anyVariant) {
      return `/api/images/${anyVariant.thumb_key}`;
    }
    return null;
  }, [variants]);

  // Render a single asset option
  const renderAssetOption = (asset: Asset, depth: number = 0) => {
    const thumbnailUrl = getAssetThumbnail(asset);
    const isSelected = selectedAssetId === asset.id;
    const children = filteredAssets.filter(a => a.parent_asset_id === asset.id);

    return (
      <div key={asset.id}>
        <button
          className={`${styles.option} ${isSelected ? styles.selected : ''}`}
          style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}
          onClick={() => onSelect(asset.id)}
        >
          <div className={styles.thumbnail}>
            {thumbnailUrl ? (
              <img src={thumbnailUrl} alt="" className={styles.thumbnailImage} />
            ) : (
              <div className={styles.thumbnailPlaceholder}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </div>
            )}
          </div>
          <div className={styles.optionInfo}>
            <span className={styles.optionName}>{asset.name}</span>
            <span className={styles.optionType}>{asset.type}</span>
          </div>
          {isSelected && (
            <span className={styles.checkmark}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          )}
        </button>
        {children.map(child => renderAssetOption(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className={styles.picker}>
      {/* Search */}
      <div className={styles.search}>
        <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search assets..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Options list */}
      <div className={styles.options}>
        {/* Root option */}
        {allowRoot && (
          <button
            className={`${styles.option} ${selectedAssetId === null ? styles.selected : ''}`}
            onClick={() => onSelect(null)}
          >
            <div className={styles.thumbnail}>
              <div className={styles.thumbnailPlaceholder}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </div>
            </div>
            <div className={styles.optionInfo}>
              <span className={styles.optionName}>{rootLabel}</span>
            </div>
            {selectedAssetId === null && (
              <span className={styles.checkmark}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            )}
          </button>
        )}

        {/* Asset options */}
        {rootAssets.map(asset => renderAssetOption(asset))}

        {/* Empty state */}
        {filteredAssets.length === 0 && searchQuery && (
          <div className={styles.empty}>
            No assets matching "{searchQuery}"
          </div>
        )}
      </div>
    </div>
  );
}

export default AssetPicker;
