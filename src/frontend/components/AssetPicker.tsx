import { useState, useCallback, useMemo } from 'react';
import { type Asset, type Variant } from '../hooks/useSpaceWebSocket';
import { formatMediaKind } from '../mediaKind';
import { Button, TextInput } from '../ui';
import { Thumbnail } from './Thumbnail';
import styles from './AssetPicker.module.css';

export interface AssetPickerProps {
  assets: Asset[];
  variants: Variant[];
  selectedAssetId?: string | null;
  onSelect: (assetId: string) => void;
}

export function AssetPicker({
  assets,
  variants,
  selectedAssetId,
  onSelect,
}: AssetPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter assets based on search
  const filteredAssets = useMemo(() => {
    if (!searchQuery.trim()) return assets;
    const query = searchQuery.toLowerCase();
    return assets.filter(a =>
      a.name.toLowerCase().includes(query) ||
      a.type.toLowerCase().includes(query) ||
      formatMediaKind(a.media_kind).toLowerCase().includes(query)
    );
  }, [assets, searchQuery]);

  // Get the active variant for an asset (for thumbnail display)
  const getAssetVariant = useCallback((asset: Asset): Variant | null => {
    // Prefer the active variant
    const activeVariant = variants.find(v => v.id === asset.active_variant_id);
    if (activeVariant) {
      return activeVariant;
    }
    // Fall back to any variant for this asset
    const anyVariant = variants.find(v => v.asset_id === asset.id);
    return anyVariant || null;
  }, [variants]);

  // Render a single asset option
  const renderAssetOption = (asset: Asset) => {
    const variant = getAssetVariant(asset);
    const isSelected = selectedAssetId === asset.id;

    return (
      <div key={asset.id}>
        <Button
          className={`${styles.option} ${isSelected ? styles.selected : ''}`}
          onClick={() => onSelect(asset.id)}
          variant="ghost"
        >
          <Thumbnail variant={variant} size="xs" className={styles.thumbnail} />
          <div className={styles.optionInfo}>
            <span className={styles.optionName}>{asset.name}</span>
            <span className={styles.optionMeta}>
              <span className={styles.optionType}>
                {asset.type} / {formatMediaKind(asset.media_kind)}
              </span>
              {isSelected && <span className={styles.selectionStatus}>Selected</span>}
            </span>
          </div>
        </Button>
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
        <TextInput
          type="text"
          className={styles.searchInput}
          aria-label="Search assets"
          placeholder="Search assets..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          fullWidth
        />
      </div>

      {/* Options list */}
      <div className={styles.options}>
        {/* Asset options */}
        {filteredAssets.map(asset => renderAssetOption(asset))}

        {/* Empty state - no search results */}
        {filteredAssets.length === 0 && searchQuery && (
          <div className={styles.empty}>
            No assets matching "{searchQuery}"
          </div>
        )}

        {/* Empty state - no assets at all */}
        {assets.length === 0 && !searchQuery && (
          <div className={styles.empty}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="24" height="24">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <span>No assets yet</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default AssetPicker;
