import { useState, useCallback, useMemo } from 'react';
import { type Asset, type SpaceSubject, type Variant, isVariantAudioReady, isVariantForgeTrayReady } from '../hooks/useSpaceWebSocket';
import { formatMediaKind } from '../mediaKind';
import { AssetMenu } from './AssetMenu';
import { getAudioCardMetadata } from './assetCardMetadata';
import { Thumbnail } from './Thumbnail';
import { Button, IconButton } from '../ui';
import styles from './AssetCard.module.css';

export interface AssetCardProps {
  asset: Asset;
  variants: Variant[];
  depth?: number;
  isGenerating?: boolean;
  generatingStatus?: 'pending' | 'processing';
  canEdit?: boolean;
  spaceId: string;
  onAssetClick?: (asset: Asset) => void;
  onAddToTray?: (variant: Variant, asset: Asset) => void;
  onRenameAsset?: (asset: Asset) => void;
  onCreateRelation?: (subject: SpaceSubject) => void;
  onDeleteAsset?: (asset: Asset) => void;
}

export function AssetCard(props: AssetCardProps) {
  const {
    asset,
    variants,
    spaceId,
    depth = 0,
    isGenerating: _isGenerating = false, // eslint-disable-line @typescript-eslint/no-unused-vars
    generatingStatus: _generatingStatus, // eslint-disable-line @typescript-eslint/no-unused-vars
    onAssetClick,
    onAddToTray,
    onRenameAsset,
    onCreateRelation,
    onDeleteAsset,
  } = props;
  const [showAssetMenu, setShowAssetMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);

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
    if (primaryVariant && isVariantForgeTrayReady(primaryVariant)) {
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
  const isAudioCard = primaryVariant ? isVariantAudioReady(primaryVariant) : false;
  const audioMetadata = useMemo(() => getAudioCardMetadata(primaryVariant), [primaryVariant]);
  const hasAudioDetails = isAudioCard && (audioMetadata.name || audioMetadata.model || audioMetadata.voice || audioMetadata.prompt);

  return (
    <div
      className={`${styles.card} ${styles[depthClass]} ${isAudioCard ? styles.audioCard : ''}`}
      onContextMenu={handleContextMenu}
    >
      {/* Thumbnail Area */}
      {isAudioCard ? (
        <div className={styles.thumbnailArea}>
          {primaryVariant && (
            <div className={styles.thumbnailWrapper}>
              <Thumbnail
                variant={primaryVariant}
                size="fill"
                spaceId={spaceId}
                className={styles.thumbnailPreview}
                showAudioControls
              />
            </div>
          )}
        </div>
      ) : (
        <Button
          className={`${styles.thumbnailArea} ${styles.thumbnailButton}`}
          onClick={handleCardClick}
          title={asset.name}
          aria-label={`Open ${asset.name}`}
          variant="ghost"
          size="sm"
        >
          {primaryVariant ? (
            <div className={styles.thumbnailWrapper}>
              <Thumbnail
                variant={primaryVariant}
                size="fill"
                spaceId={spaceId}
                className={styles.thumbnailPreview}
              />
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
        </Button>
      )}

      {/* Asset Info Row */}
      <div className={styles.infoRow}>
        <div className={styles.nameRow}>
          <Button className={styles.titleButton} onClick={handleCardClick} variant="ghost" size="sm">
            <span className={styles.name}>{asset.name}</span>
            <span className={styles.type}>
              {asset.type} / {formatMediaKind(asset.media_kind)}
            </span>
          </Button>
          {hasAudioDetails && (
            <div className={styles.audioDetails}>
              {(audioMetadata.name || audioMetadata.model || audioMetadata.voice) && (
                <div className={styles.audioMetaRow}>
                  {audioMetadata.name && (
                    <span className={styles.audioMeta} title={audioMetadata.name}>
                      <span className={styles.audioMetaLabel}>Name</span>
                      {audioMetadata.name}
                    </span>
                  )}
                  {audioMetadata.model && (
                    <span className={styles.audioMeta} title={audioMetadata.model}>
                      <span className={styles.audioMetaLabel}>Model</span>
                      {audioMetadata.model}
                    </span>
                  )}
                  {audioMetadata.voice && (
                    <span className={styles.audioMeta} title={audioMetadata.voice}>
                      <span className={styles.audioMetaLabel}>Voice</span>
                      {audioMetadata.voice}
                    </span>
                  )}
                </div>
              )}
              {audioMetadata.prompt && (
                <p className={styles.audioPrompt} title={audioMetadata.prompt}>
                  {audioMetadata.prompt}
                </p>
              )}
            </div>
          )}
        </div>
        {onAddToTray && primaryVariant && isVariantForgeTrayReady(primaryVariant) && (
          <IconButton
            className={styles.addButton}
            onClick={handleAddToTray}
            title="Add to Forge Tray"
            aria-label="Add to Forge Tray"
            variant="ghost"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </IconButton>
        )}
      </div>

      {/* Asset Menu (context menu) */}
      {showAssetMenu && menuPosition && (
        <AssetMenu
          asset={asset}
          position={menuPosition}
          onClose={handleCloseMenu}
          onRename={onRenameAsset ? () => onRenameAsset(asset) : undefined}
          onCreateRelation={onCreateRelation ? () => onCreateRelation({ subjectType: 'asset', assetId: asset.id }) : undefined}
          onDelete={onDeleteAsset ? () => onDeleteAsset(asset) : undefined}
        />
      )}
    </div>
  );
}

export default AssetCard;
