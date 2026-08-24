import { describe, expect, it } from 'vitest';
import { beginAction } from './actions.ts';
import {
  AMBUSH_MAX_GAP_TICKS,
  AMBUSH_MIN_GAP_TICKS,
  ambushWinChance,
  pickAmbusher,
  WIN_CHANCE_CEIL,
  WIN_CHANCE_FLOOR,
} from './ambush.ts';
import { applyPlan } from './advance.ts';
import { applyCommand } from './commands.ts';
import { ContentDb } from './content/db.ts';
import type { SimContext } from './context.ts';
import { eventsOfType } from './events.ts';
import { countItem } from './items.ts';
import { createSimState, type SimState } from './save.ts';
import { makeStep, stepTick } from './step.ts';
import { FIXTURE_PACK, fixtureContext } from './testing/fixture.ts';
import { runescapeCurve } from './xp.ts';

/** A pushover on the slope (win chance at the ceiling) and one for the heights. */
const LURKERS = [
  {
    id: 'lurker',
    name: 'Lurker',
    icon: 'lorc/hood',
    zone: 'slope',
    level: 2,
    hp: 1,
    stats: { attack: 0, strength: 1, defence: 0, speed: 1000 },
    weak: 'melee',
    xp: 12,
    coins: [10, 10],
    drops: [{ entries: [{ item: 'gem', weight: 1 }] }],
    always: [{ item: 'bone', qty: 1 }],
  },
  {
    id: 'high-lurker',
    name: 'High lurker',
    icon: 'lorc/hood',
    zone: 'heights',
    level: 25,
    hp: 1,
    stats: { attack: 0, strength: 1, defence: 0, speed: 1000 },
    weak: 'melee',
    xp: 1,
    coins: [0, 0],
    drops: [{ entries: [{ item: 'gem', weight: 1 }] }],
  },
];

const ctx: SimContext = {
  content: ContentDb.fromPack({ ...FIXTURE_PACK, ambushers: LURKERS }),
  xp: runescapeCurve(),
};

/** The slope figure nobody bare-handed survives: win chance at the floor. */
const nightmareCtx: SimContext = {
  content: ContentDb.fromPack({
    ...FIXTURE_PACK,
    ambushers: [
      {
        ...LURKERS[0],
        id: 'nightmare',
        name: 'Nightmare',
        hp: 100_000,
        stats: { attack: 100_000, strength: 100, defence: 100_000, speed: 1 },
      },
    ],
  }),
  xp: runescapeCurve(),
};

const mining = (s: SimState, c: SimContext = ctx) =>
  beginAction(s, { kind: 'mining', rock: 'sure-rock', count: null }, c);

/** The road opened by the command, as a player would. */
function opened(s: SimState, c: SimContext = ctx): SimState {
  const r = applyCommand(s, { type: 'combat:road', open: true }, c);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

function run(s0: SimState, ticks: number, c: SimContext = ctx): SimState {
  let s = s0;
  for (let i = 0; i < ticks; i++) s = stepTick(s, c);
  return s;
}

describe('the open road', () => {
  it('barred (the default), it draws nothing: with or without ambushers, the run is identical', () => {
    const a = run(mining(createSimState(5)), 60, ctx);
    const b = run(mining(createSimState(5), fixtureContext), 60, fixtureContext);
    expect(a).toEqual(b);
  });

  it('opening draws the first gap in range; reopening is a no-op; barring clears it', () => {
    const s0 = createSimState(1);
    const s1 = opened(s0);
    expect(s1.combat.road.open).toBe(true);
    expect(s1.combat.road.ambushAt).toBeGreaterThanOrEqual(s0.tick + AMBUSH_MIN_GAP_TICKS);
    expect(s1.combat.road.ambushAt).toBeLessThanOrEqual(s0.tick + AMBUSH_MAX_GAP_TICKS);
    expect(s1.rng).not.toEqual(s0.rng);
    const again = applyCommand(s1, { type: 'combat:road', open: true }, ctx);
    expect(again.ok && again.state).toEqual(s1);
    const barred = applyCommand(s1, { type: 'combat:road', open: false }, ctx);
    if (!barred.ok) throw new Error(barred.reason);
    expect(barred.state.combat.road).toEqual({ open: false, ambushAt: null });
    expect(barred.state.rng).toEqual(s1.rng);
  });

  it('a due ambush waits out an idle hero and fires on the first working tick', () => {
    let s = opened(createSimState(2));
    s = { ...s, combat: { ...s.combat, road: { open: true, ambushAt: s.tick + 1 } } };
    const idle = run(s, 5);
    expect(eventsOfType(idle, 'ambush')).toEqual([]);
    expect(idle.combat.road.ambushAt).toBe(s.tick + 1);
    const working = run(mining(idle), 1);
    expect(eventsOfType(working, 'ambush')).toHaveLength(1);
  });

  it('a due ambush also waits out a fight: the road wants someone mid-work', () => {
    let s = opened(createSimState(2));
    s = { ...s, combat: { ...s.combat, road: { open: true, ambushAt: s.tick + 1 } } };
    s = beginAction(s, { kind: 'combat', monster: 'goat', count: null }, ctx);
    const fought = run(s, 10);
    expect(eventsOfType(fought, 'ambush')).toEqual([]);
    expect(fought.combat.road.ambushAt).toBe(s.tick + 1);
  });

  it('fought off: the spoils and coins land, a little xp pays, and the work goes on', () => {
    let s = opened(mining(createSimState(1)));
    s = { ...s, combat: { ...s.combat, road: { open: true, ambushAt: s.tick + 1 } } };
    const after = run(s, 2);
    const events = eventsOfType(after, 'ambush');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ ambusher: 'lurker', won: true, coins: 10, stolen: 0 });
    expect(after.action.current?.request.kind).toBe('mining');
    expect(after.coins).toBe(10);
    expect(countItem(after.bank, 'bone')).toBe(1);
    expect(countItem(after.bank, 'gem')).toBe(1);
    expect(after.stats.ambushes).toBe(1);
    expect(after.stats.routed).toBe(0);
    expect(after.combat.hp).toBeGreaterThanOrEqual(1);
    expect((after.skills['combat']?.xp ?? 0) > 0).toBe(true);
    // The next one is already on its way.
    expect(after.combat.road.ambushAt).toBeGreaterThanOrEqual(
      after.tick + AMBUSH_MIN_GAP_TICKS - 2,
    );
  });

  it('driven off: the day ends and a twentieth of the purse walks — never an item, never a death', () => {
    let s = opened(mining(createSimState(1), nightmareCtx), nightmareCtx);
    s = {
      ...s,
      coins: 1000,
      combat: { ...s.combat, road: { open: true, ambushAt: s.tick + 1 } },
    };
    const after = run(s, 2, nightmareCtx);
    const events = eventsOfType(after, 'ambush');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ ambusher: 'nightmare', won: false, coins: 0, stolen: 50 });
    expect(after.action).toEqual({ current: null, queue: [] });
    expect(after.coins).toBe(950);
    expect(after.equipment).toEqual(s.equipment);
    expect(after.stats.deaths).toBe(0);
    expect(after.stats.routed).toBe(1);
    expect(after.combat.hp).toBe(3);
  });

  it('a full bank wins the coins but rolls no spoils: skipped, not wasted', () => {
    const junk = Array.from({ length: 30 }, (_, i) => ({ item: `junk-${String(i)}`, qty: 1 }));
    const fullCtx: SimContext = {
      content: ContentDb.fromPack({
        ...FIXTURE_PACK,
        ambushers: LURKERS,
        items: [
          ...FIXTURE_PACK.items,
          ...junk.map((j) => ({ id: j.item, name: j.item, icon: 'lorc/rock', value: 1 })),
        ],
      }),
      xp: runescapeCurve(),
    };
    let s = opened(createSimState(1), fullCtx);
    // Smithing wants ore in the bank; the rest is junk, so no slot is free for spoils.
    s = { ...s, bank: [...junk.slice(1), { item: 'ore', qty: 10 }] };
    s = beginAction(s, { kind: 'crafting', recipe: 'bar', count: null }, fullCtx);
    s = { ...s, combat: { ...s.combat, road: { open: true, ambushAt: s.tick + 1 } } };
    const after = run(s, 2, fullCtx);
    const events = eventsOfType(after, 'ambush');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ won: true, items: [], coins: 10 });
    expect(countItem(after.bank, 'bone')).toBe(0);
    expect(countItem(after.bank, 'gem')).toBe(0);
    expect(after.coins).toBe(10);
  });

  it('the figure tracks the style and its level up the hill', () => {
    const low = createSimState(1);
    expect(pickAmbusher(low, ctx)?.id).toBe('lurker');
    const high: SimState = {
      ...low,
      skills: { combat: { xp: ctx.xp.xpForLevel(25) } },
    };
    expect(pickAmbusher(high, ctx)?.id).toBe('high-lurker');
    // A staff fights on Sorcery, and Sorcery has not earned the heights.
    const staffed: SimState = { ...high, equipment: { ...high.equipment, weapon: 'staff' } };
    expect(pickAmbusher(staffed, ctx)?.id).toBe('lurker');
  });

  it('the win chance is clamped: a pushover is never certain, a nightmare never hopeless', () => {
    const s = createSimState(1);
    expect(ambushWinChance(s, ctx.content.ambusher('lurker'), ctx)).toBe(WIN_CHANCE_CEIL);
    expect(ambushWinChance(s, nightmareCtx.content.ambusher('nightmare'), nightmareCtx)).toBe(
      WIN_CHANCE_FLOOR,
    );
  });

  it('replays the same in one run or batches, ambush included', () => {
    let s = opened(mining(createSimState(7)));
    s = { ...s, combat: { ...s.combat, road: { open: true, ambushAt: s.tick + 50 } } };
    const step = makeStep(ctx);
    const plan = {
      fromTick: s.tick,
      toTick: s.tick + 200,
      fromWallMs: 0,
      newWallMs: 200 * 100,
      tickMs: 100,
      skippedTicks: 0,
      clockWentBackwards: false,
    };
    const whole = applyPlan(s, plan, step);
    let batched = s;
    while (batched.tick < plan.toTick) batched = applyPlan(batched, plan, step, 30);
    // The log may have scrolled past it; the counter has not.
    expect(whole.stats.ambushes + whole.stats.routed).toBe(1);
    expect(batched).toEqual(whole);
  });
});
