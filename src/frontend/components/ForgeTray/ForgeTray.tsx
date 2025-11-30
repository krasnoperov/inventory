import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useForgeTrayStore } from '../../stores/forgeTrayStore';
import type { ForgeOperation } from '../../stores/forgeTrayStore';
import { type Asset, type Variant, getVariantThumbnailUrl } from '../../hooks/useSpaceWebSocket';
import { AssetPickerModal } from './AssetPickerModal';
import styles from './ForgeTray.module.css';

export type DestinationType = 'existing_asset' | 'new_asset';

export interface ForgeSubmitParams {
  prompt?: string;  // undefined for fork (copy without modification)
  // Use referenceVariantIds for explicit variant selection (ForgeTray UI)
  // Use referenceAssetIds for asset-level references (Chat/Claude) - backend resolves to default variants
  referenceVariantIds?: string[];
  referenceAssetIds?: string[];
  destination: {
    type: DestinationType;
    assetId?: string;
    assetName?: string;
    assetType?: string;
    parentAssetId?: string | null;
  };
  operation: ForgeOperation;
}

export interface ForgeTrayProps {
  allAssets: Asset[];
  allVariants: Variant[];
  onSubmit: (params: ForgeSubmitParams) => void | string;
  onBrandBackground?: boolean;
  /** Current asset context (for Asset Detail page) */
  currentAsset?: Asset | null;
}

// Determine operation based on state
function getOperation(
  slotCount: number,
  hasPrompt: boolean,
  destinationType: DestinationType
): ForgeOperation {
  if (slotCount === 0) return 'generate';
  if (slotCount === 1) {
    if (!hasPrompt && destinationType === 'new_asset') return 'fork';
    if (destinationType === 'existing_asset') return 'refine';
    return 'create'; // has prompt, new asset
  }
  return 'combine';
}

// Get button label for operation
function getOperationLabel(operation: ForgeOperation): string {
  switch (operation) {
    case 'generate': return 'Generate';
    case 'fork': return 'Fork';
    case 'refine': return 'Refine';
    case 'create': return 'Create';
    case 'combine': return 'Combine';
  }
}

// Get placeholder text based on state
function getPlaceholder(slotCount: number, operation: ForgeOperation): string {
  if (slotCount === 0) return 'Describe what to generate...';
  if (operation === 'fork') return 'Leave empty to fork, or describe changes...';
  if (operation === 'combine') return 'Describe how to combine these references...';
  return 'Describe the refinement or transformation...';
}

export function ForgeTray({
  allAssets,
  allVariants,
  onSubmit,
  onBrandBackground = true,
  currentAsset,
}: ForgeTrayProps) {
  const { slots, maxSlots, prompt, setPrompt, clearSlots, removeSlot } = useForgeTrayStore();
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Destination state
  const [destinationType, setDestinationType] = useState<DestinationType>('existing_asset');
  const [newAssetName, setNewAssetName] = useState('');

  // Target asset: currentAsset (Asset Detail) or first slot's asset (Scene)
  const targetAsset = useMemo(() => {
    if (currentAsset) return currentAsset;
    if (slots.length > 0) return slots[0].asset;
    return null;
  }, [currentAsset, slots]);

  // When we have slots, default to existing asset; when empty (Generate), default to new on Scene
  const effectiveDestinationType = useMemo(() => {
    if (slots.length === 0 && !currentAsset) {
      return 'new_asset'; // Generate on Scene always creates new
    }
    return destinationType;
  }, [slots.length, currentAsset, destinationType]);

  const hasPrompt = prompt.trim().length > 0;
  const operation = getOperation(slots.length, hasPrompt, effectiveDestinationType);
  const operationLabel = getOperationLabel(operation);
  const placeholder = getPlaceholder(slots.length, operation);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const newHeight = Math.min(Math.max(textarea.scrollHeight, 44), 200);
      textarea.style.height = `${newHeight}px`;
    }
  }, [prompt]);

  const handleAddClick = useCallback(() => {
    setShowAssetPicker(true);
  }, []);

  const handleCloseAssetPicker = useCallback(() => {
    setShowAssetPicker(false);
  }, []);

  const handleRemoveSlot = useCallback((e: React.MouseEvent, slotId: string) => {
    e.stopPropagation();
    removeSlot(slotId);
  }, [removeSlot]);

  const handleSubmit = useCallback(async () => {
    // Fork doesn't need prompt; others do
    if (operation !== 'fork' && !prompt.trim()) return;
    // New asset needs a name
    if (effectiveDestinationType === 'new_asset' && !newAssetName.trim()) return;
    // Refine with no prompt is a no-op
    if (operation === 'refine' && !prompt.trim()) return;

    setIsSubmitting(true);
    try {
      // When creating new asset from existing slots, set parent and inherit type
      const sourceAsset = slots.length > 0 ? slots[0].asset : null;
      const parentAssetId = effectiveDestinationType === 'new_asset' && sourceAsset
        ? sourceAsset.id
        : undefined;
      // Inherit type from source asset, or default to 'character'
      const assetType = sourceAsset?.type || 'character';

      // For fork operation, prompt should be undefined (copy without modification)
      const trimmedPrompt = prompt.trim();

      onSubmit({
        prompt: trimmedPrompt || undefined,
        referenceVariantIds: slots.map(s => s.variant.id),
        destination: {
          type: effectiveDestinationType,
          assetId: effectiveDestinationType === 'existing_asset' && targetAsset ? targetAsset.id : undefined,
          assetName: effectiveDestinationType === 'new_asset' ? newAssetName.trim() : undefined,
          assetType: effectiveDestinationType === 'new_asset' ? assetType : undefined,
          parentAssetId,
        },
        operation,
      });

      // Clear on success
      clearSlots();
      setPrompt('');
      setNewAssetName('');
      setDestinationType('existing_asset');
    } catch (error) {
      console.error('Forge submit failed:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [prompt, effectiveDestinationType, newAssetName, slots, targetAsset, onSubmit, clearSlots, setPrompt, operation]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  // Determine if submit is allowed
  const canSubmit = useMemo(() => {
    if (isSubmitting) return false;

    // Fork: 1 slot, no prompt needed, but need new asset name
    if (operation === 'fork') {
      return newAssetName.trim().length > 0;
    }

    // Refine: need prompt (destination is existing)
    if (operation === 'refine') {
      return hasPrompt;
    }

    // Generate, Create, Combine: need prompt
    if (!hasPrompt) return false;

    // New asset destination needs a name
    if (effectiveDestinationType === 'new_asset') {
      return newAssetName.trim().length > 0;
    }

    return true;
  }, [isSubmitting, operation, hasPrompt, effectiveDestinationType, newAssetName]);

  const canAddMore = slots.length < maxSlots;
  const showDestinationToggle = slots.length > 0 || currentAsset;

  const trayClass = onBrandBackground
    ? `${styles.tray} ${styles.onBrandBackground}`
    : styles.tray;

  return (
    <>
      <div className={trayClass}>
        {/* Unified Input Area - Textarea with embedded thumbnails */}
        <div className={styles.inputArea}>
          {/* Prompt Textarea */}
          <textarea
            ref={textareaRef}
            className={styles.promptTextarea}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isSubmitting}
            rows={1}
          />

          {/* Thumbnails Row - Inside the input area */}
          {(slots.length > 0 || canAddMore) && (
            <div className={styles.thumbsRow}>
              {slots.map((slot) => (
                <div key={slot.id} className={styles.slotThumb}>
                  <img
                    src={getVariantThumbnailUrl(slot.variant)}
                    alt={slot.asset.name}
                    className={styles.slotImage}
                  />
                  <button
                    className={styles.removeButton}
                    onClick={(e) => handleRemoveSlot(e, slot.id)}
                    title="Remove"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="8" height="8">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                  <span className={styles.slotTooltip}>{slot.asset.name}</span>
                </div>
              ))}
              {canAddMore && (
                <button
                  className={styles.addThumbButton}
                  onClick={handleAddClick}
                  title="Add reference"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* Controls Row - Bottom of input area */}
          <div className={styles.controlsRow}>
            {/* Destination Toggle */}
            {showDestinationToggle && (
              <div className={styles.destinationToggle}>
                <button
                  type="button"
                  className={`${styles.destButton} ${destinationType === 'existing_asset' ? styles.active : ''}`}
                  onClick={() => setDestinationType('existing_asset')}
                  disabled={isSubmitting}
                  title={targetAsset ? `Add to "${targetAsset.name}"` : 'Add to existing'}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span>Current</span>
                </button>
                <button
                  type="button"
                  className={`${styles.destButton} ${destinationType === 'new_asset' ? styles.active : ''}`}
                  onClick={() => setDestinationType('new_asset')}
                  disabled={isSubmitting}
                  title="Create new asset"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M12 8v8M8 12h8" />
                  </svg>
                  <span>New</span>
                </button>
              </div>
            )}

            {/* New Asset Name Input */}
            {effectiveDestinationType === 'new_asset' && (
              <input
                type="text"
                className={styles.assetNameInput}
                value={newAssetName}
                onChange={(e) => setNewAssetName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Asset name"
                disabled={isSubmitting}
              />
            )}

            {/* Spacer */}
            <div className={styles.controlsSpacer} />

            {/* Submit Button */}
            <button
              className={styles.forgeButton}
              onClick={handleSubmit}
              disabled={!canSubmit}
              title={`${operationLabel} (Cmd+Enter)`}
            >
              {isSubmitting ? (
                <span className={styles.spinner} />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              )}
              <span className={styles.buttonLabel}>{operationLabel}</span>
            </button>
          </div>
        </div>
      </div>

      {showAssetPicker && (
        <AssetPickerModal
          allAssets={allAssets}
          allVariants={allVariants}
          onClose={handleCloseAssetPicker}
        />
      )}
    </>
  );
}

export default ForgeTray;
