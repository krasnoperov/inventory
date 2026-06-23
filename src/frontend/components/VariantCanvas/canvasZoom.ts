import type { Variant } from '../../space/protocol';

/** Lower bound — preserves the canvas's prior fixed cap for dimensionless variants. */
export const MIN_NATIVE_MAX_ZOOM = 2;
/** Upper bound — keeps the canvas usable even for very tall sources. */
export const MAX_NATIVE_MAX_ZOOM = 8;
/** Headroom past native 1:1 so the user can push a bit further to inspect detail. */
export const NATIVE_ZOOM_HEADROOM = 1.5;

/**
 * Compute the canvas `maxZoom` so each image can be zoomed to (and a bit past)
 * its native pixel resolution.
 *
 * A non-active node renders its image at `thumbHeight` tall, so the canvas zoom
 * needed to reach native pixels is `media_height / thumbHeight`. We take the
 * largest such ratio across all variants (the most demanding image), apply
 * {@link NATIVE_ZOOM_HEADROOM}, and clamp to
 * [{@link MIN_NATIVE_MAX_ZOOM}, {@link MAX_NATIVE_MAX_ZOOM}]. Variants without a
 * stored `media_height` (e.g. pending/failed) don't raise the cap, so the floor
 * applies when no dimensions are known.
 */
export function computeNativeMaxZoom(variants: Variant[], thumbHeight: number): number {
  let nativeZoom = 0;
  for (const variant of variants) {
    const height = variant.media_height;
    if (height && height > 0) {
      nativeZoom = Math.max(nativeZoom, height / thumbHeight);
    }
  }
  return Math.min(MAX_NATIVE_MAX_ZOOM, Math.max(MIN_NATIVE_MAX_ZOOM, nativeZoom * NATIVE_ZOOM_HEADROOM));
}
