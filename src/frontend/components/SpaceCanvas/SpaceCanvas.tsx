import { useMemo, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
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
  SpaceCollection,
  Variant,
} from '../../space/protocol';
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

// Masonry: drop each frame into the currently shortest column. Uses the real
// measured height when available (after React Flow measures the DOM), falling
// back to the estimate for the very first paint.
function packMasonry(nodes: FrameNode[]): FrameNode[] {
  const columnHeights = new Array(COLUMNS).fill(0);
  return nodes.map((node) => {
    let col = 0;
    for (let i = 1; i < COLUMNS; i++) {
      if (columnHeights[i] < columnHeights[col]) col = i;
    }
    const height = node.measured?.height ?? estimateFrameHeight((node.data as FrameData).count);
    const position = { x: col * (FRAME_WIDTH + FRAME_GAP), y: columnHeights[col] };
    columnHeights[col] += height + FRAME_GAP;
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
  isInitialSyncPending,
  onAssetClick,
}: SpaceCanvasProps) {
  const { fitView } = useReactFlow();
  const [isReady, setIsReady] = useState(false);

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

  // Sync live data into the nodes while preserving any positions the user has
  // dragged. Only frames that didn't exist before take their computed masonry
  // slot; existing frames keep where they were placed.
  useEffect(() => {
    setNodes((current) => {
      const positionById = new Map(current.map((node) => [node.id, node.position]));
      return initialNodes.map((node) => {
        const existing = positionById.get(node.id);
        return existing ? { ...node, position: existing } : node;
      });
    });
  }, [initialNodes, setNodes]);

  // Once React Flow has measured the frames, re-pack the masonry with their real
  // heights (the estimate can't know exact wall heights) and fit the view. Runs
  // once per mount; later data edits keep the user's arranged positions.
  const nodesInitialized = useNodesInitialized();
  const didLayoutRef = useRef(false);
  useEffect(() => {
    if (!nodesInitialized || didLayoutRef.current || nodes.length === 0) return;
    didLayoutRef.current = true;
    setNodes((current) => packMasonry(current));
    requestAnimationFrame(() => {
      fitView({ padding: 0.15, maxZoom: 1 });
      requestAnimationFrame(() => setIsReady(true));
    });
  }, [nodesInitialized, nodes.length, setNodes, fitView]);

  if (assets.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon}>{isInitialSyncPending ? '⏳' : '🎨'}</span>
        <p>{isInitialSyncPending ? 'Loading assets…' : 'No assets yet'}</p>
      </div>
    );
  }

  return (
    <div className={`${styles.canvas} ${isReady ? styles.ready : styles.loading}`}>
      <ReactFlow
        nodes={nodes}
        edges={EMPTY_EDGES}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        minZoom={0.15}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
      >
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
