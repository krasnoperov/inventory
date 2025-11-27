import { useState, useCallback, useEffect, useRef } from 'react';
import type { Asset, Variant } from '../hooks/useSpaceWebSocket';
import { useReferenceStore } from '../stores/referenceStore';
import { PREDEFINED_ASSET_TYPES } from '../hooks/useSpaceWebSocket';
import styles from './GenerateModal.module.css';

export interface GenerateModalProps {
  targetAsset?: Asset | null; // If provided, generating variant for this asset
  sourceVariant?: Variant | null; // The variant being used as source (for edit)
  onClose: () => void;
  onGenerate: (prompt: string, referenceIds: string[], assetName?: string, assetType?: string) => void;
}

export function GenerateModal({
  targetAsset,
  sourceVariant,
  onClose,
  onGenerate,
}: GenerateModalProps) {
  const [prompt, setPrompt] = useState('');
  const [assetName, setAssetName] = useState('');
  const [assetType, setAssetType] = useState('character');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Mode: creating new asset or new variant in existing asset
  const isCreatingNewAsset = !targetAsset;

  const { references, removeReference, clearReferences } = useReferenceStore();

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
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

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim()) return;
    // Require asset name when creating new asset
    if (isCreatingNewAsset && !assetName.trim()) return;

    setIsSubmitting(true);
    try {
      const referenceIds = references.map(r => r.variant.id);
      await onGenerate(
        prompt.trim(),
        referenceIds,
        isCreatingNewAsset ? assetName.trim() : undefined,
        isCreatingNewAsset ? assetType : undefined
      );
      clearReferences();
      onClose();
    } catch (error) {
      console.error('Generate failed:', error);
      setIsSubmitting(false);
    }
  }, [prompt, assetName, assetType, isCreatingNewAsset, references, onGenerate, clearReferences, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const title = targetAsset
    ? `New Variant for "${targetAsset.name}"`
    : 'Create New Asset';

  const placeholder = targetAsset
    ? `Describe how this variant should differ from the source...`
    : 'Describe what you want to generate...';

  const buttonLabel = targetAsset ? 'Create Variant' : 'Create Asset';

  const canSubmit = prompt.trim() && (!isCreatingNewAsset || assetName.trim());

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button className={styles.closeButton} onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className={styles.content}>
          {/* Target asset context with source variant preview */}
          {targetAsset && (
            <div className={styles.targetSection}>
              <span className={styles.targetLabel}>Creating new variant based on</span>
              <div className={styles.targetInfo}>
                {sourceVariant && (
                  <img
                    src={`/api/images/${sourceVariant.thumb_key}`}
                    alt="Source variant"
                    className={styles.sourceVariantThumb}
                  />
                )}
                <div className={styles.targetDetails}>
                  <span className={styles.targetName}>{targetAsset.name}</span>
                  <span className={styles.targetType}>{targetAsset.type}</span>
                </div>
              </div>
            </div>
          )}

          {/* New asset fields - only when creating new asset */}
          {isCreatingNewAsset && (
            <div className={styles.assetFields}>
              <div className={styles.fieldRow}>
                <div className={styles.fieldGroup}>
                  <label className={styles.sectionLabel} htmlFor="asset-name">
                    Asset Name
                  </label>
                  <input
                    id="asset-name"
                    type="text"
                    className={styles.textInput}
                    value={assetName}
                    onChange={(e) => setAssetName(e.target.value)}
                    placeholder="e.g., Hero Knight"
                    disabled={isSubmitting}
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.sectionLabel} htmlFor="asset-type">
                    Type
                  </label>
                  <select
                    id="asset-type"
                    className={styles.select}
                    value={assetType}
                    onChange={(e) => setAssetType(e.target.value)}
                    disabled={isSubmitting}
                  >
                    {PREDEFINED_ASSET_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.charAt(0).toUpperCase() + t.slice(1).replace('-', ' ')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* References */}
          {references.length > 0 && (
            <div className={styles.referencesSection}>
              <span className={styles.sectionLabel}>References ({references.length})</span>
              <div className={styles.referencesList}>
                {references.map((ref) => (
                  <div key={ref.variant.id} className={styles.referenceItem}>
                    <img
                      src={`/api/images/${ref.variant.thumb_key}`}
                      alt="Reference"
                      className={styles.referenceImage}
                    />
                    <span className={styles.referenceName}>{ref.asset.name}</span>
                    <button
                      className={styles.removeReference}
                      onClick={() => removeReference(ref.variant.id)}
                      title="Remove reference"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prompt input */}
          <div className={styles.promptSection}>
            <label className={styles.sectionLabel} htmlFor="generate-prompt">
              {targetAsset ? 'What should this variant look like?' : 'What would you like to create?'}
            </label>
            <textarea
              ref={textareaRef}
              id="generate-prompt"
              className={styles.textarea}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              rows={5}
              disabled={isSubmitting}
            />
            <span className={styles.hint}>
              Press {navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'}+Enter to generate
            </span>
          </div>
        </div>

        <div className={styles.footer}>
          <button
            className={styles.cancelButton}
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            className={styles.submitButton}
            onClick={handleSubmit}
            disabled={isSubmitting || !canSubmit}
          >
            {isSubmitting ? (
              <>
                <span className={styles.spinner} />
                Generating...
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                {buttonLabel}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default GenerateModal;
