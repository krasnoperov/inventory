/**
 * Reference Image Limit Utilities
 *
 * Ensures combined style + pipeline reference images fit within
 * Gemini's per-request limit (14 images).
 */

/**
 * Cap pipeline refs to fit within Gemini's limit alongside style refs.
 * Always keeps the source image, then fills with most recent views.
 */
export function capRefs(
  styleKeys: string[],
  pipelineKeys: string[],
  sourceKey: string,
  maxTotal: number = 14
): string[] {
  const budget = maxTotal - styleKeys.length;
  if (budget <= 0) return [];
  if (pipelineKeys.length <= budget) return pipelineKeys;
  // Always keep source (first), then most recent views
  return [sourceKey, ...pipelineKeys.slice(-(budget - 1))];
}

/**
 * Get style image keys for the current space.
 * Returns empty arrays until Tier 1 (Style Anchoring) is implemented.
 */
export async function getStyleImageKeys(
  _repo: unknown,
  _disableStyle?: boolean
): Promise<{ styleKeys: string[]; styleDescription: string | null }> {
  // TODO: Tier 1 integration — when StyleController lands with generation support,
  // fetch active style here and return its image_keys + description
  return { styleKeys: [], styleDescription: null };
}
