import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { type Asset, type Variant, isVariantReady, isVariantLoading, isVariantFailed } from '../../hooks/useSpaceWebSocket';
import { Thumbnail } from '../Thumbnail';
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
  onRetry?: (variantId: string) => void;
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

function StarStatusIcon() {
  return (
    <svg className={styles.starIndicatorIcon} viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
      <path d="M12 3.2l2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.22 6.9 18.9l.98-5.68L3.75 9.2l5.7-.83L12 3.2z" />
    </svg>
  );
}

function VariantNodeComponent({ data, selected }: NodeProps<VariantNodeType>) {
  const {
    variant,
    asset,
    isActive,
    isSelected,
    onVariantClick,
    onRetry,
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

  const thumbnail = (
    <div
      className={styles.thumbnail}
      style={{
        ...(thumbWidth ? { width: thumbWidth } : {}),
        ...(thumbHeight ? { height: thumbHeight } : {}),
      }}
    >
      {renderThumbnail()}
    </div>
  );

  const audioDetails = showAudioDetails ? (
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
  ) : null;
  const relationLinks = (
    <>
      {isGhost && (
        <span className={styles.ghostLabel} title={isDerivative ? `To: ${asset.name}` : `From: ${asset.name}`}>
          {isDerivative ? '↘' : '↗'} {asset.name}
        </span>
      )}
      {!isGhost && forkedFrom && (
        <span
          className={styles.forkedFromLink}
          title={`Forked from: ${forkedFrom.assetName}`}
          onClick={(e) => handleForkedToClick(e, forkedFrom.assetId)}
        >
          ↗ {forkedFrom.assetName}
        </span>
      )}
      {!isGhost && forkedTo && forkedTo.map((fork) => (
        <span
          key={fork.assetId}
          className={styles.forkedToLink}
          title={`Forked to: ${fork.assetName}`}
          onClick={(e) => handleForkedToClick(e, fork.assetId)}
        >
          ↘ {fork.assetName}
        </span>
      ))}
    </>
  );
  const hasRelationLinks = isGhost || Boolean(forkedFrom) || Boolean(forkedTo && forkedTo.length > 0);

  return (
    <div className={nodeClasses} onClick={handleClick}>
      {/* Input handle (for incoming edges from parent variants) - hidden when no connections */}
      {showTopHandle && (
        <Handle type="target" position={targetPosition} className={styles.handle} />
      )}

      {showAudioDetails ? (
        <div className={styles.audioCard}>
          {thumbnail}
          {audioDetails}
        </div>
      ) : (
        thumbnail
      )}

      {isVariantReady(variant) && variant.starred ? (
        <span className={styles.starIndicator} title="Starred variant" aria-label="Starred variant">
          <StarStatusIcon />
        </span>
      ) : null}

      <div className={styles.nodeChrome}>
        <div className={styles.statusRow} aria-label="Variant status">
          <span className={isGhost ? styles.ghostRoleChip : styles.roleChip}>
            {isGhost ? 'Linked variant' : 'Variant'}
          </span>
          {isActive ? <span className={styles.mainChip}>Main</span> : null}
          {isSelected ? <span className={styles.selectedChip}>Selected</span> : null}
        </div>
        {hasRelationLinks ? (
          <div className={styles.relationRow}>
            {relationLinks}
          </div>
        ) : null}
      </div>

      {/* Output handle (for outgoing edges to child variants) - hidden for ghost nodes */}
      {showBottomHandle && (
        <Handle type="source" position={sourcePosition} className={styles.handle} />
      )}
    </div>
  );
}

export const VariantNode = memo(VariantNodeComponent);
