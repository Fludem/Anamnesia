import { describe, expect, it } from 'vitest';
import { beginAction } from '../actions.ts';
import { countItem } from '../items.ts';
import { createSimState, type SimState } from '../save.ts';
import { stepTick } from '../step.ts';
import { fixtureContext as ctx } from '../testing/fixture.ts';

const run = (s: SimState, ticks: number): SimState => {
  for (let i = 0; i < ticks; i++) s = stepTick(s, ctx);
  return s;
};

describe('fishing', () => {
  it('is gathering over waters with the rod as its tool', () => {
    const plain = run(
      beginAction(createSimState(1), { kind: 'fishing', water: 'sure-water', count: null }, ctx),
      8,
    );
    expect(countItem(plain.bank, 'fish')).toBe(2);
    const rodded: SimState = {
      ...createSimState(1),
      equipment: { ...createSimState(1).equipment, rod: 'rod' },
    };
    const quick = run(
      beginAction(rodded, { kind: 'fishing', water: 'sure-water', count: null }, ctx),
      8,
    );
    expect(countItem(quick.bank, 'fish')).toBe(4);
    expect(quick.stats.actions).toEqual({ fishing: 4 });
  });
});
