import { useCallback, useMemo, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ViewportPortal,
  getNodesBounds,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useStore,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { Thumbnail } from '../Thumbnail';
import { Button, IconButton } from '../../ui';
import {
  isVariantForgeTrayReady,
  type Asset,
  type CollectionItem,
  type Lineage,
  type SpaceCollection,
  type Variant,
} from '../../space/protocol';
import { buildLineageAssetEdges } from './canvasEdges';
import { FRAME_WIDTH, FRAME_GAP, columnCountForLayout, estimateFrameHeight } from './canvasLayout';
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
  onAddToTray?: (variant: Variant, asset: Asset) => void;
  isVariantInForgeTray?: (variantId: string) => boolean;
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
  onAddToTray?: (variant: Variant, asset: Asset) => void;
  isVariantInForgeTray?: (variantId: string) => boolean;
}

type FrameNode = Node<FrameData, 'frame'>;

const NO_DRAGGED: ReadonlySet<string> = new Set();

// Masonry: drop each frame into the currently shortest column. Uses the real
// measured height when available (after React Flow measures the DOM), falling
// back to the estimate for the very first paint. Frames the user has dragged
// keep their position and are left out of the column flow — only the
// auto-arranged frames are packed, so live data changes can never push an
// auto-frame on top of another. Nodes whose position is unchanged are returned
// by identity so callers can cheaply detect a no-op.
function packMasonry(nodes: FrameNode[], columns: number, draggedIds: ReadonlySet<string> = NO_DRAGGED): FrameNode[] {
  const columnHeights = new Array(Math.max(1, columns)).fill(0);
  return nodes.map((node) => {
    if (draggedIds.has(node.id)) return node;
    let col = 0;
    for (let i = 1; i < columnHeights.length; i++) {
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

function FrameAssetCard({ card, data }: { card: FrameCard; data: FrameData }) {
  const isInForgeTray = Boolean(card.variant && data.isVariantInForgeTray?.(card.variant.id));
  const trayLabel = isInForgeTray
    ? `${card.asset.name} is in Forge Tray`
    : `Add ${card.asset.name} to Forge Tray`;

  return (
    <article
      className={boardStyles.assetCard}
      data-asset-id={card.asset.id}
      style={{ '--card-aspect': card.aspect } as CSSProperties}
    >
      <Button
        className={boardStyles.thumbnailButton}
        onClick={() => data.onAssetClick(card.asset)}
        title={card.asset.name}
        variant="ghost"
        size="sm"
      >
        <Thumbnail
          variant={card.variant}
          size="fill"
          spaceId={data.spaceId}
          className={boardStyles.thumbnail}
        />
      </Button>
      <div className={boardStyles.caption}>
        <div className={boardStyles.cardCaptionHeader}>
          <Button className={boardStyles.assetName} onClick={() => data.onAssetClick(card.asset)} variant="ghost" size="sm">
            {card.asset.name}
          </Button>
          {data.onAddToTray && card.variant && isVariantForgeTrayReady(card.variant) && (
            <IconButton
              className={`${styles.trayButton} ${isInForgeTray ? styles.trayButtonAdded : ''}`}
              disabled={isInForgeTray}
              onClick={() => {
                if (card.variant) data.onAddToTray?.(card.variant, card.asset);
              }}
              title={trayLabel}
              aria-label={trayLabel}
              variant="ghost"
              size="sm"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                {isInForgeTray ? (
                  <path d="m5 12 4 4L19 6" />
                ) : (
                  <>
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </>
                )}
              </svg>
            </IconButton>
          )}
        </div>
        <div className={boardStyles.assetMeta}>
          <span>{card.asset.type}</span>
        </div>
      </div>
    </article>
  );
}

function FrameNodeView({ data }: NodeProps<FrameNode>) {
  const showKindText = Boolean(data.kindLabel && data.kindLabel.toLowerCase() !== data.title.toLowerCase());
  return (
    <div className={styles.frame} style={{ '--collection-color': data.color } as CSSProperties}>
      <header className={styles.frameHeader}>
        {data.kindLabel && (
          <span className={styles.frameEyebrow}>
            <span className={styles.colorDot} />
            {showKindText && <span>{data.kindLabel}</span>}
          </span>
        )}
        <h2 className={styles.frameTitle}>{data.title}</h2>
        <span className={styles.frameCount}>{data.count}</span>
      </header>
      {data.cards.length > 0 ? (
        <div className={`${styles.frameBody} nodrag`}>
          <div className={boardStyles.cardGrid}>
            {data.cards.map((card) => (
              // The tray action lives in caption chrome, never over media pixels.
              <FrameAssetCard key={card.key} card={card} data={data} />
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
  onAddToTray,
  isVariantInForgeTray,
}: SpaceCanvasProps) {
  const { fitView, setViewport, screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);

  // Viewport aspect drives the column count so frames fill the screen rather
  // than stacking into a tall, narrow strip with empty margins on the sides.
  const [viewportAspect, setViewportAspect] = useState(() =>
    typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerWidth / window.innerHeight : 1.6,
  );
  useEffect(() => {
    const update = () => {
      const el = wrapperRef.current;
      const w = el?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 0);
      const h = el?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 0);
      if (w > 0 && h > 0) setViewportAspect(w / h);
    };
    update();
    if (typeof window === 'undefined') return;
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

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
        onAddToTray,
        isVariantInForgeTray,
      },
    }));
    const totalHeight = seeded.reduce((sum, node) => sum + estimateFrameHeight((node.data as FrameData).count) + FRAME_GAP, 0);
    const columns = columnCountForLayout(totalHeight, viewportAspect, seeded.length);
    return packMasonry(seeded, columns);
  }, [assets, variants, collections, collectionItems, spaceId, onAssetClick, onAddToTray, isVariantInForgeTray, viewportAspect]);

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
  // Includes each frame's card order, not just its height: a same-height
  // reorder (e.g. live collection-item reordering) moves cards within the
  // frame, and the edge offsets must be re-measured for that too.
  const layoutKey = useMemo(
    () =>
      nodes
        .map((node) => {
          const cardKeys = node.data.cards.map((card) => card.key).join(',');
          return `${node.id}:${Math.round(node.measured?.height ?? 0)}:${cardKeys}`;
        })
        .join('|'),
    [nodes],
  );
  useEffect(() => {
    if (!layoutKey) return;
    setNodes((current) => {
      const totalHeight = current.reduce(
        (sum, node) => sum + (node.measured?.height ?? estimateFrameHeight((node.data as FrameData).count)) + FRAME_GAP,
        0,
      );
      const columns = columnCountForLayout(totalHeight, viewportAspect, current.length);
      const packed = packMasonry(current, columns, draggedIdsRef.current);
      return packed.some((node, index) => node !== current[index]) ? packed : current;
    });
  }, [layoutKey, viewportAspect, setNodes]);

  // Set the opening view once the frames have first been measured. If the whole
  // space fits at a readable zoom, fit it. Otherwise — a dense space — don't
  // shrink everything into an unreadable sliver: open at a readable zoom anchored
  // at the top, and let the rest sit off-screen (the minimap is the "there's more
  // down here" indicator).
  const nodesInitialized = useNodesInitialized();
  const didFitRef = useRef(false);
  useEffect(() => {
    if (!nodesInitialized || didFitRef.current || nodes.length === 0) return;
    didFitRef.current = true;
    requestAnimationFrame(() => {
      const el = wrapperRef.current;
      const bounds = getNodesBounds(nodes);
      const vw = el?.clientWidth ?? 0;
      const vh = el?.clientHeight ?? 0;
      const margin = 32;
      const fitZoom =
        vw > 0 && vh > 0 && bounds.width > 0 && bounds.height > 0
          ? Math.min((vw - margin * 2) / bounds.width, (vh - margin * 2) / bounds.height, 1)
          : 1;

      // Open dense spaces at a comfortable zoom (rest goes off-screen) rather
      // than shrinking everything to fit into an unreadable sliver.
      const READABLE_ZOOM = 0.6;
      if (fitZoom >= READABLE_ZOOM) {
        fitView({ padding: 0.06, maxZoom: 1 });
      } else {
        const zoom = READABLE_ZOOM;
        const x = vw / 2 - (bounds.x + bounds.width / 2) * zoom;
        const y = margin - bounds.y * zoom;
        setViewport({ x, y, zoom });
      }
      requestAnimationFrame(() => setIsReady(true));
    });
  }, [nodesInitialized, nodes, fitView, setViewport]);

  // Each card's centre as a flow-space offset from its frame's origin. This is
  // stable while a frame is dragged (only the frame's position moves), so the
  // edge endpoints are derived live from the frame positions below and follow
  // drags without re-measuring the DOM. Re-measured only when the layout
  // changes (frames re-pack, cards added/removed).
  const [cardOffsets, setCardOffsets] = useState<Map<string, { frameId: string; dx: number; dy: number }>>(new Map());
  const measureCardOffsets = useCallback(() => {
    const root = wrapperRef.current;
    if (!root) return;
    const next = new Map<string, { frameId: string; dx: number; dy: number }>();
    root.querySelectorAll<HTMLElement>('[data-asset-id]').forEach((el) => {
      const id = el.dataset.assetId;
      const frameEl = el.closest<HTMLElement>('.react-flow__node');
      const frameId = frameEl?.getAttribute('data-id');
      if (!id || !frameEl || !frameId) return;
      const card = el.getBoundingClientRect();
      const frame = frameEl.getBoundingClientRect();
      // Subtracting two flow-space points cancels the viewport transform.
      const cardFlow = screenToFlowPosition({ x: card.left + card.width / 2, y: card.top + card.height / 2 });
      const frameFlow = screenToFlowPosition({ x: frame.left, y: frame.top });
      next.set(id, { frameId, dx: cardFlow.x - frameFlow.x, dy: cardFlow.y - frameFlow.y });
    });
    setCardOffsets(next);
  }, [screenToFlowPosition]);

  useEffect(() => {
    if (!nodesInitialized) return;
    const frame = requestAnimationFrame(measureCardOffsets);
    return () => cancelAnimationFrame(frame);
  }, [nodesInitialized, layoutKey, edges, measureCardOffsets]);

  // Resolve each asset to its live flow-space centre: frame position + offset.
  const cardCenter = useMemo(() => {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return (assetId: string): { x: number; y: number } | null => {
      const offset = cardOffsets.get(assetId);
      const node = offset && nodeById.get(offset.frameId);
      if (!offset || !node) return null;
      return { x: node.position.x + offset.dx, y: node.position.y + offset.dy };
    };
  }, [nodes, cardOffsets]);

  if (assets.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={`${styles.emptyMark} ${isInitialSyncPending ? styles.emptyMarkLoading : ''}`} aria-hidden="true" />
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
              const a = cardCenter(edge.source);
              const b = cardCenter(edge.target);
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
          maskColor="var(--canvas-minimap-mask)"
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
