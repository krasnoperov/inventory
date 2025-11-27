import { useState, useCallback, useEffect, useRef } from 'react';
import type { Asset, Variant } from '../hooks/useSpaceWebSocket';
import { AssetPicker } from './AssetPicker';
import styles from './NewAssetModal.module.css';

export interface NewAssetModalProps {
  sourceVariant: Variant;
  sourceAsset: Asset;
  allAssets: Asset[];
  allVariants: Variant[];
  onClose: () => void;
  onCreate: (name: string, type: string, parentAssetId: string | null) => void;
}

const ASSET_TYPES = [
  { value: 'character', label: 'Character' },
  { value: 'prop', label: 'Prop' },
  { value: 'environment', label: 'Environment' },
  { value: 'effect', label: 'Effect' },
  { value: 'ui', label: 'UI Element' },
  { value: 'other', label: 'Other' },
];

export function NewAssetModal({
  sourceVariant,
  sourceAsset,
  allAssets,
  allVariants,
  onClose,
  onCreate,
}: NewAssetModalProps) {
  const [step, setStep] = useState<'name' | 'parent'>('name');
  const [name, setName] = useState('');
  const [type, setType] = useState('character');
  const [parentAssetId, setParentAssetId] = useState<string | null>(sourceAsset.parent_asset_id);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Close on backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  const handleNext = useCallback(() => {
    if (name.trim()) {
      setStep('parent');
    }
  }, [name]);

  const handleBack = useCallback(() => {
    setStep('name');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      await onCreate(name.trim(), type, parentAssetId);
      onClose();
    } catch (error) {
      console.error('Create asset failed:', error);
      setIsSubmitting(false);
    }
  }, [name, type, parentAssetId, onCreate, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (step === 'name') {
        handleNext();
      } else {
        handleSubmit();
      }
    }
  }, [step, handleNext, handleSubmit]);

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>New Asset</h2>
          <button className={styles.closeButton} onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Source preview */}
        <div className={styles.sourcePreview}>
          <img
            src={`/api/images/${sourceVariant.thumb_key}`}
            alt="Source"
            className={styles.sourceImage}
          />
          <div className={styles.sourceInfo}>
            <span className={styles.sourceLabel}>Creating from</span>
            <span className={styles.sourceName}>{sourceAsset.name}</span>
          </div>
        </div>

        {/* Step indicator */}
        <div className={styles.steps}>
          <div className={`${styles.step} ${step === 'name' ? styles.active : ''}`}>
            <span className={styles.stepNumber}>1</span>
            <span className={styles.stepLabel}>Name & Type</span>
          </div>
          <div className={styles.stepDivider} />
          <div className={`${styles.step} ${step === 'parent' ? styles.active : ''}`}>
            <span className={styles.stepNumber}>2</span>
            <span className={styles.stepLabel}>Location</span>
          </div>
        </div>

        <div className={styles.content}>
          {step === 'name' ? (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="asset-name">
                  Asset Name
                </label>
                <input
                  ref={inputRef}
                  id="asset-name"
                  type="text"
                  className={styles.input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter asset name..."
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Asset Type</label>
                <div className={styles.typeGrid}>
                  {ASSET_TYPES.map((t) => (
                    <button
                      key={t.value}
                      className={`${styles.typeOption} ${type === t.value ? styles.selected : ''}`}
                      onClick={() => setType(t.value)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className={styles.field}>
              <label className={styles.label}>Parent Asset</label>
              <div className={styles.pickerContainer}>
                <AssetPicker
                  assets={allAssets}
                  variants={allVariants}
                  selectedAssetId={parentAssetId}
                  allowRoot={true}
                  rootLabel="No parent (root asset)"
                  onSelect={setParentAssetId}
                />
              </div>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          {step === 'parent' && (
            <button
              className={styles.backButton}
              onClick={handleBack}
              disabled={isSubmitting}
            >
              Back
            </button>
          )}
          <div className={styles.footerSpacer} />
          <button
            className={styles.cancelButton}
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          {step === 'name' ? (
            <button
              className={styles.nextButton}
              onClick={handleNext}
              disabled={!name.trim()}
            >
              Next
            </button>
          ) : (
            <button
              className={styles.submitButton}
              onClick={handleSubmit}
              disabled={isSubmitting || !name.trim()}
            >
              {isSubmitting ? (
                <>
                  <span className={styles.spinner} />
                  Creating...
                </>
              ) : (
                'Create Asset'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default NewAssetModal;
