import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type {
  Asset,
  Composition,
  CompositionItem,
  CollectionItem,
  Lineage,
  SpaceCollection,
  SpaceRelation,
  Variant,
} from '../../space/protocol';
import { buildRelationsGraph, classifyRoles, isCompositionNodeId, layoutForce, layoutLayered, neighbourSet, traceLineage } from './relationsModel';

function asset(id: string, type = 'character', tags = '[]'): Asset {
  return {
    id,
    name: id,
    type,
    media_kind: 'image',
    tags,
    parent_asset_id: null,
    active_variant_id: `${id}-v1`,
    created_by: 'u',
    created_at: 1,
    updated_at: 1,
  };
}

function variant(id: string, assetId: string, over: Partial<Variant> = {}): Variant {
  return {
    id,
    asset_id: assetId,
    media_kind: 'image',
    workflow_id: null,
    status: 'completed',
    error_message: null,
    image_key: null,
    thumb_key: null,
    media_key: null,
    media_mime_type: null,
    media_size_bytes: null,
    media_width: 100,
    media_height: 100,
    media_duration_ms: null,
    recipe: '{}',
    starred: false,
    created_by: 'u',
    created_at: 1,
    updated_at: 1,
    ...over,
  } as Variant;
}

function relation(id: string, subjAsset: string, objAsset: string, type: SpaceRelation['relation_type'] = 'appears_in'): SpaceRelation {
  return {
    id,
    subject_type: 'asset',
    subject_asset_id: subjAsset,
    subject_variant_id: null,
    object_type: 'asset',
    object_asset_id: objAsset,
    object_variant_id: null,
    relation_type: type,
    context: null,
    sort_index: 0,
    created_by: 'u',
    created_at: 1,
    updated_at: 1,
  };
}

const emptyExtras = {
  collections: [] as SpaceCollection[],
  collectionItems: [] as CollectionItem[],
  compositions: [] as Composition[],
  compositionItems: [] as CompositionItem[],
};

describe('buildRelationsGraph', () => {
  test('builds an asset node per asset with variant stats', () => {
    const assets = [asset('a'), asset('b')];
    const variants = [
      variant('a-v1', 'a'),
      variant('a-v2', 'a', { status: 'failed' }),
      variant('a-v3', 'a', { status: 'pending', starred: true }),
      variant('b-v1', 'b'),
    ];
    const graph = buildRelationsGraph({
      assets,
      variants,
      lineage: [],
      relations: [],
      grouping: 'none',
      ...emptyExtras,
    });
    assert.equal(graph.assetNodes.length, 2);
    const a = graph.assetNodes.find((n) => n.id === 'a')!;
    assert.deepEqual(a.stats, { total: 3, ready: 1, pending: 1, failed: 1, starred: 1 });
  });

  test('lineage collapses to asset-level edges and drops severed links', () => {
    const assets = [asset('a'), asset('b')];
    const variants = [variant('a-v1', 'a'), variant('b-v1', 'b')];
    const lineage: Lineage[] = [
      { id: 'l1', parent_variant_id: 'a-v1', child_variant_id: 'b-v1', relation_type: 'derived', severed: false, created_at: 1 },
      { id: 'l2', parent_variant_id: 'a-v1', child_variant_id: 'b-v1', relation_type: 'refined', severed: true, created_at: 1 },
    ];
    const graph = buildRelationsGraph({ assets, variants, lineage, relations: [], grouping: 'none', ...emptyExtras });
    const lineageEdges = graph.edges.filter((e) => e.family === 'lineage');
    assert.equal(lineageEdges.length, 1);
    assert.equal(lineageEdges[0].source, 'a');
    assert.equal(lineageEdges[0].target, 'b');
  });

  test('authored relations resolve variant subjects to their asset and skip self-loops', () => {
    const assets = [asset('a'), asset('b')];
    const variants = [variant('a-v1', 'a'), variant('b-v1', 'b')];
    const relations: SpaceRelation[] = [
      relation('r1', 'a', 'b', 'appears_in'),
      // variant subject resolving to asset 'a', object asset 'a' => self-loop, dropped
      { ...relation('r2', 'a', 'a'), subject_type: 'variant', subject_asset_id: null, subject_variant_id: 'a-v1' },
    ];
    const graph = buildRelationsGraph({ assets, variants, lineage: [], relations, grouping: 'none', ...emptyExtras });
    const relEdges = graph.edges.filter((e) => e.family === 'relation');
    assert.equal(relEdges.length, 1);
    assert.equal(relEdges[0].source, 'a');
    assert.equal(relEdges[0].target, 'b');
    assert.equal(relEdges[0].label, 'appears in');
  });

  test('compositions become hub nodes with membership edges', () => {
    const assets = [asset('a')];
    const variants = [variant('a-v1', 'a')];
    const compositions: Composition[] = [
      { id: 'c1', name: 'Hero shot', description: null, status: 'draft', output_asset_id: null, output_variant_id: null, metadata: '{}', sort_index: 0, created_by: 'u', created_at: 1, updated_at: 1 },
    ];
    const compositionItems: CompositionItem[] = [
      { id: 'ci1', composition_id: 'c1', role: 'character', asset_id: 'a', variant_id: 'a-v1', metadata: '{}', sort_index: 0, created_by: 'u', created_at: 1, updated_at: 1 },
    ];
    const graph = buildRelationsGraph({
      assets,
      variants,
      lineage: [],
      relations: [],
      grouping: 'none',
      collections: [],
      collectionItems: [],
      compositions,
      compositionItems,
    });
    assert.equal(graph.compositionNodes.length, 1);
    assert.equal(graph.compositionNodes[0].memberCount, 1);
    assert.ok(isCompositionNodeId(graph.compositionNodes[0].id));
    const compEdges = graph.edges.filter((e) => e.family === 'composition');
    assert.equal(compEdges.length, 1);
    assert.equal(compEdges[0].target, 'a');
    assert.ok(isCompositionNodeId(compEdges[0].source));
  });

  test('grouping by type clusters assets and produces one group per type', () => {
    const assets = [asset('a', 'character'), asset('b', 'character'), asset('c', 'scene')];
    const variants = assets.map((a) => variant(`${a.id}-v1`, a.id));
    const graph = buildRelationsGraph({ assets, variants, lineage: [], relations: [], grouping: 'type', ...emptyExtras });
    assert.equal(graph.groups.length, 2);
    const character = graph.groups.find((g) => g.label === 'character')!;
    assert.deepEqual(character.nodeIds.sort(), ['a', 'b']);
  });
});

describe('layout', () => {
  const nodes = [
    { id: 'a', width: 196, height: 168, groupKey: 'g1' },
    { id: 'b', width: 196, height: 168, groupKey: 'g1' },
    { id: 'c', width: 196, height: 168, groupKey: 'g2' },
  ];
  const edges = [{ source: 'a', target: 'b' }];

  test('force layout positions every node and is deterministic', () => {
    const first = layoutForce(nodes, edges);
    const second = layoutForce(nodes, edges);
    assert.equal(first.length, 3);
    assert.deepEqual(first, second);
    for (const p of first) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  });

  test('layered layout separates ranks vertically for connected nodes', () => {
    const positioned = layoutLayered(nodes, edges);
    const a = positioned.find((p) => p.id === 'a')!;
    const b = positioned.find((p) => p.id === 'b')!;
    assert.notEqual(a.y, b.y);
  });

  test('layered layout drops unconnected nodes into a grid below the trees', () => {
    // Real spaces are lineage-shallow: most nodes are orphans. They must not be
    // flattened into one giant rank beside the trees, but packed beneath them.
    const many = [
      { id: 'a', width: 196, height: 168 },
      { id: 'b', width: 196, height: 168 },
      ...Array.from({ length: 12 }, (_, i) => ({ id: `orphan-${i}`, width: 196, height: 168 })),
    ];
    const positioned = layoutLayered(many, [{ source: 'a', target: 'b' }]);
    const treeBottom = Math.max(
      positioned.find((p) => p.id === 'a')!.y,
      positioned.find((p) => p.id === 'b')!.y,
    );
    const orphanYs = positioned.filter((p) => p.id.startsWith('orphan-')).map((p) => p.y);
    // Every orphan sits below the lineage tree…
    assert.ok(orphanYs.every((y) => y > treeBottom));
    // …and they form multiple grid rows rather than a single wide strip.
    assert.ok(new Set(orphanYs).size >= 2);
  });

  test('force layout spatially separates distinct groups', () => {
    const grouped = [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `g1-${i}`, width: 196, height: 168, groupKey: 'g1' })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: `g2-${i}`, width: 196, height: 168, groupKey: 'g2' })),
    ];
    const positioned = layoutForce(grouped, []);
    const centroid = (prefix: string) => {
      const pts = positioned.filter((p) => p.id.startsWith(prefix));
      return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    };
    const c1 = centroid('g1-');
    const c2 = centroid('g2-');
    const dist = Math.hypot(c1.x - c2.x, c1.y - c2.y);
    // Cohesion should pull each group to its own anchor, well clear of the other.
    assert.ok(dist > 600, `expected separated centroids, got ${dist}`);
  });
});

describe('classifyRoles (story lens)', () => {
  test('classifies source, trunk, final, off-trunk attempt and orphan', () => {
    // s -> m -> f (the trunk), m -> x (a dead-end attempt), o is unlinked.
    const edges = [
      { source: 's', target: 'm' },
      { source: 'm', target: 'f' },
      { source: 'm', target: 'x' },
    ];
    const roles = classifyRoles(['s', 'm', 'f', 'x', 'o'], edges, new Set(['f']));
    assert.equal(roles.get('s'), 'source');
    assert.equal(roles.get('m'), 'trunk');
    assert.equal(roles.get('f'), 'final');
    assert.equal(roles.get('x'), 'attempt');
    assert.equal(roles.get('o'), 'orphan');
  });

  test('falls back to lineage leaves as finals when none are flagged', () => {
    const edges = [
      { source: 's', target: 'm' },
      { source: 'm', target: 'f1' },
      { source: 'm', target: 'f2' },
    ];
    const roles = classifyRoles(['s', 'm', 'f1', 'f2'], edges, new Set());
    assert.equal(roles.get('s'), 'source');
    assert.equal(roles.get('m'), 'trunk');
    assert.equal(roles.get('f1'), 'final');
    assert.equal(roles.get('f2'), 'final');
  });

  test('a root that reaches no final is an attempt, not a source', () => {
    // Real space shape: an abandoned branch whose root leads nowhere useful.
    const edges = [
      { source: 'good', target: 'fin' },
      { source: 'dead', target: 'deadchild' }, // separate branch, no flagged final
    ];
    const roles = classifyRoles(['good', 'fin', 'dead', 'deadchild'], edges, new Set(['fin']));
    assert.equal(roles.get('good'), 'source');
    assert.equal(roles.get('fin'), 'final');
    assert.equal(roles.get('dead'), 'attempt');
    assert.equal(roles.get('deadchild'), 'attempt');
  });
});

describe('buildRelationsGraph story counts', () => {
  test('flags approved variants and deliverables collections as finals', () => {
    const a = asset('a');
    const b = asset('b');
    const variants = [variant('a-v1', 'a'), variant('b-v1', 'b', { quality_rating: 'approved' })];
    const lineage: Lineage[] = [
      { id: 'l1', parent_variant_id: 'a-v1', child_variant_id: 'b-v1', relation_type: 'derived', severed: false, created_at: 1 },
    ];
    const graph = buildRelationsGraph({ assets: [a, b], variants, lineage, relations: [], grouping: 'none', ...emptyExtras });
    const byId = new Map(graph.assetNodes.map((n) => [n.id, n.role]));
    assert.equal(byId.get('a'), 'source');
    assert.equal(byId.get('b'), 'final');
    assert.equal(graph.storyCounts.sources, 1);
    assert.equal(graph.storyCounts.finals, 1);
  });
});

describe('traceLineage (full lineage through an asset)', () => {
  // a -> b -> c (main chain); b -> x (a fork off b); d -> e is unrelated.
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'b', target: 'x' },
    { source: 'd', target: 'e' },
  ];

  test('from a middle node, includes all ancestors and all descendants', () => {
    const set = traceLineage('b', edges);
    assert.deepEqual([...set].sort(), ['a', 'b', 'c', 'x']);
  });

  test('excludes unrelated branches', () => {
    const set = traceLineage('b', edges);
    assert.ok(!set.has('d') && !set.has('e'));
  });

  test('a leaf traces back to its full ancestry', () => {
    assert.deepEqual([...traceLineage('c', edges)].sort(), ['a', 'b', 'c']);
  });

  test('an isolated asset traces to just itself', () => {
    assert.deepEqual([...traceLineage('lonely', edges)], ['lonely']);
  });
});

describe('neighbourSet', () => {
  test('returns the node and its direct neighbours across edges', () => {
    const edges = [
      { id: 'e1', source: 'a', target: 'b', family: 'lineage' as const },
      { id: 'e2', source: 'c', target: 'a', family: 'relation' as const },
      { id: 'e3', source: 'd', target: 'e', family: 'lineage' as const },
    ];
    const set = neighbourSet('a', edges);
    assert.deepEqual([...set].sort(), ['a', 'b', 'c']);
  });
});
