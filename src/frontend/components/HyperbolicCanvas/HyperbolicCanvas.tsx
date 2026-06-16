/**
 * HyperbolicCanvas — a Poincaré-disk view of a space's asset graph.
 *
 * A prototype alternative to the React Flow {@link AssetCanvas}. Instead of an
 * affine pan/zoom viewport, every asset is placed in the hyperbolic plane and
 * projected through a Möbius "camera". Dragging applies a hyperbolic
 * translation (the whole plane glides, things grow as they near the centre and
 * shrink toward the rim); the scroll wheel zooms toward the cursor. Edges are
 * drawn as true geodesics. Reuses the existing {@link Thumbnail} for content.
 *
 * Inspired by https://uonr.github.io/poincake/.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Asset, type Variant } from '../../hooks/useSpaceWebSocket';
import { Thumbnail } from '../Thumbnail';
import { applyLayout } from '../AssetCanvas/layouts';
import type { AssetNodeType } from '../AssetCanvas/AssetNode';
import { formatMediaKind } from '../../mediaKind';
import {
  type Complex,
  type Mobius,
  IDENTITY,
  C,
  apply,
  compose,
  dragTransform,
  translation,
  invert,
  clampToDisk,
  geodesicPoints,
  tileScale,
  layoutToDisk,
  cscale,
  cabs,
} from './hyperbolic';
import styles from './HyperbolicCanvas.module.css';

export interface HyperbolicCanvasProps {
  spaceId?: string;
  assets: Asset[];
  variants: Variant[];
  jobs?: Map<string, { assetId?: string; status: string }>;
  onAssetClick?: (asset: Asset) => void;
}

/** Base on-screen size of a node sitting at the disk centre (px). */
const NODE_BASE = 132;
/** Padding inside the viewport so the disk doesn't touch the edges. */
const DISK_PADDING = 0.94;
/** Hide nodes whose conformal scale falls below this (they're near the rim). */
const MIN_VISIBLE_SCALE = 0.02;
/** Pointer travel (px) beyond which a press is a drag, not a click. */
const CLICK_THRESHOLD = 5;

interface Viewport {
  width: number;
  height: number;
  cx: number;
  cy: number;
  r: number;
}

export function HyperbolicCanvas({
  spaceId,
  assets,
  variants,
  jobs,
  onAssetClick,
}: HyperbolicCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0, cx: 0, cy: 0, r: 1 });
  const [cam, setCam] = useState<Mobius>(IDENTITY);

  // Drag bookkeeping (refs so pointer handlers stay stable + don't re-render).
  const dragRef = useRef<{ startView: Complex; startCam: Mobius } | null>(null);
  const movedRef = useRef(false);

  // Resolve the variant shown for an asset (active, else first for the asset).
  const variantForAsset = useCallback(
    (asset: Asset): Variant | null => {
      if (asset.active_variant_id) {
        return variants.find((v) => v.id === asset.active_variant_id) ?? null;
      }
      return variants.find((v) => v.asset_id === asset.id) ?? null;
    },
    [variants]
  );

  const isGenerating = useCallback(
    (assetId: string): boolean => {
      if (!jobs) return false;
      for (const job of jobs.values()) {
        if (job.assetId === assetId && (job.status === 'pending' || job.status === 'processing')) {
          return true;
        }
      }
      return false;
    },
    [jobs]
  );

  // Base positions: run the existing dagre layout, then map into the disk.
  const { diskPositions, edges } = useMemo(() => {
    const nodes: AssetNodeType[] = assets.map((asset) => ({
      id: asset.id,
      type: 'asset' as const,
      position: { x: 0, y: 0 },
      data: { asset, variant: variantForAsset(asset), spaceId },
    }));

    const parentEdges = assets
      .filter((a) => a.parent_asset_id)
      .map((a) => ({ id: `${a.parent_asset_id}-${a.id}`, source: a.parent_asset_id!, target: a.id }));

    const { nodes: laidOut } = applyLayout(nodes, parentEdges, {
      algorithm: 'dagre',
      direction: 'TB',
      nodeDimensions: new Map(),
      defaultDimensions: { width: 160, height: 190 },
    });

    const positions = laidOut.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
    return { diskPositions: layoutToDisk(positions), edges: parentEdges };
  }, [assets, variantForAsset, spaceId]);

  // Track viewport size and compute the disk geometry.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setViewport({
        width: rect.width,
        height: rect.height,
        cx: rect.width / 2,
        cy: rect.height / 2,
        r: (Math.min(rect.width, rect.height) / 2) * DISK_PADDING,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Convert a client pointer position to a disk coordinate.
  const toDisk = useCallback(
    (clientX: number, clientY: number): Complex => {
      const el = stageRef.current;
      if (!el) return C(0, 0);
      const rect = el.getBoundingClientRect();
      return clampToDisk(
        C((clientX - rect.left - viewport.cx) / viewport.r, (clientY - rect.top - viewport.cy) / viewport.r)
      );
    },
    [viewport]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragRef.current = { startView: toDisk(e.clientX, e.clientY), startCam: cam };
      movedRef.current = false;
    },
    [cam, toDisk]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const now = toDisk(e.clientX, e.clientY);
      if (cabs({ x: now.x - drag.startView.x, y: now.y - drag.startView.y }) * viewport.r > CLICK_THRESHOLD) {
        movedRef.current = true;
      }
      // Recompute from the drag start so the grabbed point tracks the cursor.
      setCam(compose(dragTransform(drag.startView, now), drag.startCam));
    },
    [toDisk, viewport.r]
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Wheel = zoom toward the cursor (a hyperbolic translation sliding the point
  // under the cursor toward/away from the centre). Bound natively for passive:false.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toDisk(e.clientX, e.clientY);
      const k = Math.exp(e.deltaY * 0.0015); // up → k<1 → zoom in
      const target = clampToDisk(cscale(p, k));
      const t = compose(translation(target), invert(translation(p)));
      setCam((prev) => compose(t, prev));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [toDisk]);

  const recenter = useCallback(() => setCam(IDENTITY), []);

  // Project every asset and build geodesic edge paths in view space.
  const projected = useMemo(() => {
    return assets
      .map((asset) => {
        const world = diskPositions.get(asset.id);
        if (!world) return null;
        const v = apply(cam, world);
        const scale = tileScale(v);
        if (scale < MIN_VISIBLE_SCALE) return null;
        return {
          asset,
          variant: variantForAsset(asset),
          generating: isGenerating(asset.id),
          left: viewport.cx + v.x * viewport.r,
          top: viewport.cy + v.y * viewport.r,
          scale,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
      // Draw rim-ward (small) nodes first so central ones sit on top.
      .sort((a, b) => a.scale - b.scale);
  }, [assets, diskPositions, cam, viewport, variantForAsset, isGenerating]);

  const edgePaths = useMemo(() => {
    return edges
      .map((edge) => {
        const wp = diskPositions.get(edge.source);
        const wc = diskPositions.get(edge.target);
        if (!wp || !wc) return null;
        const pts = geodesicPoints(apply(cam, wp), apply(cam, wc));
        const points = pts
          .map((pt) => `${viewport.cx + pt.x * viewport.r},${viewport.cy + pt.y * viewport.r}`)
          .join(' ');
        return { id: edge.id, points };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
  }, [edges, diskPositions, cam, viewport]);

  if (assets.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon}>🪩</span>
        <p className={styles.emptyText}>No assets yet</p>
      </div>
    );
  }

  return (
    <div className={styles.canvas}>
      <div
        ref={stageRef}
        className={styles.stage}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={recenter}
      >
        {/* Disk boundary + geodesic edges */}
        <svg className={styles.overlay} width={viewport.width} height={viewport.height}>
          <circle
            cx={viewport.cx}
            cy={viewport.cy}
            r={viewport.r}
            className={styles.diskBorder}
          />
          {edgePaths.map((e) => (
            <polyline key={e.id} points={e.points} className={styles.edge} />
          ))}
        </svg>

        {/* Asset nodes */}
        {projected.map((p) => (
          <div
            key={p.asset.id}
            className={styles.node}
            style={{
              left: p.left,
              top: p.top,
              width: NODE_BASE,
              transform: `translate(-50%, -50%) scale(${p.scale})`,
              opacity: Math.min(1, 0.25 + p.scale),
              zIndex: Math.round(p.scale * 1000),
            }}
            onClick={() => {
              if (movedRef.current) return;
              onAssetClick?.(p.asset);
            }}
          >
            <div className={`${styles.thumb} ${p.generating ? styles.generating : ''}`}>
              <Thumbnail variant={p.variant} size="fill" spaceId={spaceId} className={styles.media} />
            </div>
            <div className={styles.label}>
              <span className={styles.name}>{p.asset.name}</span>
              <span className={styles.type}>
                {p.asset.type} / {formatMediaKind(p.asset.media_kind)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.hint}>Drag to pan · scroll to zoom · double-click to recenter</div>
    </div>
  );
}
