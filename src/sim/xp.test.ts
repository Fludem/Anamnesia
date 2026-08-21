import { describe, expect, it } from 'vitest';
import { DEFAULT_XP_CURVE, runescapeCurve, tableCurve } from './xp.ts';

describe('runescapeCurve', () => {
  const curve = runescapeCurve();

  it('matches the published RuneScape table at known levels', () => {
    expect(curve.xpForLevel(1)).toBe(0);
    expect(curve.xpForLevel(2)).toBe(83);
    expect(curve.xpForLevel(10)).toBe(1_154);
    expect(curve.xpForLevel(50)).toBe(101_333);
    expect(curve.xpForLevel(92)).toBe(6_517_253);
    expect(curve.xpForLevel(99)).toBe(13_034_431);
    expect(curve.maxLevel).toBe(99);
  });

  it('level lookup is exact at every boundary', () => {
    for (let level = 1; level <= 99; level++) {
      const xp = curve.xpForLevel(level);
      expect(curve.levelForXp(xp)).toBe(level);
      if (level > 1) expect(curve.levelForXp(xp - 1)).toBe(level - 1);
    }
    expect(curve.levelForXp(0)).toBe(1);
    expect(curve.levelForXp(82)).toBe(1);
    expect(curve.levelForXp(83)).toBe(2);
    expect(curve.levelForXp(83.5)).toBe(2);
    expect(curve.levelForXp(1e12)).toBe(99);
  });

  it('clamps garbage to level 1', () => {
    expect(curve.levelForXp(-5)).toBe(1);
    expect(curve.levelForXp(Number.NaN)).toBe(1);
  });

  it('rejects levels outside the table', () => {
    expect(() => curve.xpForLevel(0)).toThrow(RangeError);
    expect(() => curve.xpForLevel(100)).toThrow(RangeError);
    expect(() => curve.xpForLevel(1.5)).toThrow(RangeError);
  });

  it('is the default curve', () => {
    expect(DEFAULT_XP_CURVE.xpForLevel(99)).toBe(curve.xpForLevel(99));
  });

  it('supports a different max level', () => {
    const c = runescapeCurve(120);
    expect(c.maxLevel).toBe(120);
    expect(c.xpForLevel(99)).toBe(13_034_431);
    expect(c.xpForLevel(120)).toBe(104_273_167);
  });
});

describe('tableCurve (a swapped-in curve)', () => {
  it('a linear 100-xp-per-level curve works through the same interface', () => {
    const linear = tableCurve([0, 0, 100, 200, 300, 400], 5);
    expect(linear.xpForLevel(3)).toBe(200);
    expect(linear.levelForXp(199)).toBe(2);
    expect(linear.levelForXp(200)).toBe(3);
    expect(linear.levelForXp(9_999)).toBe(5);
  });

  it('rejects malformed tables', () => {
    expect(() => tableCurve([0, 0, 100], 5)).toThrow(RangeError);
    expect(() => tableCurve([0, 5, 100], 2)).toThrow(RangeError);
    expect(() => tableCurve([0, 0, 100, 100], 3)).toThrow(RangeError);
  });
});
