import { useCallback } from 'react';
import type { TileSet, TilePosition, Variant } from '../../hooks/useSpaceWebSocket';
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
  onRefineTile,
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
      {tileSet.status === 'completed' && (onRefineEdges || onExportTrainingData) && (
        <div className={styles.actionBar}>
          {onRefineEdges && (
            <button
              className={styles.refineButton}
              onClick={() => onRefineEdges(tileSet.id)}
            >
              Refine Edges
            </button>
          )}
          {onExportTrainingData && (
            <button
              className={styles.refineButton}
              onClick={onExportTrainingData}
            >
              Export Training Data
            </button>
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
              ? `/api/images/${variant.image_key}`
              : undefined;
            const isSelected = variant?.id === selectedVariantId;
            const qualityRating = (variant as Variant & { quality_rating?: string })?.quality_rating;

            return (
              <div
                key={`${x}-${y}`}
                className={`${styles.cell} ${isSelected ? styles.selected : ''} ${isGenerating ? styles.generating : ''} ${isFailed ? styles.failed : ''}`}
                onClick={() => handleCellClick(variant?.id)}
              >
                {imageUrl && isCompleted ? (
                  <>
                    <img
                      src={imageUrl}
                      alt={`Tile ${x},${y}`}
                      className={styles.cellImage}
                    />
                    {/* Quality rating overlay */}
                    {qualityRating === 'approved' && (
                      <span className={styles.ratingApproved} title="Approved">&#10003;</span>
                    )}
                    {qualityRating === 'rejected' && (
                      <span className={styles.ratingRejected} title="Rejected">&#10005;</span>
                    )}
                    {/* Rating buttons (on hover) */}
                    {onRateVariant && variant && (
                      <div className={styles.ratingButtons}>
                        <button
                          className={`${styles.rateBtn} ${styles.rateBtnApprove}`}
                          onClick={(e) => { e.stopPropagation(); onRateVariant(variant.id, 'approved'); }}
                          title="Approve"
                        >&#9650;</button>
                        <button
                          className={`${styles.rateBtn} ${styles.rateBtnReject}`}
                          onClick={(e) => { e.stopPropagation(); onRateVariant(variant.id, 'rejected'); }}
                          title="Reject"
                        >&#9660;</button>
                      </div>
                    )}
                  </>
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
                          <button
                            className={styles.retryButton}
                            onClick={(e) => {
                              e.stopPropagation();
                              onRetryTile(tileSet.id, x, y);
                            }}
                            title="Retry this tile"
                          >
                            Retry
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
