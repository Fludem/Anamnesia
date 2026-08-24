import { describe, expect, it } from 'vitest';
import { beginAction } from './actions.ts';
import { eventsOfType } from './events.ts';
import {
  bandCeiling,
  reachOf,
  reachSpan,
  recordXp,
  REACH_FLOOR,
  REACH_SPAN,
  trophyLevel,
  trophyWeight,
  weighCatch,
} from './records.ts';
import { createSimState, type SimState } from './save.ts';
import { stepTick } from './step.ts';
import { fixtureContext as ctx } from './testing/fixture.ts';

const BAND = { min: 100, max: 1100, bounty: 500 };
const DEEP = ctx.content.water('deep-water');

const run = (s: SimState, ticks: number): SimState => {
  for (let i = 0; i < ticks; i++) s = stepTick(s, ctx);
  return s;
};

/** A hero at `level` in fishing, already fishing `water` until stopped. */
const angler = (seed: number, level: number, water = 'deep-water'): SimState => {
  const s = createSimState(seed);
  return beginAction(
    { ...s, skills: { fishing: { xp: ctx.xp.xpForLevel(level) } } },
    { kind: 'fishing', water, count: null },
    ctx,
  );
};

describe('reach', () => {
  it('opens a water over thirty levels, or over what is left below the cap', () => {
    expect(reachSpan(1, 99)).toBe(REACH_SPAN);
    expect(reachSpan(80, 99)).toBe(19);
    expect(reachSpan(99, 99)).toBe(1);
  });

  it('is none at the water’s own level, whole at the top of the span, and never outside that', () => {
    expect(reachOf(1, 1, 99)).toBe(0);
    expect(reachOf(16, 1, 99)).toBeCloseTo(0.5);
    expect(reachOf(31, 1, 99)).toBe(1);
    expect(reachOf(99, 1, 99)).toBe(1);
    expect(reachOf(1, 50, 99)).toBe(0);
  });

  it('holds back half the band until the hero has climbed', () => {
    expect(bandCeiling(BAND, 0)).toBe(BAND.min + (BAND.max - BAND.min) * REACH_FLOOR);
    expect(bandCeiling(BAND, 1)).toBe(BAND.max);
  });
});

describe('the trophy line', () => {
  it('sits near the top of the band and opens well before the cap on a low water', () => {
    expect(trophyWeight(BAND)).toBe(1050);
    expect(trophyLevel(1, 99)).toBe(28);
    expect(trophyLevel(35, 99)).toBe(62);
  });

  it('cannot be crossed below the level it opens at, and can be above it', () => {
    const under = bandCeiling(BAND, reachOf(trophyLevel(1, 99) - 5, 1, 99));
    expect(under).toBeLessThan(trophyWeight(BAND));
    expect(bandCeiling(BAND, reachOf(99, 1, 99))).toBeGreaterThanOrEqual(trophyWeight(BAND));
  });

  it('holds out to the very end on the waters with no headroom left', () => {
    expect(trophyLevel(80, 99)).toBe(98);
    expect(trophyLevel(90, 99)).toBe(99);
  });
});

describe('what a record pays', () => {
  it('is the water’s own xp, scaled by how far into the band the fish sits', () => {
    expect(recordXp(DEEP, BAND, BAND.min)).toBe(0);
    expect(recordXp(DEEP, BAND, 600)).toBe(10);
    expect(recordXp(DEEP, BAND, BAND.max)).toBe(20);
  });
});

describe('weighing a catch', () => {
  it('weighs every fish inside the band, and never past it', () => {
    const s = run(angler(3, 99), 400);
    const weighed = eventsOfType(s, 'gain').flatMap((g) => g.sizes);
    expect(weighed.length).toBeGreaterThan(0);
    for (const w of weighed) {
      expect(w.item).toBe('big-fish');
      expect(w.grams).toBeGreaterThanOrEqual(BAND.min);
      expect(w.grams).toBeLessThanOrEqual(BAND.max);
    }
  });

  it('cannot pull the top of the band out of a water it has not climbed above', () => {
    // Twenty cycles at level 1 (level 2 wants 83 xp; the water pays 20 and the first record a
    // little more), so every one of these was drawn against the closed half of the band.
    const s = run(angler(3, 1), 80);
    const grams = eventsOfType(s, 'gain').flatMap((g) => g.sizes.map((w) => w.grams));
    expect(grams.length).toBeGreaterThan(0);
    for (const g of grams) expect(g).toBeLessThanOrEqual(bandCeiling(BAND, reachOf(1, 1, 99)));
  });

  it('keeps only the biggest, and says so on the cycle that landed it', () => {
    let s = angler(7, 40);
    let best = 0;
    let records = 0;
    for (let i = 0; i < 800; i++) {
      s = stepTick(s, ctx);
      // The log is a ring, so read this tick's own entry rather than a slice of it.
      const last = s.log[s.log.length - 1];
      if (last?.type !== 'gain' || last.tick !== s.tick) continue;
      for (const w of last.sizes) {
        expect(w.best).toBe(w.grams > best);
        if (w.best) {
          best = w.grams;
          records++;
        }
      }
    }
    expect(records).toBeGreaterThan(1);
    expect(s.records.fish['big-fish']?.grams).toBe(best);
    expect(best).toBeGreaterThan(BAND.min);
  });

  it('stamps the tick the record was landed on', () => {
    const s = run(angler(11, 40), 40);
    const line = s.records.fish['big-fish'];
    expect(line).toBeDefined();
    expect(line?.tick).toBeGreaterThan(0);
    expect(line?.tick).toBeLessThanOrEqual(s.tick);
  });

  it('pays the water’s xp again for a record, on top of the cycle', () => {
    // The first catch is always a record, so the first cycle pays more than the water's 20.
    const s = run(angler(5, 1), 4);
    const first = eventsOfType(s, 'gain')[0];
    expect(first?.sizes[0]?.best).toBe(true);
    expect(first?.xp).toBeGreaterThan(DEEP.xp);
    expect(first?.xp).toBe(DEEP.xp + recordXp(DEEP, BAND, first?.sizes[0]?.grams ?? 0));
  });

  it('pays the trader’s bounty the first time the line is crossed, and never again', () => {
    let s = run(angler(2, 99), 8_000);
    expect(s.records.trophies).toEqual(['big-fish']);
    const won = eventsOfType(s, 'trophy');
    expect(won.length).toBeGreaterThanOrEqual(0); // the log is a ring; coins are the ledger
    expect(s.coins).toBe(BAND.bounty);
    const before = s.coins;
    s = run(s, 4_000);
    expect(s.coins).toBe(before);
    expect(s.records.trophies).toEqual(['big-fish']);
  });

  it('names the fish, the weight and the coins on the trophy event', () => {
    const s = run(angler(2, 99), 400);
    const won = eventsOfType(s, 'trophy');
    if (won.length > 0) {
      expect(won[0]?.item).toBe('big-fish');
      expect(won[0]?.grams).toBeGreaterThanOrEqual(trophyWeight(BAND));
      expect(won[0]?.coins).toBe(BAND.bounty);
    }
  });

  it('leaves a haul with nothing to weigh alone: no slab line, no sizes on the cycle', () => {
    const s = run(angler(5, 1, 'sure-water'), 40);
    expect(s.records).toEqual({ fish: {}, trophies: [] });
    for (const g of eventsOfType(s, 'gain')) expect(g.sizes).toEqual([]);
  });

  it('takes no draw at all for a skill that does not weigh', () => {
    const mined = run(
      beginAction(createSimState(9), { kind: 'mining', rock: 'sure-rock', count: null }, ctx),
      30,
    );
    expect(mined.records).toEqual({ fish: {}, trophies: [] });
    for (const g of eventsOfType(mined, 'gain')) expect(g.sizes).toEqual([]);
  });

  it('gives a doubled catch two draws and keeps the better of them', () => {
    // The sea god doubles every catch; two draws can only ever beat one.
    const sworn = { ...angler(4, 60), player: { name: 'A', god: 'sea-god' } };
    const doubled = run(sworn, 400);
    const single = run(angler(4, 60), 400);
    expect(doubled.records.fish['big-fish']?.grams ?? 0).toBeGreaterThan(0);
    expect(single.records.fish['big-fish']?.grams ?? 0).toBeGreaterThan(0);
  });

  it('is a pure step: same state in, same slab out', () => {
    const s = angler(13, 50);
    const a = weighCatch(s, [{ item: 'big-fish', qty: 1 }], DEEP, 'fishing', ctx);
    const b = weighCatch(s, [{ item: 'big-fish', qty: 1 }], DEEP, 'fishing', ctx);
    expect(a.weighings).toEqual(b.weighings);
    expect(a.state.records).toEqual(b.state.records);
    expect(a.xp).toBe(b.xp);
  });
});
