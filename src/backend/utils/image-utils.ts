// =============================================================================
// Image Utilities - Shared functions for image processing
// =============================================================================

import type { Env } from '../../core/types';

export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/**
 * Detect actual image type from base64 data by checking magic bytes.
 * More reliable than R2 metadata which may be incorrect.
 */
export function detectImageType(base64: string): ImageMimeType {
  // Check base64 prefix patterns (magic bytes encoded)
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBOR')) return 'image/png';
  if (base64.startsWith('R0lG')) return 'image/gif';
  if (base64.startsWith('UklGR')) return 'image/webp';

  // Default to jpeg as it's most common for generated images
  return 'image/jpeg';
}

/**
 * Get file extension from mime type
 */
export function getExtensionForMimeType(mimeType: ImageMimeType): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
}

/**
 * Convert ArrayBuffer to base64 string without stack overflow.
 * Uses chunked processing to handle large images safely.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * Convert base64 string to Uint8Array
 */
export function base64ToBuffer(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

/**
 * Thumbnail options for createThumbnail
 */
export interface ThumbnailOptions {
  width: number;
  height: number;
  fit?: 'cover' | 'contain' | 'scale-down' | 'crop';
  gravity?: 'auto' | 'face' | 'center';
  quality?: number;
  format?: 'webp' | 'jpeg' | 'png';
}

// Thumbnail size of 512px covers:
// - 2x DPR displays up to 256px CSS size
// - 3x DPR displays up to 170px CSS size
// This handles --thumb-size-lg (150px) well on all displays
const DEFAULT_THUMBNAIL_OPTIONS: ThumbnailOptions = {
  width: 512,
  height: 512,
  fit: 'cover',
  gravity: 'auto', // Smart crop using saliency detection
  quality: 80,
  format: 'webp',
};

/**
 * Create a thumbnail from an image stored in R2.
 * Uses Cloudflare Image Resizing (cf.image) on stage/production.
 * Falls back to original image on local development.
 *
 * @param imageKey - R2 key of the source image (must already be uploaded)
 * @param baseUrl - Base URL for self-fetch (e.g., "https://inventory-stage.krasnoperov.me")
 * @param env - Cloudflare environment
 * @param options - Thumbnail options
 * @returns Buffer of the thumbnail image
 */
export async function createThumbnail(
  imageKey: string,
  baseUrl: string,
  env: Env,
  options: Partial<ThumbnailOptions> = {}
): Promise<{ buffer: Uint8Array; mimeType: ImageMimeType }> {
  const opts = { ...DEFAULT_THUMBNAIL_OPTIONS, ...options };

  // On local development, cf.image is not available
  // Just return the original image from R2 directly
  const isLocal = env.ENVIRONMENT === 'local' || env.ENVIRONMENT === 'development' || env.ENVIRONMENT === undefined;

  if (isLocal) {
    console.log('[createThumbnail] Local mode - returning original image');
    const object = await env.IMAGES.get(imageKey);
    if (!object) {
      throw new Error(`Source image not found: ${imageKey}`);
    }
    const buffer = new Uint8Array(await object.arrayBuffer());
    const mimeType = (object.httpMetadata?.contentType as ImageMimeType) || 'image/png';
    return { buffer, mimeType };
  }

  // On stage/production, use Cloudflare Image Resizing
  // Fetch our own image endpoint with cf.image options
  const imageUrl = `${baseUrl}/api/images/${imageKey}`;

  console.log(`[createThumbnail] Fetching thumbnail from: ${imageUrl}`);

  const response = await fetch(imageUrl, {
    cf: {
      image: {
        width: opts.width,
        height: opts.height,
        fit: opts.fit,
        gravity: opts.gravity,
        quality: opts.quality,
        format: opts.format,
      },
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to create thumbnail: ${response.status} ${response.statusText}`);
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  const mimeType = `image/${opts.format}` as ImageMimeType;

  console.log(`[createThumbnail] Created thumbnail: ${buffer.length} bytes, ${mimeType}`);

  return { buffer, mimeType };
}

/**
 * Get the base URL for the current environment.
 * Used for self-fetching images with cf.image transformations.
 */
export function getBaseUrl(env: Env): string {
  switch (env.ENVIRONMENT) {
    case 'production':
      return 'https://inventory.krasnoperov.me';
    case 'stage':
    case 'staging':
      return 'https://inventory-stage.krasnoperov.me';
    default:
      return 'http://localhost:8788';
  }
}
