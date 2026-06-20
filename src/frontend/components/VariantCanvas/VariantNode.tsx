import { memo, useCallback, useState, useEffect } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { type Asset, type SpaceSubject, type Variant, getVariantMediaUrl, isVariantReady, isVariantImageReady, isVariantForgeTrayReady, isVariantLoading, isVariantFailed } from '../../hooks/useSpaceWebSocket';
import { formatMediaKind } from '../../mediaKind';
import { formatUtcDateTime } from '../../lib/dates';
import { Thumbnail } from '../Thumbnail';
import { ImageLightbox } from '../ImageLightbox';
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
  /** Handler for starring/unstarring a variant */
  onStarVariant?: (variantId: string, starred: boolean) => void;
  /** Handler for deleting a variant */
  onDeleteVariant?: (variant: Variant) => void;
  /** Handler for creating a manual relation from this variant */
  onCreateRelation?: (subject: SpaceSubject) => void;
  /** Total number of variants (to disable delete when only 1) */
  variantCount?: number;
  /** Space ID for authenticated media downloads */
  spaceId?: string;
  /** Exact thumbnail width (px) so the card matches the image aspect ratio */
  thumbWidth?: number;
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
    onStarVariant,
    onDeleteVariant,
    onCreateRelation,
    variantCount = 0,
    spaceId,
    thumbWidth,
  } = data;

  // Expanded state for showing details
  const [isExpanded, setIsExpanded] = useState(false);
  // Full-resolution lightbox
  const [lightboxOpen, setLightboxOpen] = useState(false);
  // Raw metadata disclosure (collapsed by default to keep the panel lean)
  const [showRawMeta, setShowRawMeta] = useState(false);
  // Fallback image dimensions when the variant has none stored (e.g. uploads)
  const [measuredDims, setMeasuredDims] = useState<{ width: number; height: number } | null>(null);

  // Lazily measure real dimensions only when the panel is open and the variant
  // has no stored media_width/height. Most generated variants store these, so
  // this load is rare.
  useEffect(() => {
    if (!isExpanded) return;
    if (variant.media_width && variant.media_height) return;
    if (!isVariantImageReady(variant)) return;
    const url = getVariantMediaUrl(variant, spaceId);
    if (!url) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setMeasuredDims({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [isExpanded, variant, spaceId]);

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

  const handleCreateRelationClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onCreateRelation?.({ subjectType: 'variant', variantId: variant.id });
  }, [onCreateRelation, variant.id]);

  const handleCloseExpanded = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(false);
  }, []);

  const handleOpenLightbox = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setLightboxOpen(true);
  }, []);

  const handleCloseLightbox = useCallback(() => setLightboxOpen(false), []);

  // Parse recipe for details
  const parseRecipe = (recipe: string) => {
    try {
      return JSON.parse(recipe);
    } catch {
      return null;
    }
  };

  const recipe = parseRecipe(variant.recipe);
  const provenanceSummary = formatMetadataSummary(variant.generation_provenance, [
    'operation',
    'assetType',
    'mediaKind',
    'model',
    'modelProvider',
    'prompt',
  ]);
  const providerSummary = formatMetadataSummary(variant.provider_metadata, [
    'provider',
    'providerMode',
    'model',
    'operation',
    'api',
    'resolution',
    'durationSeconds',
  ]);

  // Lean derived fields for the details panel
  const dimWidth = variant.media_width ?? measuredDims?.width ?? null;
  const dimHeight = variant.media_height ?? measuredDims?.height ?? null;
  const dimensionsLabel = dimWidth && dimHeight ? `${dimWidth}×${dimHeight}` : null;
  const sizeLabel = formatBytes(variant.media_size_bytes);
  const keyFacts = extractKeyFacts(variant, recipe);
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
    if (isVariantImageReady(variant) && onRetryRecipe) {
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

  // Render thumbnail based on variant status and media kind
  const renderThumbnail = () => {
    return (
      <Thumbnail
        variant={variant}
        size="fill"
        spaceId={spaceId}
        showAudioControls
        showVideoControls
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
      <div className={styles.thumbnail} style={thumbWidth ? { width: thumbWidth } : undefined}>
        {renderThumbnail()}

        {/* Indicators - only for completed variants */}
        {isVariantReady(variant) && isActive ? (
          <span className={styles.activeIndicator}>Active</span>
        ) : null}
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
                title="Set as Active"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            )}
            {onRetryRecipe && isVariantImageReady(variant) && (
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
            {canViewFullSize && (
              <button
                className={styles.detailActionButton}
                onClick={handleOpenLightbox}
                title="View full size"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
              </button>
            )}
            <button
              className={`${styles.detailActionButton} ${variant.starred ? styles.starred : ''}`}
              onClick={handleStarClick}
              title={variant.starred ? 'Unstar' : 'Star'}
            >
              {variant.starred ? '★' : '☆'}
            </button>
            <a
              className={styles.detailActionButton}
              href={getVariantMediaUrl(variant, spaceId)}
              download={`${asset.name}-${variant.id.slice(0, 8)}`}
              title="Download"
              onClick={(e) => e.stopPropagation()}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </a>
            {onAddToTray && isVariantForgeTrayReady(variant) && (
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
            {onCreateRelation && (
              <button
                className={styles.detailActionButton}
                onClick={handleCreateRelationClick}
                title="Create relation"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4.93" />
                  <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L13 19.07" />
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

          {/* Metadata - one lean line: when · kind · dimensions · size */}
          <div className={styles.detailsMeta}>
            <span className={styles.detailsDate}>{formatUtcDateTime(variant.created_at)}</span>
            <span className={styles.detailsChip}>{formatMediaKind(variant.media_kind)}</span>
            {dimensionsLabel && <span className={styles.detailsChip}>{dimensionsLabel}</span>}
            {sizeLabel && <span className={styles.detailsChip}>{sizeLabel}</span>}
          </div>

          {/* Prompt */}
          {recipe?.prompt && (
            <div className={styles.detailsPrompt}>
              {recipe.prompt.length > 140 ? recipe.prompt.slice(0, 140) + '…' : recipe.prompt}
            </div>
          )}

          {/* Key facts - compact chip row (operation · type · provider · model) */}
          {keyFacts.length > 0 && (
            <div className={styles.detailsFacts}>
              {keyFacts.map((fact) => (
                <span key={fact} className={styles.detailsChip}>{fact}</span>
              ))}
            </div>
          )}

          {/* Raw metadata - collapsed by default so it costs ~one line */}
          {(provenanceSummary || providerSummary) && (
            <div className={styles.detailsRaw}>
              <button
                className={styles.detailsRawToggle}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowRawMeta((prev) => !prev);
                }}
                aria-expanded={showRawMeta}
              >
                <svg
                  className={`${styles.detailsRawChevron} ${showRawMeta ? styles.detailsRawChevronOpen : ''}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                Raw metadata
              </button>
              {showRawMeta && (
                <div className={styles.detailsGeneration}>
                  {provenanceSummary && (
                    <div className={styles.detailsGenerationRow}>
                      <span>Provenance</span>
                      <code>{provenanceSummary}</code>
                    </div>
                  )}
                  {providerSummary && (
                    <div className={styles.detailsGenerationRow}>
                      <span>Provider</span>
                      <code>{providerSummary}</code>
                    </div>
                  )}
                </div>
              )}
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

function formatMetadataSummary(value: string | null | undefined, preferredKeys: string[]): string | null {
  if (!value) return null;
  const parsed = parseJsonObject(value);
  if (!parsed) return truncateText(value, 140);

  const parts: string[] = [];
  for (const key of preferredKeys) {
    const field = parsed[key];
    if (field === undefined || field === null || typeof field === 'object') continue;
    parts.push(`${key}=${String(field)}`);
  }

  return parts.length > 0 ? truncateText(parts.join(' '), 180) : truncateText(JSON.stringify(parsed), 180);
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

/** Human-readable byte size, e.g. 245 KB / 1.8 MB. */
function formatBytes(bytes: number | null | undefined): string | null {
  if (!bytes || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? value : value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded} ${units[unit]}`;
}

/**
 * Pull the few high-value facts (operation, asset type, provider, model) out of
 * the verbose provenance/provider metadata for the compact chip row. Falls back
 * across sources and de-dupes so chips stay lean.
 */
function extractKeyFacts(variant: Variant, recipe: { model?: string } | null): string[] {
  const prov = variant.generation_provenance ? parseJsonObject(variant.generation_provenance) : null;
  const provider = variant.provider_metadata ? parseJsonObject(variant.provider_metadata) : null;
  const facts: string[] = [];
  const add = (value: unknown) => {
    if (value === undefined || value === null || typeof value === 'object') return;
    const text = String(value).trim();
    if (text && !facts.some((f) => f.toLowerCase() === text.toLowerCase())) facts.push(text);
  };
  add(prov?.operation);
  add(prov?.assetType);
  add(provider?.provider ?? prov?.modelProvider);
  add(recipe?.model ?? provider?.model ?? prov?.model);
  return facts;
}

export const VariantNode = memo(VariantNodeComponent);
