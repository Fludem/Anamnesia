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

describe('recipes with requirements and a burn chance', () => {
  const withFish = (n: number, firemaking = 0, cooking = 0): SimState => {
    let s: SimState = { ...createSimState(7), bank: addItem([], 'fish', n) };
    if (firemaking > 0) s = addXp(s, 'firemaking', firemaking);
    if (cooking > 0) s = addXp(s, 'cooking', cooking);
    return s;
  };
  const cook = { kind: 'crafting', recipe: 'cook', count: null } as const;

  it('asks for the other skill’s level with a reason naming it', () => {
    expect(canStartAction(withFish(3), cook, ctx)).toEqual({
      ok: false,
      reason: 'needs Firemaking level 5 (you are 1)',
    });
    expect(canStartAction(withFish(3, 500), cook, ctx)).toEqual({ ok: true });
  });

  it('a failed cycle eats the input, lands the fail output and pays no xp', () => {
    // Level 1 cooking: 50/50. Over many cycles both outcomes happen and the counts add up.
    const s = run(beginAction(withFish(40, 500), cook, ctx), 2 * 40 + 1);
    const cooked = countItem(s.bank, 'cooked-fish');
    const burnt = countItem(s.bank, 'burnt');
    expect(countItem(s.bank, 'fish')).toBe(0);
    expect(cooked + burnt).toBe(40);
    expect(cooked).toBeGreaterThan(5);
    expect(burnt).toBeGreaterThan(5);
    expect(skillXp(s, 'cooking')).toBe(cooked * 9);
    expect(s.stats.actions['cooking']).toBe(40);
    expect(s.stats.items).toEqual({ 'cooked-fish': cooked, burnt });
  });

  it('stops burning once the level carries the chance to 1', () => {
    // Level 11 cooking (0.5 + 0.05 × 10 = 1): every fish cooks.
    const s = run(beginAction(withFish(20, 500, 1500), cook, ctx), 2 * 20 + 1);
    expect(countItem(s.bank, 'cooked-fish')).toBe(20);
    expect(countItem(s.bank, 'burnt')).toBe(0);
  });

  it('a recipe with no outputs consumes its input and pays xp', () => {
    const s0: SimState = { ...createSimState(1), bank: addItem([], 'log', 3) };
    const s = run(beginAction(s0, { kind: 'crafting', recipe: 'burn', count: null }, ctx), 7);
    expect(s.bank).toEqual([]);
    expect(skillXp(s, 'firemaking')).toBe(12);
    expect(s.action.current).toBeNull();
  });
});
