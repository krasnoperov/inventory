import { useMemo, useCallback, useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Edge,
  MarkerType,
  BackgroundVariant,
} from '@xyflow/react';
import dagre from 'dagre';
import { type Asset, type Variant, getVariantThumbnailUrl } from '../../hooks/useSpaceWebSocket';
import { AssetNode, type AssetNodeData, type AssetNodeType } from './AssetNode';

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

export interface AssetCanvasProps {
  assets: Asset[];
  variants: Variant[];
  jobs?: Map<string, { assetId?: string; status: string }>;
  onAssetClick?: (asset: Asset) => void;
  onAddToTray?: (variant: Variant, asset: Asset) => void;
}

/** Calculate node width from image dimensions */
function calculateNodeWidth(imgWidth: number, imgHeight: number): number {
  const aspectRatio = imgWidth / imgHeight;
  const thumbWidth = Math.min(THUMB_MAX_WIDTH, Math.max(THUMB_MIN_WIDTH, THUMB_HEIGHT * aspectRatio));
  return thumbWidth + NODE_PADDING;
}

/** Apply dagre layout to nodes with dynamic widths */
function getLayoutedElements(
  nodes: AssetNodeType[],
  edges: Edge[],
  nodeDimensions: Map<string, { width: number; height: number }>,
  direction: 'TB' | 'LR' = 'TB'
): { nodes: AssetNodeType[]; edges: Edge[] } {
  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Identify connected components (trees) and orphan nodes
  const sourceIds = new Set(edges.map(e => e.source));
  const targetIds = new Set(edges.map(e => e.target));
  const connectedIds = new Set([...sourceIds, ...targetIds]);

  // Orphan nodes: not connected to any edge
  const orphanNodes = nodes.filter(n => !connectedIds.has(n.id));
  const treeNodes = nodes.filter(n => connectedIds.has(n.id));

  // Layout tree nodes with dagre
  let layoutedTreeNodes: AssetNodeType[] = [];

  if (treeNodes.length > 0) {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    dagreGraph.setGraph({
      rankdir: direction,
      nodesep: 30,  // Horizontal spacing between siblings
      ranksep: 40,  // Vertical spacing between parent and child
      marginx: 20,
      marginy: 20,
    });

    // Add tree nodes with their actual dimensions
    treeNodes.forEach((node) => {
      const dims = nodeDimensions.get(node.id) || { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
      dagreGraph.setNode(node.id, { width: dims.width, height: dims.height });
    });

    // Add edges
    edges.forEach((edge) => {
      dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    layoutedTreeNodes = treeNodes.map((node) => {
      const nodeWithPosition = dagreGraph.node(node.id);
      const dims = nodeDimensions.get(node.id) || { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
      return {
        ...node,
        position: {
          x: nodeWithPosition.x - dims.width / 2,
          y: nodeWithPosition.y - dims.height / 2,
        },
      };
    });
  }

  // Layout orphan nodes in a grid
  let layoutedOrphanNodes: AssetNodeType[] = [];

  if (orphanNodes.length > 0) {
    const sortedOrphans = [...orphanNodes].sort((a, b) =>
      a.data.asset.name.toLowerCase().localeCompare(b.data.asset.name.toLowerCase())
    );

    // Find where to position orphan grid
    let startX = 0;
    let startY = 0;

    if (layoutedTreeNodes.length > 0) {
      const maxTreeX = Math.max(...layoutedTreeNodes.map(n => {
        const dims = nodeDimensions.get(n.id) || { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
        return n.position.x + dims.width;
      }));
      startX = maxTreeX + 60;
      startY = Math.min(...layoutedTreeNodes.map(n => n.position.y));
    }

    // Simple row-based layout for orphans
    let currentX = startX;
    let currentY = startY;
    let rowMaxHeight = 0;
    const maxRowWidth = 800; // Max width before wrapping

    layoutedOrphanNodes = sortedOrphans.map((node) => {
      const dims = nodeDimensions.get(node.id) || { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };

      // Wrap to next row if needed
      if (currentX > startX && currentX + dims.width > startX + maxRowWidth) {
        currentX = startX;
        currentY += rowMaxHeight + 40;
        rowMaxHeight = 0;
      }

      const position = { x: currentX, y: currentY };
      currentX += dims.width + 30;
      rowMaxHeight = Math.max(rowMaxHeight, dims.height);

      return { ...node, position };
    });
  }

  return {
    nodes: [...layoutedTreeNodes, ...layoutedOrphanNodes],
    edges
  };
}

export function AssetCanvas({
  assets,
  variants,
  jobs,
  onAssetClick,
  onAddToTray,
}: AssetCanvasProps) {
  // Track loaded image dimensions
  const [imageDimensions, setImageDimensions] = useState<Map<string, { width: number; height: number }>>(new Map());

  // Get variant for an asset
  const getAssetVariant = useCallback((asset: Asset): Variant | null => {
    if (asset.active_variant_id) {
      return variants.find(v => v.id === asset.active_variant_id) || null;
    }
    return variants.find(v => v.asset_id === asset.id) || null;
  }, [variants]);

  // Load image dimensions for all variants
  useEffect(() => {
    const loadDimensions = async () => {
      const newDimensions = new Map<string, { width: number; height: number }>();

      const promises = assets.map(async (asset) => {
        const variant = getAssetVariant(asset);
        if (!variant) {
          newDimensions.set(asset.id, { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
          return;
        }

        try {
          const img = new Image();
          const url = getVariantThumbnailUrl(variant);

          await new Promise<void>((resolve, reject) => {
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
    };

    if (assets.length > 0) {
      loadDimensions();
    }
  }, [assets, getAssetVariant]);

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

    // Apply layout with dynamic dimensions
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      nodes, edges, imageDimensions, 'TB'
    );

    return { initialNodes: layoutedNodes, initialEdges: layoutedEdges };
  }, [assets, getAssetVariant, isAssetGenerating, onAssetClick, onAddToTray, imageDimensions]);

  const [nodes, setNodes, onNodesChange] = useNodesState<AssetNodeType>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes when layout changes
  useEffect(() => {
    setNodes(initialNodes as AssetNodeType[]);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

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

  return (
    <div className={styles.canvas}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--color-border)" />
        <Controls className={styles.controls} />
        <MiniMap
          className={styles.minimap}
          nodeColor={(node) => {
            const data = node.data as AssetNodeData;
            return data.variant ? 'var(--color-primary)' : 'var(--color-text-muted)';
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
        />
      </ReactFlow>
    </div>
  );
}
