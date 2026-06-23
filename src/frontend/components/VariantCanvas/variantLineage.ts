import type { Lineage } from '../../space/protocol';

export interface LineageStep {
  /** The ancestor variant that this step came from. */
  variantId: string;
  /** How the child was produced from this ancestor. */
  relationType: Lineage['relation_type'];
}

/**
 * Walk the (unsevered) parent links from a variant up to its root, returning the
 * creation trail ordered from the **oldest ancestor to the direct parent**
 * (the variant itself is not included). Severed links cut the chain, matching
 * how lineage edges are rendered on the canvas. A visited set guards against
 * cycles in malformed data so the walk always terminates.
 */
export function buildAncestryTrail(variantId: string, lineage: Lineage[]): LineageStep[] {
  // Index unsevered links by child so each step is an O(1) lookup.
  const parentByChild = new Map<string, Lineage>();
  for (const link of lineage) {
    if (link.severed) continue;
    // Keep the first parent seen for a child; lineage is expected to be a tree.
    if (!parentByChild.has(link.child_variant_id)) {
      parentByChild.set(link.child_variant_id, link);
    }
  }

  const trail: LineageStep[] = [];
  const visited = new Set<string>([variantId]);
  let current = variantId;
  while (true) {
    const link = parentByChild.get(current);
    if (!link || visited.has(link.parent_variant_id)) break;
    trail.push({ variantId: link.parent_variant_id, relationType: link.relation_type });
    visited.add(link.parent_variant_id);
    current = link.parent_variant_id;
  }

  // Collected direct-parent → root; reverse to read oldest → newest.
  return trail.reverse();
}
