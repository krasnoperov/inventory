/**
 * Image Reference Counting Utilities
 *
 * Manages reference counting for images stored in R2.
 * When a variant is created, refs are incremented for all images it uses.
 * When a variant is deleted, refs are decremented and images with 0 refs are deleted.
 *
 * This ensures images are only deleted when no variants reference them,
 * supporting image reuse across variants (e.g., same input used in multiple derives).
 */

// ============================================================================
// SQL Queries
// ============================================================================

/**
 * SQL to increment image reference count (upsert pattern).
 * If the key doesn't exist, inserts with count 1.
 * If it exists, increments the count.
 */
export const INCREMENT_REF_SQL = `
  INSERT INTO image_refs (image_key, ref_count) VALUES (?, 1)
  ON CONFLICT(image_key) DO UPDATE SET ref_count = ref_count + 1
`;

/**
 * SQL to decrement image reference count and return the new count.
 * The RETURNING clause lets us check if we should delete the image.
 */
export const DECREMENT_REF_SQL = `
  UPDATE image_refs SET ref_count = ref_count - 1
  WHERE image_key = ?
  RETURNING ref_count
`;

/**
 * SQL to delete an image reference record.
 * Called after ref_count reaches 0 and the R2 object is deleted.
 */
export const DELETE_REF_SQL = 'DELETE FROM image_refs WHERE image_key = ?';

// ============================================================================
// Variant Image Key Extraction
// ============================================================================

/**
 * Recipe structure as stored in variant.recipe JSON.
 * The operation field indicates how the variant was created:
 * - generate: AI-generated from prompt only
 * - derive: AI-generated using reference images
 * - refine: AI refinement of existing asset
 * - fork: Copy without modification
 * - upload: User uploaded image (no AI)
 */
interface Recipe {
  operation?: 'generate' | 'derive' | 'refine' | 'fork' | 'upload';
  prompt?: string;
  /** For generated variants: source images used */
  inputs?: Array<{
    variantId?: string;
    imageKey: string;
  }>;
  /** For uploaded variants: original filename */
  originalFilename?: string;
  /** For uploaded variants: upload timestamp */
  uploadedAt?: string;
  /** Asset type (character, item, scene, etc.) */
  assetType?: string;
}

/**
 * Extract all image keys that need ref counting for a variant.
 *
 * A variant references:
 * 1. Its own image_key (the generated image)
 * 2. Its own thumb_key (the thumbnail)
 * 3. Any input images from the recipe (source images used in generation)
 *
 * Note: Only call this for completed variants. Placeholder variants
 * (pending/failed) have null image keys and should not be ref-counted.
 *
 * @param variant - Variant with image_key, thumb_key, and recipe
 * @returns Deduplicated array of non-null image keys
 *
 * @example
 * const keys = getVariantImageKeys({
 *   image_key: 'images/space1/variant1.png',
 *   thumb_key: 'thumbs/space1/variant1.png',
 *   recipe: JSON.stringify({
 *     type: 'derive',
 *     inputs: [{ imageKey: 'images/space1/source.png' }]
 *   })
 * });
 * // Returns: ['images/space1/variant1.png', 'thumbs/space1/variant1.png', 'images/space1/source.png']
 */
export function getVariantImageKeys(variant: {
  image_key: string | null;
  thumb_key: string | null;
  recipe: string;
}): string[] {
  const keys: string[] = [];

  // Only add keys that are not null (placeholder variants have null keys)
  if (variant.image_key) keys.push(variant.image_key);
  if (variant.thumb_key) keys.push(variant.thumb_key);

  try {
    const recipe = JSON.parse(variant.recipe) as Recipe;
    if (recipe.inputs && Array.isArray(recipe.inputs)) {
      for (const input of recipe.inputs) {
        if (input.imageKey) {
          keys.push(input.imageKey);
        }
      }
    }
  } catch {
    // Ignore JSON parse errors - just use the direct keys
  }

  // Deduplicate (image_key and thumb_key might be the same for some variants)
  return [...new Set(keys)];
}

/**
 * Parse recipe JSON safely.
 * Returns null if parsing fails.
 */
export function parseRecipe(recipeJson: string): Recipe | null {
  try {
    return JSON.parse(recipeJson) as Recipe;
  } catch {
    return null;
  }
}

/**
 * Get input image keys from a recipe.
 * Returns empty array if recipe is invalid or has no inputs.
 */
export function getRecipeInputKeys(recipeJson: string): string[] {
  const recipe = parseRecipe(recipeJson);
  if (!recipe?.inputs || !Array.isArray(recipe.inputs)) {
    return [];
  }
  return recipe.inputs
    .filter((input) => input.imageKey)
    .map((input) => input.imageKey);
}
