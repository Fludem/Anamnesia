import { describe, expect, it } from 'vitest';
import type { HallView } from '../api/protocol.ts';
import { addItem } from '../sim/items.ts';
import { createSimState, type SimState } from '../sim/save.ts';
import { fixtureContext as ctx } from '../sim/testing/fixture.ts';
import {
  agoLine,
  cartLines,
  needLine,
  numeral,
  perkLine,
  perkLines,
  roomRows,
} from './derive-hall.ts';

const view: HallView = {
  id: 7,
  name: 'The Quiet Hall',
  founder: 'Alpha',
  foundedAt: 0,
  members: [],
  rooms: [
    {
      room: 'hearth',
      tier: 1,
      progress: [
        { what: 'log', have: 5, need: 20 },
        { what: 'stone', have: 5, need: 5 },
        { what: '$gp', have: 0, need: 100 },
      ],
    },
    { room: 'store', tier: 1, progress: [] },
  ],
  ledger: [],
};

function member(): SimState {
  const s = createSimState(1);
  return {
    ...s,
    bank: addItem(s.bank, 'log', 3),
    coins: 0,
    hall: {
      id: 7,
      rooms: { hearth: 1, store: 1 },
      gifts: [{ id: 1, room: 'hearth', tier: 2, item: 'log', qty: 2 }],
      given: 1,
    },
  };
}

describe('derive-hall', () => {
  it('rows carry the tier, the perks either side, the needs and whether this name can give', () => {
    const rows = roomRows(view, member(), ctx);
    const hearth = rows.find((r) => r.room.id === 'hearth')!;
    expect(hearth.tier).toBe(1);
    expect(hearth.sub).toBe('stands at I · next +100% xp in every skill');
    expect(hearth.needs.map(needLine)).toEqual(['5/20 Log', '5 Stone', '0/100 gp']);
    expect(hearth.needs.map((n) => [n.held, n.met])).toEqual([
      [3, false],
      [0, true],
      [0, false],
    ]);
    expect(hearth.fraction).toBeCloseTo(10 / 125);
    expect(hearth.canGive).toBe(true);
    const store = rows.find((r) => r.room.id === 'store')!;
    expect(store.sub).toBe('stands at I · finished');
    expect(store.fraction).toBe(1);
    expect(store.canGive).toBe(false);
    const larder = rows.find((r) => r.room.id === 'larder')!;
    expect(larder.sub).toBe('not yet raised · next food heals 100% more');
    expect(larder.needs).toEqual([]);
  });

  it('perk lines, the cart, numerals and ago', () => {
    expect(perkLines(member(), ctx)).toEqual([
      '+50% xp in every skill',
      'gathering lands twice 100% of the time',
    ]);
    expect(perkLine({ kind: 'double-yield', skill: 'mining', chance: 0.03 }, ctx)).toBe(
      'Mining lands twice 3% of the time',
    );
    expect(perkLine({ kind: 'bank-slots', slots: 5 }, ctx)).toBe('+5 bank slots');
    expect(perkLine({ kind: 'night', hours: 2 }, ctx)).toBe('the night lasts 2 h longer');
    expect(perkLine({ kind: 'ferryman', discount: 0.1 }, ctx)).toBe('the ferryman takes 10% less');
    expect(cartLines(member().hall.gifts, ctx)).toEqual(['2 Log for Hearth']);
    expect([0, 1, 3, 6].map(numeral)).toEqual(['', 'I', 'III', '6']);
    expect([null, 0, 5 * 60_000, 3 * 3_600_000, 3 * 86_400_000].map(agoLine)).toEqual([
      'never seen',
      'just now',
      '5 min ago',
      '3 h ago',
      '3 d ago',
    ]);
  });
});
