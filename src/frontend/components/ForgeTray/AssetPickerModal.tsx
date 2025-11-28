import { useState, useCallback, useMemo, useEffect } from 'react';
import { useForgeTrayStore } from '../../stores/forgeTrayStore';
import { type Asset, type Variant, getVariantThumbnailUrl } from '../../hooks/useSpaceWebSocket';
import styles from './AssetPickerModal.module.css';

export interface AssetPickerModalProps {
  allAssets: Asset[];
  allVariants: Variant[];
  onClose: () => void;
}

export function AssetPickerModal({
  allAssets,
  allVariants,
  onClose,
}: AssetPickerModalProps) {
  const { slots, addSlot, removeSlot, hasVariant } = useForgeTrayStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Close on backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Get unique asset types
  const assetTypes = useMemo(() => {
    const types = new Set(allAssets.map(a => a.type));
    return Array.from(types).sort();
  }, [allAssets]);

  // Get primary variant for an asset
  const getPrimaryVariant = useCallback((asset: Asset) => {
    if (asset.active_variant_id) {
      return allVariants.find(v => v.id === asset.active_variant_id);
    }
    return allVariants.find(v => v.asset_id === asset.id);
  }, [allVariants]);

  // Filter assets based on search and type filter
  const filteredAssets = useMemo(() => {
    let result = allAssets;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(a =>
        a.name.toLowerCase().includes(query) ||
        a.type.toLowerCase().includes(query)
      );
    }

    if (typeFilter) {
      result = result.filter(a => a.type === typeFilter);
    }

    return result;
  }, [allAssets, searchQuery, typeFilter]);

  // Group assets by type
  const groupedAssets = useMemo(() => {
    const groups = new Map<string, Asset[]>();

    filteredAssets.forEach(asset => {
      const group = groups.get(asset.type) || [];
      group.push(asset);
      groups.set(asset.type, group);
    });

    return groups;
  }, [filteredAssets]);

  // Get assets currently in tray
  const assetsInTray = useMemo(() => {
    return new Set(slots.map(s => s.asset.id));
  }, [slots]);

  // Build parent path for an asset (hierarchy breadcrumb)
  const getParentPath = useCallback((asset: Asset): Asset[] => {
    const path: Asset[] = [];
    let current = allAssets.find(a => a.id === asset.parent_asset_id);
    while (current) {
      path.unshift(current);
      current = allAssets.find(a => a.id === current?.parent_asset_id);
    }
    return path;
  }, [allAssets]);

  // Toggle asset in tray
  const handleAssetClick = useCallback((asset: Asset) => {
    const primaryVariant = getPrimaryVariant(asset);
    if (!primaryVariant) return;

    if (hasVariant(primaryVariant.id)) {
      // Find and remove the slot with this variant
      const slot = slots.find(s => s.variant.id === primaryVariant.id);
      if (slot) {
        removeSlot(slot.id);
      }
    } else {
      addSlot(primaryVariant, asset);
    }
  }, [getPrimaryVariant, hasVariant, slots, addSlot, removeSlot]);

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Add to Forge Tray</h2>
          <button className={styles.closeButton} onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className={styles.filters}>
          <div className={styles.searchWrapper}>
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
              autoFocus
            />
          </div>
          <select
            className={styles.typeFilter}
            value={typeFilter || ''}
            onChange={(e) => setTypeFilter(e.target.value || null)}
          >
            <option value="">All types</option>
            {assetTypes.map((type) => (
              <option key={type} value={type}>
                {type.charAt(0).toUpperCase() + type.slice(1).replace('-', ' ')}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.content}>
          {/* Currently in tray */}
          {slots.length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>In Tray ({slots.length})</h3>
              <div className={styles.assetGrid}>
                {slots.map((slot) => {
                  const primaryVariant = getPrimaryVariant(slot.asset);
                  const parentPath = getParentPath(slot.asset);
                  return (
                    <button
                      key={slot.id}
                      className={`${styles.assetItem} ${styles.inTray}`}
                      onClick={() => handleAssetClick(slot.asset)}
                    >
                      <div className={styles.thumbnailWrapper}>
                        {primaryVariant && (
                          <img
                            src={getVariantThumbnailUrl(primaryVariant)}
                            alt={slot.asset.name}
                            className={styles.assetImage}
                          />
                        )}
                        <span className={styles.checkmark}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="12" height="12">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </span>
                      </div>
                      <div className={styles.assetInfo}>
                        {parentPath.length > 0 && (
                          <span className={styles.parentPath}>
                            {parentPath.map(p => p.name).join(' / ')}
                          </span>
                        )}
                        <span className={styles.assetName}>{slot.asset.name}</span>
                        <span className={styles.assetType}>{slot.asset.type}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Assets grouped by type */}
          {Array.from(groupedAssets.entries()).map(([type, assets]) => (
            <div key={type} className={styles.section}>
              <h3 className={styles.sectionTitle}>
                {type.charAt(0).toUpperCase() + type.slice(1).replace('-', ' ')} ({assets.length})
              </h3>
              <div className={styles.assetGrid}>
                {assets.map((asset) => {
                  const primaryVariant = getPrimaryVariant(asset);
                  const isInTray = assetsInTray.has(asset.id);
                  const parentPath = getParentPath(asset);

                  return (
                    <button
                      key={asset.id}
                      className={`${styles.assetItem} ${isInTray ? styles.inTray : ''}`}
                      onClick={() => handleAssetClick(asset)}
                    >
                      <div className={styles.thumbnailWrapper}>
                        {primaryVariant ? (
                          <img
                            src={getVariantThumbnailUrl(primaryVariant)}
                            alt={asset.name}
                            className={styles.assetImage}
                          />
                        ) : (
                          <div className={styles.emptyImage}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="24" height="24">
                              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                              <circle cx="8.5" cy="8.5" r="1.5" />
                              <polyline points="21 15 16 10 5 21" />
                            </svg>
                          </div>
                        )}
                        {isInTray && (
                          <span className={styles.checkmark}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="12" height="12">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </span>
                        )}
                      </div>
                      <div className={styles.assetInfo}>
                        {parentPath.length > 0 && (
                          <span className={styles.parentPath}>
                            {parentPath.map(p => p.name).join(' / ')}
                          </span>
                        )}
                        <span className={styles.assetName}>{asset.name}</span>
                        <span className={styles.assetType}>{asset.type}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Empty state */}
          {filteredAssets.length === 0 && (
            <div className={styles.emptyState}>
              {searchQuery || typeFilter ? (
                <p>No assets matching your filters</p>
              ) : (
                <p>No assets available</p>
              )}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.doneButton} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default AssetPickerModal;
