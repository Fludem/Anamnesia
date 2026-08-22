import { describe, expect, it } from 'vitest';
import { ContentDb } from './content/db.ts';
import { applyCommand } from './commands.ts';
import type { SimContext } from './context.ts';
import { addItem, countItem } from './items.ts';
import { createSimState, type SimState } from './save.ts';
import { FIXTURE_PACK, fixtureContext as ctx } from './testing/fixture.ts';

const withBank = (...stacks: [string, number][]): SimState => ({
  ...createSimState(7),
  bank: stacks.reduce((b, [item, qty]) => addItem(b, item, qty), createSimState(7).bank),
});

describe('equip / unequip', () => {
  it('moves an item from the bank to its slot and swaps the previous one back', () => {
    let s = withBank(['pick', 2], ['axe', 1]);
    let r = applyCommand(s, { type: 'equip', item: 'pick' }, ctx);
    expect(r.ok).toBe(true);
    s = r.state;
    expect(s.equipment.pickaxe).toBe('pick');
    expect(countItem(s.bank, 'pick')).toBe(1);
    // Equipping into an occupied slot returns the old item.
    r = applyCommand(s, { type: 'equip', item: 'pick' }, ctx);
    s = r.state;
    expect(s.equipment.pickaxe).toBe('pick');
    expect(countItem(s.bank, 'pick')).toBe(1);
    r = applyCommand(s, { type: 'unequip', slot: 'pickaxe' }, ctx);
    s = r.state;
    expect(s.equipment.pickaxe).toBeNull();
    expect(countItem(s.bank, 'pick')).toBe(2);
  });

  it('rejects unequippable, absent and unknown items, and empty slots', () => {
    const s = withBank(['stone', 1]);
    expect(applyCommand(s, { type: 'equip', item: 'stone' }, ctx)).toMatchObject({
      ok: false,
      reason: 'Stone cannot be equipped',
    });
    expect(applyCommand(s, { type: 'equip', item: 'pick' }, ctx)).toMatchObject({
      ok: false,
      reason: 'no Pick in the bank',
    });
    expect(applyCommand(s, { type: 'equip', item: 'nope' }, ctx)).toMatchObject({ ok: false });
    expect(applyCommand(s, { type: 'unequip', slot: 'axe' }, ctx)).toMatchObject({
      ok: false,
      reason: 'nothing in the axe slot',
    });
  });
});

describe('open', () => {
  const nestCtx: SimContext = {
    ...ctx,
    content: ContentDb.fromPack({
      ...FIXTURE_PACK,
      items: [
        ...FIXTURE_PACK.items,
        {
          id: 'nest',
          name: 'Nest',
          icon: 'delapouite/nest-eggs',
          class: 'container',
          opens: { entries: [{ item: 'gem', weight: 1, quantity: [2, 2] }] },
          value: 1,
        },
      ],
    }),
  };

  it('consumes the containers and rolls the table once each', () => {
    const s = withBank(['nest', 3]);
    const r = applyCommand(s, { type: 'open', item: 'nest', qty: 2 }, nestCtx);
    expect(r.ok).toBe(true);
    expect(countItem(r.state.bank, 'nest')).toBe(1);
    expect(countItem(r.state.bank, 'gem')).toBe(4);
    expect(r.state.rng).not.toEqual(s.rng);
  });

  it('rejects non-containers and short stacks', () => {
    expect(
      applyCommand(withBank(['stone', 1]), { type: 'open', item: 'stone', qty: 1 }, nestCtx),
    ).toMatchObject({ ok: false, reason: 'Stone cannot be opened' });
    expect(
      applyCommand(withBank(['nest', 1]), { type: 'open', item: 'nest', qty: 2 }, nestCtx),
    ).toMatchObject({ ok: false, reason: 'only 1 Nest in the bank' });
  });
});
