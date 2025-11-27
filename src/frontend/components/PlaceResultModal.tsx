import { useState, useCallback, useEffect } from 'react';
import type { Asset, Variant } from '../hooks/useSpaceWebSocket';
import { AssetPicker } from './AssetPicker';
import styles from './PlaceResultModal.module.css';

export type PlacementOption = 'new_asset' | 'existing_asset' | 'discard';

export interface PlaceResultModalProps {
  generatedImageUrl: string;
  allAssets: Asset[];
  allVariants: Variant[];
  suggestedAssetId?: string;
  onClose: () => void;
  onPlaceAsNewAsset: (name: string, type: string, parentAssetId: string | null) => void;
  onPlaceInExistingAsset: (assetId: string) => void;
  onDiscard: () => void;
}

const ASSET_TYPES = [
  { value: 'character', label: 'Character' },
  { value: 'prop', label: 'Prop' },
  { value: 'environment', label: 'Environment' },
  { value: 'effect', label: 'Effect' },
  { value: 'ui', label: 'UI Element' },
  { value: 'other', label: 'Other' },
];

export function PlaceResultModal({
  generatedImageUrl,
  allAssets,
  allVariants,
  suggestedAssetId,
  onClose,
  onPlaceAsNewAsset,
  onPlaceInExistingAsset,
  onDiscard,
}: PlaceResultModalProps) {
  const [option, setOption] = useState<PlacementOption>(suggestedAssetId ? 'existing_asset' : 'new_asset');
  const [name, setName] = useState('');
  const [type, setType] = useState('character');
  const [parentAssetId, setParentAssetId] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(suggestedAssetId ?? null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    setIsSubmitting(true);
    try {
      if (option === 'new_asset') {
        if (!name.trim()) return;
        await onPlaceAsNewAsset(name.trim(), type, parentAssetId);
      } else if (option === 'existing_asset') {
        if (!selectedAssetId) return;
        await onPlaceInExistingAsset(selectedAssetId);
      } else {
        await onDiscard();
      }
      onClose();
    } catch (error) {
      console.error('Place result failed:', error);
      setIsSubmitting(false);
    }
  }, [option, name, type, parentAssetId, selectedAssetId, onPlaceAsNewAsset, onPlaceInExistingAsset, onDiscard, onClose]);

  const canSubmit = () => {
    if (option === 'new_asset') return name.trim().length > 0;
    if (option === 'existing_asset') return selectedAssetId !== null;
    return true; // discard
  };

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Place Generated Image</h2>
          <button className={styles.closeButton} onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Preview */}
        <div className={styles.preview}>
          <img
            src={generatedImageUrl}
            alt="Generated"
            className={styles.previewImage}
          />
        </div>

        <div className={styles.content}>
          {/* Placement options */}
          <div className={styles.options}>
            <button
              className={`${styles.optionButton} ${option === 'new_asset' ? styles.selected : ''}`}
              onClick={() => setOption('new_asset')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>Create New Asset</span>
            </button>
            <button
              className={`${styles.optionButton} ${option === 'existing_asset' ? styles.selected : ''}`}
              onClick={() => setOption('existing_asset')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
              <span>Add to Existing Asset</span>
            </button>
            <button
              className={`${styles.optionButton} ${styles.danger} ${option === 'discard' ? styles.selected : ''}`}
              onClick={() => setOption('discard')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>Discard</span>
            </button>
          </div>

          {/* New asset form */}
          {option === 'new_asset' && (
            <div className={styles.form}>
              <div className={styles.field}>
                <label className={styles.label}>Name</label>
                <input
                  type="text"
                  className={styles.input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter asset name..."
                  autoFocus
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Type</label>
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

              <div className={styles.field}>
                <label className={styles.label}>Parent Asset (optional)</label>
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
            </div>
          )}

          {/* Existing asset picker */}
          {option === 'existing_asset' && (
            <div className={styles.form}>
              <div className={styles.field}>
                <label className={styles.label}>Select Asset</label>
                <div className={styles.pickerContainer}>
                  <AssetPicker
                    assets={allAssets}
                    variants={allVariants}
                    selectedAssetId={selectedAssetId}
                    allowRoot={false}
                    onSelect={(id) => setSelectedAssetId(id)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Discard confirmation */}
          {option === 'discard' && (
            <div className={styles.discardWarning}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <p>This generated image will be permanently deleted and cannot be recovered.</p>
            </div>
          )}
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
            className={`${styles.submitButton} ${option === 'discard' ? styles.danger : ''}`}
            onClick={handleSubmit}
            disabled={isSubmitting || !canSubmit()}
          >
            {isSubmitting ? (
              <>
                <span className={styles.spinner} />
                Processing...
              </>
            ) : option === 'discard' ? (
              'Discard Image'
            ) : (
              'Place Image'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PlaceResultModal;
