import { useCallback } from 'react';
import type { TileSet, TilePosition, Variant } from '../../hooks/useSpaceWebSocket';
import styles from './TileGrid.module.css';

interface TileGridProps {
  tileSet: TileSet;
  tilePositions: TilePosition[];
  variants: Variant[];
  selectedVariantId?: string;
  onCellClick?: (variantId: string) => void;
}

export function TileGrid({
  tileSet,
  tilePositions,
  variants,
  selectedVariantId,
  onCellClick,
}: TileGridProps) {
  const handleCellClick = useCallback(
    (variantId: string | undefined) => {
      if (variantId && onCellClick) onCellClick(variantId);
    },
    [onCellClick]
  );

  const positions = tilePositions.filter((tp) => tp.tile_set_id === tileSet.id);

  return (
    <div className={styles.container}>
      <div className={styles.gridHeader}>
        <span className={styles.gridTitle}>
          {tileSet.tile_type} &middot; {tileSet.grid_width}x{tileSet.grid_height}
        </span>
        <span className={styles.gridInfo}>
          {tileSet.status === 'generating'
            ? `${tileSet.current_step}/${tileSet.total_steps} tiles`
            : tileSet.status}
        </span>
      </div>
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

            return (
              <div
                key={`${x}-${y}`}
                className={`${styles.cell} ${isSelected ? styles.selected : ''} ${isGenerating ? styles.generating : ''}`}
                onClick={() => handleCellClick(variant?.id)}
              >
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
                      <span className={`${styles.statusBadge} ${styles.failed}`}>
                        err
                      </span>
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
