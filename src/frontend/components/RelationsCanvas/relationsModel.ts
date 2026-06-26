/**
 * Relations Canvas model
 *
 * A space holds five relational families that the masonry wall hides:
 *  - lineage (variant derivation, collapsed to asset level)
 *  - authored semantic relations (space_relations: appears_in, prop_in, …)
 *  - composition membership (variants placed into a deliverable)
 *  - collection membership (grouping)
 *  - asset → variant fan-out (summarised as a node badge, not an edge)
 *
 * This module turns the raw space snapshot into a draggable asset graph:
 * asset nodes, typed edges, grouping clusters, and a self-contained
 * force / layered layout. Pure functions only — no React, so it is unit
 * testable and the component stays thin.
 */

import dagre from 'dagre';
import * as d3Force from 'd3-force';
import type {
  Asset,
  CompositionItem,
  CompositionStatus,
  CollectionItem,
  Lineage,
  SpaceCollection,
  SpaceRelation,
  Variant,
} from '../../space/protocol';

// Both the full Composition and the lighter CompositionOverview (overview sync)
// satisfy this — the graph only needs identity, name and status.
export interface CompositionLike {
  id: string;
  name: string;
  status: CompositionStatus;
}
import { buildLineageAssetEdges } from '../SpaceCanvas/canvasEdges';
import { getDisplayVariant, COLLECTION_KIND_COLORS } from '../SpaceBoard/spaceBoardModel';

export type RelationFamily = 'lineage' | 'relation' | 'composition';
export type GroupingAxis = 'collection' | 'type' | 'none';
export type LayoutMode = 'force' | 'layered';

// Edge families are tinted from app tokens, not arbitrary hex: lineage carries
// the brand's provenance purple (matches the landing-page lineage metaphor),
// authored relations take the warm "human note" amber, compositions the green
// assembly/success hue. The concrete colours live in the CSS module as
// light-dark() pairs under these var names; the component resolves them at
// runtime for the edge strokes, markers and minimap.
export const RELATION_FAMILY_VARS: Record<RelationFamily, string> = {
  lineage: '--canvas-thread-lineage',
  relation: '--canvas-thread-relation',
  composition: '--canvas-thread-composition',
};

export const RELATION_FAMILY_LABELS: Record<RelationFamily, string> = {
  lineage: 'Lineage',
  relation: 'Relations',
  composition: 'Compositions',
};

export const RELATION_FAMILY_HINTS: Record<RelationFamily, string> = {
  lineage: 'Forged from — derivation provenance',
  relation: 'Authored links — appears in, prop in, …',
  composition: 'Assembled into a deliverable',
};

// Per-asset rollup of its variants — the "information density" the wall drops.
export interface VariantStats {
  total: number;
  ready: number;
  pending: number;
  failed: number;
  starred: number;
}

export interface AssetNodeModel {
  id: string;
  asset: Asset;
  variant: Variant | null; // representative variant for the thumbnail
  stats: VariantStats;
  groupKey: string;
  groupLabel: string;
  groupColor: string;
  typeColor: string; // hue for the asset type, independent of the grouping spine
}

export interface CompositionNodeModel {
  id: string;
  composition: CompositionLike;
  memberCount: number;
}

export interface GraphEdgeModel {
  id: string;
  source: string;
  target: string;
  family: RelationFamily;
  label?: string;
  /** lineage sub-type / relation type, for tinting */
  variant?: string;
}

export interface GroupModel {
  key: string;
  label: string;
  color: string;
  nodeIds: string[];
}

export interface RelationsGraph {
  assetNodes: AssetNodeModel[];
  compositionNodes: CompositionNodeModel[];
  edges: GraphEdgeModel[];
  groups: GroupModel[];
}

const COMP_PREFIX = 'comp:';

function computeStats(assetId: string, variants: Variant[]): VariantStats {
  const stats: VariantStats = { total: 0, ready: 0, pending: 0, failed: 0, starred: 0 };
  for (const v of variants) {
    if (v.asset_id !== assetId) continue;
    stats.total += 1;
    if (v.status === 'completed') stats.ready += 1;
    else if (v.status === 'failed') stats.failed += 1;
    else stats.pending += 1;
    if (v.starred) stats.starred += 1;
  }
  return stats;
}

// Map an asset or variant subject onto the asset it belongs to, so variant-level
// authored relations still connect the asset nodes the canvas draws.
function resolveAsset(
  type: 'asset' | 'variant',
  assetId: string | null,
  variantId: string | null,
  variantToAsset: Map<string, string>,
): string | null {
  if (type === 'asset') return assetId;
  if (variantId) return variantToAsset.get(variantId) ?? null;
  return null;
}

function groupForAsset(
  asset: Asset,
  axis: GroupingAxis,
  collectionByAsset: Map<string, SpaceCollection>,
): { key: string; label: string; color: string } {
  if (axis === 'type') {
    const key = asset.type || 'untyped';
    return { key: `type:${key}`, label: key, color: colorForType(key) };
  }
  if (axis === 'collection') {
    const collection = collectionByAsset.get(asset.id);
    if (collection) {
      return {
        key: `col:${collection.id}`,
        label: collection.name,
        color: collection.color ?? COLLECTION_KIND_COLORS[collection.kind] ?? '#6f7480',
      };
    }
    return { key: 'col:__unfiled__', label: 'Unfiled', color: '#6f7480' };
  }
  return { key: 'all', label: 'All assets', color: '#6f7480' };
}

// Asset-type spine colour. Known types echo the app's --color-type-* hues
// (character=blue, item=purple, scene=green, composite/sheets=orange); unknown
// types get a stable hashed OKLCH hue so the whole palette stays in one space.
const TYPE_HUES: Record<string, number> = {
  character: 250,
  item: 300,
  scene: 145,
  composite: 55,
  'sprite-sheet': 55,
  'style-sheet': 300,
  animation: 35,
  reference: 200,
};

function colorForType(type: string): string {
  const known = TYPE_HUES[type];
  if (known !== undefined) return `oklch(70% 0.13 ${known})`;
  let hash = 0;
  for (let i = 0; i < type.length; i++) hash = (hash * 31 + type.charCodeAt(i)) >>> 0;
  return `oklch(70% 0.12 ${hash % 360})`;
}

export interface BuildGraphInput {
  assets: Asset[];
  variants: Variant[];
  lineage: Lineage[];
  relations: SpaceRelation[];
  collections: SpaceCollection[];
  collectionItems: CollectionItem[];
  compositions: CompositionLike[];
  compositionItems: CompositionItem[];
  grouping: GroupingAxis;
}

export function buildRelationsGraph(input: BuildGraphInput): RelationsGraph {
  const {
    assets,
    variants,
    lineage,
    relations,
    collections,
    collectionItems,
    compositions,
    compositionItems,
    grouping,
  } = input;

  const variantToAsset = new Map(variants.map((v) => [v.id, v.asset_id]));
  const collectionById = new Map(collections.map((c) => [c.id, c]));

  // First collection an asset belongs to drives its grouping colour/cluster.
  const collectionByAsset = new Map<string, SpaceCollection>();
  for (const item of collectionItems) {
    const assetId =
      item.subject_type === 'asset'
        ? item.asset_id
        : item.variant_id
          ? variantToAsset.get(item.variant_id) ?? null
          : null;
    if (!assetId || collectionByAsset.has(assetId)) continue;
    const collection = collectionById.get(item.collection_id);
    if (collection) collectionByAsset.set(assetId, collection);
  }

  const groups = new Map<string, GroupModel>();
  const assetNodes: AssetNodeModel[] = assets.map((asset) => {
    const group = groupForAsset(asset, grouping, collectionByAsset);
    if (!groups.has(group.key)) {
      groups.set(group.key, { key: group.key, label: group.label, color: group.color, nodeIds: [] });
    }
    groups.get(group.key)!.nodeIds.push(asset.id);
    return {
      id: asset.id,
      asset,
      variant: getDisplayVariant(null, asset, variants),
      stats: computeStats(asset.id, variants),
      groupKey: group.key,
      groupLabel: group.label,
      groupColor: group.color,
      typeColor: colorForType(asset.type || 'untyped'),
    };
  });

  const assetIds = new Set(assets.map((a) => a.id));
  const edges: GraphEdgeModel[] = [];

  // 1) Lineage — reuse the canvas collapse (severed + intra-asset already dropped).
  for (const edge of buildLineageAssetEdges(lineage, variants)) {
    edges.push({
      id: `lin:${edge.id}`,
      source: edge.source,
      target: edge.target,
      family: 'lineage',
      variant: edge.relationType,
      label: edge.relationType,
    });
  }

  // 2) Authored semantic relations.
  const seenRel = new Set<string>();
  for (const rel of relations) {
    const source = resolveAsset(rel.subject_type, rel.subject_asset_id, rel.subject_variant_id, variantToAsset);
    const target = resolveAsset(rel.object_type, rel.object_asset_id, rel.object_variant_id, variantToAsset);
    if (!source || !target || source === target) continue;
    if (!assetIds.has(source) || !assetIds.has(target)) continue;
    const key = `${source}->${target}:${rel.relation_type}`;
    if (seenRel.has(key)) continue;
    seenRel.add(key);
    edges.push({
      id: `rel:${rel.id}`,
      source,
      target,
      family: 'relation',
      variant: rel.relation_type,
      label: rel.relation_type.replace(/_/g, ' '),
    });
  }

  // 3) Composition membership — composition becomes a hub node.
  const compositionNodes: CompositionNodeModel[] = [];
  const memberCounts = new Map<string, number>();
  for (const item of compositionItems) {
    memberCounts.set(item.composition_id, (memberCounts.get(item.composition_id) ?? 0) + 1);
  }
  for (const composition of compositions) {
    compositionNodes.push({
      id: `${COMP_PREFIX}${composition.id}`,
      composition,
      memberCount: memberCounts.get(composition.id) ?? 0,
    });
  }
  const seenComp = new Set<string>();
  for (const item of compositionItems) {
    const assetId = item.asset_id ?? (item.variant_id ? variantToAsset.get(item.variant_id) ?? null : null);
    if (!assetId || !assetIds.has(assetId)) continue;
    const compNodeId = `${COMP_PREFIX}${item.composition_id}`;
    const key = `${compNodeId}->${assetId}`;
    if (seenComp.has(key)) continue;
    seenComp.add(key);
    edges.push({
      id: `comp:${item.id}`,
      source: compNodeId,
      target: assetId,
      family: 'composition',
      variant: item.role,
      label: item.role,
    });
  }

  return {
    assetNodes,
    compositionNodes,
    edges,
    groups: [...groups.values()].filter((g) => g.nodeIds.length > 0),
  };
}

export function isCompositionNodeId(id: string): boolean {
  return id.startsWith(COMP_PREFIX);
}

// ---- Layout -----------------------------------------------------------------

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  /** group key for spatial cohesion; undefined nodes float freely */
  groupKey?: string;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface Positioned {
  id: string;
  x: number;
  y: number;
}

interface SimNode extends d3Force.SimulationNodeDatum {
  id: string;
  width: number;
  height: number;
  groupKey?: string;
}

// Deterministic pseudo-random seed point so layout is stable across renders
// (Math.random would re-shuffle the graph on every rebuild).
function seedPoint(id: string, span: number): { x: number; y: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = (h >>> 0) / 4294967295;
  const b = (Math.imul(h, 48271) >>> 0) / 4294967295;
  return { x: a * span, y: b * span };
}

/**
 * Force-directed layout with optional group cohesion. Each group is pinned to a
 * coarse-grid anchor and members are pulled toward it, so grouping spreads the
 * graph into labelled clusters without the brittleness of nested subflows.
 */
export function layoutForce(nodes: LayoutNode[], edges: LayoutEdge[]): Positioned[] {
  if (nodes.length === 0) return [];

  // Count members per group so clusters get a cell sized to their content —
  // a 20-node cluster needs far more room than a 2-node one, otherwise large
  // clusters bleed into their neighbours and the region boxes overlap.
  const counts = new Map<string, number>();
  for (const n of nodes) if (n.groupKey) counts.set(n.groupKey, (counts.get(n.groupKey) ?? 0) + 1);
  const groupKeys = [...counts.keys()];
  const cols = Math.max(1, Math.ceil(Math.sqrt(groupKeys.length)));
  // Grid pitch scales with the biggest cluster's packed footprint (each node
  // occupies ~250px once collision spacing is included), plus a gap so adjacent
  // clusters — and their region outlines — stay clear of each other.
  const maxCount = Math.max(1, ...counts.values());
  const cell = Math.max(1000, Math.sqrt(maxCount) * 300);
  const anchors = new Map<string, { x: number; y: number }>();
  groupKeys.forEach((key, i) => {
    anchors.set(key, { x: (i % cols) * cell, y: Math.floor(i / cols) * cell });
  });

  const simNodes: SimNode[] = nodes.map((n) => {
    const seed = seedPoint(n.id, 360);
    const anchor = n.groupKey ? anchors.get(n.groupKey) : undefined;
    return {
      id: n.id,
      width: n.width,
      height: n.height,
      groupKey: n.groupKey,
      x: (anchor?.x ?? 0) + seed.x,
      y: (anchor?.y ?? 0) + seed.y,
    };
  });

  const simLinks = edges.map((e) => ({ source: e.source, target: e.target }));
  const hasGroups = groupKeys.length > 1;

  const sim = d3Force
    .forceSimulation<SimNode>(simNodes)
    .force(
      'link',
      d3Force
        .forceLink<SimNode, (typeof simLinks)[number]>(simLinks)
        .id((d) => d.id)
        .distance(190)
        .strength(0.5),
    )
    .force('charge', d3Force.forceManyBody<SimNode>().strength(-480).distanceMax(650))
    .force('collision', d3Force.forceCollide<SimNode>().radius((d) => Math.max(d.width, d.height) / 2 + 26).strength(0.95))
    .stop();

  if (hasGroups) {
    // Strong group cohesion keeps clusters tight and well-separated so the
    // region overlays don't overlap into hatched noise (seen at ~10 groups).
    sim
      .force('gx', d3Force.forceX<SimNode>((d) => anchors.get(d.groupKey ?? '')?.x ?? 0).strength(0.5))
      .force('gy', d3Force.forceY<SimNode>((d) => anchors.get(d.groupKey ?? '')?.y ?? 0).strength(0.5));
  } else {
    sim.force('center', d3Force.forceCenter(0, 0));
  }

  for (let i = 0; i < 360; i++) sim.tick();

  return simNodes.map((n) => ({ id: n.id, x: (n.x ?? 0) - n.width / 2, y: (n.y ?? 0) - n.height / 2 }));
}

/**
 * Layered (dagre) layout — reads lineage/composition flow top-to-bottom.
 * Only nodes that participate in an edge go through dagre; unconnected nodes
 * (the majority in real spaces, where lineage is shallow) are packed into a
 * grid beneath the trees instead of being flattened into one enormous rank.
 */
export function layoutLayered(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  direction: 'TB' | 'LR' = 'TB',
): Positioned[] {
  if (nodes.length === 0) return [];
  const connected = new Set<string>();
  for (const e of edges) {
    connected.add(e.source);
    connected.add(e.target);
  }
  const treeNodes = nodes.filter((n) => connected.has(n.id));
  const orphans = nodes.filter((n) => !connected.has(n.id));

  const positioned: Positioned[] = [];
  let treeMaxX = 0;
  let treeMaxY = 0;

  if (treeNodes.length > 0) {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: direction, nodesep: 48, ranksep: 90, marginx: 20, marginy: 20 });
    const ids = new Set(treeNodes.map((n) => n.id));
    treeNodes.forEach((n) => g.setNode(n.id, { width: n.width, height: n.height }));
    edges.forEach((e) => {
      if (ids.has(e.source) && ids.has(e.target)) g.setEdge(e.source, e.target);
    });
    dagre.layout(g);
    for (const n of treeNodes) {
      const p = g.node(n.id);
      const x = (p?.x ?? 0) - n.width / 2;
      const y = (p?.y ?? 0) - n.height / 2;
      positioned.push({ id: n.id, x, y });
      treeMaxX = Math.max(treeMaxX, x + n.width);
      treeMaxY = Math.max(treeMaxY, y + n.height);
    }
  }

  if (orphans.length > 0) {
    const gap = 28;
    const cellW = orphans[0].width + gap;
    const cellH = orphans[0].height + gap;
    // Match the orphan grid's width to the lineage trees above it (fall back to
    // a comfortable default when there are no trees at all).
    const cols = Math.max(1, Math.round((treeMaxX || 1200) / cellW));
    const startY = treeNodes.length > 0 ? treeMaxY + 90 : 0;
    orphans.forEach((n, i) => {
      positioned.push({ id: n.id, x: (i % cols) * cellW, y: startY + Math.floor(i / cols) * cellH });
    });
  }

  return positioned;
}

/** Neighbours of a node across the given (already filtered) edges, 1 hop. */
export function neighbourSet(id: string, edges: GraphEdgeModel[]): Set<string> {
  const set = new Set<string>([id]);
  for (const e of edges) {
    if (e.source === id) set.add(e.target);
    else if (e.target === id) set.add(e.source);
  }
  return set;
}
