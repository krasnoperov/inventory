import { useEffect, useState, useCallback } from 'react';
import type {
  Asset,
  Variant,
  RotationConfig,
  RotationSet,
  RotationView,
  RotationRequestParams,
} from '../../hooks/useSpaceWebSocket';
import styles from './RotationPanel.module.css';

const CONFIGS: { value: RotationConfig; label: string; icon: string; count: number }[] = [
  { value: '4-directional', label: '4-Dir', icon: '???', count: 4 },
  { value: '8-directional', label: '8-Dir', icon: '???', count: 8 },
  { value: 'turnaround', label: 'Turnaround', icon: '????', count: 24 },
];

interface RotationPanelProps {
  sourceVariant: Variant;
  sourceAsset: Asset;
  rotationSets: RotationSet[];
  rotationViews: RotationView[];
  variants: Variant[];
  onSubmit: (params: RotationRequestParams) => void;
  onCancel: (rotationSetId: string) => void;
  onClose: () => void;
}

export function RotationPanel({
  sourceVariant,
  sourceAsset,
  rotationSets,
  rotationViews,
  variants,
  onSubmit,
  onCancel,
  onClose,
}: RotationPanelProps) {
  const [config, setConfig] = useState<RotationConfig>('4-directional');
  const [subjectDescription, setSubjectDescription] = useState(
    sourceVariant.description || sourceAsset.name
  );

  // Check if there's an active rotation set for this variant
  const activeSet = rotationSets.find(
    (rs) => rs.source_variant_id === sourceVariant.id && rs.status === 'generating'
  );

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
    onSubmit({
      sourceVariantId: sourceVariant.id,
      config,
      subjectDescription: subjectDescription || undefined,
    });
  }, [onSubmit, sourceVariant.id, config, subjectDescription]);

  const thumbUrl = sourceVariant.image_key
    ? `/api/images/${sourceVariant.thumb_key || sourceVariant.image_key}`
    : undefined;

  // Progress view for active rotation
  if (activeSet) {
    const views = rotationViews.filter((rv) => rv.rotation_set_id === activeSet.id);
    return (
      <div className={styles.backdrop} onClick={handleBackdropClick}>
        <div className={styles.modal}>
          <div className={styles.header}>
            <h2 className={styles.title}>Rotation in Progress</h2>
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
                <span className={styles.progressLabel}>{activeSet.config}</span>
                <span className={styles.progressCount}>
                  {activeSet.current_step} / {activeSet.total_steps}
                </span>
              </div>
              <div className={styles.compassGrid}>
                {views.map((view) => {
                  const variant = variants.find((v) => v.id === view.variant_id);
                  const isCompleted = variant?.status === 'completed';
                  const isGenerating = variant?.status === 'pending' || variant?.status === 'processing';
                  const viewThumb = variant?.image_key
                    ? `/api/images/${variant.thumb_key || variant.image_key}`
                    : undefined;

                  return (
                    <div
                      key={view.id}
                      className={`${styles.directionCell} ${isCompleted ? styles.completed : ''} ${isGenerating ? styles.generating : ''} ${view.step_index === 0 ? styles.center : ''}`}
                    >
                      {viewThumb && <img src={viewThumb} alt={view.direction} className={styles.directionThumb} />}
                      <span className={styles.directionLabel}>{view.direction}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className={styles.footer}>
            <button
              className={styles.cancelButton}
              onClick={() => onCancel(activeSet.id)}
            >
              Cancel Rotation
            </button>
            <button className={styles.cancelButton} onClick={onClose}>
              Close
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
          <h2 className={styles.title}>Generate Rotation Set</h2>
          <button className={styles.closeButton} onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.content}>
          {/* Source preview */}
          <div className={styles.sourcePreview}>
            {thumbUrl ? (
              <img src={thumbUrl} alt={sourceAsset.name} className={styles.sourceImage} />
            ) : (
              <div className={styles.sourceImage} style={{ background: 'var(--color-bg)' }} />
            )}
            <div className={styles.sourceInfo}>
              <div className={styles.sourceName}>{sourceAsset.name}</div>
              <div className={styles.sourceLabel}>Source variant</div>
            </div>
          </div>

          {/* Config selection */}
          <div className={styles.configSection}>
            <span className={styles.sectionLabel}>Configuration</span>
            <div className={styles.configGrid}>
              {CONFIGS.map((c) => (
                <button
                  key={c.value}
                  className={`${styles.configCard} ${config === c.value ? styles.selected : ''}`}
                  onClick={() => setConfig(c.value)}
                >
                  <span className={styles.configIcon}>{c.icon}</span>
                  <span className={styles.configLabel}>{c.label}</span>
                  <span className={styles.configCount}>{c.count} views</span>
                </button>
              ))}
            </div>
          </div>

          {/* Subject description */}
          <div className={styles.inputGroup}>
            <span className={styles.sectionLabel}>Subject Description</span>
            <input
              type="text"
              className={styles.textInput}
              value={subjectDescription}
              onChange={(e) => setSubjectDescription(e.target.value)}
              placeholder="e.g. a pixel art warrior character"
            />
            <span className={styles.inputHint}>
              Helps the AI maintain consistency across views
            </span>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.startButton}
            onClick={handleStart}
            disabled={!sourceVariant.image_key}
          >
            Start Rotation
          </button>
        </div>
      </div>
    </div>
  );
}
