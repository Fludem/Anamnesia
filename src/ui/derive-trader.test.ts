import { describe, expect, it } from 'vitest';
import { createSimState, type SimState } from '../sim/save.ts';
import { fixtureContext as ctx } from '../sim/testing/fixture.ts';
import { deathLine, ferrymanView, nightHours, wareRows } from './derive-trader.ts';

describe('the trader view', () => {
  it('lists every ware with its price, status and what it does now', () => {
    const s0 = createSimState(1);
    const rows = wareRows(s0, ctx);
    expect(rows.map((r) => [r.ware.id, r.status, r.price, r.affordable])).toEqual([
      ['lamp', 'for-sale', 500, false],
      ['wick', 'locked', 2500, false],
      ['second-look', 'for-sale', 330, false],
      ['release', 'for-sale', 1000, false],
    ]);
    expect(rows[1]?.needs?.id).toBe('lamp');
    expect(rows[0]?.sub).toBe('offline progress counts for 16 h instead of 12');
    expect(rows[3]?.sub).toBe('sworn to nobody');
    const s: SimState = {
      ...s0,
      coins: 2500,
      upgrades: { lamp: 1, release: 1 },
      player: { ...s0.player, god: 'sea-god' },
    };
    const later = wareRows(s, ctx);
    expect(later.map((r) => [r.status, r.affordable])).toEqual([
      ['owned', true],
      ['for-sale', true],
      ['for-sale', true],
      ['for-sale', true],
    ]);
    expect(later[0]?.sub).toBe('the night lasts 16 h');
    expect(later[3]).toMatchObject({ price: 2000, bought: 1, sub: 'released 1× · favour is kept' });
    expect(nightHours(s, ctx)).toBe(16);
  });

  it('reads the ferryman: paying, obols, and the dearest thing a death could cost', () => {
    const s0 = createSimState(1);
    expect(ferrymanView(s0, ctx)).toEqual({ paying: true, obols: 0, worstFee: 0, worst: null });
    const s: SimState = {
      ...s0,
      equipment: { ...s0.equipment, head: 'helm', body: 'cuirass', pickaxe: 'pick' },
      bank: [{ item: 'obol', qty: 3 }],
      combat: { ...s0.combat, ferryman: false },
    };
    const fv = ferrymanView(s, ctx);
    expect(fv).toMatchObject({ paying: false, obols: 3, worstFee: 120 });
    expect(fv.worst?.id).toBe('cuirass');
  });

  it('says what a death cost in one line', () => {
    const base = { type: 'died' as const, tick: 1, monster: 'goat' };
    expect(deathLine({ ...base, lost: null, kept: null, paid: 0, obol: false }, ctx.content)).toBe(
      'the hill took nothing; you wore nothing',
    );
    expect(
      deathLine({ ...base, lost: 'helm', kept: null, paid: 0, obol: false }, ctx.content),
    ).toBe('the hill took your Helm');
    expect(
      deathLine({ ...base, lost: null, kept: 'helm', paid: 40, obol: false }, ctx.content),
    ).toBe('the ferryman took 40 gp for your Helm');
    expect(deathLine({ ...base, lost: null, kept: 'helm', paid: 0, obol: true }, ctx.content)).toBe(
      'an obol paid the ferryman · your Helm stays',
    );
  });
});
