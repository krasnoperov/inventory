import { useEffect, useState, useCallback } from 'react';
import type {
  TileType,
  TileSet,
  TilePosition,
  Variant,
  TileSetRequestParams,
} from '../../hooks/useSpaceWebSocket';
import { useStyleStore } from '../../stores/styleStore';
import styles from './TileSetPanel.module.css';

const TILE_TYPES: { value: TileType; label: string; icon: string }[] = [
  { value: 'terrain', label: 'Terrain', icon: '????' },
  { value: 'building', label: 'Building', icon: '????' },
  { value: 'decoration', label: 'Decor', icon: '????' },
  { value: 'custom', label: 'Custom', icon: '????' },
];

const GRID_SIZES = [2, 3, 4, 5] as const;

interface TileSetPanelProps {
  tileSets: TileSet[];
  tilePositions: TilePosition[];
  variants: Variant[];
  onSubmit: (params: TileSetRequestParams) => void;
  onCancel: (tileSetId: string) => void;
  onClose: () => void;
}

export function TileSetPanel({
  tileSets,
  tilePositions,
  variants,
  onSubmit,
  onCancel,
  onClose,
}: TileSetPanelProps) {
  const [tileType, setTileType] = useState<TileType>('terrain');
  const [gridSize, setGridSize] = useState(3);
  const [prompt, setPrompt] = useState('');
  const [disableStyle, setDisableStyle] = useState(false);
  const [generationMode, setGenerationMode] = useState<'sequential' | 'single-shot'>('sequential');
  const [dismissedFailedSetId, setDismissedFailedSetId] = useState<string | null>(null);
  const style = useStyleStore((s) => s.style);

  // Check for active tile sets
  const activeSet = tileSets.find((ts) => ts.status === 'generating');

  // Check for failed sets (most recent first)
  const failedSet = [...tileSets].reverse().find(
    (ts) => ts.status === 'failed' && ts.id !== dismissedFailedSetId
  );

  // Pre-fill form state from the failed set so "Try Again" works
  useEffect(() => {
    if (!failedSet) return;
    setTileType(failedSet.tile_type);
    setGridSize(failedSet.grid_width);
    try {
      const parsed = JSON.parse(failedSet.config) as {
        prompt?: string;
        disableStyle?: boolean;
      };
      if (parsed.prompt) setPrompt(parsed.prompt);
      if (parsed.disableStyle) setDisableStyle(true);
    } catch { /* ignore malformed config */ }
  }, [failedSet?.id]);

  // Close on Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  const handleStart = useCallback(() => {
    if (!prompt.trim()) return;
    onSubmit({
      tileType,
      gridWidth: gridSize,
      gridHeight: gridSize,
      prompt: prompt.trim(),
      disableStyle: disableStyle || undefined,
      generationMode,
    });
  }, [onSubmit, tileType, gridSize, prompt, disableStyle]);

  // Progress view for active tile set
  if (activeSet) {
    const positions = tilePositions.filter((tp) => tp.tile_set_id === activeSet.id);
    return (
      <div className={styles.backdrop} onClick={handleBackdropClick}>
        <div className={styles.modal}>
          <div className={styles.header}>
            <h2 className={styles.title}>Tile Set in Progress</h2>
            <button className={styles.closeButton} onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className={styles.content}>
            <div className={styles.progressSection}>
              <div className={styles.progressHeader}>
                <span className={styles.progressLabel}>
                  {activeSet.tile_type} &middot; {activeSet.grid_width}x{activeSet.grid_height}
                </span>
                <span className={styles.progressCount}>
                  {activeSet.current_step} / {activeSet.total_steps}
                </span>
              </div>
              <div
                className={styles.progressGrid}
                style={{ gridTemplateColumns: `repeat(${activeSet.grid_width}, 1fr)` }}
              >
                {Array.from({ length: activeSet.grid_height }, (_, y) =>
                  Array.from({ length: activeSet.grid_width }, (_, x) => {
                    const pos = positions.find((p) => p.grid_x === x && p.grid_y === y);
                    const variant = pos
                      ? variants.find((v) => v.id === pos.variant_id)
                      : undefined;
                    const isCompleted = variant?.status === 'completed';
                    const isGenerating =
                      variant?.status === 'pending' || variant?.status === 'processing';
                    const cellThumb = variant?.image_key
                      ? `/api/images/${variant.thumb_key || variant.image_key}`
                      : undefined;

                    return (
                      <div
                        key={`${x}-${y}`}
                        className={`${styles.progressCell} ${isCompleted ? styles.completed : ''} ${isGenerating ? styles.generating : ''}`}
                      >
                        {cellThumb && (
                          <img src={cellThumb} alt={`${x},${y}`} className={styles.cellThumb} />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
          <div className={styles.footer}>
            <button
              className={styles.cancelButton}
              onClick={() => onCancel(activeSet.id)}
            >
              Cancel
            </button>
            <button className={styles.cancelButton} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Error view for failed tile set
  if (failedSet) {
    const positions = tilePositions.filter((tp) => tp.tile_set_id === failedSet.id);
    const completedCount = positions.filter((p) => {
      const variant = variants.find((v) => v.id === p.variant_id);
      return variant?.status === 'completed';
    }).length;

    return (
      <div className={styles.backdrop} onClick={handleBackdropClick}>
        <div className={styles.modal}>
          <div className={styles.header}>
            <h2 className={styles.title}>Tile Set Failed</h2>
            <button className={styles.closeButton} onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className={styles.content}>
            <div className={styles.errorSection}>
              <div className={styles.errorIcon}>!</div>
              <div className={styles.errorMessage}>
                {failedSet.error_message || 'An error occurred during tile set generation.'}
              </div>
              <div className={styles.errorHint}>
                {completedCount} of {failedSet.total_steps} tiles completed before failure.
              </div>
            </div>
          </div>
          <div className={styles.footer}>
            <button
              className={styles.cancelButton}
              onClick={() => setDismissedFailedSetId(failedSet.id)}
            >
              Configure New
            </button>
            <button
              className={styles.startButton}
              onClick={handleStart}
              disabled={!prompt.trim()}
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Setup view
  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Create Tile Set</h2>
          <button className={styles.closeButton} onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.content}>
          {/* Tile type selection */}
          <div className={styles.inputGroup}>
            <span className={styles.sectionLabel}>Tile Type</span>
            <div className={styles.typeGrid}>
              {TILE_TYPES.map((t) => (
                <button
                  key={t.value}
                  className={`${styles.typeCard} ${tileType === t.value ? styles.selected : ''}`}
                  onClick={() => setTileType(t.value)}
                >
                  <span className={styles.typeIcon}>{t.icon}</span>
                  <span className={styles.typeLabel}>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Grid size */}
          <div className={styles.inputGroup}>
            <span className={styles.sectionLabel}>Grid Size</span>
            <div className={styles.sizeButtons}>
              {GRID_SIZES.map((size) => (
                <button
                  key={size}
                  className={`${styles.sizeButton} ${gridSize === size ? styles.selected : ''}`}
                  onClick={() => setGridSize(size)}
                >
                  {size}x{size}
                </button>
              ))}
            </div>
          </div>

          {/* Theme prompt */}
          <div className={styles.inputGroup}>
            <span className={styles.sectionLabel}>Theme / Description</span>
            <textarea
              className={styles.textArea}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. lush green forest floor with mossy stones and fallen leaves"
              rows={3}
            />
            <span className={styles.inputHint}>
              Describe the overall theme. Each tile will be generated with adjacency context.
            </span>
          </div>

          {/* Generation mode toggle */}
          <div className={styles.inputGroup}>
            <span className={styles.sectionLabel}>Generation Mode</span>
            <div className={styles.sizeButtons}>
              <button
                className={`${styles.sizeButton} ${generationMode === 'sequential' ? styles.selected : ''}`}
                onClick={() => setGenerationMode('sequential')}
              >
                Sequential
              </button>
              <button
                className={`${styles.sizeButton} ${generationMode === 'single-shot' ? styles.selected : ''}`}
                onClick={() => setGenerationMode('single-shot')}
              >
                Single-Shot
              </button>
            </div>
            <span className={styles.inputHint}>
              {generationMode === 'sequential'
                ? 'Generates tiles one-by-one with adjacency context (higher quality).'
                : 'Generates entire grid as one image then slices (faster, no inter-step drift).'}
            </span>
          </div>

          {/* No style checkbox */}
          {style?.enabled && (
            <label className={styles.noStyleCheck}>
              <input
                type="checkbox"
                checked={disableStyle}
                onChange={(e) => setDisableStyle(e.target.checked)}
              />
              <span>No style</span>
            </label>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.startButton}
            onClick={handleStart}
            disabled={!prompt.trim()}
          >
            Generate {gridSize}x{gridSize} Tiles
          </button>
        </div>
      </div>
    </div>
  );
}
