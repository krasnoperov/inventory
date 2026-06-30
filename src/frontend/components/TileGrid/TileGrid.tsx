import { useCallback } from 'react';
import type { TileSet, TilePosition, Variant } from '../../hooks/useSpaceWebSocket';
import { getR2ImageUrl } from '../../media-cdn';
import { Button } from '../../ui';
import styles from './TileGrid.module.css';

interface TileGridProps {
  tileSet: TileSet;
  tilePositions: TilePosition[];
  variants: Variant[];
  selectedVariantId?: string;
  onCellClick?: (variantId: string) => void;
  onRetryTile?: (tileSetId: string, gridX: number, gridY: number) => void;
  onRefineTile?: (tileSetId: string, gridX: number, gridY: number) => void;
  onRefineEdges?: (tileSetId: string) => void;
  onRateVariant?: (variantId: string, rating: 'approved' | 'rejected') => void;
  onExportTrainingData?: () => void;
}

export function TileGrid({
  tileSet,
  tilePositions,
  variants,
  selectedVariantId,
  onCellClick,
  onRetryTile,
  onRefineEdges,
  onRateVariant,
  onExportTrainingData,
}: TileGridProps) {
  const handleCellClick = useCallback(
    (variantId: string | undefined) => {
      if (variantId && onCellClick) onCellClick(variantId);
    },
    [onCellClick]
  );

  const positions = tilePositions.filter((tp) => tp.tile_set_id === tileSet.id);
  const selectedVariant = selectedVariantId
    ? variants.find((variant) => variant.id === selectedVariantId && variant.status === 'completed')
    : undefined;
  const selectedRating = (selectedVariant as (Variant & { quality_rating?: string }) | undefined)?.quality_rating;
  const hasFailedTiles = positions.some((p) => {
    const variant = variants.find((v) => v.id === p.variant_id);
    return variant?.status === 'failed';
  });

  return (
    <div className={styles.container}>
      <div className={styles.gridHeader}>
        <span className={styles.gridTitle}>
          {tileSet.tile_type} &middot; {tileSet.grid_width}x{tileSet.grid_height}
        </span>
        <span className={tileSet.status === 'failed' ? styles.gridInfoFailed : styles.gridInfo}>
          {tileSet.status === 'generating'
            ? `${tileSet.current_step}/${tileSet.total_steps} tiles`
            : tileSet.status === 'failed'
              ? 'Failed'
              : tileSet.status === 'completed'
                ? 'Completed'
                : tileSet.status === 'cancelled'
                  ? 'Cancelled'
                  : tileSet.status === 'pending'
                    ? 'Pending'
                    : tileSet.status}
        </span>
      </div>
      {tileSet.status === 'failed' && tileSet.error_message && (
        <div className={styles.errorBanner}>{tileSet.error_message}</div>
      )}
      {/* Action bar for completed sets */}
      {tileSet.status === 'completed' && (onRefineEdges || onExportTrainingData || (onRateVariant && selectedVariant)) && (
        <div className={styles.actionBar}>
          {onRefineEdges && (
            <Button
              className={styles.refineButton}
              onClick={() => onRefineEdges(tileSet.id)}
              variant="secondary"
              size="sm"
            >
              Refine Edges
            </Button>
          )}
          {onExportTrainingData && (
            <Button
              className={styles.refineButton}
              onClick={() => onExportTrainingData()}
              variant="secondary"
              size="sm"
            >
              Export Training Data
            </Button>
          )}
          {onRateVariant && selectedVariant && (
            <div className={styles.ratingActions} aria-label="Selected tile rating">
              <Button
                className={`${styles.ratingAction} ${selectedRating === 'approved' ? styles.ratingActionActive : ''}`}
                onClick={() => onRateVariant(selectedVariant.id, 'approved')}
                variant="secondary"
                size="sm"
                aria-pressed={selectedRating === 'approved'}
              >
                Approve
              </Button>
              <Button
                className={`${styles.ratingAction} ${selectedRating === 'rejected' ? styles.ratingActionActive : ''}`}
                onClick={() => onRateVariant(selectedVariant.id, 'rejected')}
                variant="secondary"
                size="sm"
                aria-pressed={selectedRating === 'rejected'}
              >
                Reject
              </Button>
            </div>
          )}
        </div>
      )}
      {/* Retry all failed tiles hint */}
      {hasFailedTiles && tileSet.status !== 'cancelled' && (
        <div className={styles.failedHint}>
          Some tiles failed. Click the retry button on failed cells.
        </div>
      )}
      <div
        className={styles.grid}
        style={{ gridTemplateColumns: `repeat(${tileSet.grid_width}, 1fr)` }}
      >
        {Array.from({ length: tileSet.grid_height }, (_, y) =>
          Array.from({ length: tileSet.grid_width }, (_, x) => {
            const pos = positions.find((p) => p.grid_x === x && p.grid_y === y);
            const variant = pos
              ? variants.find((v) => v.id === pos.variant_id)
              : undefined;
            const isCompleted = variant?.status === 'completed';
            const isGenerating =
              variant?.status === 'pending' || variant?.status === 'processing';
            const isFailed = variant?.status === 'failed';
            const imageUrl = variant?.image_key
              ? getR2ImageUrl(variant.image_key)
              : undefined;
            const isSelected = variant?.id === selectedVariantId;
            const qualityRating = (variant as Variant & { quality_rating?: string })?.quality_rating;
            const ratingClass = qualityRating === 'approved'
              ? styles.cellApproved
              : qualityRating === 'rejected'
                ? styles.cellRejected
                : '';
            const cellClassName = `${styles.cell} ${isSelected ? styles.selected : ''} ${isGenerating ? styles.generating : ''} ${isFailed ? styles.failed : ''} ${ratingClass}`;
            const cellLabel = variant
              ? `Tile ${x},${y}${isSelected ? ', selected' : ''}`
              : `Tile ${x},${y}, empty`;

            const cellContent = (
              <>
                {imageUrl && isCompleted ? (
                  <img
                    src={imageUrl}
                    alt={`Tile ${x},${y}`}
                    className={styles.cellImage}
                  />
                ) : (
                  <div className={styles.cellEmpty}>
                    {isGenerating && (
                      <span className={`${styles.statusBadge} ${styles.generating}`}>
                        gen
                      </span>
                    )}
                    {isFailed && (
                      <>
                        <span className={`${styles.statusBadge} ${styles.failed}`}>
                          err
                        </span>
                        {onRetryTile && (
                          <Button
                            className={styles.retryButton}
                            onClick={(e) => {
                              e.stopPropagation();
                              onRetryTile(tileSet.id, x, y);
                            }}
                            title="Retry this tile"
                            variant="primary"
                            size="sm"
                          >
                            Retry
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </>
            );

            return imageUrl && isCompleted ? (
              <button
                key={`${x}-${y}`}
                type="button"
                className={`${cellClassName} ${styles.interactive}`}
                onClick={() => handleCellClick(variant.id)}
                aria-label={cellLabel}
                aria-pressed={isSelected}
              >
                {cellContent}
              </button>
            ) : (
              <div
                key={`${x}-${y}`}
                className={cellClassName}
                onClick={() => handleCellClick(variant?.id)}
              >
                {cellContent}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
