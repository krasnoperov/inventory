import { useState, useRef, useEffect, useCallback } from 'react';
import styles from './EnhanceButton.module.css';

export type EnhanceType = 'geminify';

export interface EnhanceButtonProps {
  onEnhance: (type: EnhanceType) => void;
  isEnhancing: boolean;
  disabled?: boolean;
}

export function EnhanceButton({ onEnhance, isEnhancing, disabled = false }: EnhanceButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleToggle = useCallback(() => {
    if (!disabled && !isEnhancing) {
      setIsOpen((prev) => !prev);
    }
  }, [disabled, isEnhancing]);

  const handleSelect = useCallback((type: EnhanceType) => {
    setIsOpen(false);
    onEnhance(type);
  }, [onEnhance]);

  return (
    <div className={styles.container}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.enhanceButton}
        onClick={handleToggle}
        disabled={disabled || isEnhancing}
        title="Enhance prompt"
      >
        {isEnhancing ? (
          <span className={styles.spinner} />
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        )}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10" className={styles.chevron}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div ref={menuRef} className={styles.menu}>
          <button
            className={styles.menuItem}
            onClick={() => handleSelect('geminify')}
          >
            <span className={styles.menuLabel}>Geminify</span>
            <span className={styles.menuHint}>Add style, lighting, details</span>
          </button>
          {/* Future options:
          <button className={styles.menuItem} disabled>
            <span className={styles.menuLabel}>Add Image Details</span>
            <span className={styles.menuHint}>Coming soon</span>
          </button>
          <button className={styles.menuItem} disabled>
            <span className={styles.menuLabel}>Reverse Prompt</span>
            <span className={styles.menuHint}>Coming soon</span>
          </button>
          */}
        </div>
      )}
    </div>
  );
}
