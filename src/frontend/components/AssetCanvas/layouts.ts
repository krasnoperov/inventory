/**
 * Layout algorithms for AssetCanvas
 *
 * Supports multiple intelligent layout strategies:
 * - dagre: Hierarchical tree layout (good for parent-child relationships)
 * - force: Force-directed layout (organic clustering, reveals relationships)
 * - grid: Compact grid layout (efficient space usage)
 * - radial: Radial tree layout (center-focused hierarchy)
 * - circular: Nodes arranged in a circle
 */

import dagre from 'dagre';
import * as d3Force from 'd3-force';
import type { Edge } from '@xyflow/react';
import type { AssetNodeType } from './AssetNode';

export type LayoutAlgorithm = 'dagre' | 'force' | 'grid' | 'radial' | 'circular';

export interface LayoutOptions {
  /** Layout algorithm to use */
  algorithm: LayoutAlgorithm;
  /** Direction for hierarchical layouts (dagre, radial) */
  direction?: 'TB' | 'LR' | 'BT' | 'RL';
  /** Node dimensions map */
  nodeDimensions: Map<string, { width: number; height: number }>;
  /** Default node dimensions */
  defaultDimensions: { width: number; height: number };
}

interface LayoutResult {
  nodes: AssetNodeType[];
  edges: Edge[];
}

/** Apply layout algorithm to nodes */
export function applyLayout(
  nodes: AssetNodeType[],
  edges: Edge[],
  options: LayoutOptions
): LayoutResult {
  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const { algorithm, direction = 'LR', nodeDimensions, defaultDimensions } = options;

  switch (algorithm) {
    case 'dagre':
      return layoutDagre(nodes, edges, nodeDimensions, defaultDimensions, direction);
    case 'force':
      return layoutForce(nodes, edges, nodeDimensions, defaultDimensions);
    case 'grid':
      return layoutGrid(nodes, edges, nodeDimensions, defaultDimensions);
    case 'radial':
      return layoutRadial(nodes, edges, nodeDimensions, defaultDimensions);
    case 'circular':
      return layoutCircular(nodes, edges, nodeDimensions, defaultDimensions);
    default:
      return layoutDagre(nodes, edges, nodeDimensions, defaultDimensions, direction);
  }
}

/** Dagre hierarchical layout - best for tree structures */
function layoutDagre(
  nodes: AssetNodeType[],
  edges: Edge[],
  nodeDimensions: Map<string, { width: number; height: number }>,
  defaultDimensions: { width: number; height: number },
  direction: 'TB' | 'LR' | 'BT' | 'RL'
): LayoutResult {
  // Identify connected components (trees) and orphan nodes
  const sourceIds = new Set(edges.map(e => e.source));
  const targetIds = new Set(edges.map(e => e.target));
  const connectedIds = new Set([...sourceIds, ...targetIds]);

  const orphanNodes = nodes.filter(n => !connectedIds.has(n.id));
  const treeNodes = nodes.filter(n => connectedIds.has(n.id));

  let layoutedTreeNodes: AssetNodeType[] = [];

  if (treeNodes.length > 0) {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({
      rankdir: direction,
      nodesep: 40,
      ranksep: 50,
      marginx: 20,
      marginy: 20,
    });

    treeNodes.forEach((node) => {
      const dims = nodeDimensions.get(node.id) || defaultDimensions;
      dagreGraph.setNode(node.id, { width: dims.width, height: dims.height });
    });

    edges.forEach((edge) => {
      if (connectedIds.has(edge.source) && connectedIds.has(edge.target)) {
        dagreGraph.setEdge(edge.source, edge.target);
      }
    });

    dagre.layout(dagreGraph);

    layoutedTreeNodes = treeNodes.map((node) => {
      const nodeWithPosition = dagreGraph.node(node.id);
      const dims = nodeDimensions.get(node.id) || defaultDimensions;
      return {
        ...node,
        position: {
          x: nodeWithPosition.x - dims.width / 2,
          y: nodeWithPosition.y - dims.height / 2,
        },
      };
    });
  }

  // Layout orphan nodes in a grid next to the tree
  const layoutedOrphanNodes = layoutOrphansGrid(
    orphanNodes,
    layoutedTreeNodes,
    nodeDimensions,
    defaultDimensions
  );

  return {
    nodes: [...layoutedTreeNodes, ...layoutedOrphanNodes].map(n => ({
      ...n,
      data: { ...n.data, layoutDirection: direction },
    })),
    edges,
  };
}

/** Simulation node type with required properties */
interface SimNode extends d3Force.SimulationNodeDatum {
  id: string;
  width: number;
  height: number;
}

/** Force-directed layout using d3-force - organic clustering */
function layoutForce(
  nodes: AssetNodeType[],
  edges: Edge[],
  nodeDimensions: Map<string, { width: number; height: number }>,
  defaultDimensions: { width: number; height: number }
): LayoutResult {
  // Create simulation nodes
  const simNodes: SimNode[] = nodes.map(node => {
    const dims = nodeDimensions.get(node.id) || defaultDimensions;
    return {
      id: node.id,
      x: Math.random() * 800,
      y: Math.random() * 600,
      width: dims.width,
      height: dims.height,
    };
  });

  // Create simulation links
  const simLinks = edges.map(edge => ({
    source: edge.source,
    target: edge.target,
  }));

  // Run force simulation
  const simulation = d3Force.forceSimulation<SimNode>(simNodes)
    .force('link', d3Force.forceLink<SimNode, typeof simLinks[number]>(simLinks)
      .id(d => d.id)
      .distance(180)
      .strength(0.8))
    .force('charge', d3Force.forceManyBody<SimNode>()
      .strength(-400)
      .distanceMax(500))
    .force('center', d3Force.forceCenter(400, 300))
    .force('collision', d3Force.forceCollide<SimNode>()
      .radius(d => Math.max(d.width, d.height) / 2 + 20)
      .strength(0.9))
    .stop();

  // Run simulation for fixed number of ticks
  for (let i = 0; i < 300; i++) {
    simulation.tick();
  }

  // Map positions back to nodes
  const nodePositions = new Map(simNodes.map(n => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));

  const layoutedNodes = nodes.map(node => {
    const pos = nodePositions.get(node.id) || { x: 0, y: 0 };
    const dims = nodeDimensions.get(node.id) || defaultDimensions;
    return {
      ...node,
      position: {
        x: pos.x - dims.width / 2,
        y: pos.y - dims.height / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

/** Grid layout - compact arrangement in rows */
function layoutGrid(
  nodes: AssetNodeType[],
  edges: Edge[],
  nodeDimensions: Map<string, { width: number; height: number }>,
  defaultDimensions: { width: number; height: number }
): LayoutResult {
  // Sort nodes: connected nodes first (by connectivity), then orphans alphabetically
  const sourceIds = new Set(edges.map(e => e.source));
  const targetIds = new Set(edges.map(e => e.target));

  // Count connections per node
  const connectionCount = new Map<string, number>();
  nodes.forEach(n => connectionCount.set(n.id, 0));
  edges.forEach(e => {
    connectionCount.set(e.source, (connectionCount.get(e.source) || 0) + 1);
    connectionCount.set(e.target, (connectionCount.get(e.target) || 0) + 1);
  });

  const sortedNodes = [...nodes].sort((a, b) => {
    const aConn = connectionCount.get(a.id) || 0;
    const bConn = connectionCount.get(b.id) || 0;
    if (aConn !== bConn) return bConn - aConn; // More connections first
    return a.data.asset.name.toLowerCase().localeCompare(b.data.asset.name.toLowerCase());
  });

  // Calculate optimal grid dimensions
  const avgWidth = Array.from(nodeDimensions.values()).reduce((sum, d) => sum + d.width, 0) / Math.max(nodeDimensions.size, 1) || defaultDimensions.width;
  const cols = Math.ceil(Math.sqrt(nodes.length * 1.5)); // Slightly wider than square
  const gapX = 40;
  const gapY = 40;

  let currentX = 0;
  let currentY = 0;
  let rowMaxHeight = 0;
  let colIndex = 0;

  const layoutedNodes = sortedNodes.map((node) => {
    const dims = nodeDimensions.get(node.id) || defaultDimensions;

    if (colIndex >= cols) {
      colIndex = 0;
      currentX = 0;
      currentY += rowMaxHeight + gapY;
      rowMaxHeight = 0;
    }

    const position = { x: currentX, y: currentY };
    currentX += dims.width + gapX;
    rowMaxHeight = Math.max(rowMaxHeight, dims.height);
    colIndex++;

    return { ...node, position };
  });

  return { nodes: layoutedNodes, edges };
}

/** Radial tree layout - hierarchy radiating from center */
function layoutRadial(
  nodes: AssetNodeType[],
  edges: Edge[],
  nodeDimensions: Map<string, { width: number; height: number }>,
  defaultDimensions: { width: number; height: number }
): LayoutResult {
  if (nodes.length === 0) return { nodes: [], edges };

  // Find root nodes (nodes that are sources but not targets, or have most children)
  const targetIds = new Set(edges.map(e => e.target));
  const rootNodes = nodes.filter(n => !targetIds.has(n.id));
  const orphanNodes = nodes.filter(n => {
    const isSource = edges.some(e => e.source === n.id);
    const isTarget = edges.some(e => e.target === n.id);
    return !isSource && !isTarget;
  });

  // Build adjacency for BFS
  const children = new Map<string, string[]>();
  nodes.forEach(n => children.set(n.id, []));
  edges.forEach(e => {
    const c = children.get(e.source) || [];
    c.push(e.target);
    children.set(e.source, c);
  });

  // BFS to assign levels
  const levels = new Map<string, number>();
  const queue: Array<{ id: string; level: number }> = [];

  // Start with actual roots (connected nodes with no parent)
  const connectedRoots = rootNodes.filter(n => !orphanNodes.includes(n));
  if (connectedRoots.length === 0 && nodes.length > 0) {
    // No clear hierarchy, just use first node
    queue.push({ id: nodes[0].id, level: 0 });
  } else {
    connectedRoots.forEach(r => queue.push({ id: r.id, level: 0 }));
  }

  while (queue.length > 0) {
    const { id, level } = queue.shift()!;
    if (levels.has(id)) continue;
    levels.set(id, level);

    const nodeChildren = children.get(id) || [];
    nodeChildren.forEach(childId => {
      if (!levels.has(childId)) {
        queue.push({ id: childId, level: level + 1 });
      }
    });
  }

  // Add orphans at the outermost level
  const maxLevel = Math.max(...Array.from(levels.values()), 0);
  orphanNodes.forEach(n => {
    if (!levels.has(n.id)) {
      levels.set(n.id, maxLevel + 1);
    }
  });

  // Group nodes by level
  const nodesByLevel = new Map<number, AssetNodeType[]>();
  nodes.forEach(node => {
    const level = levels.get(node.id) ?? maxLevel + 1;
    const group = nodesByLevel.get(level) || [];
    group.push(node);
    nodesByLevel.set(level, group);
  });

  // Position nodes in concentric circles
  const centerX = 400;
  const centerY = 300;
  const baseRadius = 120;
  const radiusIncrement = 150;

  const layoutedNodes: AssetNodeType[] = [];

  nodesByLevel.forEach((levelNodes, level) => {
    const radius = level === 0 ? 0 : baseRadius + (level - 1) * radiusIncrement;
    const angleStep = (2 * Math.PI) / levelNodes.length;
    const startAngle = -Math.PI / 2; // Start from top

    levelNodes.forEach((node, index) => {
      const dims = nodeDimensions.get(node.id) || defaultDimensions;
      const angle = startAngle + index * angleStep;

      layoutedNodes.push({
        ...node,
        position: {
          x: centerX + radius * Math.cos(angle) - dims.width / 2,
          y: centerY + radius * Math.sin(angle) - dims.height / 2,
        },
      });
    });
  });

  return { nodes: layoutedNodes, edges };
}

/** Circular layout - all nodes arranged in a circle */
function layoutCircular(
  nodes: AssetNodeType[],
  edges: Edge[],
  nodeDimensions: Map<string, { width: number; height: number }>,
  defaultDimensions: { width: number; height: number }
): LayoutResult {
  if (nodes.length === 0) return { nodes: [], edges };

  // Sort nodes to minimize edge crossings (connected nodes closer together)
  const adjacency = new Map<string, Set<string>>();
  nodes.forEach(n => adjacency.set(n.id, new Set()));
  edges.forEach(e => {
    adjacency.get(e.source)?.add(e.target);
    adjacency.get(e.target)?.add(e.source);
  });

  // Simple greedy ordering: start with most connected, add neighbors
  const sortedNodes: AssetNodeType[] = [];
  const remaining = new Set(nodes.map(n => n.id));
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Start with most connected node
  let current = nodes.reduce((best, n) =>
    (adjacency.get(n.id)?.size || 0) > (adjacency.get(best.id)?.size || 0) ? n : best
  );

  while (remaining.size > 0) {
    if (remaining.has(current.id)) {
      sortedNodes.push(current);
      remaining.delete(current.id);
    }

    // Find next: prefer neighbors, then most connected remaining
    const neighbors = adjacency.get(current.id) || new Set();
    let next: AssetNodeType | null = null;

    for (const neighborId of neighbors) {
      if (remaining.has(neighborId)) {
        next = nodeMap.get(neighborId)!;
        break;
      }
    }

    if (!next && remaining.size > 0) {
      const remainingId = remaining.values().next().value as string;
      next = nodeMap.get(remainingId)!;
    }

    if (next) current = next;
  }

  // Calculate radius based on node sizes
  const totalSize = sortedNodes.reduce((sum, n) => {
    const dims = nodeDimensions.get(n.id) || defaultDimensions;
    return sum + Math.max(dims.width, dims.height);
  }, 0);
  const minRadius = totalSize / (2 * Math.PI) + 60;
  const radius = Math.max(minRadius, 200);

  const centerX = 400;
  const centerY = 300;
  const angleStep = (2 * Math.PI) / sortedNodes.length;
  const startAngle = -Math.PI / 2;

  const layoutedNodes = sortedNodes.map((node, index) => {
    const dims = nodeDimensions.get(node.id) || defaultDimensions;
    const angle = startAngle + index * angleStep;

    return {
      ...node,
      position: {
        x: centerX + radius * Math.cos(angle) - dims.width / 2,
        y: centerY + radius * Math.sin(angle) - dims.height / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

/** Helper: layout orphan nodes in a grid, positioned relative to existing nodes */
function layoutOrphansGrid(
  orphanNodes: AssetNodeType[],
  existingNodes: AssetNodeType[],
  nodeDimensions: Map<string, { width: number; height: number }>,
  defaultDimensions: { width: number; height: number }
): AssetNodeType[] {
  if (orphanNodes.length === 0) return [];

  const sortedOrphans = [...orphanNodes].sort((a, b) =>
    a.data.asset.name.toLowerCase().localeCompare(b.data.asset.name.toLowerCase())
  );

  // Find starting position
  let startX = 0;
  let startY = 0;

  if (existingNodes.length > 0) {
    const maxX = Math.max(...existingNodes.map(n => {
      const dims = nodeDimensions.get(n.id) || defaultDimensions;
      return n.position.x + dims.width;
    }));
    startX = maxX + 80;
    startY = Math.min(...existingNodes.map(n => n.position.y));
  }

  let currentX = startX;
  let currentY = startY;
  let rowMaxHeight = 0;
  const maxRowWidth = 600;

  return sortedOrphans.map((node) => {
    const dims = nodeDimensions.get(node.id) || defaultDimensions;

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

/** Layout algorithm metadata for UI */
export const layoutAlgorithms: Array<{
  id: LayoutAlgorithm;
  name: string;
  description: string;
  icon: string;
}> = [
  {
    id: 'dagre',
    name: 'Tree',
    description: 'Hierarchical tree layout, best for parent-child relationships',
    icon: '🌲',
  },
  {
    id: 'force',
    name: 'Force',
    description: 'Organic force-directed layout, reveals clusters and relationships',
    icon: '🔮',
  },
  {
    id: 'grid',
    name: 'Grid',
    description: 'Compact grid layout, efficient use of space',
    icon: '▦',
  },
  {
    id: 'radial',
    name: 'Radial',
    description: 'Radial tree with hierarchy radiating from center',
    icon: '◎',
  },
  {
    id: 'circular',
    name: 'Circle',
    description: 'All nodes arranged in a circle',
    icon: '○',
  },
];
