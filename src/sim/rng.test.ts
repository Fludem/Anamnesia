import { describe, expect, it } from 'vitest';
import { nextFloat, nextInt, nextU32, seedRng, type RngState } from './rng.ts';

function take(s: RngState, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const [u, next] = nextU32(s);
    out.push(u);
    s = next;
  }
  return out;
}

describe('rng', () => {
  it('is deterministic for a fixed seed', () => {
    expect(take(seedRng(42), 5)).toEqual(take(seedRng(42), 5));
    // Pin the sequence: if this changes, every save's future diverges. Update deliberately.
    expect(take(seedRng(42), 5)).toMatchInlineSnapshot(`
      [
        3681621431,
        4250209148,
        940641817,
        1738069921,
        2628877060,
      ]
    `);
  });

  it('diverges for different seeds', () => {
    expect(take(seedRng(1), 5)).not.toEqual(take(seedRng(2), 5));
  });

  it('does not mutate its input state', () => {
    const s = seedRng(7);
    const copy = [...s];
    nextU32(s);
    expect([...s]).toEqual(copy);
  });

  it('round-trips through JSON', () => {
    const s = seedRng(99);
    const back = JSON.parse(JSON.stringify(s)) as RngState;
    expect(take(back, 3)).toEqual(take(s, 3));
  });

  it('produces uint32s, floats in [0,1) and ints in range', () => {
    let s = seedRng(3);
    for (let i = 0; i < 1000; i++) {
      const [u, s1] = nextU32(s);
      expect(Number.isInteger(u) && u >= 0 && u <= 0xffffffff).toBe(true);
      const [f, s2] = nextFloat(s1);
      expect(f >= 0 && f < 1).toBe(true);
      const [k, s3] = nextInt(s2, -3, 3);
      expect(k >= -3 && k <= 3 && Number.isInteger(k)).toBe(true);
      s = s3;
    }
    expect(() => nextInt(s, 5, 4)).toThrow(RangeError);
  });
});
