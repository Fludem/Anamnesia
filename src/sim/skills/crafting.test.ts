import { describe, expect, it } from 'vitest';
import { beginAction, canStartAction } from '../actions.ts';
import { applyCommand } from '../commands.ts';
import { addItem, countItem } from '../items.ts';
import { addXp, skillXp } from '../progress.ts';
import { createSimState, type SimState } from '../save.ts';
import { stepTick } from '../step.ts';
import { fixtureContext as ctx } from '../testing/fixture.ts';

const run = (s: SimState, ticks: number): SimState => {
  for (let i = 0; i < ticks; i++) s = stepTick(s, ctx);
  return s;
};
const withOre = (n: number): SimState => ({
  ...createSimState(1),
  bank: addItem([], 'ore', n),
});
const bar = { kind: 'crafting', recipe: 'bar', count: null } as const;

describe('crafting handler', () => {
  it('refuses unknown recipes, missing levels and missing inputs with a reason', () => {
    expect(canStartAction(withOre(2), { ...bar, recipe: 'nope' }, ctx)).toEqual({
      ok: false,
      reason: 'unknown recipe "nope"',
    });
    expect(canStartAction(withOre(2), { ...bar, recipe: 'gated-bar' }, ctx)).toEqual({
      ok: false,
      reason: 'requires Smithing level 20 (you are 1)',
    });
    expect(canStartAction(withOre(1), bar, ctx)).toEqual({
      ok: false,
      reason: 'needs 2 × Ore (you have 1)',
    });
    expect(canStartAction(withOre(2), bar, ctx)).toEqual({ ok: true });
    expect(
      canStartAction(addXp(withOre(1), 'smithing', 5000), { ...bar, recipe: 'gated-bar' }, ctx),
    ).toEqual({ ok: true });
  });

  it('takes inputs and gives outputs when the cycle completes, not when it starts', () => {
    const s0 = beginAction(withOre(2), bar, ctx);
    expect(countItem(s0.bank, 'ore')).toBe(2);
    const s2 = run(s0, 2);
    expect(countItem(s2.bank, 'ore')).toBe(2);
    expect(countItem(s2.bank, 'bar')).toBe(0);
    const s3 = run(s0, 3);
    expect(s3.bank).toEqual([{ item: 'bar', qty: 1 }]);
    expect(skillXp(s3, 'smithing')).toBe(7);
    // Crafting never fails, so the rng is untouched.
    expect(s3.rng).toEqual(s0.rng);
  });

  it('stops by itself when the inputs run out, then falls through to the queue', () => {
    const s0 = applyCommand(withOre(5), { type: 'action:start', request: bar }, ctx).state;
    const queued = applyCommand(
      s0,
      { type: 'action:enqueue', request: { kind: 'mining', rock: 'sure-rock', count: null } },
      ctx,
    ).state;
    const s6 = run(queued, 6);
    expect(countItem(s6.bank, 'bar')).toBe(2);
    expect(countItem(s6.bank, 'ore')).toBe(1);
    // The third cycle could not start: the queued mining request took over on the same tick.
    expect(s6.action.current?.request).toEqual({ kind: 'mining', rock: 'sure-rock', count: null });
    expect(s6.action.queue).toEqual([]);
    // With nothing queued the action simply ends.
    const alone = run(s0, 6);
    expect(alone.action.current).toBeNull();
    expect(countItem(alone.bank, 'bar')).toBe(2);
  });

  it('honours a count', () => {
    const s = run(beginAction(withOre(10), { ...bar, count: 2 }, ctx), 30);
    expect(countItem(s.bank, 'bar')).toBe(2);
    expect(countItem(s.bank, 'ore')).toBe(6);
    expect(s.action.current).toBeNull();
  });
});
