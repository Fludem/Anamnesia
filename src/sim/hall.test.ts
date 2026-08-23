import { describe, expect, it } from 'vitest';
import { beginAction } from './actions.ts';
import { bankCapacity, BASE_BANK_SLOTS } from './bank.ts';
import { applyCommand } from './commands.ts';
import { OFFLINE_CAP_TICKS, TICKS_PER_HOUR } from './constants.ts';
import { eventsOfType } from './events.ts';
import {
  applyHallSync,
  give,
  hallFerrymanDiscount,
  hallPerks,
  MAX_PENDING_GIFTS,
  type HallSync,
} from './hall.ts';
import { addItem, countItem } from './items.ts';
import { xpAwarded } from './perks.ts';
import { createSimState, type SimState } from './save.ts';
import { eat, ferrymanFee } from './skills/combat.ts';
import { stepTick } from './step.ts';
import { fixtureContext as ctx } from './testing/fixture.ts';
import { offlineCapTicks } from './trader.ts';

const content = ctx.content;

/** A name in hall 7 holding a few things, with the rooms given. */
function member(rooms: Record<string, number> = {}, extra: Partial<SimState> = {}): SimState {
  const s = createSimState(1);
  let bank = s.bank;
  for (const [item, qty] of [
    ['log', 30],
    ['stone', 8],
    ['ore', 6],
    ['fish', 5],
    ['bar', 2],
  ] as const) {
    bank = addItem(bank, item, qty);
  }
  return { ...s, bank, coins: 500, hall: { id: 7, rooms, gifts: [], given: 0 }, ...extra };
}

const giveCmd = (s: SimState, room: string, item: string | null, qty: number) =>
  applyCommand(s, { type: 'hall:give', room, item, qty }, ctx);

describe('the hall: giving', () => {
  it('takes the gift out of the bank and puts it on the cart, numbered', () => {
    const r1 = giveCmd(member(), 'hearth', 'log', 10);
    expect(r1.ok).toBe(true);
    expect(countItem(r1.state.bank, 'log')).toBe(20);
    expect(r1.state.hall.gifts).toEqual([{ id: 1, room: 'hearth', tier: 1, item: 'log', qty: 10 }]);
    expect(r1.state.hall.given).toBe(1);
    expect(r1.state.stats.given).toBe(20);
    const r2 = giveCmd(r1.state, 'pyre', 'log', 3);
    const r3 = giveCmd(r2.state, 'tower', null, 50);
    expect(r3.ok).toBe(true);
    expect(r3.state.coins).toBe(450);
    expect(r3.state.hall.gifts.map((g) => g.id)).toEqual([1, 2, 3]);
    expect(r3.state.stats.given).toBe(20 + 6 + 50);
    expect(eventsOfType(r3.state, 'gave')).toHaveLength(3);
  });

  it('a gift for the second tier says so', () => {
    const r = giveCmd(member({ hearth: 1 }), 'hearth', 'stone', 5);
    expect(r.ok && r.state.hall.gifts[0]?.tier).toBe(2);
    const coins = giveCmd(member({ hearth: 1 }), 'hearth', null, 100);
    expect(coins.ok).toBe(true);
  });

  it('refuses what the hall cannot take, and the state stays as it was', () => {
    const s = member();
    const nobody = { ...s, hall: { ...s.hall, id: null } };
    expect(give(nobody, { room: 'hearth', item: 'log', qty: 1 }, ctx)).toEqual({
      ok: false,
      reason: 'you have no hall to give to',
    });
    expect(give(s, { room: 'chapel', item: 'log', qty: 1 }, ctx)).toMatchObject({ ok: false });
    expect(give(member({ store: 1 }), { room: 'store', item: 'ore', qty: 1 }, ctx)).toEqual({
      ok: false,
      reason: 'Store is finished',
    });
    expect(give(s, { room: 'hearth', item: 'ore', qty: 1 }, ctx)).toEqual({
      ok: false,
      reason: 'Hearth has no use for Ore',
    });
    expect(give(s, { room: 'hearth', item: 'log', qty: 31 }, ctx)).toEqual({
      ok: false,
      reason: 'you have 30 Log',
    });
    expect(give(s, { room: 'hearth', item: null, qty: 10 }, ctx)).toEqual({
      ok: false,
      reason: 'Hearth wants no coins for now',
    });
    expect(give(s, { room: 'tower', item: null, qty: 501 }, ctx)).toEqual({
      ok: false,
      reason: 'that is 501 gp (you have 500)',
    });
    expect(give(s, { room: 'hearth', item: 'log', qty: 0 }, ctx)).toMatchObject({ ok: false });
    const r = giveCmd(s, 'hearth', 'ore', 1);
    expect(r.ok).toBe(false);
    expect(r.state).toBe(s);
  });

  it('a full cart waits for the register', () => {
    let s = member();
    for (let i = 0; i < MAX_PENDING_GIFTS; i++) {
      const r = give(s, { room: 'tower', item: null, qty: 1 }, ctx);
      expect(r.ok).toBe(true);
      if (r.ok) s = r.state;
    }
    expect(give(s, { room: 'tower', item: null, qty: 1 }, ctx)).toEqual({
      ok: false,
      reason: 'the hall has not taken your last gifts yet',
    });
  });
});

describe('the hall: the register answers', () => {
  const onCart = (): SimState => {
    let s = member();
    for (const [room, item, qty] of [
      ['hearth', 'log', 10],
      ['pyre', 'log', 3],
      ['tower', null, 50],
    ] as const) {
      const r = give(s, { room, item, qty }, ctx);
      if (r.ok) s = r.state;
    }
    return s;
  };

  it('clears the answered gifts, sends back what was not taken and sets the rooms', () => {
    const s = onCart();
    const sync: HallSync = {
      id: 7,
      rooms: { hearth: 1, pyre: 1 },
      took: [
        { id: 1, qty: 10 },
        { id: 2, qty: 1 },
      ],
      given: 3,
    };
    const after = applyHallSync(s, sync, ctx);
    expect(after.hall.gifts.map((g) => g.id)).toEqual([3]);
    expect(countItem(after.bank, 'log')).toBe(17 + 2);
    expect(after.coins).toBe(450);
    expect(after.hall.rooms).toEqual({ hearth: 1, pyre: 1 });
    expect(eventsOfType(after, 'raised').map((e) => [e.room, e.tier])).toEqual([
      ['hearth', 1],
      ['pyre', 1],
    ]);
    const later = applyHallSync(
      after,
      { id: 7, rooms: { hearth: 1, pyre: 1 }, took: [{ id: 3, qty: 0 }], given: 3 },
      ctx,
    );
    expect(later.hall.gifts).toEqual([]);
    expect(later.coins).toBe(500);
    expect(eventsOfType(later, 'raised')).toHaveLength(2);
  });

  it('the same state comes back when nothing changed; given never falls behind', () => {
    const s = onCart();
    const idle: HallSync = { id: 7, rooms: {}, took: [], given: 2 };
    expect(applyHallSync(s, idle, ctx)).toBe(s);
    const ahead = applyHallSync(s, { ...idle, given: 9 }, ctx);
    expect(ahead.hall.given).toBe(9);
    expect(ahead.hall.gifts).toEqual(s.hall.gifts);
  });

  it('never throws on an answer that makes no sense', () => {
    const s = onCart();
    const odd = applyHallSync(
      s,
      {
        id: 7,
        rooms: { chapel: 3, hearth: 1 },
        took: [
          { id: 1, qty: 99 },
          { id: 42, qty: 1 },
        ],
        given: 0,
      },
      ctx,
    );
    expect(odd.hall.rooms).toEqual({ hearth: 1 });
    expect(odd.hall.gifts.map((g) => g.id)).toEqual([2, 3]);
    expect(countItem(odd.bank, 'log')).toBe(17);
    expect(odd.hall.given).toBe(3);
  });

  it('leaving the hall takes the rooms and their perks with it', () => {
    const s = member({ hearth: 2, strong: 1 });
    expect(hallPerks(s, ctx)).toHaveLength(2);
    const gone = applyHallSync(s, { id: null, rooms: {}, took: [], given: 0 }, ctx);
    expect(gone.hall).toEqual({ id: null, rooms: {}, gifts: [], given: 0 });
    expect(hallPerks(gone, ctx)).toEqual([]);
    expect(eventsOfType(gone, 'raised')).toEqual([]);
  });
});

describe('the hall: what the rooms do', () => {
  it('the hearth adds to every skill’s xp, on top of god and gear', () => {
    expect(xpAwarded(member(), 'mining', 10, ctx)).toBe(10);
    expect(xpAwarded(member({ hearth: 1 }), 'mining', 10, ctx)).toBe(15);
    expect(xpAwarded(member({ hearth: 2 }), 'fishing', 10, ctx)).toBe(20);
    const sworn = { ...member({ hearth: 1 }), player: { name: 'x', god: 'stone-god' } };
    expect(xpAwarded(sworn, 'mining', 10, ctx)).toBe(20);
  });

  it('the store lands a gathering cycle twice', () => {
    let s = beginAction(
      member({ store: 1 }),
      { kind: 'fishing', water: 'sure-water', count: 2 },
      ctx,
    );
    for (let i = 0; i < 8; i++) s = stepTick(s, ctx);
    expect(countItem(s.bank, 'fish')).toBe(5 + 4);
  });

  it('the larder makes food heal more', () => {
    const hungry = (rooms: Record<string, number>) => {
      const s = member(rooms, {
        combat: { ...createSimState(1).combat, hp: 1, food: 'cooked-fish' },
      });
      return { ...s, bank: addItem(s.bank, 'cooked-fish', 1) };
    };
    expect(eat(hungry({}), ctx)?.combat.hp).toBe(6);
    expect(eat(hungry({ larder: 1 }), ctx)?.combat.hp).toBe(10);
  });

  it('the strongroom adds bank slots', () => {
    expect(bankCapacity(member(), ctx)).toBe(BASE_BANK_SLOTS);
    expect(bankCapacity(member({ strong: 1 }), ctx)).toBe(BASE_BANK_SLOTS + 5);
  });

  it('the tower makes the night longer, on top of the lamp', () => {
    expect(offlineCapTicks(member(), ctx)).toBe(OFFLINE_CAP_TICKS);
    expect(offlineCapTicks(member({ tower: 1 }), ctx)).toBe(OFFLINE_CAP_TICKS + 2 * TICKS_PER_HOUR);
    const lit = member({ tower: 1 }, { upgrades: { lamp: 1 } });
    expect(offlineCapTicks(lit, ctx)).toBe(18 * TICKS_PER_HOUR);
  });

  it('the pyre cuts the ferryman’s fee', () => {
    const helm = content.item('helm');
    expect(ferrymanFee(helm, member(), ctx)).toBe(2 * helm.value);
    expect(hallFerrymanDiscount(member({ pyre: 1 }), ctx)).toBe(0.5);
    expect(ferrymanFee(helm, member({ pyre: 1 }), ctx)).toBe(helm.value);
  });
});
