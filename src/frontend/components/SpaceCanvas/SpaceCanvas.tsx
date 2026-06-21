import { useCallback, useMemo, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ViewportPortal,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useStore,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { Thumbnail } from '../Thumbnail';
import type {
  Asset,
  CollectionItem,
  Lineage,
  SpaceCollection,
  Variant,
} from '../../space/protocol';
import { buildLineageAssetEdges } from './canvasEdges';
import {
  aspectRatioForVariant,
  COLLECTION_KIND_COLORS,
  COLLECTION_KIND_LABELS,
  getCollectionItems,
  getDisplayVariant,
  getItemAsset,
  getUnfiledAssets,
  sortCollections,
} from '../SpaceBoard/spaceBoardModel';
import boardStyles from '../SpaceBoard/SpaceBoard.module.css';

import '@xyflow/react/dist/style.css';
import styles from './SpaceCanvas.module.css';

interface SpaceCanvasProps {
  spaceId: string;
  assets: Asset[];
  variants: Variant[];
  collections: SpaceCollection[];
  collectionItems: CollectionItem[];
  lineage: Lineage[];
  isInitialSyncPending?: boolean;
  onAssetClick: (asset: Asset) => void;
}

// A frame's content is the justified wall — the same cards as the scrolling
// board, minus the management menus (those live in the board view).
interface FrameCard {
  key: string;
  asset: Asset;
  variant: Variant | null;
  aspect: number;
}

interface FrameData extends Record<string, unknown> {
  title: string;
  kindLabel: string | null;
  color: string;
  count: number;
  cards: FrameCard[];
  spaceId: string;
  onAssetClick: (asset: Asset) => void;
}

type FrameNode = Node<FrameData, 'frame'>;

const FRAME_WIDTH = 460;
const FRAME_GAP = 36;
const COLUMNS = 3;
// Rough per-frame height estimate to balance the initial masonry columns;
// React Flow re-measures the real DOM afterwards for the minimap.
const HEADER_H = 64;
const ROW_H = 150;
const CARDS_PER_ROW = 3.2;

function estimateFrameHeight(count: number): number {
  const rows = Math.max(1, Math.ceil(count / CARDS_PER_ROW));
  return HEADER_H + rows * (ROW_H + 9) + 16;
}

const NO_DRAGGED: ReadonlySet<string> = new Set();

// Masonry: drop each frame into the currently shortest column. Uses the real
// measured height when available (after React Flow measures the DOM), falling
// back to the estimate for the very first paint. Frames the user has dragged
// keep their position and are left out of the column flow — only the
// auto-arranged frames are packed, so live data changes can never push an
// auto-frame on top of another. Nodes whose position is unchanged are returned
// by identity so callers can cheaply detect a no-op.
function packMasonry(nodes: FrameNode[], draggedIds: ReadonlySet<string> = NO_DRAGGED): FrameNode[] {
  const columnHeights = new Array(COLUMNS).fill(0);
  return nodes.map((node) => {
    if (draggedIds.has(node.id)) return node;
    let col = 0;
    for (let i = 1; i < COLUMNS; i++) {
      if (columnHeights[i] < columnHeights[col]) col = i;
    }
    const height = node.measured?.height ?? estimateFrameHeight((node.data as FrameData).count);
    const position = { x: col * (FRAME_WIDTH + FRAME_GAP), y: columnHeights[col] };
    columnHeights[col] += height + FRAME_GAP;
    if (node.position.x === position.x && node.position.y === position.y) return node;
    return { ...node, position };
  });
}

// Invisible flex children that keep a sparse last row at its natural height.
const ROW_FILLERS = Array.from({ length: 8 });

function FrameNodeView({ data }: NodeProps<FrameNode>) {
  return (
    <div className={styles.frame} style={{ '--collection-color': data.color } as CSSProperties}>
      <header className={styles.frameHeader}>
        {data.kindLabel && (
          <span className={styles.frameEyebrow}>
            <span className={styles.colorDot} />
            <span>{data.kindLabel}</span>
          </span>
        )}
        <h2 className={styles.frameTitle}>{data.title}</h2>
        <span className={styles.frameCount}>{data.count}</span>
      </header>
      {data.cards.length > 0 ? (
        <div className={`${styles.frameBody} nodrag`}>
          <div className={boardStyles.cardGrid}>
            {data.cards.map((card) => (
              <article
                key={card.key}
                className={boardStyles.assetCard}
                data-asset-id={card.asset.id}
                style={{ '--card-aspect': card.aspect } as CSSProperties}
              >
                <button
                  className={boardStyles.thumbnailButton}
                  onClick={() => data.onAssetClick(card.asset)}
                  title={card.asset.name}
                >
                  <Thumbnail
                    variant={card.variant}
                    size="fill"
                    spaceId={data.spaceId}
                    className={boardStyles.thumbnail}
                  />
                </button>
                <div className={boardStyles.caption}>
                  <button className={boardStyles.assetName} onClick={() => data.onAssetClick(card.asset)}>
                    {card.asset.name}
                  </button>
                  <div className={boardStyles.assetMeta}>
                    <span>{card.asset.type}</span>
                  </div>
                </div>
              </article>
            ))}
            {ROW_FILLERS.map((_, index) => (
              <span key={`filler-${index}`} className={boardStyles.cardFiller} aria-hidden="true" />
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.frameEmpty}>No items</div>
      )}
    </div>
  );
}

const nodeTypes = { frame: FrameNodeView };

// Step 1 has no edges yet; a stable empty array keeps React Flow controlled.
const EMPTY_EDGES: never[] = [];

function buildCards(
  items: CollectionItem[],
  assets: Asset[],
  variants: Variant[],
): FrameCard[] {
  return items
    .map((item) => {
      const asset = getItemAsset(item, assets, variants);
      if (!asset) return null;
      const variant = getDisplayVariant(item, asset, variants);
      return {
        key: item.id,
        asset,
        variant,
        aspect: aspectRatioForVariant(variant),
      } satisfies FrameCard;
    })
    .filter((card): card is FrameCard => card !== null);
}

function SpaceCanvasInner({
  spaceId,
  assets,
  variants,
  collections,
  collectionItems,
  lineage,
  isInitialSyncPending,
  onAssetClick,
}: SpaceCanvasProps) {
  const { fitView, screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);

  // Lineage drawn between asset cards across frames — the "inventory graph".
  const edges = useMemo(() => buildLineageAssetEdges(lineage, variants), [lineage, variants]);

  // Mirror zoom into a CSS var so card captions/labels can counter-scale later.
  const zoom = useStore((state) => state.transform[2]);
  useEffect(() => {
    const container = document.querySelector(`.${styles.canvas}`);
    if (container) {
      (container as HTMLElement).style.setProperty('--rf-zoom', String(zoom));
    }
  }, [zoom]);

  const initialNodes = useMemo<FrameNode[]>(() => {
    const ordered = sortCollections(collections);
    const unfiled = getUnfiledAssets(assets, collectionItems, variants);

    type FrameSeed = {
      id: string;
      title: string;
      kindLabel: string | null;
      color: string;
      cards: FrameCard[];
      count: number;
    };

    const frames: FrameSeed[] = ordered.map((collection) => {
      const items = getCollectionItems(collection.id, collectionItems);
      const color = collection.color ?? COLLECTION_KIND_COLORS[collection.kind];
      return {
        id: collection.id,
        title: collection.name,
        kindLabel: COLLECTION_KIND_LABELS[collection.kind],
        color,
        cards: buildCards(items, assets, variants),
        count: items.length,
      };
    });

    if (unfiled.length > 0) {
      frames.push({
        id: '__unfiled__',
        title: 'Unfiled',
        kindLabel: null,
        color: COLLECTION_KIND_COLORS.custom,
        cards: unfiled.map((asset) => {
          const variant = getDisplayVariant(null, asset, variants);
          return { key: asset.id, asset, variant, aspect: aspectRatioForVariant(variant) };
        }),
        count: unfiled.length,
      });
    }

    const seeded = frames.map((frame) => ({
      id: frame.id,
      type: 'frame' as const,
      position: { x: 0, y: 0 },
      dragHandle: `.${styles.frameHeader}`,
      data: {
        title: frame.title,
        kindLabel: frame.kindLabel,
        color: frame.color,
        count: frame.count,
        cards: frame.cards,
        spaceId,
        onAssetClick,
      },
    }));
    return packMasonry(seeded);
  }, [assets, variants, collections, collectionItems, spaceId, onAssetClick]);

  const [nodes, setNodes, onNodesChange] = useNodesState<FrameNode>(initialNodes);
  const draggedIdsRef = useRef<Set<string>>(new Set());

  // Sync live data into the existing nodes, keeping each frame's current
  // position and measured size. New frames arrive with their seeded slot.
  useEffect(() => {
    setNodes((current) => {
      const byId = new Map(current.map((node) => [node.id, node]));
      return initialNodes.map((incoming) => {
        const existing = byId.get(incoming.id);
        return existing ? { ...existing, data: incoming.data } : incoming;
      });
    });
  }, [initialNodes, setNodes]);

  // Re-pack the masonry whenever the set of frames or any measured height
  // changes — so growing a frame (e.g. live-synced new cards) re-flows the
  // auto-arranged frames instead of letting them overlap. Frames the user has
  // dragged are skipped (see packMasonry). The key omits positions, so the
  // re-pack's own position writes don't retrigger it.
  const layoutKey = useMemo(
    () => nodes.map((node) => `${node.id}:${Math.round(node.measured?.height ?? 0)}`).join('|'),
    [nodes],
  );
  useEffect(() => {
    if (!layoutKey) return;
    setNodes((current) => {
      const packed = packMasonry(current, draggedIdsRef.current);
      return packed.some((node, index) => node !== current[index]) ? packed : current;
    });
  }, [layoutKey, setNodes]);

  // Fit the view once the frames have first been measured.
  const nodesInitialized = useNodesInitialized();
  const didFitRef = useRef(false);
  useEffect(() => {
    if (!nodesInitialized || didFitRef.current || nodes.length === 0) return;
    didFitRef.current = true;
    requestAnimationFrame(() => {
      fitView({ padding: 0.15, maxZoom: 1 });
      requestAnimationFrame(() => setIsReady(true));
    });
  }, [nodesInitialized, nodes.length, fitView]);

  // Card centres in flow coordinates, for drawing lineage edges between them.
  // Recomputed only when the layout changes — flow coordinates are independent
  // of pan/zoom, so the edge layer just rides the viewport transform.
  const [centers, setCenters] = useState<Map<string, { x: number; y: number }>>(new Map());
  const measureCenters = useCallback(() => {
    const root = wrapperRef.current;
    if (!root) return;
    const next = new Map<string, { x: number; y: number }>();
    root.querySelectorAll<HTMLElement>('[data-asset-id]').forEach((el) => {
      const id = el.dataset.assetId;
      if (!id) return;
      const rect = el.getBoundingClientRect();
      next.set(id, screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }));
    });
    setCenters(next);
  }, [screenToFlowPosition]);

  useEffect(() => {
    if (!nodesInitialized) return;
    const frame = requestAnimationFrame(measureCenters);
    return () => cancelAnimationFrame(frame);
  }, [nodesInitialized, layoutKey, edges, measureCenters]);

  if (assets.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon}>{isInitialSyncPending ? '⏳' : '🎨'}</span>
        <p>{isInitialSyncPending ? 'Loading assets…' : 'No assets yet'}</p>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className={`${styles.canvas} ${isReady ? styles.ready : styles.loading}`}>
      <ReactFlow
        nodes={nodes}
        edges={EMPTY_EDGES}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_event, node) => draggedIdsRef.current.add(node.id)}
        nodeTypes={nodeTypes}
        minZoom={0.15}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
      >
        {/* Lineage edges live inside the viewport so they pan/zoom with the
            frames; flow coordinates put them behind the frame nodes. */}
        <ViewportPortal>
          <svg className={styles.edgeLayer} style={{ overflow: 'visible' }} width="1" height="1" data-testid="lineage-edges">
            {edges.map((edge) => {
              const a = centers.get(edge.source);
              const b = centers.get(edge.target);
              if (!a || !b) return null;
              const midX = (a.x + b.x) / 2;
              return (
                <path
                  key={edge.id}
                  className={`${styles.edge} ${styles[edge.relationType]}`}
                  d={`M ${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}`}
                />
              );
            })}
          </svg>
        </ViewportPortal>
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--color-border)" />
        <Controls className={styles.controls} position="bottom-left" showInteractive={false} />
        <MiniMap
          className={styles.minimap}
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(node) => (node.data as FrameData).color}
          maskColor="rgba(0, 0, 0, 0.5)"
        />
      </ReactFlow>
    </div>
  );
}

export function SpaceCanvas(props: SpaceCanvasProps) {
  return (
    <ReactFlowProvider>
      <SpaceCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export default SpaceCanvas;
