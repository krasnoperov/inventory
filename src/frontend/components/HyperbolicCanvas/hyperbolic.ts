/**
 * Hyperbolic geometry helpers for the Poincaré-disk canvas.
 *
 * The Poincaré disk model represents the hyperbolic plane as the open unit
 * disk |z| < 1. Its orientation-preserving isometries are the Möbius maps
 *
 *     f(z) = (a·z + b) / (b̄·z + ā),   with |a|² − |b|² = 1
 *
 * which form the group SU(1,1). We represent the "camera" (world → view
 * transform) by the pair (a, b); composition is just matrix multiplication,
 * so panning/zooming never accumulates error that pushes points out of the
 * disk. See uonr.github.io/poincake for the visual reference this mirrors.
 */

/** A complex number, `x` = real part, `y` = imaginary part. */
export interface Complex {
  x: number;
  y: number;
}

export const C = (x: number, y: number): Complex => ({ x, y });

export const cadd = (a: Complex, b: Complex): Complex => ({ x: a.x + b.x, y: a.y + b.y });
export const cconj = (a: Complex): Complex => ({ x: a.x, y: -a.y });
export const cabs2 = (a: Complex): number => a.x * a.x + a.y * a.y;
export const cabs = (a: Complex): number => Math.hypot(a.x, a.y);

export const cmul = (a: Complex, b: Complex): Complex => ({
  x: a.x * b.x - a.y * b.y,
  y: a.x * b.y + a.y * b.x,
});

export const cscale = (a: Complex, s: number): Complex => ({ x: a.x * s, y: a.y * s });

export const cdiv = (a: Complex, b: Complex): Complex => {
  const d = cabs2(b);
  return { x: (a.x * b.x + a.y * b.y) / d, y: (a.y * b.x - a.x * b.y) / d };
};

/**
 * An SU(1,1) Möbius transform of the disk, stored as the (a, b) pair of
 * f(z) = (a·z + b) / (b̄·z + ā). The matrix is [[a, b], [b̄, ā]].
 */
export interface Mobius {
  a: Complex;
  b: Complex;
}

export const IDENTITY: Mobius = { a: C(1, 0), b: C(0, 0) };

/** Apply a Möbius transform to a disk point. */
export function apply(m: Mobius, z: Complex): Complex {
  const num = cadd(cmul(m.a, z), m.b);
  const den = cadd(cmul(cconj(m.b), z), cconj(m.a));
  return cdiv(num, den);
}

/** Compose two transforms: `compose(p, q)` applies q first, then p. */
export function compose(p: Mobius, q: Mobius): Mobius {
  // [[pa, pb],[p̄b, p̄a]] · [[qa, qb],[q̄b, q̄a]]
  return {
    a: cadd(cmul(p.a, q.a), cmul(p.b, cconj(q.b))),
    b: cadd(cmul(p.a, q.b), cmul(p.b, cconj(q.a))),
  };
}

/** Invert an SU(1,1) transform (determinant is 1, so this is exact). */
export function invert(m: Mobius): Mobius {
  return { a: cconj(m.a), b: cscale(m.b, -1) };
}

/**
 * Pure hyperbolic translation that sends the origin to `c` (|c| < 1).
 * Its inverse sends `c` back to the origin.
 */
export function translation(c: Complex): Mobius {
  const n = Math.sqrt(Math.max(1e-9, 1 - cabs2(c)));
  return { a: C(1 / n, 0), b: cscale(c, 1 / n) };
}

/**
 * Build the transform that drags view-point `from` to view-point `to`
 * (both in disk coordinates). Used for panning.
 */
export function dragTransform(from: Complex, to: Complex): Mobius {
  // send `from` → origin → `to`
  return compose(translation(to), invert(translation(from)));
}

/** Clamp a disk point safely inside the unit circle. */
export function clampToDisk(z: Complex, max = 0.9995): Complex {
  const r = cabs(z);
  if (r <= max) return z;
  return cscale(z, max / r);
}

/**
 * Sample the geodesic between two disk points as a polyline of `segments`+1
 * points. Geodesics are circular arcs orthogonal to the boundary; we get the
 * exact curve by translating `z1` to the origin (where the geodesic is a
 * straight radius), sampling, and mapping back.
 */
export function geodesicPoints(z1: Complex, z2: Complex, segments = 24): Complex[] {
  const toOrigin = invert(translation(z1)); // sends z1 → 0
  const back = translation(z1); // sends 0 → z1
  const z2p = apply(toOrigin, z2); // z2 relative to z1, lies on a radius
  const pts: Complex[] = [];
  for (let k = 0; k <= segments; k++) {
    const t = k / segments;
    pts.push(apply(back, cscale(z2p, t)));
  }
  return pts;
}

/**
 * Conformal scale factor for a tile of fixed hyperbolic size sitting at view
 * point `v`. Equals (1 − |v|²); shapes shrink toward the boundary, giving the
 * Escher "Circle Limit" look. Returned value is in [0, 1].
 */
export function tileScale(v: Complex): number {
  return Math.max(0, 1 - cabs2(v));
}

/**
 * Map an arbitrary 2D layout (e.g. dagre output) into disk coordinates.
 * Positions are centred, normalised, then pushed out to hyperbolic radius
 * ρ = normalised·spread and placed at Euclidean modulus tanh(ρ/2).
 */
export function layoutToDisk(
  positions: Array<{ id: string; x: number; y: number }>,
  spread = 2.5
): Map<string, Complex> {
  const result = new Map<string, Complex>();
  if (positions.length === 0) return result;

  const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
  const cy = positions.reduce((s, p) => s + p.y, 0) / positions.length;

  let maxR = 0;
  for (const p of positions) {
    maxR = Math.max(maxR, Math.hypot(p.x - cx, p.y - cy));
  }
  if (maxR < 1e-6) maxR = 1;

  for (const p of positions) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6) {
      result.set(p.id, C(0, 0));
      continue;
    }
    const rho = (dist / maxR) * spread;
    const modulus = Math.tanh(rho / 2);
    result.set(p.id, C((dx / dist) * modulus, (dy / dist) * modulus));
  }
  return result;
}
