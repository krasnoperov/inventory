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
 * Parse image dimensions from raw bytes.
 * Supports PNG, JPEG, GIF, and WebP headers.
 * Returns null if dimensions cannot be determined.
 */
export function getImageDimensions(
  data: Uint8Array
): { width: number; height: number } | null {
  if (data.length < 12) return null;

  // PNG: bytes 16-23 contain width/height as big-endian uint32
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
    if (data.length < 24) return null;
    const width = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19];
    const height = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23];
    return { width, height };
  }

  // GIF: bytes 6-9 contain width/height as little-endian uint16
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
    if (data.length < 10) return null;
    const width = data[6] | (data[7] << 8);
    const height = data[8] | (data[9] << 8);
    return { width, height };
  }

  // JPEG: scan for SOF0/SOF2 markers (0xFF 0xC0 or 0xFF 0xC2)
  if (data[0] === 0xFF && data[1] === 0xD8) {
    let offset = 2;
    while (offset < data.length - 9) {
      if (data[offset] !== 0xFF) { offset++; continue; }
      const marker = data[offset + 1];
      if (marker === 0xC0 || marker === 0xC2) {
        const height = (data[offset + 5] << 8) | data[offset + 6];
        const width = (data[offset + 7] << 8) | data[offset + 8];
        return { width, height };
      }
      // Skip to next marker using segment length
      const segLen = (data[offset + 2] << 8) | data[offset + 3];
      offset += 2 + segLen;
    }
    return null;
  }

  // WebP: RIFF header, then check VP8/VP8L/VP8X
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
      data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
    // VP8X (extended): width at 24-26, height at 27-29 (24-bit LE, +1)
    if (data[12] === 0x56 && data[13] === 0x50 && data[14] === 0x38 && data[15] === 0x58) {
      if (data.length < 30) return null;
      const width = ((data[24]) | (data[25] << 8) | (data[26] << 16)) + 1;
      const height = ((data[27]) | (data[28] << 8) | (data[29] << 16)) + 1;
      return { width, height };
    }
    // VP8L (lossless): dimensions packed in bytes 21-24
    if (data[12] === 0x56 && data[13] === 0x50 && data[14] === 0x38 && data[15] === 0x4C) {
      if (data.length < 25) return null;
      const bits = (data[21]) | (data[22] << 8) | (data[23] << 16) | (data[24] << 24);
      const width = (bits & 0x3FFF) + 1;
      const height = ((bits >> 14) & 0x3FFF) + 1;
      return { width, height };
    }
    // VP8 (lossy): width/height at bytes 26-29 (little-endian uint16)
    if (data[12] === 0x56 && data[13] === 0x50 && data[14] === 0x38 && data[15] === 0x20) {
      if (data.length < 30) return null;
      const width = (data[26] | (data[27] << 8)) & 0x3FFF;
      const height = (data[28] | (data[29] << 8)) & 0x3FFF;
      return { width, height };
    }
  }

  return null;
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
