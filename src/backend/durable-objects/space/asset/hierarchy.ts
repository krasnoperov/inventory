/**
 * Asset Hierarchy Utilities
 *
 * Pure functions for asset tree operations:
 * - Cycle detection when re-parenting
 * - Ancestor chain traversal for breadcrumbs
 *
 * These functions are dependency-injected with lookup functions
 * for easy testing without database access.
 */

/**
 * Check if setting newParentId as parent of assetId would create a cycle.
 *
 * Algorithm: Walk up the ancestor chain from newParentId. If we reach
 * assetId, it would create a cycle (invalid).
 *
 * @param assetId - The asset being reparented
 * @param newParentId - The proposed new parent (null means root)
 * @param getParentId - Async function to lookup an asset's parent ID
 * @returns true if it would create a cycle (invalid), false otherwise
 *
 * @example
 * // In SpaceDO:
 * const wouldCycle = await wouldCreateCycle(
 *   assetId,
 *   newParentId,
 *   async (id) => {
 *     const result = await this.ctx.storage.sql.exec(
 *       'SELECT parent_asset_id FROM assets WHERE id = ?', id
 *     );
 *     return result.toArray()[0]?.parent_asset_id ?? null;
 *   }
 * );
 */
export async function wouldCreateCycle(
  assetId: string,
  newParentId: string | null,
  getParentId: (id: string) => Promise<string | null>
): Promise<boolean> {
  // If no parent, no cycle possible
  if (!newParentId) return false;

  // Can't be your own parent
  if (assetId === newParentId) return true;

  // Walk up the ancestor chain from newParentId to see if we reach assetId
  let currentId: string | null = newParentId;
  const visited = new Set<string>();

  while (currentId) {
    // Prevent infinite loops in case of existing (corrupted) cycles
    if (visited.has(currentId)) break;
    visited.add(currentId);

    // If we reach the asset we're trying to reparent, it's a cycle
    if (currentId === assetId) return true;

    // Get the parent of current
    currentId = await getParentId(currentId);
  }

  return false;
}

/**
 * Build ancestor chain for an asset (for breadcrumbs).
 *
 * Returns ancestors in root-first order (grandparent, parent, etc.)
 * excluding the asset itself.
 *
 * @param assetId - The asset to get ancestors for
 * @param getAssetById - Async function to lookup an asset by ID
 * @param getParentId - Function to extract parent_asset_id from an asset
 * @returns Array of ancestors in root-first order
 *
 * @example
 * // In SpaceDO:
 * const ancestors = await getAncestorChain(
 *   assetId,
 *   async (id) => {
 *     const result = await this.ctx.storage.sql.exec(
 *       'SELECT * FROM assets WHERE id = ?', id
 *     );
 *     return result.toArray()[0] as Asset | undefined ?? null;
 *   },
 *   (asset) => asset.parent_asset_id
 * );
 */
export async function getAncestorChain<T>(
  assetId: string,
  getAssetById: (id: string) => Promise<T | null>,
  getParentId: (asset: T) => string | null
): Promise<T[]> {
  const ancestors: T[] = [];
  let currentId: string | null = assetId;
  let isFirst = true;
  const visited = new Set<string>();

  while (currentId) {
    // Prevent infinite loops
    if (visited.has(currentId)) break;
    visited.add(currentId);

    const asset = await getAssetById(currentId);
    if (!asset) break;

    // Skip the first one (the asset itself)
    if (!isFirst) {
      ancestors.unshift(asset); // Root-first order
    }
    isFirst = false;

    currentId = getParentId(asset);
  }

  return ancestors;
}

/**
 * Get all descendants of an asset (children, grandchildren, etc.)
 *
 * Uses BFS to traverse the tree.
 *
 * @param assetId - The root asset ID
 * @param getChildIds - Async function to get child asset IDs
 * @param maxDepth - Maximum depth to traverse (default: 10)
 * @returns Array of descendant asset IDs
 */
export async function getDescendantIds(
  assetId: string,
  getChildIds: (id: string) => Promise<string[]>,
  maxDepth: number = 10
): Promise<string[]> {
  const descendants: string[] = [];
  const queue: Array<{ id: string; depth: number }> = [{ id: assetId, depth: 0 }];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (visited.has(current.id)) continue;
    visited.add(current.id);

    if (current.depth > 0) {
      // Don't include the root asset itself
      descendants.push(current.id);
    }

    if (current.depth < maxDepth) {
      const childIds = await getChildIds(current.id);
      for (const childId of childIds) {
        if (!visited.has(childId)) {
          queue.push({ id: childId, depth: current.depth + 1 });
        }
      }
    }
  }

  return descendants;
}
