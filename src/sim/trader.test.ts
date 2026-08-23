import { describe, expect, it } from 'vitest';
import { beginAction } from './actions.ts';
import { applyCommand } from './commands.ts';
import { OFFLINE_CAP_TICKS } from './constants.ts';
import { ContentDb } from './content/db.ts';
import type { SimContext } from './context.ts';
import { eventsOfType } from './events.ts';
import { countItem } from './items.ts';
import { createSimState, type SimState } from './save.ts';
import { ferrymanFee } from './skills/combat.ts';
import { stepTick } from './step.ts';
import { FIXTURE_PACK, fixtureContext as ctx, fightingState } from './testing/fixture.ts';
import {
  buyWare,
  findsRolls,
  oathsReleased,
  offlineCapTicks,
  warePrice,
  wareStatus,
} from './trader.ts';

const content = ctx.content;
const rich = (coins: number, extra: Partial<SimState> = {}): SimState => ({
  ...createSimState(1),
  coins,
  ...extra,
});
const buy = (s: SimState, ware: string) => applyCommand(s, { type: 'trader:buy', ware }, ctx);

describe('the trader', () => {
  it('prices a ware from its base, its growth and how often it was bought, rounded to 10', () => {
    const s = rich(0);
    expect(warePrice(content.ware('lamp'), s)).toBe(500);
    expect(warePrice(content.ware('release'), s)).toBe(1000);
    const twice = { ...s, upgrades: { release: 2 } };
    expect(warePrice(content.ware('release'), twice)).toBe(4000);
    const odd = { ...content.ware('release'), price: 333, growth: 1.5 };
    expect(warePrice(odd, { ...s, upgrades: { release: 1 } })).toBe(500);
  });

  it('knows what is owned, what is locked behind another ware, and what is for sale', () => {
    const s = rich(0);
    expect(wareStatus(content.ware('lamp'), s)).toBe('for-sale');
    expect(wareStatus(content.ware('wick'), s)).toBe('locked');
    const lit = { ...s, upgrades: { lamp: 1 } };
    expect(wareStatus(content.ware('lamp'), lit)).toBe('owned');
    expect(wareStatus(content.ware('wick'), lit)).toBe('for-sale');
    // A repeatable ware is never "owned".
    expect(wareStatus(content.ware('release'), { ...s, upgrades: { release: 3 } })).toBe(
      'for-sale',
    );
  });

  it('refuses the unknown, the locked, the owned and the unaffordable, leaving the state alone', () => {
    const s = rich(400);
    for (const [ware, reason] of [
      ['nothing', /unknown ware/],
      ['wick', /comes after Lamp/],
      ['lamp', /costs 500 gp \(you have 400\)/],
    ] as const) {
      const r = buy(s, ware);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toMatch(reason);
      expect(r.state).toBe(s);
    }
    const owned = { ...rich(9000), upgrades: { lamp: 1 } };
    const again = buyWare(owned, 'lamp', ctx);
    expect(!again.ok && again.reason).toMatch(/already have Lamp/);
    const unsworn = buyWare(rich(9000), 'release', ctx);
    expect(!unsworn.ok && unsworn.reason).toMatch(/no oath/);
  });

  it('a purchase takes the coins, counts them as spent and records the ware', () => {
    const r = buy(rich(600), 'lamp');
    expect(r.ok).toBe(true);
    expect(r.state.coins).toBe(100);
    expect(r.state.stats.spent).toBe(500);
    expect(r.state.upgrades).toEqual({ lamp: 1 });
    // Bank slots count as spent too.
    const slot = applyCommand(rich(600), { type: 'bank:buy-slot' }, ctx);
    expect(slot.ok && slot.state.stats.spent).toBe(500);
  });

  it('the lamp ladder raises the offline cap and never lowers it', () => {
    const s = rich(0);
    expect(offlineCapTicks(s, ctx)).toBe(OFFLINE_CAP_TICKS);
    expect(offlineCapTicks({ ...s, upgrades: { lamp: 1 } }, ctx)).toBe(16 * 36_000);
    expect(offlineCapTicks({ ...s, upgrades: { lamp: 1, wick: 1 } }, ctx)).toBe(24 * 36_000);
    // A lamp shorter than the base cap would be pointless; the base wins.
    const dim: SimContext = {
      ...ctx,
      content: ContentDb.fromPack({
        ...FIXTURE_PACK,
        wares: [
          {
            id: 'lamp',
            name: 'Lamp',
            line: 'Dim.',
            icon: 'lorc/lantern',
            price: 1,
            effect: { kind: 'offline-cap', hours: 2 },
          },
        ],
      }),
    };
    expect(offlineCapTicks({ ...s, upgrades: { lamp: 1 } }, dim)).toBe(OFFLINE_CAP_TICKS);
  });

  it('a second look rolls the finds twice', () => {
    const pack = {
      ...FIXTURE_PACK,
      skills: FIXTURE_PACK.skills.map((sk) =>
        sk.id === 'mining'
          ? { ...sk, finds: { nothingWeight: 0, entries: [{ item: 'cape', weight: 1 }] } }
          : sk,
      ),
    };
    const finding: SimContext = { ...ctx, content: ContentDb.fromPack(pack) };
    const req = { kind: 'mining', rock: 'sure-rock', count: null } as const;
    const once = createSimState(2);
    expect(findsRolls(once, finding)).toBe(1);
    const twice = { ...once, upgrades: { 'second-look': 1 } };
    expect(findsRolls(twice, finding)).toBe(2);
    let a = beginAction(once, req, finding);
    let b = beginAction(twice, req, finding);
    for (let i = 0; i < 40; i++) {
      a = stepTick(a, finding);
      b = stepTick(b, finding);
    }
    const cycles = a.stats.actions['mining'] ?? 0;
    expect(cycles).toBeGreaterThan(3);
    expect(countItem(a.bank, 'cape')).toBe(cycles);
    expect(countItem(b.bank, 'cape')).toBe(2 * cycles);
    expect(eventsOfType(b, 'found')[0]?.items).toEqual([{ item: 'cape', qty: 2 }]);
  });

  it('release lets go of the god, doubles in price, keeps the favour, and the hero swears again', () => {
    const base = rich(3000);
    const sworn: SimState = {
      ...base,
      player: { ...base.player, god: 'stone-god' },
      combat: { ...base.combat, favour: 40 },
    };
    const r1 = buy(sworn, 'release');
    expect(r1.ok).toBe(true);
    expect(r1.state.player.god).toBeNull();
    expect(r1.state.coins).toBe(2000);
    expect(r1.state.combat.favour).toBe(40);
    expect(oathsReleased(r1.state, ctx)).toBe(1);
    expect(warePrice(content.ware('release'), r1.state)).toBe(2000);
    const again = applyCommand(r1.state, { type: 'player:swear', god: 'sea-god' }, ctx);
    expect(again.ok && again.state.player.god).toBe('sea-god');
    const r2 = buy(again.ok ? again.state : r1.state, 'release');
    expect(r2.ok && r2.state.coins).toBe(0);
    expect(r2.ok && warePrice(content.ware('release'), r2.state)).toBe(4000);
  });
});

describe('the ferryman', () => {
  /** Fight the unkillable brute wearing only a helm until the hero falls. */
  const fall = (seed: number, extra: Partial<SimState>): SimState => {
    let s: SimState = { ...fightingState(seed, 'brute', { head: 'helm' }), ...extra };
    for (let i = 0; i < 400 && eventsOfType(s, 'died').length === 0; i++) s = stepTick(s, ctx);
    expect(eventsOfType(s, 'died')).toHaveLength(1);
    return s;
  };
  const fee = ferrymanFee(content.item('helm'), createSimState(1), ctx);

  it('charges twice what the thing is worth and the hero keeps it', () => {
    expect(fee).toBe(2 * content.item('helm').value);
    const s = fall(1, { coins: fee + 5 });
    expect(s.equipment.head).toBe('helm');
    expect(s.coins).toBe(5);
    expect(s.stats).toMatchObject({ deaths: 1, ferried: 1, spent: fee });
    expect(eventsOfType(s, 'died')[0]).toMatchObject({
      monster: 'brute',
      lost: null,
      kept: 'helm',
      paid: fee,
      obol: false,
    });
    // The fight ended and hitpoints refilled, as they always did.
    expect(s.combat.fight).toBeNull();
    expect(s.action.current).toBeNull();
  });

  it('an obol settles the crossing first, whatever the hero has', () => {
    const s = fall(2, { coins: fee + 5, bank: [{ item: 'obol', qty: 2 }] });
    expect(s.equipment.head).toBe('helm');
    expect(s.coins).toBe(fee + 5);
    expect(countItem(s.bank, 'obol')).toBe(1);
    expect(s.stats).toMatchObject({ ferried: 1, spent: 0 });
    expect(eventsOfType(s, 'died')[0]).toMatchObject({ kept: 'helm', paid: 0, obol: true });
  });

  it('too poor, or told not to pay, and the hill takes the item as before', () => {
    const poor = fall(3, { coins: fee - 1 });
    expect(poor.equipment.head).toBeNull();
    expect(poor.coins).toBe(fee - 1);
    expect(eventsOfType(poor, 'died')[0]).toMatchObject({ lost: 'helm', kept: null, paid: 0 });
    const base = createSimState(4);
    const refusing = fall(4, { coins: 10_000, combat: { ...base.combat, ferryman: false } });
    expect(refusing.equipment.head).toBeNull();
    expect(refusing.coins).toBe(10_000);
    expect(refusing.stats.ferried).toBe(0);
    const told = applyCommand(base, { type: 'combat:ferryman', pay: false }, ctx);
    expect(told.ok && told.state.combat.ferryman).toBe(false);
  });

  it('a bare hero owes nothing', () => {
    let s: SimState = { ...fightingState(5, 'brute'), coins: 100 };
    for (let i = 0; i < 400 && eventsOfType(s, 'died').length === 0; i++) s = stepTick(s, ctx);
    expect(eventsOfType(s, 'died')[0]).toMatchObject({ lost: null, kept: null, paid: 0 });
    expect(s.coins).toBe(100);
    expect(s.stats.ferried).toBe(0);
  });
});
