import { describe, expect, it } from 'vitest';
import { beginAction } from './actions.ts';
import { CommandSchema } from './commands.ts';
import { eventsOfType, LOG_CAP, pushEvent } from './events.ts';
import { addItem } from './items.ts';
import { addXp } from './progress.ts';
import { createSimState, type SimState } from './save.ts';
import { stepTick } from './step.ts';
import { fixtureContext as ctx } from './testing/fixture.ts';

const run = (s: SimState, ticks: number): SimState => {
  for (let i = 0; i < ticks; i++) s = stepTick(s, ctx);
  return s;
};

describe('event log', () => {
  it('logs one gain per completed gathering cycle with the items and xp of that cycle', () => {
    let s = beginAction(createSimState(5), { kind: 'mining', rock: 'sure-rock', count: 2 }, ctx);
    s = run(s, 6);
    expect(s.log).toEqual([
      {
        type: 'gain',
        tick: 3,
        skill: 'mining',
        xp: 10,
        items: [{ item: 'stone', qty: 1 }],
        sizes: [],
      },
      {
        type: 'gain',
        tick: 6,
        skill: 'mining',
        xp: 10,
        items: [{ item: 'stone', qty: 1 }],
        sizes: [],
      },
    ]);
  });

  it('logs crafting outputs, and the stop when inputs run out', () => {
    let s = { ...createSimState(5), bank: addItem([], 'ore', 2) };
    s = beginAction(s, { kind: 'crafting', recipe: 'bar', count: null }, ctx);
    s = run(s, 3);
    expect(s.log).toEqual([
      {
        type: 'gain',
        tick: 3,
        skill: 'smithing',
        xp: 7,
        items: [{ item: 'bar', qty: 1 }],
        sizes: [],
      },
      {
        type: 'stopped',
        tick: 3,
        skill: 'smithing',
        reason: 'needs 2 × Ore (you have 0)',
        fight: false,
      },
    ]);
    expect(s.action.current).toBeNull();
  });

  it('a counted action that finishes its count is not a stop, and every cycle is counted', () => {
    let s = beginAction(createSimState(5), { kind: 'mining', rock: 'sure-rock', count: 1 }, ctx);
    s = run(s, 3);
    expect(eventsOfType(s, 'stopped')).toEqual([]);
    expect(s.stats.actions).toEqual({ mining: 1 });
    // Failed cycles count too: an action is an attempt.
    let f = beginAction(createSimState(5), { kind: 'mining', rock: 'flaky-rock', count: 5 }, ctx);
    f = run(f, 20);
    expect(f.stats.actions).toEqual({ mining: 5 });
  });

  it('logs a level event with from/to when a cycle crosses a level', () => {
    // Level 2 is 83 xp; sure-rock pays 10 per cycle, so the 9th cycle (90 xp) crosses it.
    let s = beginAction(createSimState(5), { kind: 'mining', rock: 'sure-rock', count: null }, ctx);
    s = run(s, 27);
    expect(eventsOfType(s, 'level')).toEqual([
      { type: 'level', tick: 27, skill: 'mining', from: 1, to: 2 },
    ]);
    // A big jump logs a single event spanning the levels.
    const jump = addXp(createSimState(1), 'mining', 0);
    const before = { ...jump, bank: addItem([], 'ore', 2) };
    const leap = beginAction(
      addXp(before, 'smithing', 1150), // level 9 is 969, level 10 is 1154: +7 xp crosses one
      { kind: 'crafting', recipe: 'bar', count: 1 },
      ctx,
    );
    expect(eventsOfType(run(leap, 3), 'level')).toEqual([
      { type: 'level', tick: 3, skill: 'smithing', from: 9, to: 10 },
    ]);
  });

  it('is a ring buffer of LOG_CAP entries', () => {
    let s = createSimState(1);
    for (let i = 0; i < LOG_CAP + 5; i++) {
      s = pushEvent(s, { type: 'stopped', tick: i, skill: 'mining', reason: 'r', fight: false });
    }
    expect(s.log.length).toBe(LOG_CAP);
    expect(s.log[0]?.tick).toBe(5);
    expect(s.log[LOG_CAP - 1]?.tick).toBe(LOG_CAP + 4);
  });

  it('rename accepts 3–16 sensible characters and trims', () => {
    expect(CommandSchema.parse({ type: 'player:rename', name: '  Fludem ' })).toEqual({
      type: 'player:rename',
      name: 'Fludem',
    });
    for (const bad of ['', 'ab', 'x'.repeat(17), '<script>', 'a\nb']) {
      expect(CommandSchema.safeParse({ type: 'player:rename', name: bad }).success).toBe(false);
    }
  });
});
