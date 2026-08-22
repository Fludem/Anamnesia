/**
 * Procedural swords: a seed picks one of each component; the same components decide the
 * stats, so what a sword looks like is what it does. Geometry lives in
 * src/icons/procedural/sword.ts and is keyed by these part names.
 */

import type { ItemStats } from '../content/schema.ts';
import { nextInt, seedRng, type RngState } from '../rng.ts';

export const BLADES = ['straight', 'broad', 'curved', 'rapier', 'leaf'] as const;
export const GUARDS = ['bar', 'crescent', 'disc', 'wings'] as const;
export const GRIPS = ['plain', 'wrapped', 'long'] as const;
export const POMMELS = ['round', 'diamond', 'flat'] as const;

export type Blade = (typeof BLADES)[number];
export type Guard = (typeof GUARDS)[number];
export type Grip = (typeof GRIPS)[number];
export type Pommel = (typeof POMMELS)[number];

export interface SwordParts {
  blade: Blade;
  guard: Guard;
  grip: Grip;
  pommel: Pommel;
  /** A gem is set in the guard for rarities above common. */
  gem: boolean;
}

export interface SwordRoll {
  parts: SwordParts;
  stats: ItemStats;
  rng: RngState;
}

const BLADE_STATS: Record<Blade, ItemStats> = {
  straight: { attack: 10, speed: 0 },
  broad: { attack: 14, speed: -2 },
  curved: { attack: 11, speed: 1 },
  rapier: { attack: 8, speed: 3 },
  leaf: { attack: 12, speed: 0 },
};
const GUARD_STATS: Record<Guard, ItemStats> = {
  bar: { defence: 1 },
  crescent: { defence: 2 },
  disc: { defence: 3 },
  wings: { defence: 2 },
};
const GRIP_STATS: Record<Grip, ItemStats> = {
  plain: {},
  wrapped: { strength: 1 },
  long: { strength: 2, speed: -1 },
};
const POMMEL_STATS: Record<Pommel, ItemStats> = {
  round: {},
  diamond: { strength: 1 },
  flat: { speed: 1 },
};
const GEM_STATS: ItemStats = { attack: 2 };

/** Per material rank (0 = first tier): attack/strength/defence scale by 1 + 0.35·rank. */
export const MATERIAL_SCALE_PER_RANK = 0.35;

export interface SwordRollOptions {
  /** Index of the material in the weapon tier ladder; 0 for the first tier. */
  materialRank: number;
  /** Rank from the rarity def; ≥ 1 sets a gem. */
  rarityRank: number;
}

function sum(...parts: ItemStats[]): ItemStats {
  const out: ItemStats = {};
  for (const p of parts) {
    for (const [k, v] of Object.entries(p) as [keyof ItemStats, number][]) {
      out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

/** Deterministic in (seed, options). Draw order: blade, guard, grip, pommel. */
export function rollSword(seed: number, opts: SwordRollOptions): SwordRoll {
  let rng = seedRng(seed);
  const pick = <T>(list: readonly T[]): T => {
    const [i, next] = nextInt(rng, 0, list.length - 1);
    rng = next;
    return list[i] as T;
  };
  const parts: SwordParts = {
    blade: pick(BLADES),
    guard: pick(GUARDS),
    grip: pick(GRIPS),
    pommel: pick(POMMELS),
    gem: opts.rarityRank >= 1,
  };
  return { parts, stats: swordStats(parts, opts.materialRank), rng };
}

export function swordStats(parts: SwordParts, materialRank: number): ItemStats {
  const base = sum(
    BLADE_STATS[parts.blade],
    GUARD_STATS[parts.guard],
    GRIP_STATS[parts.grip],
    POMMEL_STATS[parts.pommel],
    parts.gem ? GEM_STATS : {},
  );
  const scale = 1 + MATERIAL_SCALE_PER_RANK * Math.max(0, materialRank);
  const out: ItemStats = {};
  for (const [k, v] of Object.entries(base) as [keyof ItemStats, number][]) {
    out[k] = k === 'speed' ? v : Math.round(v * scale);
  }
  return out;
}

/** Stable id for a part combination (cache keys, tests). */
export function swordPartsKey(p: SwordParts): string {
  return `${p.blade}/${p.guard}/${p.grip}/${p.pommel}${p.gem ? '/gem' : ''}`;
}
