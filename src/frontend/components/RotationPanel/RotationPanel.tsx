import { useEffect, useState, useCallback } from 'react';
import type {
  Asset,
  Variant,
  RotationConfig,
  RotationSet,
  RotationView,
  RotationRequestParams,
} from '../../hooks/useSpaceWebSocket';
import { getR2ImageUrl } from '../../media-cdn';
import { Button, Checkbox, IconButton, SegmentedControl, TextInput, UiSelect, type SelectOption } from '../../ui';
import { DockedSheet } from '../DockedSheet';
import styles from './RotationPanel.module.css';

type GenerationMode = 'sequential' | 'single-shot';
type QualityRating = 'approved' | 'rejected';

const CONFIG_OPTIONS: Array<SelectOption<RotationConfig>> = [
  { value: '4-directional', label: '4-Dir · 4 views' },
  { value: '8-directional', label: '8-Dir · 8 views' },
  { value: 'turnaround', label: 'Turnaround · 5 views' },
];
const GENERATION_MODE_OPTIONS: Array<SelectOption<GenerationMode>> = [
  { value: 'sequential', label: 'Sequential' },
  { value: 'single-shot', label: 'Single-Shot' },
];
const RATING_OPTIONS: Array<{ value: QualityRating; label: string; tone?: 'danger' }> = [
  { value: 'approved', label: 'Approve' },
  { value: 'rejected', label: 'Reject', tone: 'danger' },
];

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

interface RotationPanelProps {
  sourceVariant: Variant;
  sourceAsset: Asset;
  rotationSets: RotationSet[];
  rotationViews: RotationView[];
  variants: Variant[];
  onSubmit: (params: RotationRequestParams & { generationMode?: 'sequential' | 'single-shot' }) => void;
  onCancel: (rotationSetId: string) => void;
  onClose: () => void;
  hasDefaultStyle?: boolean;
  onRateVariant?: (variantId: string, rating: 'approved' | 'rejected') => void;
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
  hasDefaultStyle = false,
  onRateVariant,
}: RotationPanelProps) {
  const [config, setConfig] = useState<RotationConfig>('4-directional');
  const [subjectDescription, setSubjectDescription] = useState(
    sourceVariant.description || sourceAsset.name
  );
  const [disableStyle, setDisableStyle] = useState(false);
  const [generationMode, setGenerationMode] = useState<GenerationMode>('sequential');
  const [dismissedFailedSetId, setDismissedFailedSetId] = useState<string | null>(null);
  const [selectedCompletedViewId, setSelectedCompletedViewId] = useState<string | null>(null);

  // Check if there's an active rotation set for this variant
  const activeSet = rotationSets.find(
    (rs) => rs.source_variant_id === sourceVariant.id && rs.status === 'generating'
  );

  // Check for failed/completed sets (most recent first)
  const failedSet = [...rotationSets].reverse().find(
    (rs) => rs.source_variant_id === sourceVariant.id && rs.status === 'failed' && rs.id !== dismissedFailedSetId
  );
  const completedSet = [...rotationSets].reverse().find(
    (rs) => rs.source_variant_id === sourceVariant.id && rs.status === 'completed'
  );

  // Pre-fill config from the most relevant existing set (failed > completed)
  const prefillSet = failedSet || completedSet;
  const prefillSetId = prefillSet?.id;
  const prefillSetConfig = prefillSet?.config;
  useEffect(() => {
    if (!prefillSetId || prefillSetConfig == null) return;
    try {
      const parsed = JSON.parse(prefillSetConfig) as {
        type?: RotationConfig;
        subjectDescription?: string;
        disableStyle?: boolean;
      };
      /* eslint-disable react-hooks/set-state-in-effect -- prefilling form state from an upstream set change */
      if (parsed.type) setConfig(parsed.type);
      if (parsed.subjectDescription) setSubjectDescription(parsed.subjectDescription);
      if (parsed.disableStyle) setDisableStyle(true);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch { /* ignore malformed config */ }
  }, [prefillSetId, prefillSetConfig]);

  // Close on Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleSheetHostClick = useCallback(
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
      disableStyle: disableStyle || undefined,
      generationMode,
    });
  }, [onSubmit, sourceVariant.id, config, subjectDescription, disableStyle, generationMode]);

  const thumbUrl = sourceVariant.image_key
    ? getR2ImageUrl(sourceVariant.thumb_key || sourceVariant.image_key)
    : undefined;

  // Progress view for active rotation
  if (activeSet) {
    const views = rotationViews.filter((rv) => rv.rotation_set_id === activeSet.id);
    return (
      <DockedSheet onClick={handleSheetHostClick}>
          <div className={styles.header}>
            <h2 className={styles.title}>Rotation in Progress</h2>
            <IconButton onClick={onClose} aria-label="Close rotation panel" title="Close" variant="ghost" size="sm">
              <CloseIcon />
            </IconButton>
          </div>
          <div className={styles.content}>
            <div className={styles.progressSection}>
              <div className={styles.progressHeader}>
                <span className={styles.progressLabel}>{(() => {
                  try { return JSON.parse(activeSet.config).type || activeSet.config; }
                  catch { return activeSet.config; }
                })()}</span>
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
                    ? getR2ImageUrl(variant.thumb_key || variant.image_key)
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
            <Button
              variant="secondary"
              onClick={() => onCancel(activeSet.id)}
            >
              Cancel Rotation
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
      </DockedSheet>
    );
  }

  // Error view for failed rotation
  if (failedSet) {
    const views = rotationViews.filter((rv) => rv.rotation_set_id === failedSet.id);
    const completedViewCount = views.filter((v) => {
      const variant = variants.find((vr) => vr.id === v.variant_id);
      return variant?.status === 'completed';
    }).length;

    return (
      <DockedSheet onClick={handleSheetHostClick}>
          <div className={styles.header}>
            <h2 className={styles.title}>Rotation Failed</h2>
            <IconButton onClick={onClose} aria-label="Close rotation panel" title="Close" variant="ghost" size="sm">
              <CloseIcon />
            </IconButton>
          </div>
          <div className={styles.content}>
            <div className={styles.errorSection}>
              <div className={styles.errorIcon}>!</div>
              <div className={styles.errorMessage}>
                {failedSet.error_message || 'An error occurred during rotation generation.'}
              </div>
              <div className={styles.errorHint}>
                {completedViewCount} of {failedSet.total_steps} views completed before failure.
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
              disabled={!sourceVariant.image_key}
            >
              Try Again
            </Button>
          </div>
      </DockedSheet>
    );
  }

  // Completed view
  if (completedSet) {
    const views = rotationViews.filter((rv) => rv.rotation_set_id === completedSet.id);
    const selectedView = views.find((view) => view.id === selectedCompletedViewId) ?? views.find((view) => view.variant_id);
    const selectedVariant = selectedView?.variant_id
      ? variants.find((variant) => variant.id === selectedView.variant_id && variant.status === 'completed')
      : undefined;
    const selectedRating = selectedVariant?.quality_rating;
    const selectedQualityRating: QualityRating | null =
      selectedRating === 'approved' || selectedRating === 'rejected' ? selectedRating : null;

    return (
      <DockedSheet onClick={handleSheetHostClick}>
          <div className={styles.header}>
            <h2 className={styles.title}>Rotation Complete</h2>
            <IconButton onClick={onClose} aria-label="Close rotation panel" title="Close" variant="ghost" size="sm">
              <CloseIcon />
            </IconButton>
          </div>
          <div className={styles.content}>
            <div className={styles.compassGrid}>
              {views.map((view) => {
                const variant = variants.find((v) => v.id === view.variant_id);
                const viewThumb = variant?.image_key
                  ? getR2ImageUrl(variant.thumb_key || variant.image_key)
                  : undefined;
                const rating = variant?.quality_rating;
                const ratingClass = rating === 'approved'
                  ? styles.directionApproved
                  : rating === 'rejected'
                    ? styles.directionRejected
                    : '';
                const isSelected = selectedView?.id === view.id;

                return (
                  <Button
                    key={view.id}
                    variant="ghost"
                    size="sm"
                    className={`${styles.directionCell} ${styles.completed} ${styles.selectableDirection} ${isSelected ? styles.selected : ''} ${ratingClass}`}
                    onClick={() => setSelectedCompletedViewId(view.id)}
                    aria-pressed={isSelected}
                  >
                    {viewThumb && <img src={viewThumb} alt={view.direction} className={styles.directionThumb} />}
                    <span className={styles.directionLabel}>{view.direction}</span>
                  </Button>
                );
              })}
            </div>
            {onRateVariant && selectedVariant && (
              <div className={styles.ratingActions}>
                <span className={styles.ratingContext}>{selectedView?.direction}</span>
                <SegmentedControl
                  label="Selected rotation view rating"
                  value={selectedQualityRating}
                  options={RATING_OPTIONS}
                  onValueChange={(rating) => onRateVariant(selectedVariant.id, rating)}
                />
              </div>
            )}
          </div>
          <div className={styles.footer}>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={handleStart}
              disabled={!sourceVariant.image_key}
            >
              Generate New Set
            </Button>
          </div>
      </DockedSheet>
    );
  }

  // Setup view
  return (
    <DockedSheet onClick={handleSheetHostClick}>
        <div className={styles.header}>
          <h2 className={styles.title}>Generate Rotation Set</h2>
          <IconButton onClick={onClose} aria-label="Close rotation panel" title="Close" variant="ghost" size="sm">
            <CloseIcon />
          </IconButton>
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

          <div className={styles.configSection}>
            <span className={styles.sectionLabel}>Configuration</span>
            <UiSelect
              className={styles.select}
              value={config}
              options={CONFIG_OPTIONS}
              onValueChange={setConfig}
              label="Configuration"
              fullWidth
            />
          </div>

          {/* Subject description */}
          <div className={styles.inputGroup}>
            <span className={styles.sectionLabel}>Subject Description</span>
            <TextInput
              value={subjectDescription}
              onChange={(e) => setSubjectDescription(e.target.value)}
              placeholder="e.g. a pixel art warrior character"
              fullWidth
            />
            <span className={styles.inputHint}>
              Helps the AI maintain consistency across views
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
                ? 'Generates views one-by-one with reference context (higher consistency).'
                : 'Generates all views as one sprite sheet then slices (faster, no inter-step drift).'}
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
            disabled={!sourceVariant.image_key}
          >
            Start Rotation
          </Button>
        </div>
    </DockedSheet>
  );
}
