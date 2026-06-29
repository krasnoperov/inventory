/**
 * Thumbnail - Unified thumbnail component for variant display
 *
 * Handles all variant states consistently across the app:
 * - loading (pending, processing, uploading)
 * - failed
 * - completed (with image)
 * - empty (no variant)
 */

import { memo, useCallback, useEffect, useState } from 'react';
import {
  type Variant,
  isVariantReady,
  isVariantAudioReady,
  isVariantVideoReady,
  isVariantLoading,
  isVariantFailed,
  getVariantDisplayImageUrl,
  getVariantMediaUrl,
} from '../../hooks/useSpaceWebSocket';
import { Button } from '../../ui';
import { AudioPlayer } from '../AudioPlayer/AudioPlayer';
import styles from './Thumbnail.module.css';

export type ThumbnailSize = 'xs' | 'sm' | 'md' | 'lg' | 'fill';

export interface ThumbnailProps {
  /** Variant to display (null/undefined shows empty state) */
  variant?: Variant | null;
  /** Size variant using design system tokens */
  size?: ThumbnailSize;
  /** Show active/starred badges */
  showBadges?: boolean;
  /** Whether this variant is the active one for its asset */
  isActive?: boolean;
  /** Callback for retry button on failed variants */
  onRetry?: () => void;
  /** Callback for clicking the thumbnail */
  onClick?: () => void;
  /** Space ID used for authenticated media previews */
  spaceId?: string;
  /** Show audio controls when an audio variant has playable media */
  showAudioControls?: boolean;
  /** Show video controls when a video variant has playable media */
  showVideoControls?: boolean;
  /**
   * Render image variants from the full-resolution media instead of the
   * downscaled thumb_key (a 512px cover-cropped preview). Needed where the
   * image can be zoomed past the thumbnail's pixels and must stay sharp at
   * native resolution (e.g. the variant canvas). Requires `spaceId`.
   */
  fullResolution?: boolean;
  /** Additional CSS class */
  className?: string;
}

/** Status labels for loading states */
const LOADING_LABELS: Record<string, string> = {
  pending: 'Queued',
  processing: 'Generating',
  uploading: 'Uploading',
};

function ThumbnailComponent({
  variant,
  size = 'sm',
  showBadges = false,
  isActive = false,
  onRetry,
  onClick,
  spaceId,
  showAudioControls = false,
  showVideoControls = false,
  fullResolution = false,
  className,
}: ThumbnailProps) {
  const [imageLoadFailed, setImageLoadFailed] = useState(false);

  useEffect(() => {
    setImageLoadFailed(false);
  }, [variant?.id, variant?.thumb_key, variant?.image_key, variant?.media_key, spaceId, fullResolution]);

  const handleRetryClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRetry?.();
    },
    [onRetry]
  );

  const baseClasses = [
    styles.thumbnail,
    styles[size],
    showBadges && isActive ? styles.active : '',
    className,
  ].filter(Boolean).join(' ');

  // Empty state - no variant provided
  if (!variant) {
    return (
      <div className={`${baseClasses} ${styles.empty}`} onClick={onClick}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className={styles.emptyIcon}
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </div>
    );
  }

  // Loading state (pending, processing, uploading)
  if (isVariantLoading(variant)) {
    const label = LOADING_LABELS[variant.status] || 'Loading';
    return (
      <div className={`${baseClasses} ${styles.loading}`}>
        <div className={styles.spinner} />
        <span className={styles.loadingLabel}>{label}</span>
      </div>
    );
  }

  // Failed state
  if (isVariantFailed(variant)) {
    return (
      <div className={`${baseClasses} ${styles.failed}`} onClick={onClick}>
        <span className={styles.errorIcon}>⚠</span>
        <span className={styles.errorLabel}>Failed</span>
        {onRetry && (
          <Button className={styles.retryButton} onClick={handleRetryClick} variant="secondary">
            Retry
          </Button>
        )}
      </div>
    );
  }

  // Completed state
  const mediaUrl = getVariantMediaUrl(variant, spaceId);
  const showPlayableAudio = isVariantAudioReady(variant) && showAudioControls && mediaUrl;
  const showPlayableVideo = isVariantVideoReady(variant) && showVideoControls && mediaUrl;
  // Full-res media for images when asked (so zooming reveals native pixels
  // instead of upscaling the 512px thumbnail), otherwise the thumbnail.
  const imageSrc = getVariantDisplayImageUrl(variant, { fullResolution, spaceId });

  return (
    <div className={baseClasses} onClick={onClick}>
      {showPlayableVideo ? (
        <video
          className={styles.videoElement}
          src={mediaUrl}
          controls
          preload="metadata"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        />
      ) : imageSrc && !imageLoadFailed ? (
        <img
          src={imageSrc}
          alt=""
          className={styles.image}
          draggable={false}
          onError={() => setImageLoadFailed(true)}
        />
      ) : isVariantAudioReady(variant) ? (
        <div className={styles.audioPreview}>
          {/* Compact-only glyph: shown where there's no room for the player. */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            className={styles.audioIcon}
          >
            <path d="M9 18V5l10-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="16" cy="16" r="3" />
          </svg>
          <span className={styles.audioLabel}>Audio</span>
          {showPlayableAudio && mediaUrl && (
            <AudioPlayer
              src={mediaUrl}
              seed={variant.media_key ?? variant.id}
              className={styles.audioPlayer}
            />
          )}
        </div>
      ) : isVariantVideoReady(variant) ? (
        <div className={styles.videoPreview}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            className={styles.videoIcon}
          >
            <rect x="4" y="5" width="16" height="14" rx="2" />
            <path d="m10 9 5 3-5 3V9z" />
          </svg>
          <span className={styles.videoLabel}>Video</span>
        </div>
      ) : (
        <div className={styles.placeholder}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className={styles.placeholderIcon}
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
      )}

      {/* Badges - only for completed variants */}
      {showBadges && isVariantReady(variant) && (
        <>
          {variant.starred && <span className={styles.starBadge}>★</span>}
        </>
      )}
    </div>
  );
}

export const Thumbnail = memo(ThumbnailComponent);
export default Thumbnail;
