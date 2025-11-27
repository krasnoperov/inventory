import { useState, useCallback, useEffect, useRef } from 'react';
import type { Asset, Variant } from '../hooks/useSpaceWebSocket';
import { useReferenceStore } from '../stores/referenceStore';
import styles from './RefineModal.module.css';

export interface RefineModalProps {
  variant: Variant;
  asset: Asset;
  onClose: () => void;
  onRefine: (prompt: string, referenceIds: string[]) => void;
}

export function RefineModal({
  variant,
  asset,
  onClose,
  onRefine,
}: RefineModalProps) {
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    if (!prompt.trim() && references.length === 0) return;

    setIsSubmitting(true);
    try {
      const referenceIds = references.map(r => r.variant.id);
      await onRefine(prompt.trim(), referenceIds);
      clearReferences();
      onClose();
    } catch (error) {
      console.error('Refine failed:', error);
      setIsSubmitting(false);
    }
  }, [prompt, references, onRefine, clearReferences, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div ref={modalRef} className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Refine Variant</h2>
          <button className={styles.closeButton} onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className={styles.content}>
          {/* Source variant preview */}
          <div className={styles.sourceSection}>
            <span className={styles.sectionLabel}>Source</span>
            <div className={styles.sourcePreview}>
              <img
                src={`/api/images/${variant.thumb_key}`}
                alt="Source variant"
                className={styles.sourceImage}
              />
              <div className={styles.sourceInfo}>
                <span className={styles.sourceName}>{asset.name}</span>
                <span className={styles.sourceDate}>
                  Created {new Date(variant.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

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
                    <button
                      className={styles.removeReference}
                      onClick={() => removeReference(ref.variant.id)}
                      title="Remove reference"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
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
            <label className={styles.sectionLabel} htmlFor="refine-prompt">
              Instructions
            </label>
            <textarea
              ref={textareaRef}
              id="refine-prompt"
              className={styles.textarea}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe how to refine this variant..."
              rows={4}
              disabled={isSubmitting}
            />
            <span className={styles.hint}>
              Press {navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'}+Enter to submit
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
            disabled={isSubmitting || (!prompt.trim() && references.length === 0)}
          >
            {isSubmitting ? (
              <>
                <span className={styles.spinner} />
                Refining...
              </>
            ) : (
              'Refine'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default RefineModal;
