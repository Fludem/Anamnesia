/**
 * XP curve and level lookup. The curve is a single swappable value: everything that needs a
 * level goes through `XpCurve`, so changing the progression is a one-line change in the
 * `SimContext`, never a code hunt.
 */
export interface XpCurve {
  readonly maxLevel: number;
  /** Total XP at which `level` is reached. `xpForLevel(1) === 0`. */
  xpForLevel(level: number): number;
  /** Level for a total XP amount, clamped to `[1, maxLevel]`. */
  levelForXp(xp: number): number;
}

/**
 * RuneScape's curve: the XP gap between levels grows by ~10% per level, reaching 13,034,431 at 99.
 * Precomputed into a table so level lookups are a binary search, not a summation per tick.
 */
export function runescapeCurve(maxLevel = 99): XpCurve {
  if (!Number.isInteger(maxLevel) || maxLevel < 1) throw new RangeError('maxLevel must be >= 1');
  const table: number[] = [0, 0]; // index = level; level 0 unused, level 1 = 0 xp
  let points = 0;
  for (let level = 1; level < maxLevel; level++) {
    points += Math.floor(level + 300 * Math.pow(2, level / 7));
    table.push(Math.floor(points / 4));
  }
  return tableCurve(table, maxLevel);
}

/** Build a curve from an explicit table (`xp[level]`, index 0 ignored, index 1 must be 0). */
export function tableCurve(table: readonly number[], maxLevel: number): XpCurve {
  if (table.length !== maxLevel + 1 || table[1] !== 0) {
    throw new RangeError('xp table must have maxLevel + 1 entries with table[1] === 0');
  }
  for (let l = 2; l <= maxLevel; l++) {
    if ((table[l] ?? 0) <= (table[l - 1] ?? 0)) throw new RangeError('xp table must be increasing');
  }
  return {
    maxLevel,
    xpForLevel(level) {
      if (!Number.isInteger(level) || level < 1 || level > maxLevel) {
        throw new RangeError(`level ${String(level)} outside [1, ${String(maxLevel)}]`);
      }
      return table[level] ?? 0;
    },
    levelForXp(xp) {
      if (!(xp >= 0)) return 1; // NaN and negatives clamp to 1
      let lo = 1;
      let hi = maxLevel;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((table[mid] ?? Infinity) <= xp) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
  };
}

export const DEFAULT_XP_CURVE: XpCurve = runescapeCurve();
