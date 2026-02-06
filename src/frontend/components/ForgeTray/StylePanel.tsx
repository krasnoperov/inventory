import { useState, useCallback, useRef } from 'react';
import { useStyleStore, type SpaceStyleClient } from '../../stores/styleStore';
import styles from './StylePanel.module.css';

export interface StylePanelProps {
  spaceId: string;
  onClose: () => void;
  sendStyleSet: (data: { name?: string; description?: string; imageKeys?: string[]; enabled?: boolean }) => void;
  sendStyleDelete: () => void;
  sendStyleToggle: (enabled: boolean) => void;
}

export function StylePanel({
  spaceId,
  onClose,
  sendStyleSet,
  sendStyleDelete,
  sendStyleToggle,
}: StylePanelProps) {
  const style = useStyleStore((s) => s.style);

  const [description, setDescription] = useState(style?.description || '');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const imageKeys = style?.imageKeys || [];

  const handleSaveDescription = useCallback(() => {
    sendStyleSet({ description });
  }, [description, sendStyleSet]);

  const handleToggle = useCallback(() => {
    if (style) {
      sendStyleToggle(!style.enabled);
    } else {
      // Create a new style if none exists — include description and imageKeys
      sendStyleSet({ description, imageKeys, enabled: true });
    }
  }, [style, description, imageKeys, sendStyleToggle, sendStyleSet]);

  const handleDelete = useCallback(() => {
    sendStyleDelete();
  }, [sendStyleDelete]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    if (imageKeys.length >= 5) return;

    setIsUploading(true);
    try {
      // Upload image to get R2 key
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`/api/spaces/${spaceId}/style-images`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const result = await response.json() as { success: boolean; imageKey: string };
      if (result.success && result.imageKey) {
        sendStyleSet({ imageKeys: [...imageKeys, result.imageKey] });
      }
    } catch (error) {
      console.error('Style image upload failed:', error);
    } finally {
      setIsUploading(false);
    }
  }, [spaceId, imageKeys, sendStyleSet]);

  const handleRemoveImage = useCallback((index: number) => {
    const newKeys = imageKeys.filter((_, i) => i !== index);
    sendStyleSet({ imageKeys: newKeys });
  }, [imageKeys, sendStyleSet]);

  return (
    <div className={styles.stylePanel}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.title}>Space Style</span>
        <div className={styles.headerActions}>
          <button
            className={styles.closeButton}
            onClick={onClose}
            title="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className={styles.body}>
        {/* Description */}
        <div>
          <div className={styles.descriptionLabel}>Style Description</div>
          <textarea
            className={styles.descriptionTextarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={handleSaveDescription}
            placeholder="Describe the visual style (e.g., 'Pixel art, 16-bit, vibrant colors, top-down perspective')"
            rows={3}
          />
        </div>

        {/* Image References */}
        <div className={styles.imageSection}>
          <div className={styles.imageSectionHeader}>
            <span className={styles.imageLabel}>Reference Images</span>
            <span className={styles.imageCount}>{imageKeys.length}/5</span>
          </div>
          <div className={styles.imageGrid}>
            {imageKeys.map((key, index) => (
              <div key={key} className={styles.imageThumb}>
                <img src={`/api/images/${key}`} alt={`Style ref ${index + 1}`} />
                <button
                  className={styles.imageRemoveButton}
                  onClick={() => handleRemoveImage(index)}
                  title="Remove"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
            {imageKeys.length < 5 && (
              <button
                className={styles.addImageButton}
                onClick={handleUploadClick}
                disabled={isUploading}
                title="Add style reference image"
              >
                {isUploading ? (
                  <span>...</span>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <div className={styles.toggleRow}>
          <button
            className={`${styles.toggle} ${style?.enabled ? styles.enabled : ''}`}
            onClick={handleToggle}
            title={style?.enabled ? 'Disable style' : 'Enable style'}
          />
          <span className={styles.toggleLabel}>
            {style?.enabled ? 'Active' : 'Inactive'}
          </span>
        </div>
        {style && (
          <button
            className={styles.deleteButton}
            onClick={handleDelete}
          >
            Delete Style
          </button>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
    </div>
  );
}

export default StylePanel;
