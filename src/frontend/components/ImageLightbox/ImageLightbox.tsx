/**
 * ImageLightbox - Full-resolution image viewer.
 *
 * Rendered through a portal to document.body so it escapes the React Flow
 * canvas transform (a position:fixed element inside a transformed ancestor
 * would otherwise be positioned relative to that ancestor, not the viewport).
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './ImageLightbox.module.css';

export interface ImageLightboxProps {
  /** Full-resolution image URL */
  src: string;
  /** Accessible alt text */
  alt?: string;
  /** Optional caption shown beneath the image (e.g. name · dimensions) */
  caption?: string;
  /** Close handler (Escape, backdrop click, or close button) */
  onClose: () => void;
}

export function ImageLightbox({ src, alt = '', caption, onClose }: ImageLightboxProps) {
  // Close on Escape and lock background scroll while open
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <button className={styles.close} onClick={onClose} aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
      <img className={styles.image} src={src} alt={alt} />
      {caption && <div className={styles.caption}>{caption}</div>}
    </div>,
    document.body
  );
}

export default ImageLightbox;
