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
import { type Asset, type Variant, type Lineage, getVariantThumbnailUrl } from '../../hooks/useSpaceWebSocket';
import { VariantNode, type VariantNodeData, type VariantNodeType } from './VariantNode';

import '@xyflow/react/dist/style.css';
import styles from './VariantCanvas.module.css';

// Fixed thumbnail height, width varies by aspect ratio
const THUMB_HEIGHT = 140;
const THUMB_MIN_WIDTH = 100;
const THUMB_MAX_WIDTH = 240;
const NODE_PADDING = 20;
const LABEL_HEIGHT = 24;

// Active variant is larger
const ACTIVE_SCALE = 1.5;

// Default node dimensions
const DEFAULT_NODE_WIDTH = 160;
const DEFAULT_NODE_HEIGHT = THUMB_HEIGHT + NODE_PADDING + LABEL_HEIGHT;

// Custom node types
const nodeTypes = {
  variant: VariantNode,
};

export interface VariantCanvasProps {
  asset: Asset;
  variants: Variant[];
  lineage: Lineage[];
  selectedVariantId?: string;
  jobs?: Map<string, { variantId?: string; status: string }>;
  onVariantClick?: (variant: Variant) => void;
  onAddToTray?: (variant: Variant, asset: Asset) => void;
  onSetActive?: (variantId: string) => void;
  /** All variants from the space (for cross-asset lineage ghost nodes) */
  allVariants?: Variant[];
  /** All assets from the space (for resolving ghost node asset info) */
  allAssets?: Asset[];
  /** Callback when clicking a ghost node to navigate to its asset */
  onGhostNodeClick?: (assetId: string) => void;
}

/** Calculate node width from image dimensions */
function calculateNodeWidth(imgWidth: number, imgHeight: number, scale = 1): number {
  const aspectRatio = imgWidth / imgHeight;
  const thumbWidth = Math.min(THUMB_MAX_WIDTH * scale, Math.max(THUMB_MIN_WIDTH * scale, THUMB_HEIGHT * scale * aspectRatio));
  return thumbWidth + NODE_PADDING;
}

/** Apply dagre layout to nodes with lineage-based edges */
function getLayoutedElements(
  nodes: VariantNodeType[],
  edges: Edge[],
  nodeDimensions: Map<string, { width: number; height: number }>,
  activeVariantId?: string,
  direction: 'TB' | 'LR' = 'TB'
): { nodes: VariantNodeType[]; edges: Edge[] } {
  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Identify connected and orphan nodes
  const sourceIds = new Set(edges.map(e => e.source));
  const targetIds = new Set(edges.map(e => e.target));
  const connectedIds = new Set([...sourceIds, ...targetIds]);

  const orphanNodes = nodes.filter(n => !connectedIds.has(n.id));
  const treeNodes = nodes.filter(n => connectedIds.has(n.id));

  let layoutedTreeNodes: VariantNodeType[] = [];

  if (treeNodes.length > 0) {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    dagreGraph.setGraph({
      rankdir: direction,
      nodesep: 40,
      ranksep: 60,
      marginx: 30,
      marginy: 30,
    });

    // Add tree nodes with dimensions
    treeNodes.forEach((node) => {
      const isActive = node.id === activeVariantId;
      const baseDims = nodeDimensions.get(node.id) || { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
      const scale = isActive ? ACTIVE_SCALE : 1;
      const dims = { width: baseDims.width * scale, height: baseDims.height * scale };
      dagreGraph.setNode(node.id, { width: dims.width, height: dims.height });
    });

    // Add edges
    edges.forEach((edge) => {
      // Only add edges between tree nodes
      if (treeNodes.some(n => n.id === edge.source) && treeNodes.some(n => n.id === edge.target)) {
        dagreGraph.setEdge(edge.source, edge.target);
      }
    });

    dagre.layout(dagreGraph);

    layoutedTreeNodes = treeNodes.map((node) => {
      const nodeWithPosition = dagreGraph.node(node.id);
      const isActive = node.id === activeVariantId;
      const baseDims = nodeDimensions.get(node.id) || { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
      const scale = isActive ? ACTIVE_SCALE : 1;
      const dims = { width: baseDims.width * scale, height: baseDims.height * scale };
      return {
        ...node,
        position: {
          x: nodeWithPosition.x - dims.width / 2,
          y: nodeWithPosition.y - dims.height / 2,
        },
        style: isActive ? {
          transform: `scale(${ACTIVE_SCALE})`,
          transformOrigin: 'top left',
          zIndex: 10,
        } : undefined,
      };
    });
  }

  // Layout orphan nodes
  let layoutedOrphanNodes: VariantNodeType[] = [];

  if (orphanNodes.length > 0) {
    const sortedOrphans = [...orphanNodes].sort((a, b) =>
      (a.data.variant.created_at || 0) - (b.data.variant.created_at || 0)
    );

    let startX = 0;
    let startY = 0;

    if (layoutedTreeNodes.length > 0) {
      const maxTreeX = Math.max(...layoutedTreeNodes.map(n => {
        const isActive = n.id === activeVariantId;
        const baseDims = nodeDimensions.get(n.id) || { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
        const scale = isActive ? ACTIVE_SCALE : 1;
        return n.position.x + baseDims.width * scale;
      }));
      startX = maxTreeX + 80;
      startY = Math.min(...layoutedTreeNodes.map(n => n.position.y));
    }

    let currentX = startX;
    let currentY = startY;
    let rowMaxHeight = 0;
    const maxRowWidth = 600;

    layoutedOrphanNodes = sortedOrphans.map((node) => {
      const isActive = node.id === activeVariantId;
      const baseDims = nodeDimensions.get(node.id) || { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
      const scale = isActive ? ACTIVE_SCALE : 1;
      const dims = { width: baseDims.width * scale, height: baseDims.height * scale };

      if (currentX > startX && currentX + dims.width > startX + maxRowWidth) {
        currentX = startX;
        currentY += rowMaxHeight + 50;
        rowMaxHeight = 0;
      }

      const position = { x: currentX, y: currentY };
      currentX += dims.width + 40;
      rowMaxHeight = Math.max(rowMaxHeight, dims.height);

      return {
        ...node,
        position,
        style: isActive ? {
          transform: `scale(${ACTIVE_SCALE})`,
          transformOrigin: 'top left',
          zIndex: 10,
        } : undefined,
      };
    });
  }

  return {
    nodes: [...layoutedTreeNodes, ...layoutedOrphanNodes],
    edges,
  };
}

export function VariantCanvas({
  asset,
  variants,
  lineage,
  selectedVariantId,
  jobs,
  onVariantClick,
  onAddToTray,
  onSetActive,
  allVariants,
  allAssets,
  onGhostNodeClick,
}: VariantCanvasProps) {
  const [imageDimensions, setImageDimensions] = useState<Map<string, { width: number; height: number }>>(new Map());

  // Load image dimensions for all variants
  useEffect(() => {
    const loadDimensions = async () => {
      const newDimensions = new Map<string, { width: number; height: number }>();

      const promises = variants.map(async (variant) => {
        try {
          const img = new Image();
          const url = getVariantThumbnailUrl(variant);

          await new Promise<void>((resolve) => {
            img.onload = () => {
              const nodeWidth = calculateNodeWidth(img.naturalWidth, img.naturalHeight);
              newDimensions.set(variant.id, { width: nodeWidth, height: DEFAULT_NODE_HEIGHT });
              resolve();
            };
            img.onerror = () => {
              newDimensions.set(variant.id, { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
              resolve();
            };
            img.src = url;
          });
        } catch {
          newDimensions.set(variant.id, { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
        }
      });

      await Promise.all(promises);
      setImageDimensions(newDimensions);
    };

    if (variants.length > 0) {
      loadDimensions();
    }
  }, [variants]);

  // Check if variant is generating
  const isVariantGenerating = useCallback((variantId: string): boolean => {
    if (!jobs) return false;
    for (const job of jobs.values()) {
      if (job.variantId === variantId && (job.status === 'pending' || job.status === 'processing')) {
        return true;
      }
    }
    return false;
  }, [jobs]);

  // Build nodes and edges
  const { initialNodes, initialEdges } = useMemo(() => {
    // Build set of valid variant IDs for this asset
    const variantIds = new Set(variants.map(v => v.id));

    // Create normal nodes for this asset's variants
    const nodes: VariantNodeType[] = variants.map((variant) => ({
      id: variant.id,
      type: 'variant' as const,
      position: { x: 0, y: 0 },
      data: {
        variant,
        asset,
        isActive: variant.id === asset.active_variant_id,
        isSelected: variant.id === selectedVariantId,
        isGenerating: isVariantGenerating(variant.id),
        onVariantClick,
        onAddToTray,
        onSetActive,
      },
    }));

    // Find cross-asset lineage: where child is in this asset but parent is from another asset
    const crossAssetLineage = lineage.filter(l =>
      variantIds.has(l.child_variant_id) &&
      !variantIds.has(l.parent_variant_id) &&
      !l.severed
    );

    // Create ghost nodes for external parent variants
    const ghostNodes: VariantNodeType[] = [];
    const ghostVariantIds = new Set<string>();

    if (allVariants && allAssets && crossAssetLineage.length > 0) {
      for (const lin of crossAssetLineage) {
        if (ghostVariantIds.has(lin.parent_variant_id)) continue;

        const parentVariant = allVariants.find(v => v.id === lin.parent_variant_id);
        if (!parentVariant) continue;

        const parentAsset = allAssets.find(a => a.id === parentVariant.asset_id);
        if (!parentAsset) continue;

        ghostVariantIds.add(lin.parent_variant_id);
        ghostNodes.push({
          id: lin.parent_variant_id,
          type: 'variant' as const,
          position: { x: 0, y: 0 },
          data: {
            variant: parentVariant,
            asset: parentAsset,
            isGhost: true,
            onGhostClick: onGhostNodeClick,
          },
        });
      }
    }

    const allNodes = [...nodes, ...ghostNodes];
    const allVariantIds = new Set([...variantIds, ...ghostVariantIds]);

    // Create edges from lineage (parent -> child)
    // Include edges where both endpoints exist (including ghost nodes)
    const edges: Edge[] = lineage
      .filter(l => l.relation_type === 'derived' && allVariantIds.has(l.parent_variant_id) && allVariantIds.has(l.child_variant_id) && !l.severed)
      .map(l => {
        const isFromGhost = ghostVariantIds.has(l.parent_variant_id);
        return {
          id: `${l.parent_variant_id}-${l.child_variant_id}`,
          source: l.parent_variant_id,
          target: l.child_variant_id,
          type: 'smoothstep',
          animated: isVariantGenerating(l.child_variant_id),
          style: {
            stroke: isFromGhost ? 'var(--color-text-muted)' : 'var(--color-border)',
            strokeWidth: 2,
            strokeDasharray: isFromGhost ? '4,4' : undefined,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: 'var(--color-text-muted)',
            width: 14,
            height: 14,
          },
          label: isFromGhost ? 'spawned' : 'derived',
          labelStyle: { fontSize: 9, fill: 'var(--color-text-muted)' },
          labelBgStyle: { fill: 'var(--color-bg)', fillOpacity: 0.8 },
        };
      });

    // Add composed edges with different style
    const composedEdges: Edge[] = lineage
      .filter(l => l.relation_type === 'composed' && allVariantIds.has(l.parent_variant_id) && allVariantIds.has(l.child_variant_id) && !l.severed)
      .map(l => {
        const isFromGhost = ghostVariantIds.has(l.parent_variant_id);
        return {
          id: `${l.parent_variant_id}-${l.child_variant_id}-composed`,
          source: l.parent_variant_id,
          target: l.child_variant_id,
          type: 'smoothstep',
          animated: isVariantGenerating(l.child_variant_id),
          style: {
            stroke: 'var(--color-primary)',
            strokeWidth: 2,
            strokeDasharray: isFromGhost ? '4,4' : '5,5',
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: 'var(--color-primary)',
            width: 14,
            height: 14,
          },
          label: 'composed',
          labelStyle: { fontSize: 9, fill: 'var(--color-primary)' },
          labelBgStyle: { fill: 'var(--color-bg)', fillOpacity: 0.8 },
        };
      });

    // Add spawned edges
    const spawnedEdges: Edge[] = lineage
      .filter(l => l.relation_type === 'spawned' && allVariantIds.has(l.parent_variant_id) && allVariantIds.has(l.child_variant_id) && !l.severed)
      .map(l => ({
        id: `${l.parent_variant_id}-${l.child_variant_id}-spawned`,
        source: l.parent_variant_id,
        target: l.child_variant_id,
        type: 'smoothstep',
        animated: false,
        style: {
          stroke: 'var(--color-text-muted)',
          strokeWidth: 2,
          strokeDasharray: '4,4',
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: 'var(--color-text-muted)',
          width: 14,
          height: 14,
        },
        label: 'spawned',
        labelStyle: { fontSize: 9, fill: 'var(--color-text-muted)' },
        labelBgStyle: { fill: 'var(--color-bg)', fillOpacity: 0.8 },
      }));

    const allEdges = [...edges, ...composedEdges, ...spawnedEdges];

    // Apply layout
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      allNodes, allEdges, imageDimensions, asset.active_variant_id ?? undefined, 'TB'
    );

    return { initialNodes: layoutedNodes, initialEdges: layoutedEdges };
  }, [variants, lineage, asset, selectedVariantId, isVariantGenerating, onVariantClick, onAddToTray, onSetActive, imageDimensions, allVariants, allAssets, onGhostNodeClick]);

  const [nodes, setNodes, onNodesChange] = useNodesState<VariantNodeType>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update when layout changes
  useEffect(() => {
    setNodes(initialNodes as VariantNodeType[]);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  if (variants.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon}>🎨</span>
        <p className={styles.emptyText}>No variants yet</p>
        <p className={styles.emptySubtext}>
          Use the Forge Tray below to create your first variant
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
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--color-border)" />
        <Controls className={styles.controls} />
        <MiniMap
          className={styles.minimap}
          nodeColor={(node) => {
            const data = node.data as VariantNodeData;
            if (data.isActive) return 'var(--color-success)';
            if (data.isSelected) return 'var(--color-primary)';
            return 'var(--color-text-muted)';
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
        />
      </ReactFlow>
    </div>
  );
}
