/**
 * Lineage Graph Utilities
 *
 * Pure functions for building lineage graphs using BFS traversal.
 * Uses dependency injection for database access.
 */

// ============================================================================
// Types
// ============================================================================

/** Raw lineage row from database (SQLite stores booleans as 0/1) */
export interface LineageRow {
  id: string;
  parent_variant_id: string;
  child_variant_id: string;
  relation_type: string;
  severed: number; // SQLite 0/1
  created_at: number;
}

/** Lineage with proper boolean type */
export interface LineageEntry {
  id: string;
  parent_variant_id: string;
  child_variant_id: string;
  relation_type: string;
  severed: boolean;
  created_at: number;
}

/** Variant with asset info for graph display */
export interface GraphVariant {
  id: string;
  asset_id: string;
  thumb_key: string;
  image_key: string;
  created_at: number;
  asset_name: string;
  asset_type: string;
}

/** Complete lineage graph result */
export interface LineageGraph {
  startVariantId: string;
  variants: GraphVariant[];
  lineage: LineageEntry[];
}

/** Dependencies for graph building */
export interface GraphDependencies {
  /** Get lineage connections for a variant (both parent and child) */
  getLineageForVariant: (variantId: string) => Promise<LineageRow[]>;
  /** Get variants with asset info by IDs */
  getVariantsWithAssets: (variantIds: string[]) => Promise<GraphVariant[]>;
}

// ============================================================================
// Graph Building
// ============================================================================

/**
 * Build a complete lineage graph starting from a variant.
 * Uses BFS to traverse all connected nodes (parents and children).
 *
 * @param startVariantId - Starting point for graph traversal
 * @param deps - Injected dependencies
 * @returns Complete graph with all connected variants and lineage entries
 *
 * @example
 * const graph = await buildLineageGraph('variant-123', {
 *   getLineageForVariant: async (id) => {
 *     const result = await db.exec(
 *       'SELECT * FROM lineage WHERE parent_variant_id = ? OR child_variant_id = ?',
 *       id, id
 *     );
 *     return result.toArray();
 *   },
 *   getVariantsWithAssets: async (ids) => {
 *     // ... fetch variants joined with assets
 *   }
 * });
 */
export async function buildLineageGraph(
  startVariantId: string,
  deps: GraphDependencies
): Promise<LineageGraph> {
  const visited = new Set<string>();
  const queue: string[] = [startVariantId];
  const allVariantIds = new Set<string>();
  const allLineage: LineageEntry[] = [];
  const seenLineageIds = new Set<string>();

  // BFS traversal
  while (queue.length > 0) {
    const variantId = queue.shift()!;
    if (visited.has(variantId)) continue;
    visited.add(variantId);
    allVariantIds.add(variantId);

    // Get all lineage connections for this variant
    const lineageRows = await deps.getLineageForVariant(variantId);

    for (const row of lineageRows) {
      // Avoid duplicate lineage entries
      if (!seenLineageIds.has(row.id)) {
        seenLineageIds.add(row.id);
        allLineage.push({
          ...row,
          severed: Boolean(row.severed), // Convert SQLite 0/1 to boolean
        });
      }

      // Queue connected variants
      if (!visited.has(row.parent_variant_id)) {
        queue.push(row.parent_variant_id);
      }
      if (!visited.has(row.child_variant_id)) {
        queue.push(row.child_variant_id);
      }
    }
  }

  // Fetch all variants in the graph with asset info
  const variants =
    allVariantIds.size > 0 ? await deps.getVariantsWithAssets(Array.from(allVariantIds)) : [];

  return {
    startVariantId,
    variants,
    lineage: allLineage,
  };
}

/**
 * Convert SQLite boolean (0/1) to JavaScript boolean.
 * Useful for processing raw database results.
 */
export function convertSqliteBoolean(value: number): boolean {
  return Boolean(value);
}
