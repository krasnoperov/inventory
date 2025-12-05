/**
 * useImageUpload - Hook for uploading images to create variants
 *
 * Handles the HTTP upload to /api/spaces/:spaceId/upload endpoint.
 * Returns the created variant for immediate use in the UI.
 * Supports both adding to existing assets and creating new assets.
 */

import { useState, useCallback } from 'react';
import type { Asset, Variant } from './useSpaceWebSocket';

export interface UseImageUploadOptions {
  spaceId: string;
  onSuccess?: (variant: Variant, asset?: Asset) => void;
  onError?: (error: string) => void;
}

/** Parameters for uploading to an existing asset */
export interface UploadToAssetParams {
  file: File;
  assetId: string;
}

/** Parameters for uploading and creating a new asset */
export interface UploadNewAssetParams {
  file: File;
  assetName: string;
  assetType?: string;
  parentAssetId?: string | null;
}

export interface UseImageUploadReturn {
  /** Upload a file to create a new variant on an existing asset */
  upload: (file: File, assetId: string) => Promise<Variant | null>;
  /** Upload a file and create a new asset */
  uploadNewAsset: (params: UploadNewAssetParams) => Promise<{ variant: Variant; asset: Asset } | null>;
  /** Whether an upload is currently in progress */
  isUploading: boolean;
  /** Error message from the last failed upload */
  error: string | null;
  /** Clear the error state */
  clearError: () => void;
}

interface UploadResponse {
  success: boolean;
  variant?: Variant;
  asset?: Asset;
  error?: string;
}

export function useImageUpload({
  spaceId,
  onSuccess,
  onError,
}: UseImageUploadOptions): UseImageUploadReturn {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const upload = useCallback(async (file: File, assetId: string): Promise<Variant | null> => {
    // Clear previous error
    setError(null);
    setIsUploading(true);

    try {
      // Build FormData
      const formData = new FormData();
      formData.append('file', file);
      formData.append('assetId', assetId);

      // Upload
      const response = await fetch(`/api/spaces/${spaceId}/upload`, {
        method: 'POST',
        body: formData,
        credentials: 'include', // Include auth cookies
      });

      const data: UploadResponse = await response.json();

      if (!response.ok || !data.success) {
        const errorMessage = data.error || `Upload failed: ${response.status}`;
        setError(errorMessage);
        onError?.(errorMessage);
        return null;
      }

      if (!data.variant) {
        const errorMessage = 'Upload succeeded but no variant returned';
        setError(errorMessage);
        onError?.(errorMessage);
        return null;
      }

      onSuccess?.(data.variant, data.asset);
      return data.variant;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Upload failed';
      setError(errorMessage);
      onError?.(errorMessage);
      return null;
    } finally {
      setIsUploading(false);
    }
  }, [spaceId, onSuccess, onError]);

  const uploadNewAsset = useCallback(async (params: UploadNewAssetParams): Promise<{ variant: Variant; asset: Asset } | null> => {
    const { file, assetName, assetType = 'character', parentAssetId } = params;

    // Clear previous error
    setError(null);
    setIsUploading(true);

    try {
      // Build FormData
      const formData = new FormData();
      formData.append('file', file);
      formData.append('assetName', assetName);
      formData.append('assetType', assetType);
      if (parentAssetId) {
        formData.append('parentAssetId', parentAssetId);
      }

      // Upload
      const response = await fetch(`/api/spaces/${spaceId}/upload`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      const data: UploadResponse = await response.json();

      if (!response.ok || !data.success) {
        const errorMessage = data.error || `Upload failed: ${response.status}`;
        setError(errorMessage);
        onError?.(errorMessage);
        return null;
      }

      if (!data.variant || !data.asset) {
        const errorMessage = 'Upload succeeded but missing variant or asset';
        setError(errorMessage);
        onError?.(errorMessage);
        return null;
      }

      onSuccess?.(data.variant, data.asset);
      return { variant: data.variant, asset: data.asset };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Upload failed';
      setError(errorMessage);
      onError?.(errorMessage);
      return null;
    } finally {
      setIsUploading(false);
    }
  }, [spaceId, onSuccess, onError]);

  return {
    upload,
    uploadNewAsset,
    isUploading,
    error,
    clearError,
  };
}
