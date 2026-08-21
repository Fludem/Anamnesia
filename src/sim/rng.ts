/**
 * sfc32 — a small, fast, well-tested 128-bit-state PRNG (passes PractRand).
 * Pure: every call returns the next value and a new state. The state lives in the save so
 * a given save + tick count always produces byte-identical results.
 */
export type RngState = readonly [number, number, number, number];

/** Derive a full 128-bit state from a 32-bit seed via splitmix-style mixing, then warm up. */
export function seedRng(seed: number): RngState {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  const mix = (): number => {
    h = (h + 0x9e3779b9) >>> 0;
    let z = h;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  let state: RngState = [mix(), mix(), mix(), mix()];
  // Discard the first few outputs so poor seeds don't correlate.
  for (let i = 0; i < 12; i++) state = nextU32(state)[1];
  return state;
}

/** Next uniform uint32 in [0, 2^32). */
export function nextU32(s: RngState): [number, RngState] {
  const [a, b, c, d0] = s;
  const t = (((a + b) >>> 0) + d0) >>> 0;
  const d = (d0 + 1) >>> 0;
  const na = b ^ (b >>> 9);
  const nb = (c + (c << 3)) >>> 0;
  const nc = (((c << 21) | (c >>> 11)) + t) >>> 0;
  return [t, [na >>> 0, nb, nc, d]];
}

/** Next float in [0, 1) with 32 bits of precision. */
export function nextFloat(s: RngState): [number, RngState] {
  const [u, next] = nextU32(s);
  return [u / 4294967296, next];
}

/** Next integer in [min, max] inclusive. */
export function nextInt(s: RngState, min: number, max: number): [number, RngState] {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new RangeError(`nextInt: invalid range [${String(min)}, ${String(max)}]`);
  }
  const [f, next] = nextFloat(s);
  return [min + Math.floor(f * (max - min + 1)), next];
}
