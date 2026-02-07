/**
 * Reference Image Limit Utilities
 *
 * Ensures combined style + pipeline reference images fit within
 * Gemini's per-request limit (14 images).
 */

import type { SpaceRepository } from '../repository/SpaceRepository';

/**
 * Cap pipeline refs to fit within Gemini's limit alongside style refs.
 * Always keeps the source image AND the front/first generated view (masterKey),
 * then fills remaining budget with most recent views.
 *
 * Pinning the front view ensures later steps in rotation/tile pipelines
 * always have the canonical reference, reducing inter-step drift.
 */
export function capRefs(
  styleKeys: string[],
  pipelineKeys: string[],
  sourceKey: string,
  maxTotal: number = 14,
  masterKey?: string
): string[] {
  const budget = maxTotal - styleKeys.length;
  if (budget <= 0) return [];
  if (pipelineKeys.length <= budget) return pipelineKeys;

  // Build pinned set: source + master (front view), deduplicating
  const pinned: string[] = [sourceKey];
  if (masterKey && masterKey !== sourceKey) {
    pinned.push(masterKey);
  }

  const pinnedSet = new Set(pinned);
  const remaining = pipelineKeys.filter(k => !pinnedSet.has(k));
  const fillCount = budget - pinned.length;

  return [...pinned, ...remaining.slice(-fillCount)];
}

/**
 * Get style image keys for the current space.
 * Fetches the active style and returns its image keys + description.
 */
export async function getStyleImageKeys(
  repo: SpaceRepository,
  disableStyle?: boolean
): Promise<{ styleKeys: string[]; styleDescription: string | null }> {
  if (disableStyle) return { styleKeys: [], styleDescription: null };
  const style = await repo.getActiveStyle();
  if (!style || !style.enabled) return { styleKeys: [], styleDescription: null };
  let keys: string[] = [];
  try { keys = JSON.parse(style.image_keys); } catch { /* ignore malformed JSON */ }
  return { styleKeys: keys, styleDescription: style.description || null };
}
