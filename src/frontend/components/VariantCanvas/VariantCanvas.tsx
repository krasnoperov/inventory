import { useMemo, useCallback, useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
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
const LABEL_HEIGHT = 24; // Extra height for nodes with labels (ghost/forked)

// Active variant is larger
const ACTIVE_SCALE = 1.5;

// Default node dimensions (without label - labels added dynamically for ghost/forked nodes)
const DEFAULT_NODE_WIDTH = 160;
const DEFAULT_NODE_HEIGHT = THUMB_HEIGHT + NODE_PADDING;

/** Check if a node will render a label */
function nodeHasLabel(node: VariantNodeType): boolean {
  const { isGhost, forkedFrom, forkedTo } = node.data;
  return Boolean(isGhost || forkedFrom || (forkedTo && forkedTo.length > 0));
}

// Custom node types
const nodeTypes = {
  variant: VariantNode,
};

/** Layout direction for the graph */
export type LayoutDirection = 'TB' | 'LR' | 'BT' | 'RL';

export interface VariantCanvasProps {
  asset: Asset;
  variants: Variant[];
  lineage: Lineage[];
  selectedVariantId?: string;
  jobs?: Map<string, { variantId?: string; status: string }>;
  onVariantClick?: (variant: Variant) => void;
  onAddToTray?: (variant: Variant, asset: Asset) => void;
  onSetActive?: (variantId: string) => void;
  /** Restore ForgeTray to the state used to create this variant */
  onRetryRecipe?: (variant: Variant) => void;
  /** All variants from the space (for cross-asset lineage ghost nodes) */
  allVariants?: Variant[];
  /** All assets from the space (for resolving ghost node asset info) */
  allAssets?: Asset[];
  /** Callback when clicking a ghost node to navigate to its asset */
  onGhostNodeClick?: (assetId: string) => void;
  /** Layout direction: TB (top-bottom), LR (left-right), BT, RL. Default: LR */
  layoutDirection?: LayoutDirection;
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
  direction: LayoutDirection = 'LR'
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
      const labelExtra = nodeHasLabel(node) ? LABEL_HEIGHT : 0;
      const scale = isActive ? ACTIVE_SCALE : 1;
      const dims = { width: baseDims.width * scale, height: (baseDims.height + labelExtra) * scale };
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
      const labelExtra = nodeHasLabel(node) ? LABEL_HEIGHT : 0;
      const scale = isActive ? ACTIVE_SCALE : 1;
      const dims = { width: baseDims.width * scale, height: (baseDims.height + labelExtra) * scale };
      return {
        ...node,
        position: {
          x: nodeWithPosition.x - dims.width / 2,
          y: nodeWithPosition.y - dims.height / 2,
        },
        // Use actual width/height instead of CSS transform for proper React Flow edge positioning
        width: dims.width,
        height: dims.height,
        style: isActive ? { zIndex: 10 } : undefined,
        data: {
          ...node.data,
          scale, // Pass scale to node for internal sizing
        },
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
      const labelExtra = nodeHasLabel(node) ? LABEL_HEIGHT : 0;
      const scale = isActive ? ACTIVE_SCALE : 1;
      const dims = { width: baseDims.width * scale, height: (baseDims.height + labelExtra) * scale };

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
        // Use actual width/height instead of CSS transform for proper React Flow edge positioning
        width: dims.width,
        height: dims.height,
        style: isActive ? { zIndex: 10 } : undefined,
        data: {
          ...node.data,
          scale, // Pass scale to node for internal sizing
        },
      };
    });
  }

  // Mark nodes with connection info for handle visibility and layout direction
  const allNodes = [...layoutedTreeNodes, ...layoutedOrphanNodes];
  return {
    nodes: allNodes.map(node => ({
      ...node,
      data: {
        ...node.data,
        hasIncoming: targetIds.has(node.id),
        hasOutgoing: sourceIds.has(node.id),
        layoutDirection: direction,
      },
    })),
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
  onRetryRecipe,
  allVariants,
  allAssets,
  onGhostNodeClick,
  layoutDirection = 'LR',
}: VariantCanvasProps) {
  const [imageDimensions, setImageDimensions] = useState<Map<string, { width: number; height: number }>>(new Map());

  // Load image dimensions for all variants
  useEffect(() => {
    const loadDimensions = async () => {
      const newDimensions = new Map<string, { width: number; height: number }>();

      const promises = variants.map(async (variant) => {
        const url = getVariantThumbnailUrl(variant);
        if (!url) {
          // Pending/failed variant - use default dimensions
          newDimensions.set(variant.id, { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
          return;
        }

        try {
          const img = new Image();

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

    // Build forkedTo map (outgoing: this asset's variant was forked TO another asset)
    // Build forkedFrom map (incoming: this asset's variant was forked FROM another asset)
    const forkedToMap = new Map<string, { assetId: string; assetName: string }[]>();
    const forkedFromMap = new Map<string, { assetId: string; assetName: string }>();
    if (allVariants && allAssets) {
      // Outgoing forked lineage: local parent → external child
      const outgoingForked = lineage.filter(l =>
        variantIds.has(l.parent_variant_id) &&
        !variantIds.has(l.child_variant_id) &&
        !l.severed &&
        l.relation_type === 'forked'
      );
      for (const lin of outgoingForked) {
        const childVariant = allVariants.find(v => v.id === lin.child_variant_id);
        if (!childVariant) continue;
        const childAsset = allAssets.find(a => a.id === childVariant.asset_id);
        if (!childAsset) continue;

        const existing = forkedToMap.get(lin.parent_variant_id) || [];
        // Avoid duplicates (same asset)
        if (!existing.some(e => e.assetId === childAsset.id)) {
          existing.push({ assetId: childAsset.id, assetName: childAsset.name });
        }
        forkedToMap.set(lin.parent_variant_id, existing);
      }

      // Incoming forked lineage: external parent → local child
      const incomingForked = lineage.filter(l =>
        variantIds.has(l.child_variant_id) &&
        !variantIds.has(l.parent_variant_id) &&
        !l.severed &&
        l.relation_type === 'forked'
      );
      for (const lin of incomingForked) {
        const parentVariant = allVariants.find(v => v.id === lin.parent_variant_id);
        if (!parentVariant) continue;
        const parentAsset = allAssets.find(a => a.id === parentVariant.asset_id);
        if (!parentAsset) continue;

        // For incoming fork, the local child variant links back to parent asset
        forkedFromMap.set(lin.child_variant_id, { assetId: parentAsset.id, assetName: parentAsset.name });
      }
    }

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
        onRetryRecipe,
        forkedTo: forkedToMap.get(variant.id),
        forkedFrom: forkedFromMap.get(variant.id),
        onGhostClick: onGhostNodeClick, // For forked-to/from navigation
      },
    }));

    // Find incoming cross-asset lineage: where child is in this asset but parent is from another asset
    // Exclude forked - for forked, the local variant IS a copy, so no ghost needed
    const incomingCrossAssetLineage = lineage.filter(l =>
      variantIds.has(l.child_variant_id) &&
      !variantIds.has(l.parent_variant_id) &&
      !l.severed &&
      l.relation_type !== 'forked'
    );

    // Find outgoing cross-asset lineage: where parent is in this asset but child is from another asset
    // Exclude forked - forked relationships don't need ghost nodes (child is a copy)
    const outgoingCrossAssetLineage = lineage.filter(l =>
      variantIds.has(l.parent_variant_id) &&
      !variantIds.has(l.child_variant_id) &&
      !l.severed &&
      l.relation_type !== 'forked'
    );

    // Create ghost nodes for external variants (both parents and children)
    const ghostNodes: VariantNodeType[] = [];
    const ghostVariantIds = new Set<string>();

    if (allVariants && allAssets) {
      // Ghost nodes for external parent variants (incoming)
      for (const lin of incomingCrossAssetLineage) {
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

      // Ghost nodes for external child variants (outgoing/derivatives) - excludes forked
      for (const lin of outgoingCrossAssetLineage) {
        if (ghostVariantIds.has(lin.child_variant_id)) continue;

        const childVariant = allVariants.find(v => v.id === lin.child_variant_id);
        if (!childVariant) continue;

        const childAsset = allAssets.find(a => a.id === childVariant.asset_id);
        if (!childAsset) continue;

        ghostVariantIds.add(lin.child_variant_id);
        ghostNodes.push({
          id: lin.child_variant_id,
          type: 'variant' as const,
          position: { x: 0, y: 0 },
          data: {
            variant: childVariant,
            asset: childAsset,
            isGhost: true,
            isDerivative: true, // Mark as outgoing derivative for different styling
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
      .filter(l => l.relation_type === 'refined' && allVariantIds.has(l.parent_variant_id) && allVariantIds.has(l.child_variant_id) && !l.severed)
      .map(l => {
        const isFromGhost = ghostVariantIds.has(l.parent_variant_id);
        const isToGhost = ghostVariantIds.has(l.child_variant_id);
        const isGhostEdge = isFromGhost || isToGhost;
        return {
          id: `${l.parent_variant_id}-${l.child_variant_id}`,
          source: l.parent_variant_id,
          target: l.child_variant_id,
          type: 'smoothstep',
          animated: isVariantGenerating(l.child_variant_id),
          style: {
            stroke: isGhostEdge ? 'var(--color-text-muted)' : 'var(--color-border)',
            strokeWidth: 2,
            strokeDasharray: isGhostEdge ? '4,4' : undefined,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: 'var(--color-text-muted)',
            width: 14,
            height: 14,
          },
        };
      });

    // Add derived edges (cross-asset references when deriving new assets)
    const derivedEdges: Edge[] = lineage
      .filter(l => l.relation_type === 'derived' && allVariantIds.has(l.parent_variant_id) && allVariantIds.has(l.child_variant_id) && !l.severed)
      .map(l => {
        const isFromGhost = ghostVariantIds.has(l.parent_variant_id);
        const isToGhost = ghostVariantIds.has(l.child_variant_id);
        const isGhostEdge = isFromGhost || isToGhost;
        return {
          id: `${l.parent_variant_id}-${l.child_variant_id}-derived`,
          source: l.parent_variant_id,
          target: l.child_variant_id,
          type: 'smoothstep',
          animated: isVariantGenerating(l.child_variant_id),
          style: {
            stroke: 'var(--color-success)',
            strokeWidth: 2,
            strokeDasharray: isGhostEdge ? '4,4' : undefined,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: 'var(--color-success)',
            width: 14,
            height: 14,
          },
        };
      });

    // Add forked edges
    const forkedEdges: Edge[] = lineage
      .filter(l => l.relation_type === 'forked' && allVariantIds.has(l.parent_variant_id) && allVariantIds.has(l.child_variant_id) && !l.severed)
      .map(l => ({
          id: `${l.parent_variant_id}-${l.child_variant_id}-forked`,
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
        }));

    const allEdges = [...edges, ...derivedEdges, ...forkedEdges];

    // Apply layout with configurable direction (default: LR for better sidebar/tray coexistence)
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      allNodes, allEdges, imageDimensions, asset.active_variant_id ?? undefined, layoutDirection
    );

    return { initialNodes: layoutedNodes, initialEdges: layoutedEdges };
  }, [variants, lineage, asset, selectedVariantId, isVariantGenerating, onVariantClick, onAddToTray, onSetActive, onRetryRecipe, imageDimensions, allVariants, allAssets, onGhostNodeClick, layoutDirection]);

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

  // Adjust fitView padding based on chat sidebar state
  // When chat is open (380px + margins), add extra right padding
  const fitViewOptions = useMemo(() => ({
    padding: 0.3,
    // Shift content left when chat is open to avoid overlap
    // Note: padding is uniform, but we position content to account for sidebar
  }), []);

  return (
    <div className={styles.canvas}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--color-border)" />
        <Controls className={styles.controls} position="bottom-left" />
      </ReactFlow>
    </div>
  );
}
