# Asset Canvas - DAG Visualization

Interactive canvas for visualizing asset hierarchies as a directed acyclic graph (DAG).

## Overview

The Asset Canvas replaces traditional grid/list views with a node-based visualization where:
- Assets are displayed as thumbnail cards
- Parent-child relationships shown with connecting arrows
- Layout automatically calculated based on hierarchy
- Full pan/zoom/drag interaction

## Technology Stack

- **React Flow** (`@xyflow/react`) - Node-based UI library for interactive diagrams
- **Dagre** - Graph layout algorithm for automatic node positioning
- **CSS Variables** - Theme-aware styling

## Key Architecture Decisions

### 1. Dynamic Node Dimensions

Nodes have variable widths based on image aspect ratio:

```typescript
// Fixed height, variable width
const THUMB_HEIGHT = 140;
const THUMB_MIN_WIDTH = 100;
const THUMB_MAX_WIDTH = 240;

function calculateNodeWidth(imgWidth: number, imgHeight: number): number {
  const aspectRatio = imgWidth / imgHeight;
  return Math.min(THUMB_MAX_WIDTH, Math.max(THUMB_MIN_WIDTH, THUMB_HEIGHT * aspectRatio));
}
```

Images are preloaded to get natural dimensions before layout calculation.

### 2. Two-Pass Layout Strategy

**Tree nodes** (connected via parent-child edges):
- Processed by dagre with actual node dimensions
- Maintains proper hierarchy visualization
- Spacing: `nodesep: 30`, `ranksep: 40`

**Orphan nodes** (no connections):
- Laid out in a row-based grid
- Positioned to the right of tree structures
- Wraps at 800px width

### 3. Layout Algorithm

```
1. Separate nodes into "tree nodes" (have edges) and "orphan nodes" (isolated)
2. Load image dimensions for all variants
3. For tree nodes:
   - Create dagre graph with actual node dimensions
   - Add edges from parent_asset_id relationships
   - Run dagre.layout()
   - Position nodes centered on dagre coordinates
4. For orphan nodes:
   - Sort alphabetically
   - Position in rows, wrapping when exceeding max width
   - Start position: right of tree layout
5. Combine and return all positioned nodes
```

### 4. Real-time Updates

- Layout recalculates when `assets` or `variants` change
- Generating assets show animated edges
- Job status reflected in node appearance

## Component Structure

```
AssetCanvas/
├── AssetCanvas.tsx      # Main canvas with React Flow + layout logic
├── AssetCanvas.module.css
├── AssetNode.tsx        # Custom node component (thumbnail + label)
├── AssetNode.module.css
└── index.ts
```

### AssetCanvas Props

```typescript
interface AssetCanvasProps {
  assets: Asset[];
  variants: Variant[];
  jobs?: Map<string, { assetId?: string; status: string }>;
  onAssetClick?: (asset: Asset) => void;
  onAddToTray?: (variant: Variant, asset: Asset) => void;
}
```

### AssetNode Data

```typescript
interface AssetNodeData {
  asset: Asset;
  variant: Variant | null;
  isGenerating?: boolean;
  onAssetClick?: (asset: Asset) => void;
  onAddToTray?: (variant: Variant, asset: Asset) => void;
}
```

## Styling Approach

### Thumbnail Sizing

```css
.thumbnail {
  min-width: 100px;
  max-width: 240px;
  height: 140px;  /* Fixed height */
}

.image {
  height: 100%;
  width: auto;    /* Width follows aspect ratio */
  object-fit: contain;
}
```

### Node Appearance

- Surface background with border
- Hover: primary color border + lift effect
- Selected: primary border with glow
- Connection handles at top/bottom

### Canvas Controls

- Background: dot pattern
- Controls: zoom in/out, fit view
- MiniMap: overview navigation

## Full-Screen Layout Integration

The canvas is designed to fill available viewport space:

```css
.canvasContainer {
  flex: 1;
  position: relative;
  min-height: 0;
}

.canvas {
  width: 100%;
  height: 100%;
}
```

Overlays float above the canvas:
- **Top-left**: Space title, role, member/asset counts
- **Top-right**: Chat toggle button
- **Bottom-left**: Active job cards
- **Right panel**: Collapsible chat sidebar

## Performance Considerations

1. **Image preloading**: Dimensions fetched in parallel via `Promise.all`
2. **Memoization**: Layout calculation memoized with `useMemo`
3. **Incremental updates**: Only re-layout when dependencies change
4. **React Flow optimization**: `proOptions={{ hideAttribution: true }}`

## Future Improvements

- Store image dimensions in variant metadata (avoid preload)
- Variant lineage visualization (second relationship type)
- Drag-to-reparent assets
- Multi-select for batch operations
- Zoom-dependent detail levels
