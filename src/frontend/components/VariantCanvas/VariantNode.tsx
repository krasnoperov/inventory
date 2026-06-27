import { memo, useCallback, useState } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { type Asset, type Variant, getVariantMediaUrl, isVariantReady, isVariantImageReady, isVariantForgeTrayReady, isVariantLoading, isVariantFailed } from '../../hooks/useSpaceWebSocket';
import { formatBytes } from '../../lib/format';
import { Thumbnail } from '../Thumbnail';
import { ImageLightbox } from '../ImageLightbox';
import { getAudioCardMetadata } from '../assetCardMetadata';
import styles from './VariantNode.module.css';

/** Layout direction for handle positioning */
export type LayoutDirection = 'TB' | 'LR' | 'BT' | 'RL';

export interface VariantNodeData extends Record<string, unknown> {
  variant: Variant;
  asset: Asset;
  isActive?: boolean;
  isSelected?: boolean;
  onVariantClick?: (variant: Variant) => void;
  onAddToTray?: (variant: Variant, asset: Asset) => void;
  onSetActive?: (variantId: string) => void;
  onRetry?: (variantId: string) => void;
  /** Restore ForgeTray to the state used to create this variant */
  onRetryRecipe?: (variant: Variant) => void;
  /** Ghost node: variant from another asset */
  isGhost?: boolean;
  /** Ghost node is a derivative (child) rather than a parent */
  isDerivative?: boolean;
  /** Callback for ghost node click (navigate to source asset) */
  onGhostClick?: (assetId: string) => void;
  /** Whether this node has incoming edges */
  hasIncoming?: boolean;
  /** Whether this node has outgoing edges */
  hasOutgoing?: boolean;
  /** Assets this variant was forked to (shown as link on local node) */
  forkedTo?: Array<{ assetId: string; assetName: string }>;
  /** Asset this variant was forked from (shown as link on local node) */
  forkedFrom?: { assetId: string; assetName: string };
  /** Layout direction for handle positioning */
  layoutDirection?: LayoutDirection;
  /** Toggle the fixed details panel for this variant (single-select on the canvas). */
  onToggleExpand?: (variantId: string) => void;
  /** Whether the details panel is currently open for this variant. */
  isExpanded?: boolean;
  /** Space ID for authenticated media downloads */
  spaceId?: string;
  /** Exact thumbnail width (px) so the card matches the media aspect ratio */
  thumbWidth?: number;
  /** Exact thumbnail height (px); lets audio nodes use a landscape ratio instead of the square default */
  thumbHeight?: number;
}

export type VariantNodeType = Node<VariantNodeData, 'variant'>;

function VariantNodeComponent({ data, selected }: NodeProps<VariantNodeType>) {
  const {
    variant,
    asset,
    isActive,
    isSelected,
    onVariantClick,
    onAddToTray,
    onSetActive,
    onRetry,
    onRetryRecipe,
    isGhost,
    isDerivative,
    onGhostClick,
    hasIncoming,
    hasOutgoing,
    forkedTo,
    forkedFrom,
    layoutDirection = 'LR',
    onToggleExpand,
    isExpanded,
    spaceId,
    thumbWidth,
    thumbHeight,
  } = data;

  // Full-resolution lightbox (the quick-view from the thumbnail hover button).
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Determine handle positions based on layout direction
  const getHandlePositions = () => {
    switch (layoutDirection) {
      case 'TB': return { target: Position.Top, source: Position.Bottom };
      case 'BT': return { target: Position.Bottom, source: Position.Top };
      case 'RL': return { target: Position.Right, source: Position.Left };
      case 'LR':
      default: return { target: Position.Left, source: Position.Right };
    }
  };
  const { target: targetPosition, source: sourcePosition } = getHandlePositions();

  const handleClick = useCallback(() => {
    if (isGhost && onGhostClick) {
      onGhostClick(asset.id);
    } else {
      // Open the fixed details panel for this variant (single-select on canvas).
      onToggleExpand?.(variant.id);
      onVariantClick?.(variant);
    }
  }, [variant, isGhost, asset.id, onVariantClick, onGhostClick, onToggleExpand]);

  const handleOpenLightbox = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setLightboxOpen(true);
  }, []);

  const handleCloseLightbox = useCallback(() => setLightboxOpen(false), []);

  // Derived fields for the hover quick-view lightbox caption.
  const dimensionsLabel = variant.media_width && variant.media_height
    ? `${variant.media_width}×${variant.media_height}`
    : null;
  const sizeLabel = formatBytes(variant.media_size_bytes);
  const canViewFullSize = isVariantImageReady(variant);
  const fullSizeUrl = canViewFullSize ? getVariantMediaUrl(variant, spaceId) : undefined;
  const lightboxCaption = [asset.name, dimensionsLabel, sizeLabel].filter(Boolean).join(' · ');

  const handleAddToTray = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isVariantForgeTrayReady(variant)) {
      onAddToTray?.(variant, asset);
    }
  }, [variant, asset, onAddToTray]);

  const handleSetActive = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isVariantReady(variant)) {
      onSetActive?.(variant.id);
    }
  }, [variant, onSetActive]);

  const handleRetryRecipe = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isVariantForgeTrayReady(variant) && onRetryRecipe) {
      onRetryRecipe(variant);
    }
  }, [variant, onRetryRecipe]);

  const handleForkedToClick = useCallback((e: React.MouseEvent, assetId: string) => {
    e.stopPropagation();
    onGhostClick?.(assetId);
  }, [onGhostClick]);

  const nodeClasses = [
    styles.node,
    variant.media_kind === 'audio' ? styles.audioNode : '',
    selected ? styles.selected : '',
    isActive ? styles.active : '',
    isSelected ? styles.highlighted : '',
    variant.starred ? styles.starred : '',
    isGhost ? styles.ghost : '',
    isVariantLoading(variant) ? styles.loading : '',
    isVariantFailed(variant) ? styles.failed : '',
    isExpanded ? styles.expanded : '',
  ].filter(Boolean).join(' ');
  const audioMetadata = getAudioCardMetadata(variant);
  const audioFacts = [
    audioMetadata.name ? ['name', audioMetadata.name] : null,
    audioMetadata.model ? ['model', audioMetadata.model] : null,
    audioMetadata.voice ? ['voice', audioMetadata.voice] : null,
  ].filter(
    (fact): fact is [string, string] => Boolean(fact),
  );
  const showAudioDetails = variant.media_kind === 'audio' && (audioFacts.length > 0 || audioMetadata.prompt);

  // Render thumbnail based on variant status and media kind
  const renderThumbnail = () => {
    return (
      <Thumbnail
        variant={variant}
        size="fill"
        spaceId={spaceId}
        showAudioControls
        showVideoControls
        fullResolution
        onRetry={onRetry ? () => onRetry(variant.id) : undefined}
        className={`${styles.mediaPreview} nodrag nopan`}
      />
    );
  };

  // Determine if we should show handles (only when connected or for potential connections)
  // Ghost nodes always have connections by definition:
  // - Parent ghosts: show top handle (they are sources)
  // - Derivative ghosts: show top handle (they receive the edge from parent in this asset)
  const showTopHandle = hasIncoming || (isGhost && !isDerivative);
  const showBottomHandle = hasOutgoing || !isGhost || isDerivative; // Non-ghost and derivative ghost nodes can have edges

  return (
    <div className={nodeClasses} onClick={handleClick}>
      {/* Input handle (for incoming edges from parent variants) - hidden when no connections */}
      {showTopHandle && (
        <Handle type="target" position={targetPosition} className={styles.handle} />
      )}

      {/* Thumbnail */}
      <div
        className={styles.thumbnail}
        style={{
          ...(thumbWidth ? { width: thumbWidth } : {}),
          ...(thumbHeight ? { height: thumbHeight } : {}),
        }}
      >
        {renderThumbnail()}

        {/* Indicators - only for completed variants */}
        {isVariantReady(variant) && variant.starred ? (
          <span className={styles.starIndicator}>★</span>
        ) : null}

        {/* Hover actions - only for completed variants */}
        {isVariantForgeTrayReady(variant) ? (
          <div className={styles.actions}>
            {canViewFullSize && (
              <button
                className={styles.actionButton}
                onClick={handleOpenLightbox}
                title="View full size"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
              </button>
            )}
            {onAddToTray && isVariantForgeTrayReady(variant) && (
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
            {!isActive && onSetActive && (
              <button
                className={styles.actionButton}
                onClick={handleSetActive}
                title="Use as main variant"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            )}
            {onRetryRecipe && isVariantForgeTrayReady(variant) && (
              <button
                className={styles.actionButton}
                onClick={handleRetryRecipe}
                title="Retry with same recipe"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <path d="M1 4v6h6" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
              </button>
            )}
          </div>
        ) : null}
      </div>

      {showAudioDetails && (
        <div className={styles.audioDetails}>
          {audioFacts.length > 0 && (
            <div className={styles.audioFacts}>
              {audioFacts.map(([key, value]) => (
                <span key={key} title={value}>{value}</span>
              ))}
            </div>
          )}
          {audioMetadata.prompt && (
            <p className={styles.audioPrompt} title={audioMetadata.prompt}>
              {audioMetadata.prompt}
            </p>
          )}
        </div>
      )}

      {/* Label - only for ghost nodes (shows source/target asset name) */}
      {isGhost && (
        <div className={styles.label}>
          <span className={styles.ghostLabel} title={isDerivative ? `To: ${asset.name}` : `From: ${asset.name}`}>
            {isDerivative ? '↘' : '↗'} {asset.name}
          </span>
        </div>
      )}

      {/* Forked-from link - for local variants that were forked from another asset */}
      {!isGhost && forkedFrom && (
        <div className={styles.label}>
          <span
            className={styles.forkedFromLink}
            title={`Forked from: ${forkedFrom.assetName}`}
            onClick={(e) => handleForkedToClick(e, forkedFrom.assetId)}
          >
            ↗ {forkedFrom.assetName}
          </span>
        </div>
      )}

      {/* Forked-to links - for local variants that were forked to other assets */}
      {!isGhost && forkedTo && forkedTo.length > 0 && (
        <div className={styles.label}>
          {forkedTo.map((fork) => (
            <span
              key={fork.assetId}
              className={styles.forkedToLink}
              title={`Forked to: ${fork.assetName}`}
              onClick={(e) => handleForkedToClick(e, fork.assetId)}
            >
              ↘ {fork.assetName}
            </span>
          ))}
        </div>
      )}

      {/* Output handle (for outgoing edges to child variants) - hidden for ghost nodes */}
      {showBottomHandle && (
        <Handle type="source" position={sourcePosition} className={styles.handle} />
      )}

      {/* Full-resolution lightbox (portaled to body, escapes canvas transform) */}
      {lightboxOpen && fullSizeUrl && (
        <ImageLightbox
          src={fullSizeUrl}
          alt={asset.name}
          caption={lightboxCaption}
          onClose={handleCloseLightbox}
        />
      )}
    </div>
  );
}

export const VariantNode = memo(VariantNodeComponent);
