import { useCallback } from 'react';
import { useReferenceStore } from '../stores/referenceStore';
import styles from './ReferenceShelf.module.css';

export interface ReferenceShelfProps {
  onGenerate?: () => void;
}

export function ReferenceShelf({ onGenerate }: ReferenceShelfProps) {
  const { references, removeReference, clearReferences, maxReferences } = useReferenceStore();

  const handleRemove = useCallback((variantId: string) => {
    removeReference(variantId);
  }, [removeReference]);

  const handleClear = useCallback(() => {
    clearReferences();
  }, [clearReferences]);

  // Don't render if no references
  if (references.length === 0) {
    return null;
  }

  return (
    <div className={styles.shelf}>
      <div className={styles.header}>
        <span className={styles.title}>
          References ({references.length}/{maxReferences})
        </span>
        <button
          className={styles.clearButton}
          onClick={handleClear}
          title="Clear all references"
        >
          Clear
        </button>
      </div>

      <div className={styles.references}>
        {references.map((ref) => (
          <div key={ref.variant.id} className={styles.reference}>
            <img
              src={`/api/images/${ref.variant.thumb_key}`}
              alt={ref.asset.name}
              className={styles.thumbnail}
            />
            <div className={styles.info}>
              <span className={styles.assetName}>{ref.asset.name}</span>
            </div>
            <button
              className={styles.removeButton}
              onClick={() => handleRemove(ref.variant.id)}
              title="Remove reference"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {onGenerate && (
        <button
          className={styles.generateButton}
          onClick={onGenerate}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          Generate with References
        </button>
      )}
    </div>
  );
}

export default ReferenceShelf;
