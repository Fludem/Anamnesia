import { describe, expect, it } from 'vitest';
import { beginAction, canStartAction } from '../actions.ts';
import { countItem } from '../items.ts';
import { skillXp } from '../progress.ts';
import { createSimState, type SimState } from '../save.ts';
import { stepTick } from '../step.ts';
import { fixtureContext as ctx, miningState } from '../testing/fixture.ts';
import { toolAdjustedTicks } from './gathering.ts';

const run = (s: SimState, ticks: number): SimState => {
  for (let i = 0; i < ticks; i++) s = stepTick(s, ctx);
  return s;
};
const equip = (s: SimState, slot: 'pickaxe' | 'axe', item: string): SimState => ({
  ...s,
  equipment: { ...s.equipment, [slot]: item },
});

describe('gathering handler', () => {
  it('woodcutting is mining with trees: logs land in the bank, xp in woodcutting', () => {
    const req = { kind: 'woodcutting', tree: 'sure-tree', count: null } as const;
    expect(canStartAction(createSimState(1), req, ctx)).toEqual({ ok: true });
    const s = run(beginAction(createSimState(1), req, ctx), 8);
    expect(countItem(s.bank, 'log')).toBe(2);
    expect(skillXp(s, 'woodcutting')).toBe(16);
    expect(skillXp(s, 'mining')).toBe(0);
  });

  it('foraging is gathering by hand: sprigs land in the bank and no tool shortens it', () => {
    const req = { kind: 'foraging', patch: 'sure-patch', count: null } as const;
    expect(canStartAction(createSimState(1), req, ctx)).toEqual({ ok: true });
    const s = run(beginAction(createSimState(1), req, ctx), 8);
    expect(countItem(s.bank, 'sprig')).toBe(2);
    expect(skillXp(s, 'foraging')).toBe(12);
    const tooled = equip(createSimState(1), 'pickaxe', 'pick');
    expect(beginAction(tooled, req, ctx).action.current?.durationTicks).toBe(4);
    expect(toolAdjustedTicks(tooled, null, 4, ctx)).toBe(4);
  });

  it('an unknown tree and a gated rock are refused with a reason', () => {
    const unknown = canStartAction(
      createSimState(1),
      { kind: 'woodcutting', tree: 'nope', count: null },
      ctx,
    );
    expect(unknown).toEqual({ ok: false, reason: 'unknown tree "nope"' });
    const gated = canStartAction(
      createSimState(1),
      { kind: 'mining', rock: 'gated-rock', count: null },
      ctx,
    );
    expect(gated).toEqual({ ok: false, reason: 'requires Mining level 10 (you are 1)' });
  });

  it('the equipped tool cuts the action time by its gather percentage, rounded, never below 1', () => {
    const s = createSimState(1);
    expect(toolAdjustedTicks(s, 'pickaxe', 30, ctx)).toBe(30);
    expect(toolAdjustedTicks(equip(s, 'pickaxe', 'pick'), 'pickaxe', 30, ctx)).toBe(15);
    expect(toolAdjustedTicks(equip(s, 'pickaxe', 'pick'), 'pickaxe', 1, ctx)).toBe(1);
    expect(toolAdjustedTicks(equip(s, 'axe', 'axe'), 'axe', 4, ctx)).toBe(4); // 3.6 rounds up
    expect(toolAdjustedTicks(equip(s, 'axe', 'axe'), 'axe', 10, ctx)).toBe(9);
    // A tool in the other slot does nothing for this skill.
    expect(toolAdjustedTicks(equip(s, 'axe', 'axe'), 'pickaxe', 30, ctx)).toBe(30);
  });

  it('a pick halves a rock: twice the stone in the same ticks, and the snapshot is taken at start', () => {
    const bare = run(miningState(1, 'sure-rock'), 30);
    const withPick = run(
      beginAction(
        equip(createSimState(1), 'pickaxe', 'pick'),
        { kind: 'mining', rock: 'sure-rock', count: null },
        ctx,
      ),
      30,
    );
    expect(countItem(bare.bank, 'stone')).toBe(10);
    expect(countItem(withPick.bank, 'stone')).toBe(15); // 3 ticks → 2 per cycle
    expect(withPick.action.current?.durationTicks).toBe(2);
    // Unequipping mid-cycle does not change the cycle in flight; the next one re-reads it.
    const unequipped = run(equip(withPick, 'pickaxe', null as never), 2);
    expect(unequipped.action.current?.durationTicks).toBe(3);
  });
});
