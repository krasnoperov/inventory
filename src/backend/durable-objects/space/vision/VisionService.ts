/**
 * Vision Service
 *
 * Orchestrates describe and compare operations for images using Claude vision.
 * Pure functions with dependency injection for testability.
 *
 * This service handles:
 * - Validation of inputs and prerequisites
 * - Fetching variant/asset data
 * - Fetching images from storage
 * - Converting to base64 for Claude API
 * - Coordinating with ClaudeService
 */

import type { ClaudeUsage } from '../../../services/claudeService';
import type { DescribeFocus } from '../../../../shared/websocket-types';

// ============================================================================
// Types
// ============================================================================

/** Result of a describe operation */
export interface DescribeResult {
  success: true;
  description: string;
  usage?: ClaudeUsage;
}

/** Result of a compare operation */
export interface CompareResult {
  success: true;
  comparison: string;
  usage?: ClaudeUsage;
}

/** Error result for vision operations */
export interface VisionError {
  success: false;
  error: string;
}

/** Dependencies for vision operations */
export interface VisionDependencies {
  /** Get variant by ID, returns image_key */
  getVariant: (id: string) => Promise<{ image_key: string } | null>;
  /** Get variant with asset info for comparison */
  getVariantWithAsset: (id: string) => Promise<{ image_key: string; asset_name: string } | null>;
  /** Fetch image bytes from R2 by key */
  getImage: (key: string) => Promise<ArrayBuffer | null>;
  /** Claude describe function */
  describeImage: (
    base64: string,
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
    assetName: string,
    focus: DescribeFocus,
    question?: string
  ) => Promise<{ description: string; usage: ClaudeUsage }>;
  /** Claude compare function */
  compareImages: (
    images: Array<{ base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; label: string }>,
    aspects: string[]
  ) => Promise<{ comparison: string; usage: ClaudeUsage }>;
}

// ============================================================================
// Image Utilities
// ============================================================================

/**
 * Convert ArrayBuffer to base64 string.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Detect image type from base64 magic bytes.
 * Returns JPEG as default for unknown types.
 */
export function detectImageType(
  base64: string
): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  // Decode first few bytes to check magic numbers
  try {
    const decoded = atob(base64.slice(0, 20));
    const bytes = decoded.split('').map((c) => c.charCodeAt(0));

    // PNG: 89 50 4E 47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'image/png';
    }
    // GIF: 47 49 46
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      return 'image/gif';
    }
    // WebP: 52 49 46 46 ... 57 45 42 50
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      return 'image/webp';
    }
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
  } catch {
    // If decoding fails, default to JPEG
  }
  return 'image/jpeg';
}

// ============================================================================
// Describe Operation
// ============================================================================

export interface DescribeRequest {
  variantId: string;
  assetName: string;
  focus?: DescribeFocus;
  question?: string;
}

/**
 * Process a describe request - analyze a single image.
 *
 * @param request - The describe request parameters
 * @param deps - Injected dependencies
 * @returns Description result or error
 *
 * @example
 * const result = await processDescribe(
 *   { variantId: 'v1', assetName: 'Hero Character', focus: 'style' },
 *   {
 *     getVariant: async (id) => db.getVariant(id),
 *     getImage: async (key) => r2.get(key),
 *     describeImage: claudeService.describeImage.bind(claudeService),
 *     // ...
 *   }
 * );
 */
export async function processDescribe(
  request: DescribeRequest,
  deps: VisionDependencies
): Promise<DescribeResult | VisionError> {
  // Get variant from database
  const variant = await deps.getVariant(request.variantId);
  if (!variant?.image_key) {
    return { success: false, error: 'Variant not found or has no image' };
  }

  // Fetch image from R2
  const imageData = await deps.getImage(variant.image_key);
  if (!imageData) {
    return { success: false, error: 'Image not found in storage' };
  }

  // Convert to base64 and detect type
  const base64 = arrayBufferToBase64(imageData);
  const mediaType = detectImageType(base64);

  // Call Claude to describe
  const { description, usage } = await deps.describeImage(
    base64,
    mediaType,
    request.assetName,
    request.focus || 'general',
    request.question
  );

  return {
    success: true,
    description,
    usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
  };
}

// ============================================================================
// Compare Operation
// ============================================================================

export interface CompareRequest {
  variantIds: string[];
  aspects?: string[];
}

/**
 * Process a compare request - compare multiple images.
 *
 * @param request - The compare request parameters
 * @param deps - Injected dependencies
 * @returns Comparison result or error
 *
 * @example
 * const result = await processCompare(
 *   { variantIds: ['v1', 'v2'], aspects: ['style', 'colors'] },
 *   {
 *     getVariantWithAsset: async (id) => db.getVariantWithAsset(id),
 *     getImage: async (key) => r2.get(key),
 *     compareImages: claudeService.compareImages.bind(claudeService),
 *     // ...
 *   }
 * );
 */
export async function processCompare(
  request: CompareRequest,
  deps: VisionDependencies
): Promise<CompareResult | VisionError> {
  // Validate variant count
  if (!request.variantIds || request.variantIds.length < 2 || request.variantIds.length > 4) {
    return { success: false, error: 'Must provide 2-4 variants to compare' };
  }

  // Fetch all variant images
  const images: Array<{
    base64: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    label: string;
  }> = [];

  for (const variantId of request.variantIds) {
    // Get variant and asset info
    const variantRow = await deps.getVariantWithAsset(variantId);
    if (!variantRow?.image_key) {
      return { success: false, error: `Variant ${variantId.slice(0, 8)} not found` };
    }

    // Fetch image from R2
    const imageData = await deps.getImage(variantRow.image_key);
    if (!imageData) {
      return { success: false, error: `Image for variant ${variantId.slice(0, 8)} not found` };
    }

    // Convert to base64 and detect type
    const base64 = arrayBufferToBase64(imageData);

    images.push({
      base64,
      mediaType: detectImageType(base64),
      label: variantRow.asset_name || `Variant ${variantId.slice(0, 8)}`,
    });
  }

  // Call Claude to compare
  const aspects = request.aspects || ['style', 'composition', 'colors'];
  const { comparison, usage } = await deps.compareImages(images, aspects);

  return {
    success: true,
    comparison,
    usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
  };
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Check if API key is configured.
 * Use before calling vision operations.
 */
export function hasApiKey(apiKey: string | undefined): apiKey is string {
  return typeof apiKey === 'string' && apiKey.length > 0;
}

/**
 * Check if storage is configured.
 * Use before calling vision operations.
 */
export function hasStorage<T>(storage: T | undefined): storage is T {
  return storage !== undefined && storage !== null;
}
