import { useCallback } from 'react';
import { useForgeTrayStore } from '../../stores/forgeTrayStore';
import styles from './ForgeSlots.module.css';

export interface ForgeSlotsProps {
  onAddClick?: () => void;
}

export function ForgeSlots({ onAddClick }: ForgeSlotsProps) {
  const { slots, maxSlots, removeSlot } = useForgeTrayStore();

  const handleRemove = useCallback((e: React.MouseEvent, slotId: string) => {
    e.stopPropagation();
    removeSlot(slotId);
  }, [removeSlot]);

  const canAddMore = slots.length < maxSlots;

  return (
    <div className={styles.slots}>
      {slots.map((slot) => (
        <div key={slot.id} className={styles.slot}>
          <img
            src={`/api/images/${slot.variant.thumb_key}`}
            alt={slot.asset.name}
            className={styles.slotImage}
          />
          <button
            className={styles.removeButton}
            onClick={(e) => handleRemove(e, slot.id)}
            title="Remove"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <span className={styles.slotTooltip}>{slot.asset.name}</span>
        </div>
      ))}
      {canAddMore && (
        <button
          className={styles.addButton}
          onClick={onAddClick}
          title="Add reference"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default ForgeSlots;
