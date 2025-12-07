import { memo, useCallback, useState } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { type Asset, type Variant, getVariantThumbnailUrl, isVariantReady, isVariantLoading, isVariantFailed } from '../../hooks/useSpaceWebSocket';
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
  /** Scale factor for active variant (default 1) */
  scale?: number;
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
  /** Handler for starring/unstarring a variant */
  onStarVariant?: (variantId: string, starred: boolean) => void;
  /** Handler for deleting a variant */
  onDeleteVariant?: (variant: Variant) => void;
  /** Total number of variants (to disable delete when only 1) */
  variantCount?: number;
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
    scale = 1,
    hasIncoming,
    hasOutgoing,
    forkedTo,
    forkedFrom,
    layoutDirection = 'LR',
    onStarVariant,
    onDeleteVariant,
    variantCount = 0,
  } = data;

  // Expanded state for showing details
  const [isExpanded, setIsExpanded] = useState(false);

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
      // Toggle expanded state on click
      setIsExpanded(prev => !prev);
      onVariantClick?.(variant);
    }
  }, [variant, isGhost, asset.id, onVariantClick, onGhostClick]);

  const handleStarClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onStarVariant?.(variant.id, !variant.starred);
  }, [variant.id, variant.starred, onStarVariant]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDeleteVariant?.(variant);
  }, [variant, onDeleteVariant]);

  const handleCloseExpanded = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(false);
  }, []);

  // Parse recipe for details
  const parseRecipe = (recipe: string) => {
    try {
      return JSON.parse(recipe);
    } catch {
      return null;
    }
  };

  const recipe = parseRecipe(variant.recipe);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleAddToTray = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isVariantReady(variant)) {
      onAddToTray?.(variant, asset);
    }
  }, [variant, asset, onAddToTray]);

  const handleSetActive = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isVariantReady(variant)) {
      onSetActive?.(variant.id);
    }
  }, [variant, onSetActive]);

  const handleRetry = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isVariantFailed(variant) && onRetry) {
      onRetry(variant.id);
    }
  }, [variant, onRetry]);

  const handleRetryRecipe = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isVariantReady(variant) && onRetryRecipe) {
      onRetryRecipe(variant);
    }
  }, [variant, onRetryRecipe]);

  const handleForkedToClick = useCallback((e: React.MouseEvent, assetId: string) => {
    e.stopPropagation();
    onGhostClick?.(assetId);
  }, [onGhostClick]);

  const nodeClasses = [
    styles.node,
    selected ? styles.selected : '',
    isActive ? styles.active : '',
    isSelected ? styles.highlighted : '',
    variant.starred ? styles.starred : '',
    isGhost ? styles.ghost : '',
    isVariantLoading(variant) ? styles.loading : '',
    isVariantFailed(variant) ? styles.failed : '',
    isExpanded ? styles.expanded : '',
  ].filter(Boolean).join(' ');

  // Render thumbnail based on variant status
  const renderThumbnail = () => {
    if (isVariantLoading(variant)) {
      const loadingLabels: Record<string, string> = {
        pending: 'Queued',
        processing: 'Generating',
        uploading: 'Uploading',
      };
      const statusLabel = loadingLabels[variant.status] || 'Loading';
      return (
        <div className={styles.generating}>
          <div className={styles.spinner} />
          <span>{statusLabel}</span>
        </div>
      );
    }

    if (isVariantFailed(variant)) {
      return (
        <div className={`${styles.generating} ${styles.failedContent}`}>
          <span className={styles.errorIcon}>⚠</span>
          <span>Failed</span>
          {onRetry && (
            <button className={styles.retryButton} onClick={handleRetry}>
              Retry
            </button>
          )}
        </div>
      );
    }

    const url = getVariantThumbnailUrl(variant);
    if (!url) {
      return (
        <div className={styles.placeholder}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="24" height="24">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
      );
    }

    return (
      <img
        src={url}
        alt={`Variant ${variant.id.slice(0, 8)}`}
        className={styles.image}
        draggable={false}
      />
    );
  };

  // Determine if we should show handles (only when connected or for potential connections)
  // Ghost nodes always have connections by definition:
  // - Parent ghosts: show top handle (they are sources)
  // - Derivative ghosts: show top handle (they receive the edge from parent in this asset)
  const showTopHandle = hasIncoming || (isGhost && !isDerivative);
  const showBottomHandle = hasOutgoing || !isGhost || isDerivative; // Non-ghost and derivative ghost nodes can have edges

  // Apply CSS custom property for scaling (used by CSS for proportional sizing)
  const nodeStyle = scale !== 1 ? { '--node-scale': scale } as React.CSSProperties : undefined;

  return (
    <div className={nodeClasses} onClick={handleClick} style={nodeStyle}>
      {/* Input handle (for incoming edges from parent variants) - hidden when no connections */}
      {showTopHandle && (
        <Handle type="target" position={targetPosition} className={styles.handle} />
      )}

      {/* Thumbnail */}
      <div className={styles.thumbnail}>
        {renderThumbnail()}

        {/* Indicators - only for completed variants */}
        {isVariantReady(variant) && isActive ? (
          <span className={styles.activeIndicator}>Active</span>
        ) : null}
        {isVariantReady(variant) && variant.starred ? (
          <span className={styles.starIndicator}>★</span>
        ) : null}

        {/* Hover actions - only for completed variants */}
        {isVariantReady(variant) ? (
          <div className={styles.actions}>
            {onAddToTray && (
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
                title="Set as Active"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            )}
            {onRetryRecipe && (
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

      {/* Expanded Details Panel */}
      {isExpanded && isVariantReady(variant) && !isGhost && (
        <div className={styles.detailsPanel} onClick={(e) => e.stopPropagation()}>
          <button className={styles.closeButton} onClick={handleCloseExpanded} title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>

          {/* Actions Row */}
          <div className={styles.detailsActions}>
            <button
              className={`${styles.detailActionButton} ${variant.starred ? styles.starred : ''}`}
              onClick={handleStarClick}
              title={variant.starred ? 'Unstar' : 'Star'}
            >
              {variant.starred ? '★' : '☆'}
            </button>
            <a
              className={styles.detailActionButton}
              href={`/api/images/${variant.image_key}`}
              download={`${asset.name}-${variant.id.slice(0, 8)}.png`}
              title="Download"
              onClick={(e) => e.stopPropagation()}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </a>
            {onAddToTray && (
              <button
                className={styles.detailActionButton}
                onClick={handleAddToTray}
                title="Add to Tray"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            )}
            {!isActive && onSetActive && (
              <button
                className={`${styles.detailActionButton} ${styles.setActive}`}
                onClick={handleSetActive}
                title="Set Active"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            )}
            {onDeleteVariant && variantCount > 1 && (
              <button
                className={`${styles.detailActionButton} ${styles.delete}`}
                onClick={handleDeleteClick}
                title="Delete"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
              </button>
            )}
          </div>

          {/* Metadata */}
          <div className={styles.detailsMeta}>
            <span className={styles.detailsDate}>{formatDate(variant.created_at)}</span>
            {recipe?.model && (
              <span className={styles.detailsModel}>{recipe.model}</span>
            )}
          </div>

          {/* Prompt */}
          {recipe?.prompt && (
            <div className={styles.detailsPrompt}>
              {recipe.prompt.length > 100 ? recipe.prompt.slice(0, 100) + '...' : recipe.prompt}
            </div>
          )}

          {/* Description */}
          {variant.description && (
            <div className={styles.detailsDescription}>
              {variant.description.length > 80 ? variant.description.slice(0, 80) + '...' : variant.description}
            </div>
          )}
        </div>
      )}

      {/* Output handle (for outgoing edges to child variants) - hidden for ghost nodes */}
      {showBottomHandle && (
        <Handle type="source" position={sourcePosition} className={styles.handle} />
      )}
    </div>
  );
}

export const VariantNode = memo(VariantNodeComponent);
