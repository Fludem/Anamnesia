import { describe, expect, it } from 'vitest';
import { beginAction } from '../actions.ts';
import { ContentDb } from '../content/db.ts';
import type { SimContext } from '../context.ts';
import { countItem } from '../items.ts';
import { addXp, skillLevel, skillXp } from '../progress.ts';
import { nextFloat, nextInt, seedRng, type RngState } from '../rng.ts';
import { createSimState, type SimState } from '../save.ts';
import { stepTick } from '../step.ts';
import { FIXTURE_PACK, fixtureContext, miningState } from '../testing/fixture.ts';
import { miningHandler } from './mining.ts';

const run = (s: SimState, ticks: number, ctx: SimContext = fixtureContext): SimState => {
  for (let i = 0; i < ticks; i++) s = stepTick(s, ctx);
  return s;
};

describe('mining end to end', () => {
  it('a never-failing rock yields exactly one drop and one xp award per duration', () => {
    const s0 = miningState(1, 'sure-rock');
    expect(run(s0, 2).bank).toEqual([]);
    const s3 = run(s0, 3);
    expect(s3.bank).toEqual([{ item: 'stone', qty: 1 }]);
    expect(skillXp(s3, 'mining')).toBe(10);
    expect(s3.action.current).toMatchObject({ elapsedTicks: 0, durationTicks: 3, remaining: null });

    const s30 = run(s0, 30);
    expect(countItem(s30.bank, 'stone')).toBe(10);
    expect(skillXp(s30, 'mining')).toBe(100);
    expect(skillLevel(s30, 'mining', fixtureContext)).toBe(2); // 83 xp is level 2
    // A 100% success rock with a fixed-quantity single-entry table still draws once per drop
    // table roll (the entry pick), and nothing for the success roll.
    let rng: RngState = s0.rng;
    for (let i = 0; i < 10; i++) rng = nextFloat(rng)[1];
    expect(s30.rng).toEqual(rng);
  });

  it('matches an independent re-derivation of every draw for a flaky rock (seed 42, 100 cycles)', () => {
    const cycles = 100;
    const sim = run(miningState(42), cycles * 4);

    // Reference: the documented draw order, written against the rng primitives directly.
    let rng = seedRng(42);
    let ore = 0;
    let gem = 0;
    let rare = 0;
    let xp = 0;
    let successes = 0;
    for (let c = 0; c < cycles; c++) {
      const level = fixtureContext.xp.levelForXp(xp);
      const chance = Math.min(1, 0.5 + 0.05 * (level - 1));
      let success = true;
      if (chance < 1) {
        let f;
        [f, rng] = nextFloat(rng);
        success = f < chance;
      }
      if (!success) continue;
      successes++;
      [, rng] = nextFloat(rng); // ore table: entry pick (only one entry)
      let qty;
      [qty, rng] = nextInt(rng, 1, 3);
      ore += qty;
      let g;
      [g, rng] = nextFloat(rng); // gem table: nothing 8 / gem 1 / rare 1
      const pick = g * 10;
      if (pick >= 9) rare++;
      else if (pick >= 8) gem++;
      xp += 25;
    }

    expect(countItem(sim.bank, 'ore')).toBe(ore);
    expect(countItem(sim.bank, 'gem')).toBe(gem);
    expect(countItem(sim.bank, 'rare-gem')).toBe(rare);
    expect(skillXp(sim, 'mining')).toBe(xp);
    expect(sim.rng).toEqual(rng);
    expect(successes).toBeGreaterThan(40);
    expect(successes).toBeLessThan(cycles);

    // Pinned literals: if these move, the save-compatible draw order has changed.
    expect({ ore, gem, rare, xp, successes }).toEqual({
      ore: 161,
      gem: 7,
      rare: 8,
      xp: 2_100,
      successes: 84,
    });
  });

  it('is deterministic: same seed → byte-identical state; different seed → different state', () => {
    const a = run(miningState(9), 1_000);
    const b = run(miningState(9), 1_000);
    const c = run(miningState(10), 1_000);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(c.bank).not.toEqual(a.bank);
  });

  it('success chance rises with level and caps at 1', () => {
    const req = { kind: 'mining', rock: 'flaky-rock', count: null } as const;
    const at = (level: number) =>
      miningHandler.successChance(
        addXp(createSimState(1), 'mining', fixtureContext.xp.xpForLevel(level)),
        req,
        fixtureContext,
      );
    expect(at(1)).toBe(0.5);
    expect(at(5)).toBeCloseTo(0.7);
    expect(at(11)).toBe(1);
    expect(at(50)).toBe(1);
  });

  it('a failed cycle consumes the time and yields nothing', () => {
    const pack = {
      ...FIXTURE_PACK,
      rocks: [{ ...FIXTURE_PACK.rocks[0]!, id: 'cursed', success: { base: 0 } }],
    };
    const ctx: SimContext = { ...fixtureContext, content: ContentDb.fromPack(pack) };
    const req = { kind: 'mining', rock: 'cursed', count: null } as const;
    const s = run(beginAction(createSimState(1), req, ctx), 30, ctx);
    expect(s.bank).toEqual([]);
    expect(skillXp(s, 'mining')).toBe(0);
    expect(s.action.current?.elapsedTicks).toBe(0); // cycle restarted after each failure
    expect(s.tick).toBe(30);
  });

  it('gates rocks on level with a readable reason', () => {
    const s = createSimState(1);
    const req = { kind: 'mining', rock: 'gated-rock', count: null } as const;
    expect(miningHandler.canStart(s, req, fixtureContext)).toEqual({
      ok: false,
      reason: 'requires Mining level 10 (you are 1)',
    });
    const levelled = addXp(s, 'mining', 1_154);
    expect(miningHandler.canStart(levelled, req, fixtureContext)).toEqual({ ok: true });
    expect(
      miningHandler.canStart(s, { kind: 'mining', rock: 'nope', count: null }, fixtureContext),
    ).toEqual({ ok: false, reason: 'unknown rock "nope"' });
  });

  it('an idle state just counts ticks and touches nothing else', () => {
    const s0 = createSimState(3);
    const s1 = run(s0, 500);
    expect(s1).toEqual({ ...s0, tick: 500 });
  });
});
