/**
 * Deterministic stylized waveform bar heights (each in [0.12, 1]) derived from
 * a seed string. The same seed always yields the same silhouette, so every clip
 * keeps a stable visual fingerprint across renders.
 *
 * Heights come from a small sum of sine components (with seed-driven
 * frequencies, phases, and amplitudes) plus light per-bar jitter — this reads
 * as audio (flowing peaks and valleys) rather than random noise. It is an
 * intentional decorative-but-functional scrubber track, not decoded amplitude.
 */
export function waveformBars(seed: string, count = 40): number[] {
  // FNV-1a hash of the seed → PRNG state.
  let state = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }

  // mulberry32 PRNG: deterministic, well-distributed.
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Three sine components of increasing frequency and decreasing amplitude.
  const components = Array.from({ length: 3 }, (_, k) => ({
    freq: 0.6 + next() * 2.4 + k, // cycles across the full width
    phase: next() * Math.PI * 2,
    amp: 1 / (k + 1),
  }));
  const ampSum = components.reduce((sum, c) => sum + c.amp, 0);

  return Array.from({ length: count }, (_, i) => {
    const t = count > 1 ? i / (count - 1) : 0;
    let v = 0;
    for (const c of components) {
      v += c.amp * Math.sin(c.freq * Math.PI * 2 * t + c.phase);
    }
    // abs() turns zero-crossings into thin bars and peaks into tall ones — the
    // classic waveform silhouette. Keep a floor so quiet bars stay visible.
    const height = 0.15 + Math.abs(v / ampSum) * 0.85;
    const jittered = height * (0.9 + next() * 0.2);
    return Math.min(1, Math.max(0.12, jittered));
  });
}
