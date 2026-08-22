import { describe, expect, it } from 'vitest';

import {
  BLADES,
  GRIPS,
  GUARDS,
  POMMELS,
  rollSword,
  swordPartsKey,
  swordStats,
  type SwordParts,
} from './sword.ts';

const ALL: SwordParts = {
  blade: 'broad',
  guard: 'disc',
  grip: 'long',
  pommel: 'diamond',
  gem: true,
};

describe('rollSword', () => {
  it('is deterministic in seed and options', () => {
    const a = rollSword(7, { materialRank: 2, rarityRank: 1 });
    const b = rollSword(7, { materialRank: 2, rarityRank: 1 });
    expect(a).toEqual(b);
  });

  it('pins the draw order (changing it would re-roll every existing sword)', () => {
    expect(rollSword(1, { materialRank: 0, rarityRank: 0 }).parts).toEqual({
      blade: 'straight',
      guard: 'crescent',
      grip: 'wrapped',
      pommel: 'diamond',
      gem: false,
    });
    expect(rollSword(42, { materialRank: 0, rarityRank: 2 }).parts).toEqual({
      blade: 'leaf',
      guard: 'wings',
      grip: 'plain',
      pommel: 'diamond',
      gem: true,
    });
  });

  it('reaches every part across seeds', () => {
    const seen = { blade: new Set(), guard: new Set(), grip: new Set(), pommel: new Set() };
    for (let seed = 0; seed < 200; seed++) {
      const { parts } = rollSword(seed, { materialRank: 0, rarityRank: 0 });
      seen.blade.add(parts.blade);
      seen.guard.add(parts.guard);
      seen.grip.add(parts.grip);
      seen.pommel.add(parts.pommel);
    }
    expect(seen.blade.size).toBe(BLADES.length);
    expect(seen.guard.size).toBe(GUARDS.length);
    expect(seen.grip.size).toBe(GRIPS.length);
    expect(seen.pommel.size).toBe(POMMELS.length);
  });

  it('sets a gem only above common', () => {
    expect(rollSword(3, { materialRank: 0, rarityRank: 0 }).parts.gem).toBe(false);
    expect(rollSword(3, { materialRank: 0, rarityRank: 1 }).parts.gem).toBe(true);
  });
});

describe('swordStats', () => {
  it('sums the part contributions', () => {
    expect(swordStats(ALL, 0)).toEqual({ attack: 16, speed: -3, defence: 3, strength: 3 });
  });

  it('scales attack/strength/defence by material rank but never speed', () => {
    expect(swordStats(ALL, 2)).toEqual({ attack: 27, speed: -3, defence: 5, strength: 5 });
  });

  it('drops zero stats from the key-less summary but keeps them in stats', () => {
    const s = swordStats(
      { blade: 'straight', guard: 'bar', grip: 'plain', pommel: 'round', gem: false },
      0,
    );
    expect(s).toEqual({ attack: 10, speed: 0, defence: 1 });
  });
});

it('swordPartsKey is stable and distinct', () => {
  expect(swordPartsKey(ALL)).toBe('broad/disc/long/diamond/gem');
  expect(swordPartsKey({ ...ALL, gem: false })).toBe('broad/disc/long/diamond');
});
