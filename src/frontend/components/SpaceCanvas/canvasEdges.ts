import type { Lineage, Variant } from '../../space/protocol';

export type LineageRelationType = Lineage['relation_type'];

export interface CanvasLineageEdge {
  id: string;
  source: string; // parent asset id
  target: string; // child asset id
  relationType: LineageRelationType;
}

// Collapse variant-level lineage into asset-level edges for the canvas: map each
// endpoint variant to its asset, drop severed links and intra-asset refinements
// (parent and child in the same asset), and de-duplicate directed asset pairs.
// The first link wins a pair's relation type.
export function buildLineageAssetEdges(lineage: Lineage[], variants: Variant[]): CanvasLineageEdge[] {
  const variantToAsset = new Map(variants.map((variant) => [variant.id, variant.asset_id]));
  const seen = new Set<string>();
  const edges: CanvasLineageEdge[] = [];

  for (const link of lineage) {
    if (link.severed) continue;
    const source = variantToAsset.get(link.parent_variant_id);
    const target = variantToAsset.get(link.child_variant_id);
    if (!source || !target || source === target) continue;
    const id = `${source}->${target}`;
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push({ id, source, target, relationType: link.relation_type });
  }

  return edges;
}
