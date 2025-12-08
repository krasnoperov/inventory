import { useMemo, useCallback, useState, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useStore,
  type Edge,
  type Connection,
  MarkerType,
  BackgroundVariant,
} from '@xyflow/react';
import { type Asset, type Variant, getVariantThumbnailUrl } from '../../hooks/useSpaceWebSocket';
import { AssetNode, type AssetNodeType } from './AssetNode';
import { applyLayout, type LayoutAlgorithm } from './layouts';

import '@xyflow/react/dist/style.css';
import styles from './AssetCanvas.module.css';

// Fixed thumbnail height, width varies by aspect ratio
const THUMB_HEIGHT = 140;
const THUMB_MIN_WIDTH = 100;
const THUMB_MAX_WIDTH = 240;
const NODE_PADDING = 20; // padding + border around thumbnail
const LABEL_HEIGHT = 30; // space for name/type label

// Default node dimensions (used before images load)
const DEFAULT_NODE_WIDTH = 160;
const DEFAULT_NODE_HEIGHT = THUMB_HEIGHT + NODE_PADDING + LABEL_HEIGHT;

// Custom node types
const nodeTypes = {
  asset: AssetNode,
};

/** Layout direction for the graph */
export type LayoutDirection = 'TB' | 'LR' | 'BT' | 'RL';

export interface AssetCanvasProps {
  assets: Asset[];
  variants: Variant[];
  jobs?: Map<string, { assetId?: string; status: string }>;
  onAssetClick?: (asset: Asset) => void;
  onAddToTray?: (variant: Variant, asset: Asset) => void;
  /** Called when user drags an edge to reparent an asset. Set childAssetId's parent to newParentAssetId (or null to unparent) */
  onReparent?: (childAssetId: string, newParentAssetId: string | null) => void;
  /** Layout direction: TB (top-bottom), LR (left-right), BT, RL. Default: LR */
  layoutDirection?: LayoutDirection;
  /** Layout algorithm to use */
  layoutAlgorithm?: LayoutAlgorithm;
}

/** Calculate node width from image dimensions */
function calculateNodeWidth(imgWidth: number, imgHeight: number): number {
  const aspectRatio = imgWidth / imgHeight;
  const thumbWidth = Math.min(THUMB_MAX_WIDTH, Math.max(THUMB_MIN_WIDTH, THUMB_HEIGHT * aspectRatio));
  return thumbWidth + NODE_PADDING;
}

/** Inner component that has access to ReactFlow hooks */
function AssetCanvasInner({
  assets,
  variants,
  jobs,
  onAssetClick,
  onAddToTray,
  onReparent,
  layoutDirection = 'LR',
  layoutAlgorithm = 'dagre',
  dimensionsReady,
  imageDimensions,
}: AssetCanvasProps & {
  dimensionsReady: boolean;
  imageDimensions: Map<string, { width: number; height: number }>;
}) {
  const { fitView } = useReactFlow();
  const [isReady, setIsReady] = useState(false);

  // Update CSS custom property when zoom changes (via DOM, not React state)
  // This avoids re-rendering nodes while still enabling CSS counter-scaling
  const zoom = useStore((state) => state.transform[2]);
  useEffect(() => {
    // Set zoom as CSS custom property on the canvas container
    const container = document.querySelector(`.${styles.canvas}`);
    if (container) {
      (container as HTMLElement).style.setProperty('--rf-zoom', String(zoom));
    }
  }, [zoom]);

  // Get variant for an asset
  const getAssetVariant = useCallback((asset: Asset): Variant | null => {
    if (asset.active_variant_id) {
      return variants.find(v => v.id === asset.active_variant_id) || null;
    }
    return variants.find(v => v.asset_id === asset.id) || null;
  }, [variants]);

  // Check if asset is generating
  const isAssetGenerating = useCallback((assetId: string): boolean => {
    if (!jobs) return false;
    for (const job of jobs.values()) {
      if (job.assetId === assetId && (job.status === 'pending' || job.status === 'processing')) {
        return true;
      }
    }
    return false;
  }, [jobs]);

  // Build nodes and edges from assets
  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: AssetNodeType[] = assets.map((asset) => ({
      id: asset.id,
      type: 'asset' as const,
      position: { x: 0, y: 0 },
      data: {
        asset,
        variant: getAssetVariant(asset),
        isGenerating: isAssetGenerating(asset.id),
        onAssetClick,
        onAddToTray,
      },
    }));

    const edges: Edge[] = assets
      .filter(asset => asset.parent_asset_id)
      .map(asset => ({
        id: `${asset.parent_asset_id}-${asset.id}`,
        source: asset.parent_asset_id!,
        target: asset.id,
        type: 'smoothstep',
        animated: isAssetGenerating(asset.id),
        style: { stroke: 'var(--color-border)', strokeWidth: 2 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: 'var(--color-text-muted)',
          width: 16,
          height: 16,
        },
      }));

    // Apply layout algorithm
    const { nodes: layoutedNodes, edges: layoutedEdges } = applyLayout(nodes, edges, {
      algorithm: layoutAlgorithm,
      direction: layoutDirection,
      nodeDimensions: imageDimensions,
      defaultDimensions: { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT },
    });

    return { initialNodes: layoutedNodes, initialEdges: layoutedEdges };
  }, [assets, getAssetVariant, isAssetGenerating, onAssetClick, onAddToTray, imageDimensions, layoutDirection, layoutAlgorithm]);

  const [nodes, setNodes, onNodesChange] = useNodesState<AssetNodeType>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes when layout changes
  useEffect(() => {
    setNodes(initialNodes as AssetNodeType[]);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Fit view once dimensions are ready (prevents blink from multiple fitView calls)
  useEffect(() => {
    if (dimensionsReady && nodes.length > 0) {
      // Small delay to ensure nodes are rendered, then show canvas
      requestAnimationFrame(() => {
        fitView({ padding: 0.2 });
        // Mark as ready after fitView to prevent blink
        requestAnimationFrame(() => {
          setIsReady(true);
        });
      });
    }
  }, [dimensionsReady, nodes.length, fitView]);

  // Handle new connections (reparenting via drag)
  // User drags from parent's bottom handle (source) to child's top handle (target)
  const handleConnect = useCallback((connection: Connection) => {
    if (!onReparent || !connection.source || !connection.target) return;

    // When connecting: source is the new parent, target is the child being reparented
    const newParentId = connection.source;
    const childId = connection.target;

    // Don't allow self-connection
    if (newParentId === childId) return;

    // Call onReparent to update via WebSocket
    onReparent(childId, newParentId);
  }, [onReparent]);

  // Handle edge deletion (unparent asset)
  const handleEdgesDelete = useCallback((deletedEdges: Edge[]) => {
    if (!onReparent) return;

    for (const edge of deletedEdges) {
      // When deleting an edge, unparent the target (child) asset
      onReparent(edge.target, null);
    }
  }, [onReparent]);

  if (assets.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon}>🎨</span>
        <p className={styles.emptyText}>No assets yet</p>
        <p className={styles.emptySubtext}>
          Use the Forge Tray below to create your first asset
        </p>
      </div>
    );
  }

  const canvasClassName = `${styles.canvas} ${isReady ? styles.ready : styles.loading}`;

  return (
    <div className={canvasClassName}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onReparent ? handleConnect : undefined}
        onEdgesDelete={onReparent ? handleEdgesDelete : undefined}
        nodeTypes={nodeTypes}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode="Delete"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--color-border)" />
        <Controls className={styles.controls} position="bottom-left" />
      </ReactFlow>
    </div>
  );
}

/** Main exported component - handles dimension loading and provides ReactFlow context */
export function AssetCanvas({
  assets,
  variants,
  jobs,
  onAssetClick,
  onAddToTray,
  onReparent,
  layoutDirection = 'LR',
  layoutAlgorithm = 'dagre',
}: AssetCanvasProps) {
  // Track loaded image dimensions
  const [imageDimensions, setImageDimensions] = useState<Map<string, { width: number; height: number }>>(new Map());
  const [dimensionsReady, setDimensionsReady] = useState(false);

  // Get variant for an asset (for dimension loading)
  const getAssetVariant = useCallback((asset: Asset): Variant | null => {
    if (asset.active_variant_id) {
      return variants.find(v => v.id === asset.active_variant_id) || null;
    }
    return variants.find(v => v.asset_id === asset.id) || null;
  }, [variants]);

  // Load image dimensions for all variants
  useEffect(() => {
    if (assets.length === 0) {
      setDimensionsReady(true);
      return;
    }

    setDimensionsReady(false);

    const loadDimensions = async () => {
      const newDimensions = new Map<string, { width: number; height: number }>();

      const promises = assets.map(async (asset) => {
        const variant = getAssetVariant(asset);
        if (!variant) {
          newDimensions.set(asset.id, { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
          return;
        }

        const url = getVariantThumbnailUrl(variant);
        if (!url) {
          // Pending/failed variant - use default dimensions
          newDimensions.set(asset.id, { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
          return;
        }

        try {
          const img = new Image();

          await new Promise<void>((resolve) => {
            img.onload = () => {
              const nodeWidth = calculateNodeWidth(img.naturalWidth, img.naturalHeight);
              newDimensions.set(asset.id, { width: nodeWidth, height: DEFAULT_NODE_HEIGHT });
              resolve();
            };
            img.onerror = () => {
              newDimensions.set(asset.id, { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
              resolve(); // Don't fail, just use default
            };
            img.src = url;
          });
        } catch {
          newDimensions.set(asset.id, { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
        }
      });

      await Promise.all(promises);
      setImageDimensions(newDimensions);
      setDimensionsReady(true);
    };

    loadDimensions();
  }, [assets, getAssetVariant]);

  return (
    <ReactFlowProvider>
      <AssetCanvasInner
        assets={assets}
        variants={variants}
        jobs={jobs}
        onAssetClick={onAssetClick}
        onAddToTray={onAddToTray}
        onReparent={onReparent}
        layoutDirection={layoutDirection}
        layoutAlgorithm={layoutAlgorithm}
        dimensionsReady={dimensionsReady}
        imageDimensions={imageDimensions}
      />
    </ReactFlowProvider>
  );
}
