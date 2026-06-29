import { useEffect, useState, useCallback } from 'react';
import type {
  TileType,
  TileSet,
  TilePosition,
  Variant,
  TileSetRequestParams,
} from '../../hooks/useSpaceWebSocket';
import { getR2ImageUrl } from '../../media-cdn';
import { Button, Checkbox, IconButton, TextArea, UiSelect, type SelectOption } from '../../ui';
import styles from './TileSetPanel.module.css';

type GenerationMode = 'sequential' | 'single-shot';

const TILE_TYPE_OPTIONS: Array<SelectOption<TileType>> = [
  { value: 'terrain', label: 'Terrain' },
  { value: 'building', label: 'Building' },
  { value: 'decoration', label: 'Decor' },
  { value: 'custom', label: 'Custom' },
];

const GRID_SIZES = [2, 3, 4, 5] as const;
const GRID_SIZE_OPTIONS: Array<SelectOption<string>> = GRID_SIZES.map((size) => ({
  value: String(size),
  label: `${size}x${size}`,
}));
const GENERATION_MODE_OPTIONS: Array<SelectOption<GenerationMode>> = [
  { value: 'sequential', label: 'Sequential' },
  { value: 'single-shot', label: 'Single-Shot' },
];

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

interface TileSetPanelProps {
  tileSets: TileSet[];
  tilePositions: TilePosition[];
  variants: Variant[];
  onSubmit: (params: TileSetRequestParams) => void;
  onCancel: (tileSetId: string) => void;
  onClose: () => void;
  hasDefaultStyle?: boolean;
}

export function TileSetPanel({
  tileSets,
  tilePositions,
  variants,
  onSubmit,
  onCancel,
  onClose,
  hasDefaultStyle = false,
}: TileSetPanelProps) {
  const [tileType, setTileType] = useState<TileType>('terrain');
  const [gridSize, setGridSize] = useState(3);
  const [prompt, setPrompt] = useState('');
  const [disableStyle, setDisableStyle] = useState(false);
  const [generationMode, setGenerationMode] = useState<GenerationMode>('sequential');
  const [dismissedFailedSetId, setDismissedFailedSetId] = useState<string | null>(null);

  // Check for active tile sets
  const activeSet = tileSets.find((ts) => ts.status === 'generating');

  // Check for failed sets (most recent first)
  const failedSet = [...tileSets].reverse().find(
    (ts) => ts.status === 'failed' && ts.id !== dismissedFailedSetId
  );
  const failedSetId = failedSet?.id;
  const failedSetTileType = failedSet?.tile_type;
  const failedSetGridWidth = failedSet?.grid_width;
  const failedSetConfig = failedSet?.config;

  // Pre-fill form state from the failed set so "Try Again" works
  useEffect(() => {
    if (!failedSetId || !failedSetTileType || failedSetGridWidth == null || failedSetConfig == null) return;
    /* eslint-disable react-hooks/set-state-in-effect -- prefilling form state when a failed set appears */
    setTileType(failedSetTileType);
    setGridSize(failedSetGridWidth);
    try {
      const parsed = JSON.parse(failedSetConfig) as {
        prompt?: string;
        disableStyle?: boolean;
      };
      if (parsed.prompt) setPrompt(parsed.prompt);
      if (parsed.disableStyle) setDisableStyle(true);
    } catch { /* ignore malformed config */ }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [failedSetId, failedSetTileType, failedSetGridWidth, failedSetConfig]);

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
  }, [onSubmit, tileType, gridSize, prompt, disableStyle, generationMode]);

  // Progress view for active tile set
  if (activeSet) {
    const positions = tilePositions.filter((tp) => tp.tile_set_id === activeSet.id);
    return (
      <div className={styles.backdrop} onClick={handleBackdropClick}>
        <div className={styles.modal}>
          <div className={styles.header}>
            <h2 className={styles.title}>Tile Set in Progress</h2>
            <IconButton onClick={onClose} aria-label="Close tile set panel" title="Close" variant="ghost" size="sm">
              <CloseIcon />
            </IconButton>
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
                      ? getR2ImageUrl(variant.thumb_key || variant.image_key)
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
            <Button
              variant="secondary"
              onClick={() => onCancel(activeSet.id)}
            >
              Cancel
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
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
            <IconButton onClick={onClose} aria-label="Close tile set panel" title="Close" variant="ghost" size="sm">
              <CloseIcon />
            </IconButton>
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
            <Button
              variant="secondary"
              onClick={() => setDismissedFailedSetId(failedSet.id)}
            >
              Configure New
            </Button>
            <Button
              variant="primary"
              onClick={handleStart}
              disabled={!prompt.trim()}
            >
              Try Again
            </Button>
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
          <IconButton onClick={onClose} aria-label="Close tile set panel" title="Close" variant="ghost" size="sm">
            <CloseIcon />
          </IconButton>
        </div>

        <div className={styles.content}>
          <div className={styles.inputGroup}>
            <span className={styles.sectionLabel}>Tile Type</span>
            <UiSelect
              className={styles.select}
              value={tileType}
              options={TILE_TYPE_OPTIONS}
              onValueChange={setTileType}
              label="Tile Type"
              fullWidth
            />
          </div>

          <div className={styles.inputGroup}>
            <span className={styles.sectionLabel}>Grid Size</span>
            <UiSelect
              className={styles.select}
              value={String(gridSize)}
              options={GRID_SIZE_OPTIONS}
              onValueChange={(value) => setGridSize(Number(value))}
              label="Grid Size"
              fullWidth
            />
          </div>

          {/* Theme prompt */}
          <div className={styles.inputGroup}>
            <span className={styles.sectionLabel}>Theme / Description</span>
            <TextArea
              className={styles.textArea}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. lush green forest floor with mossy stones and fallen leaves"
              rows={3}
              fullWidth
            />
            <span className={styles.inputHint}>
              Describe the overall theme. Each tile will be generated with adjacency context.
            </span>
          </div>

          <div className={styles.inputGroup}>
            <span className={styles.sectionLabel}>Generation Mode</span>
            <UiSelect
              className={styles.select}
              value={generationMode}
              options={GENERATION_MODE_OPTIONS}
              onValueChange={setGenerationMode}
              label="Generation Mode"
              fullWidth
            />
            <span className={styles.inputHint}>
              {generationMode === 'sequential'
                ? 'Generates tiles one-by-one with adjacency context (higher quality).'
                : 'Generates entire grid as one image then slices (faster, no inter-step drift).'}
            </span>
          </div>

          {/* No style checkbox */}
          {hasDefaultStyle && (
            <label className={styles.noStyleCheck}>
              <Checkbox
                className={styles.noStyleCheckbox}
                checked={disableStyle}
                onChange={(e) => setDisableStyle(e.target.checked)}
              />
              <span>No style</span>
            </label>
          )}
        </div>

        <div className={styles.footer}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleStart}
            disabled={!prompt.trim()}
          >
            Generate {gridSize}x{gridSize} Tiles
          </Button>
        </div>
      </div>
    </div>
  );
}
