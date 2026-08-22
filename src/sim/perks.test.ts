import { describe, expect, it } from 'vitest';
import { beginAction } from './actions.ts';
import { applyCommand } from './commands.ts';
import { eventsOfType } from './events.ts';
import { addItem, countItem } from './items.ts';
import { xpAwarded, xpMultiplier } from './perks.ts';
import { skillXp } from './progress.ts';
import { createSimState, type SimState } from './save.ts';
import { stepTick } from './step.ts';
import { fixtureContext as ctx } from './testing/fixture.ts';

const run = (s: SimState, ticks: number): SimState => {
  for (let i = 0; i < ticks; i++) s = stepTick(s, ctx);
  return s;
};
const sworn = (god: string | null, seed = 1): SimState => ({
  ...createSimState(seed),
  player: { name: 'Tester', god },
});

describe('gods', () => {
  it('swearing is a command that works once and only for a known god', () => {
    const s0 = createSimState(1);
    expect(applyCommand(s0, { type: 'player:swear', god: 'nope' }, ctx)).toMatchObject({
      ok: false,
      reason: 'unknown god "nope"',
    });
    const r = applyCommand(s0, { type: 'player:swear', god: 'stone-god' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.state.player.god).toBe('stone-god');
    expect(applyCommand(r.state, { type: 'player:swear', god: 'sea-god' }, ctx)).toMatchObject({
      ok: false,
      reason: 'already sworn to Stone god',
    });
  });

  it('an xp perk multiplies only its skill, to a tenth', () => {
    const s = sworn('stone-god');
    expect(xpMultiplier(s, 'mining', ctx)).toBe(1.5);
    expect(xpMultiplier(s, 'woodcutting', ctx)).toBe(1);
    expect(xpAwarded(s, 'mining', 25, ctx)).toBe(37.5);
    expect(xpAwarded(sworn(null), 'mining', 25, ctx)).toBe(25);
    expect(xpAwarded(sworn('sea-god'), 'fishing', 6, ctx)).toBe(6.6);
    // An unknown god in the save (content removed it) is simply no god.
    expect(xpMultiplier(sworn('gone-god'), 'mining', ctx)).toBe(1);
  });

  it('the bonus is paid by the handler and logged as what was actually paid', () => {
    const s = run(
      beginAction(sworn('stone-god'), { kind: 'mining', rock: 'sure-rock', count: 1 }, ctx),
      3,
    );
    expect(skillXp(s, 'mining')).toBe(15);
    expect(eventsOfType(s, 'gain')[0]).toMatchObject({ skill: 'mining', xp: 15 });
  });

  it('double yield lands the node’s haul twice; extra drops roll one more table', () => {
    const fish = run(
      beginAction(sworn('sea-god'), { kind: 'fishing', water: 'sure-water', count: 2 }, ctx),
      8,
    );
    expect(countItem(fish.bank, 'fish')).toBe(4);
    expect(skillXp(fish, 'fishing')).toBe(13.2);

    const logs = run(
      beginAction(sworn('green-god'), { kind: 'woodcutting', tree: 'sure-tree', count: 3 }, ctx),
      12,
    );
    expect(countItem(logs.bank, 'log')).toBe(3);
    expect(countItem(logs.bank, 'seed')).toBe(3);
    expect(eventsOfType(logs, 'gain')[0]?.items).toEqual([
      { item: 'log', qty: 1 },
      { item: 'seed', qty: 1 },
    ]);
  });

  it('a perk’s extra table counts towards "bank full"', () => {
    // 29 filler stacks plus the log stack the tree would join: full, with no slot for a seed.
    const filler = Array.from({ length: 29 }, (_, i) => ({ item: `x${String(i)}`, qty: 1 }));
    const state: SimState = { ...sworn('green-god'), bank: [...filler, { item: 'log', qty: 1 }] };
    const r = applyCommand(
      state,
      { type: 'action:start', request: { kind: 'woodcutting', tree: 'sure-tree', count: null } },
      ctx,
    );
    expect(r).toMatchObject({ ok: false, reason: 'bank is full (no slot for Seed)' });
  });
});

describe('lifetime counters', () => {
  it('count every unit gained and every unit sold', () => {
    let s = run(
      beginAction(createSimState(1), { kind: 'woodcutting', tree: 'sure-tree', count: 2 }, ctx),
      8,
    );
    expect(s.stats.items).toEqual({ log: 2 });
    s = { ...s, bank: addItem(s.bank, 'ore', 5) };
    const sold = applyCommand(s, { type: 'sell', item: 'log', qty: 2 }, ctx);
    expect(sold.ok).toBe(true);
    expect(sold.state.stats.sold).toBe(2);
    // Selling does not touch the gained counter.
    expect(sold.state.stats.items).toEqual({ log: 2 });
  });
});
