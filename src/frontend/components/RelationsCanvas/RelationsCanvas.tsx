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
import {
  buildRelationsGraph,
  isCompositionNodeId,
  layoutForce,
  layoutLayered,
  neighbourSet,
  RELATION_FAMILY_COLORS,
  RELATION_FAMILY_LABELS,
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
const ASSET_H = 168;
const COMP_W = 184;
const COMP_H = 78;

const ALL_FAMILIES: RelationFamily[] = ['lineage', 'relation', 'composition'];
const GROUPINGS: { id: GroupingAxis; label: string }[] = [
  { id: 'collection', label: 'Collection' },
  { id: 'type', label: 'Type' },
  { id: 'none', label: 'None' },
];

// ---- Node views -------------------------------------------------------------

interface AssetNodeData extends Record<string, unknown> {
  model: AssetNodeModel;
  spaceId: string;
  dimmed: boolean;
  focused: boolean;
  onOpen: (asset: Asset) => void;
}
type AssetFlowNode = Node<AssetNodeData, 'asset'>;

function StatDots({ stats }: { stats: VariantStats }) {
  return (
    <span className={styles.dots} title={`${stats.total} variants`}>
      {stats.ready > 0 && <span className={`${styles.dot} ${styles.ready}`}>{stats.ready}</span>}
      {stats.pending > 0 && <span className={`${styles.dot} ${styles.pending}`}>{stats.pending}</span>}
      {stats.failed > 0 && <span className={`${styles.dot} ${styles.failed}`}>{stats.failed}</span>}
      {stats.starred > 0 && <span className={`${styles.dot} ${styles.star}`}>★{stats.starred}</span>}
    </span>
  );
}

function AssetNodeView({ data }: NodeProps<AssetFlowNode>) {
  const { model, spaceId, dimmed, focused, onOpen } = data;
  const { asset } = model;
  const tags = (() => {
    try {
      const parsed = JSON.parse(asset.tags || '[]');
      return Array.isArray(parsed) ? (parsed as string[]).slice(0, 3) : [];
    } catch {
      return [];
    }
  })();
  return (
    <div
      className={`${styles.assetNode} ${dimmed ? styles.dimmed : ''} ${focused ? styles.focused : ''}`}
      style={{ '--accent': model.groupColor } as CSSProperties}
    >
      {/* Media stays unaltered (invariant): emphasis lives on the surrounding card. */}
      <div className={styles.thumbWrap}>
        <Thumbnail variant={model.variant} size="fill" spaceId={spaceId} className={styles.thumb} />
        <span className={styles.kindBadge}>{asset.media_kind}</span>
      </div>
      <div className={styles.rail}>
        <div className={styles.titleRow}>
          <button className={styles.openBtn} onClick={(e) => { e.stopPropagation(); onOpen(asset); }} title={`Open ${asset.name}`}>
            {asset.name}
          </button>
          <StatDots stats={model.stats} />
        </div>
        <div className={styles.metaRow}>
          <span className={styles.typeTag} style={{ '--accent': model.groupColor } as CSSProperties}>{asset.type}</span>
          {tags.map((t) => (
            <span key={t} className={styles.tagPill}>{t}</span>
          ))}
        </div>
      </div>
    </div>
  );
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
    <div className={`${styles.compNode} ${dimmed ? styles.dimmed : ''} ${focused ? styles.focused : ''}`}>
      <span className={styles.compIcon} aria-hidden>▦</span>
      <div className={styles.compBody}>
        <span className={styles.compName}>{model.composition.name}</span>
        <span className={styles.compMeta}>
          {model.memberCount} item{model.memberCount === 1 ? '' : 's'} · {model.composition.status}
        </span>
      </div>
    </div>
  );
}

const nodeTypes = { asset: AssetNodeView, composition: CompositionNodeView };

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
  const [grouping, setGrouping] = useState<GroupingAxis>('collection');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('force');
  const [families, setFamilies] = useState<Set<RelationFamily>>(() => new Set(ALL_FAMILIES));
  const [focusId, setFocusId] = useState<string | null>(null);
  const draggedRef = useRef<Map<string, { x: number; y: number }>>(new Map());

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

  // Layout uses the full structure so toggling family filters never reflows.
  // Composition hubs only join the layout when their family is structurally
  // present (they have no meaning without their membership edges).
  const positions = useMemo(() => {
    const layoutNodes = [
      ...graph.assetNodes.map((n) => ({ id: n.id, width: ASSET_W, height: ASSET_H, groupKey: n.groupKey })),
      ...graph.compositionNodes.map((n) => ({ id: n.id, width: COMP_W, height: COMP_H })),
    ];
    const layoutEdges = graph.edges.map((e) => ({ source: e.source, target: e.target }));
    const result = layoutMode === 'layered' ? layoutLayered(layoutNodes, layoutEdges) : layoutForce(layoutNodes, layoutEdges);
    return new Map(result.map((p) => [p.id, p]));
  }, [graph, layoutMode]);

  // Reset manual drags when the layout strategy or grouping changes — those are
  // explicit "re-arrange everything" actions.
  useEffect(() => {
    draggedRef.current.clear();
  }, [layoutMode, grouping]);

  const visibleEdges = useMemo(
    () => graph.edges.filter((e) => families.has(e.family)),
    [graph.edges, families],
  );

  const neighbours = useMemo(
    () => (focusId ? neighbourSet(focusId, visibleEdges) : null),
    [focusId, visibleEdges],
  );

  const rfNodes = useMemo<Node[]>(() => {
    const assetNodes: Node[] = graph.assetNodes.map((model) => {
      const pos = draggedRef.current.get(model.id) ?? positions.get(model.id) ?? { x: 0, y: 0 };
      const dimmed = !!neighbours && !neighbours.has(model.id);
      return {
        id: model.id,
        type: 'asset',
        position: { x: pos.x, y: pos.y },
        data: { model, spaceId, dimmed, focused: focusId === model.id, onOpen: onAssetClick },
      } satisfies AssetFlowNode;
    });
    const compNodes: Node[] = graph.compositionNodes.map((model) => {
      const pos = draggedRef.current.get(model.id) ?? positions.get(model.id) ?? { x: 0, y: 0 };
      const dimmed = !!neighbours && !neighbours.has(model.id);
      return {
        id: model.id,
        type: 'composition',
        position: { x: pos.x, y: pos.y },
        hidden: !families.has('composition'),
        data: { model, dimmed, focused: focusId === model.id },
      } satisfies CompFlowNode;
    });
    return [...compNodes, ...assetNodes];
  }, [graph, positions, neighbours, focusId, families, spaceId, onAssetClick]);

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  useEffect(() => setNodes(rfNodes), [rfNodes, setNodes]);

  const rfEdges = useMemo<Edge[]>(
    () =>
      visibleEdges.map((e: GraphEdgeModel) => {
        const color = RELATION_FAMILY_COLORS[e.family];
        const dim = !!neighbours && !(neighbours.has(e.source) && neighbours.has(e.target));
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: focusId ? e.label : undefined,
          animated: e.family === 'composition',
          style: {
            stroke: color,
            strokeWidth: e.family === 'relation' ? 1.5 : 2,
            strokeDasharray: e.family === 'relation' ? '5 4' : undefined,
            opacity: dim ? 0.12 : 0.85,
          },
          labelStyle: { fontSize: 10, fill: color },
          labelBgStyle: { fill: 'var(--color-surface, #1b1d23)', fillOpacity: 0.85 },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        } satisfies Edge;
      }),
    [visibleEdges, neighbours, focusId],
  );

  const onNodeDragStop = useCallback((_e: unknown, node: Node) => {
    draggedRef.current.set(node.id, { x: node.position.x, y: node.position.y });
  }, []);

  const onNodeClick = useCallback((_e: unknown, node: Node) => {
    setFocusId((cur) => (cur === node.id ? null : node.id));
  }, []);

  const toggleFamily = useCallback((family: RelationFamily) => {
    setFamilies((cur) => {
      const next = new Set(cur);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });
  }, []);

  // Region overlays: a labelled box around each group's members. Reads live
  // node positions so the box follows assets as they are dragged.
  const positionByNode = useMemo(() => new Map(nodes.map((n) => [n.id, n.position])), [nodes]);
  const regions = useMemo(() => {
    if (grouping === 'none') return [];
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
        const pad = 26;
        return {
          key: group.key,
          label: group.label,
          color: group.color,
          count: group.nodeIds.length,
          x: minX - pad,
          y: minY - pad - 22,
          width: maxX - minX + pad * 2,
          height: maxY - minY + pad * 2 + 22,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [graph.groups, grouping, positionByNode]);

  const didFit = useRef(false);
  useEffect(() => {
    if (didFit.current || nodes.length === 0) return;
    didFit.current = true;
    requestAnimationFrame(() => fitView({ padding: 0.12, maxZoom: 1 }));
  }, [nodes.length, fitView]);

  if (assets.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon}>{isInitialSyncPending ? '⏳' : '🕸️'}</span>
        <p>{isInitialSyncPending ? 'Loading relations…' : 'No assets yet'}</p>
      </div>
    );
  }

  return (
    <div className={styles.canvas}>
      <ReactFlow
        nodes={nodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onPaneClick={() => setFocusId(null)}
        nodeTypes={nodeTypes}
        minZoom={0.1}
        maxZoom={1.75}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
        fitView
      >
        <ViewportPortal>
          <div className={styles.regionLayer}>
            {regions.map((r) => (
              <div
                key={r.key}
                className={styles.region}
                style={{
                  transform: `translate(${r.x}px, ${r.y}px)`,
                  width: r.width,
                  height: r.height,
                  '--accent': r.color,
                } as CSSProperties}
              >
                <span className={styles.regionLabel}>
                  {r.label} <span className={styles.regionCount}>{r.count}</span>
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
          nodeColor={(node) =>
            node.type === 'composition'
              ? RELATION_FAMILY_COLORS.composition
              : (node.data as AssetNodeData).model?.groupColor ?? '#6f7480'
          }
          maskColor="rgba(0,0,0,0.5)"
        />
      </ReactFlow>

      <div className={styles.toolbar}>
        <div className={styles.group}>
          <span className={styles.groupLabel}>Layout</span>
          <button className={layoutMode === 'force' ? styles.on : styles.off} onClick={() => setLayoutMode('force')}>Clusters</button>
          <button className={layoutMode === 'layered' ? styles.on : styles.off} onClick={() => setLayoutMode('layered')}>Flow</button>
        </div>
        <div className={styles.group}>
          <span className={styles.groupLabel}>Group by</span>
          {GROUPINGS.map((g) => (
            <button key={g.id} className={grouping === g.id ? styles.on : styles.off} onClick={() => setGrouping(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
        <div className={styles.group}>
          <span className={styles.groupLabel}>Edges</span>
          {ALL_FAMILIES.map((f) => (
            <button
              key={f}
              className={families.has(f) ? styles.on : styles.off}
              style={{ '--accent': RELATION_FAMILY_COLORS[f] } as CSSProperties}
              onClick={() => toggleFamily(f)}
            >
              <span className={styles.swatch} style={{ background: RELATION_FAMILY_COLORS[f] }} />
              {RELATION_FAMILY_LABELS[f]}
            </button>
          ))}
        </div>
        {focusId && (
          <button className={styles.clearFocus} onClick={() => setFocusId(null)}>Clear focus ✕</button>
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
