import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ViewportPortal,
  MarkerType,
  useNodesState,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { Thumbnail } from '../Thumbnail';
import type {
  Asset,
  CompositionItem,
  CollectionItem,
  Lineage,
  SpaceCollection,
  SpaceRelation,
  Variant,
} from '../../space/protocol';
import type { CompositionLike } from './relationsModel';
import { Button } from '../../ui';
import {
  buildRelationsGraph,
  isCompositionNodeId,
  layoutForce,
  layoutLayered,
  traceLineage,
  RELATION_FAMILY_VARS,
  RELATION_FAMILY_LABELS,
  RELATION_FAMILY_HINTS,
  type AssetNodeModel,
  type CompositionNodeModel,
  type GraphEdgeModel,
  type GroupingAxis,
  type GroupModel,
  type LayoutMode,
  type RelationFamily,
  type VariantStats,
} from './relationsModel';

import '@xyflow/react/dist/style.css';
import styles from './RelationsCanvas.module.css';

interface RelationsCanvasProps {
  spaceId: string;
  assets: Asset[];
  variants: Variant[];
  lineage: Lineage[];
  relations: SpaceRelation[];
  collections: SpaceCollection[];
  collectionItems: CollectionItem[];
  compositions: CompositionLike[];
  compositionItems: CompositionItem[];
  isInitialSyncPending?: boolean;
  onAssetClick: (asset: Asset) => void;
}

const ASSET_W = 196;
const ASSET_H = 176;
const COMP_W = 184;
const COMP_H = 76;

const ALL_FAMILIES: RelationFamily[] = ['lineage', 'relation', 'composition'];
const GROUPINGS: { id: GroupingAxis; label: string }[] = [
  { id: 'collection', label: 'Collection' },
  { id: 'type', label: 'Type' },
  { id: 'none', label: 'None' },
];

type FamilyColors = Record<RelationFamily, string>;

// ---- Node views -------------------------------------------------------------

interface AssetNodeData extends Record<string, unknown> {
  model: AssetNodeModel;
  spaceId: string;
  dimmed: boolean;
  focused: boolean;
  onOpen: (asset: Asset) => void;
}
type AssetFlowNode = Node<AssetNodeData, 'asset'>;

function Tally({ stats }: { stats: VariantStats }) {
  // Mono "ready·pending·failed" tally — a catalog readout, not three badges.
  return (
    <span className={styles.tally} title={`${stats.total} variants — ${stats.ready} ready, ${stats.pending} in progress, ${stats.failed} failed`}>
      <span className={styles.tReady}>{stats.ready}</span>
      <span className={styles.tSep}>·</span>
      <span className={styles.tPending}>{stats.pending}</span>
      <span className={styles.tSep}>·</span>
      <span className={styles.tFailed}>{stats.failed}</span>
    </span>
  );
}

function AssetNodeView({ data }: NodeProps<AssetFlowNode>) {
  const { model, spaceId, dimmed, focused, onOpen } = data;
  const { asset, stats } = model;
  const tags = useMemo(() => {
    try {
      const parsed = JSON.parse(asset.tags || '[]');
      return Array.isArray(parsed) ? (parsed as string[]).slice(0, 3) : [];
    } catch {
      return [];
    }
  }, [asset.tags]);

  return (
    <article
      className={`${styles.specimen} ${dimmed ? styles.dimmed : ''} ${focused ? styles.focused : ''}`}
      style={{ '--spine': model.groupColor, '--stamp': model.typeColor } as CSSProperties}
    >
      {/* Media plate — pixels render UNALTERED: nothing is layered over the
          thumbnail. Every label/badge lives in the ledger chrome below, per the
          repo media invariant. */}
      <div className={styles.plate}>
        <Thumbnail variant={model.variant} size="fill" spaceId={spaceId} className={styles.thumb} />
      </div>
      {/* Specimen ledger — engraved beneath the plate; carries all labels. */}
      <div className={styles.ledger}>
        <div className={styles.titleRow}>
          {(model.role === 'source' || model.role === 'final') && (
            <span className={`${styles.roleChip} ${model.role === 'final' ? styles.roleFinal : styles.roleSource}`}>
              {model.role === 'final' ? 'FINAL' : 'SOURCE'}
            </span>
          )}
          <Button className={styles.name} onClick={(e) => { e.stopPropagation(); onOpen(asset); }} title={`Open ${asset.name}`} variant="ghost" size="sm">
            {asset.name}
          </Button>
          {stats.starred > 0 && <span className={styles.star} title={`${stats.starred} starred`}>★{stats.starred > 1 ? stats.starred : ''}</span>}
        </div>
        <div className={styles.coords}>
          <span className={styles.stamp}>{asset.type}</span>
          <span className={styles.kind} title={asset.media_kind}>{mediaGlyph(asset.media_kind)}</span>
          <Tally stats={stats} />
        </div>
        {tags.length > 0 && (
          <div className={styles.tags}>
            {tags.map((t) => (
              <span key={t} className={styles.tag}>{t}</span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function mediaGlyph(kind: string): string {
  if (kind === 'audio') return '♪';
  if (kind === 'video') return '▶';
  return '◧';
}

interface CompNodeData extends Record<string, unknown> {
  model: CompositionNodeModel;
  dimmed: boolean;
  focused: boolean;
}
type CompFlowNode = Node<CompNodeData, 'composition'>;

function CompositionNodeView({ data }: NodeProps<CompFlowNode>) {
  const { model, dimmed, focused } = data;
  return (
    <div className={`${styles.assembler} ${dimmed ? styles.dimmed : ''} ${focused ? styles.focused : ''}`}>
      <span className={styles.assemblerGlyph} aria-hidden>▦</span>
      <div className={styles.assemblerBody}>
        <span className={styles.assemblerName}>{model.composition.name}</span>
        <span className={styles.assemblerMeta}>
          {model.memberCount} part{model.memberCount === 1 ? '' : 's'} · {model.composition.status}
        </span>
      </div>
    </div>
  );
}

const nodeTypes = { asset: AssetNodeView, composition: CompositionNodeView };

// ---- Zoom mirror (level-of-detail) -----------------------------------------

function ZoomMirror({ target }: { target: React.RefObject<HTMLDivElement | null> }) {
  const zoom = useStore((s) => s.transform[2]);
  useEffect(() => {
    if (target.current) target.current.style.setProperty('--rf-zoom', String(zoom));
  }, [zoom, target]);
  return null;
}

// ---- Canvas -----------------------------------------------------------------

function RelationsCanvasInner({
  spaceId,
  assets,
  variants,
  lineage,
  relations,
  collections,
  collectionItems,
  compositions,
  compositionItems,
  isInitialSyncPending,
  onAssetClick,
}: RelationsCanvasProps) {
  const { fitView } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [grouping, setGrouping] = useState<GroupingAxis>('collection');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('force');
  const [families, setFamilies] = useState<Set<RelationFamily>>(() => new Set(ALL_FAMILIES));
  // Clicking an asset traces its complete lineage (all ancestors + descendants)
  // and isolates it; null = no trace.
  const [traceId, setTraceId] = useState<string | null>(null);
  // Story lens: the default for this view — show the source→final trunk and
  // hide exploration noise; "Graph" drops to the raw, fully-laid-out graph.
  const [storyMode, setStoryMode] = useState(true);
  const [showAttempts, setShowAttempts] = useState(false);
  const draggedRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // A trace forces the layered flow so ancestors read top→down.
  const effectiveLayout: LayoutMode = traceId || storyMode ? 'layered' : layoutMode;

  // Resolve the three edge tokens (light-dark pairs) to concrete colours so they
  // can drive SVG strokes, arrow markers and the minimap. Re-read if the OS
  // theme flips under us.
  const [familyColors, setFamilyColors] = useState<FamilyColors>({ lineage: '#7c6cff', relation: '#e0a23a', composition: '#3fae7a' });
  useEffect(() => {
    const read = () => {
      const el = wrapperRef.current;
      if (!el) return;
      const cs = getComputedStyle(el);
      setFamilyColors({
        lineage: cs.getPropertyValue(RELATION_FAMILY_VARS.lineage).trim() || '#7c6cff',
        relation: cs.getPropertyValue(RELATION_FAMILY_VARS.relation).trim() || '#e0a23a',
        composition: cs.getPropertyValue(RELATION_FAMILY_VARS.composition).trim() || '#3fae7a',
      });
    };
    read();
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', read);
    return () => mq?.removeEventListener?.('change', read);
  }, []);

  const graph = useMemo(
    () =>
      buildRelationsGraph({
        assets,
        variants,
        lineage,
        relations,
        collections,
        collectionItems,
        compositions,
        compositionItems,
        grouping,
      }),
    [assets, variants, lineage, relations, collections, collectionItems, compositions, compositionItems, grouping],
  );

  // Full lineage through the traced asset (transitive ancestors + descendants).
  const lineageEdges = useMemo(
    () => graph.edges.filter((e) => e.family === 'lineage').map((e) => ({ source: e.source, target: e.target })),
    [graph.edges],
  );
  const traceSet = useMemo(() => (traceId ? traceLineage(traceId, lineageEdges) : null), [traceId, lineageEdges]);
  const tracedName = useMemo(
    () => (traceId ? graph.assetNodes.find((n) => n.id === traceId)?.asset.name ?? 'asset' : null),
    [traceId, graph.assetNodes],
  );

  // Which asset nodes are on stage. A trace isolates one asset's lineage; else
  // the story lens hides attempts/orphans (unless revealed); the raw graph shows
  // everything.
  const isOffTrunk = useCallback(
    (role: string) => role === 'attempt' || role === 'orphan',
    [],
  );
  const visibleAssetIds = useMemo(() => {
    if (traceSet) return new Set(traceSet);
    const set = new Set<string>();
    for (const n of graph.assetNodes) {
      if (!storyMode || showAttempts || !isOffTrunk(n.role)) set.add(n.id);
    }
    return set;
  }, [graph.assetNodes, storyMode, showAttempts, isOffTrunk, traceSet]);
  // Compositions are a raw-graph concept (and empty in practice) — keep them out
  // of the story pipeline and traces.
  const compositionsVisible = !storyMode && !traceId && families.has('composition');

  // Layout runs over the *visible* set so the layered pipeline ranks the real
  // finals at the bottom (their hidden attempt-children don't push them up).
  const positions = useMemo(() => {
    const layoutNodes = [
      ...graph.assetNodes
        .filter((n) => visibleAssetIds.has(n.id))
        .map((n) => ({ id: n.id, width: ASSET_W, height: ASSET_H, groupKey: n.groupKey })),
      ...(compositionsVisible ? graph.compositionNodes.map((n) => ({ id: n.id, width: COMP_W, height: COMP_H })) : []),
    ];
    // Lay out only edges whose BOTH endpoints are present as nodes — never trust
    // an edge to admit a node. A dangling edge (e.g. stale lineage mid live
    // sync) would otherwise crash d3-force / ReactFlow.
    const layoutNodeIds = new Set(layoutNodes.map((n) => n.id));
    const layoutEdges = graph.edges
      .filter((e) => layoutNodeIds.has(e.source) && layoutNodeIds.has(e.target))
      .map((e) => ({ source: e.source, target: e.target }));
    const result = effectiveLayout === 'layered' ? layoutLayered(layoutNodes, layoutEdges) : layoutForce(layoutNodes, layoutEdges);
    return new Map(result.map((p) => [p.id, p]));
  }, [graph, effectiveLayout, visibleAssetIds, compositionsVisible]);

  // Layout / grouping / story / trace changes are "re-arrange everything" actions.
  useEffect(() => {
    draggedRef.current.clear();
  }, [layoutMode, grouping, storyMode, showAttempts, traceId]);

  // The exact id set that gets rendered as nodes; edges must connect two of
  // these or neither d3-force nor ReactFlow has an anchor for them.
  const renderedNodeIds = useMemo(() => {
    const ids = new Set(visibleAssetIds);
    if (compositionsVisible) for (const c of graph.compositionNodes) ids.add(c.id);
    return ids;
  }, [visibleAssetIds, compositionsVisible, graph.compositionNodes]);

  const visibleEdges = useMemo(
    () =>
      graph.edges.filter(
        (e) => families.has(e.family) && renderedNodeIds.has(e.source) && renderedNodeIds.has(e.target),
      ),
    [graph.edges, families, renderedNodeIds],
  );

  const rfNodes = useMemo<Node[]>(() => {
    const assetNodes: Node[] = graph.assetNodes
      .filter((model) => visibleAssetIds.has(model.id))
      .map((model) => {
        const pos = draggedRef.current.get(model.id) ?? positions.get(model.id) ?? { x: 0, y: 0 };
        // Revealed attempts/orphans render dimmed so the trunk keeps the
        // spotlight; in a trace nothing is dimmed (the view is already isolated).
        const dimmed = !traceId && storyMode && showAttempts && isOffTrunk(model.role);
        return {
          id: model.id,
          type: 'asset',
          position: { x: pos.x, y: pos.y },
          data: { model, spaceId, dimmed, focused: traceId === model.id, onOpen: onAssetClick },
        } satisfies AssetFlowNode;
      });
    const compNodes: Node[] = compositionsVisible
      ? graph.compositionNodes.map((model) => {
          const pos = draggedRef.current.get(model.id) ?? positions.get(model.id) ?? { x: 0, y: 0 };
          return {
            id: model.id,
            type: 'composition',
            position: { x: pos.x, y: pos.y },
            data: { model, dimmed: false, focused: false },
          } satisfies CompFlowNode;
        })
      : [];
    return [...compNodes, ...assetNodes];
  }, [graph, positions, traceId, spaceId, onAssetClick, visibleAssetIds, compositionsVisible, storyMode, showAttempts, isOffTrunk]);

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  useEffect(() => setNodes(rfNodes), [rfNodes, setNodes]);

  const rfEdges = useMemo<Edge[]>(
    () =>
      visibleEdges.map((e: GraphEdgeModel) => {
        const color = familyColors[e.family];
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          // Lineage and composition both flow; relations are static annotations.
          animated: e.family !== 'relation',
          style: {
            stroke: color,
            strokeWidth: e.family === 'lineage' ? 2.2 : 1.5,
            strokeDasharray: e.family === 'relation' ? '2 5' : undefined,
            opacity: 0.85,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 13, height: 13 },
        } satisfies Edge;
      }),
    [visibleEdges, familyColors],
  );

  const onNodeDragStop = useCallback((_e: unknown, node: Node) => {
    draggedRef.current.set(node.id, { x: node.position.x, y: node.position.y });
  }, []);
  // Click an asset to trace its full lineage; click it again (or the pane) to
  // exit. Composition hubs aren't lineage, so they don't trace.
  const onNodeClick = useCallback((_e: unknown, node: Node) => {
    if (isCompositionNodeId(node.id)) return;
    setTraceId((cur) => (cur === node.id ? null : node.id));
  }, []);
  const toggleFamily = useCallback((family: RelationFamily) => {
    setFamilies((cur) => {
      const next = new Set(cur);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });
  }, []);

  // How many edges each family actually contributes — real spaces often have
  // none of some family, so the toggle should read as empty rather than active.
  const familyCounts = useMemo(() => {
    const counts: Record<RelationFamily, number> = { lineage: 0, relation: 0, composition: 0 };
    for (const e of graph.edges) counts[e.family] += 1;
    return counts;
  }, [graph.edges]);

  // Group "plates": a labelled boundary around each cluster's members. Only
  // meaningful when the force layout has actually separated ≥2 clusters — in
  // the layered layout dagre scatters group members across ranks, so a bounding
  // box would span the whole graph (just noise).
  const positionByNode = useMemo(() => new Map(nodes.map((n) => [n.id, n.position])), [nodes]);
  const regions = useMemo(() => {
    if (traceId || storyMode || grouping === 'none' || effectiveLayout !== 'force' || graph.groups.length < 2) return [];
    return graph.groups
      .map((group: GroupModel) => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const id of group.nodeIds) {
          const pos = positionByNode.get(id);
          if (!pos) continue;
          minX = Math.min(minX, pos.x);
          minY = Math.min(minY, pos.y);
          maxX = Math.max(maxX, pos.x + ASSET_W);
          maxY = Math.max(maxY, pos.y + ASSET_H);
        }
        if (!Number.isFinite(minX)) return null;
        const pad = 34;
        return {
          key: group.key,
          label: group.label,
          color: group.color,
          count: group.nodeIds.length,
          x: minX - pad,
          y: minY - pad,
          width: maxX - minX + pad * 2,
          height: maxY - minY + pad * 2,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [graph.groups, grouping, effectiveLayout, storyMode, traceId, positionByNode]);

  const didFit = useRef(false);
  useEffect(() => {
    if (didFit.current || nodes.length === 0) return;
    didFit.current = true;
    requestAnimationFrame(() => fitView({ padding: 0.14, maxZoom: 1 }));
  }, [nodes.length, fitView]);

  // Re-frame when switching lens/layout or revealing attempts — the visible set
  // (and its bounds) changes substantially.
  const didMountFit = useRef(false);
  useEffect(() => {
    if (!didMountFit.current) { didMountFit.current = true; return; }
    const t = requestAnimationFrame(() => fitView({ padding: 0.14, maxZoom: 1 }));
    return () => cancelAnimationFrame(t);
  }, [storyMode, showAttempts, effectiveLayout, traceId, fitView]);

  if (assets.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon}>{isInitialSyncPending ? '◴' : '⊹'}</span>
        <p>{isInitialSyncPending ? 'Charting relations…' : 'No assets to chart yet'}</p>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className={styles.canvas}>
      <ReactFlow
        nodes={nodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onPaneClick={() => setTraceId(null)}
        nodeTypes={nodeTypes}
        minZoom={0.1}
        maxZoom={1.75}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
        fitView
      >
        <ZoomMirror target={wrapperRef} />
        <ViewportPortal>
          <div className={styles.regionLayer}>
            {regions.map((r) => (
              <div
                key={r.key}
                className={styles.region}
                style={{ transform: `translate(${r.x}px, ${r.y}px)`, width: r.width, height: r.height, '--plate': r.color } as CSSProperties}
              >
                <span className={styles.regionLabel}>
                  {r.label}
                  <span className={styles.regionCount}>{r.count}</span>
                </span>
              </div>
            ))}
          </div>
        </ViewportPortal>
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--color-border)" />
        <Controls className={styles.controls} position="bottom-left" showInteractive={false} />
        <MiniMap
          className={styles.minimap}
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(node) => (node.type === 'composition' ? familyColors.composition : (node.data as AssetNodeData).model?.groupColor ?? 'var(--color-text-muted)')}
          maskColor="oklch(0% 0 0 / 0.55)"
        />
      </ReactFlow>

      <div className={styles.dock} role="toolbar" aria-label="Relations canvas controls">
        {traceId ? (
          <>
            <div className={styles.segment}>
              <span className={styles.segLabel}>Lineage of</span>
              <span className={styles.traceName}>{tracedName}</span>
              <span className={styles.threadCount}>{(traceSet?.size ?? 1)} asset{(traceSet?.size ?? 1) === 1 ? '' : 's'}</span>
            </div>
            <span className={styles.dockDivider} />
            <Button className={styles.dockButton} variant="secondary" size="sm" onClick={() => setTraceId(null)}>
              Clear trace
            </Button>
          </>
        ) : (
        <>
        <div className={styles.segment}>
          <Button
            className={`${styles.dockButton} ${storyMode ? styles.dockButtonActive : ''}`}
            variant={storyMode ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setStoryMode(true)}
            title="Source → final pipeline, noise hidden"
          >
            Story
          </Button>
          <Button
            className={`${styles.dockButton} ${!storyMode ? styles.dockButtonActive : ''}`}
            variant={!storyMode ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setStoryMode(false)}
            title="Raw graph: every asset and layout control"
          >
            Graph
          </Button>
        </div>
        <span className={styles.dockDivider} />

        {storyMode ? (
          <>
            <div className={styles.segment}>
              <span className={styles.legend}>
                <span className={`${styles.legendDot} ${styles.legendSource}`} />Sources
                <span className={styles.legendNum}>{graph.storyCounts.sources}</span>
              </span>
              <span className={styles.legend}>
                <span className={`${styles.legendDot} ${styles.legendFinal}`} />Finals
                <span className={styles.legendNum}>{graph.storyCounts.finals}</span>
              </span>
            </div>
            {(graph.storyCounts.attempts > 0 || graph.storyCounts.orphans > 0) && (
              <>
                <span className={styles.dockDivider} />
                <Button
                  className={`${styles.dockButton} ${showAttempts ? styles.dockButtonActive : ''}`}
                  variant={showAttempts ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setShowAttempts((v) => !v)}
                  title="Reveal dead-end attempts and unlinked assets"
                >
                  {showAttempts ? 'Hide' : 'Show'} attempts
                  <span className={styles.threadCount}>
                    +{graph.storyCounts.attempts}
                    {graph.storyCounts.orphans > 0 ? ` · ${graph.storyCounts.orphans} unlinked` : ''}
                  </span>
                </Button>
              </>
            )}
          </>
        ) : (
          <>
            <div className={styles.segment}>
              <span className={styles.segLabel}>Layout</span>
              <Button
                className={`${styles.dockButton} ${layoutMode === 'force' ? styles.dockButtonActive : ''}`}
                variant={layoutMode === 'force' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setLayoutMode('force')}
                title="Organic clusters"
              >
                Clusters
              </Button>
              <Button
                className={`${styles.dockButton} ${layoutMode === 'layered' ? styles.dockButtonActive : ''}`}
                variant={layoutMode === 'layered' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setLayoutMode('layered')}
                title="Top-down provenance flow"
              >
                Flow
              </Button>
            </div>
            <span className={styles.dockDivider} />
            <div className={styles.segment}>
              <span className={styles.segLabel}>Group</span>
              {GROUPINGS.map((g) => (
                <Button
                  key={g.id}
                  className={`${styles.dockButton} ${grouping === g.id ? styles.dockButtonActive : ''}`}
                  variant={grouping === g.id ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setGrouping(g.id)}
                >
                  {g.label}
                </Button>
              ))}
            </div>
            <span className={styles.dockDivider} />
            <div className={styles.segment}>
              <span className={styles.segLabel}>Threads</span>
              {ALL_FAMILIES.map((f) => {
                const count = familyCounts[f];
                const empty = count === 0;
                return (
                  <Button
                    key={f}
                    className={`${styles.dockButton} ${styles.threadButton} ${families.has(f) && !empty ? '' : styles.threadOff}`}
                    variant={families.has(f) && !empty ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => !empty && toggleFamily(f)}
                    disabled={empty}
                    aria-disabled={empty}
                    title={empty ? `${RELATION_FAMILY_LABELS[f]}: none in this space` : RELATION_FAMILY_HINTS[f]}
                  >
                    <span className={styles.threadSwatch} style={{ background: familyColors[f] }} />
                    {RELATION_FAMILY_LABELS[f]}
                    <span className={styles.threadCount}>{count}</span>
                  </Button>
                );
              })}
            </div>
          </>
        )}
        </>
        )}
      </div>
    </div>
  );
}

export function RelationsCanvas(props: RelationsCanvasProps) {
  return (
    <ReactFlowProvider>
      <RelationsCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export default RelationsCanvas;

export { isCompositionNodeId };
