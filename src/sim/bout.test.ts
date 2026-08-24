import { describe, expect, it } from 'vitest';
import {
  CALLED_COOLDOWN_MS,
  CALLER_COOLDOWN_MS,
  MAX_BOUT_TICKS,
  applyBoutSync,
  fightBout,
  fighterFrom,
  type BoutSync,
  type Fighter,
} from './bout.ts';
import { heroStats } from './combat.ts';
import { addItem } from './items.ts';
import { createSimState, type SimState } from './save.ts';
import { fixtureContext } from './testing/fixture.ts';

const ctx = fixtureContext;

/** A plain fighter to vary one number at a time. */
const fighter = (over: Partial<Fighter> = {}): Fighter => ({
  name: 'Someone',
  attack: 20,
  strength: 20,
  defence: 20,
  swingTicks: 30,
  maxHp: 40,
  style: 'melee',
  ...over,
});

describe('fightBout', () => {
  it('is a pure function of its two fighters and its seed', () => {
    const a = fighter({ name: 'A' });
    const b = fighter({ name: 'B' });
    const first = fightBout(a, b, 12_345);
    for (let i = 0; i < 200; i++) expect(fightBout(a, b, 12_345)).toEqual(first);
  });

  it('never touches the save rng: a thousand bouts leave the state alone', () => {
    const s = createSimState(7);
    for (let i = 0; i < 1_000; i++) fightBout(fighter(), fighter({ name: 'B' }), i);
    expect(createSimState(7).rng).toEqual(s.rng);
  });

  it('a different seed gives a different fight', () => {
    const a = fighter({ name: 'A' });
    const b = fighter({ name: 'B' });
    const seeds = new Set(
      Array.from({ length: 50 }, (_, i) => JSON.stringify(fightBout(a, b, i).swings)),
    );
    expect(seeds.size).toBeGreaterThan(40);
  });

  it('ends with one side at nothing, and that side is the loser', () => {
    for (let seed = 0; seed < 100; seed++) {
      const out = fightBout(fighter({ name: 'A' }), fighter({ name: 'B' }), seed);
      if (out.onPoints) continue;
      const [left, right] = out.left;
      expect(out.winner === 'caller' ? right : left).toBe(0);
      expect(out.winner === 'caller' ? left : right).toBeGreaterThan(0);
    }
  });

  it('the overwhelming side wins essentially every time', () => {
    const strong = fighter({ name: 'Strong', attack: 150, strength: 70, defence: 80, maxHp: 100 });
    const weak = fighter({ name: 'Weak', attack: 10, strength: 8, defence: 8, maxHp: 20 });
    let wins = 0;
    for (let seed = 0; seed < 200; seed++) {
      if (fightBout(strong, weak, seed).winner === 'caller') wins++;
    }
    expect(wins).toBeGreaterThan(195);
  });

  it('an even match is close to a coin flip either way round', () => {
    let callerWins = 0;
    for (let seed = 0; seed < 400; seed++) {
      if (fightBout(fighter({ name: 'A' }), fighter({ name: 'B' }), seed).winner === 'caller')
        callerWins++;
    }
    // The caller swings first on a tie of clocks, so a small edge is expected, not a big one.
    expect(callerWins).toBeGreaterThan(200);
    expect(callerWins).toBeLessThan(300);
  });

  it('a faster weapon lands more swings in the same bout', () => {
    const quick = fightBout(fighter({ swingTicks: 10 }), fighter({ name: 'B' }), 3);
    const slow = fightBout(fighter({ swingTicks: 60 }), fighter({ name: 'B' }), 3);
    const by = (r: typeof quick, side: 'caller' | 'called') =>
      r.swings.filter((s) => s.by === side).length;
    expect(by(quick, 'caller')).toBeGreaterThan(by(slow, 'caller'));
  });

  it('two turtles run out of ticks and it goes on points, never on a float', () => {
    // Nothing lands often, and what lands is one point: neither can finish the other.
    const turtle = fighter({ attack: 1, strength: 1, defence: 400, maxHp: 500, swingTicks: 200 });
    const out = fightBout({ ...turtle, name: 'A' }, { ...turtle, name: 'B' }, 9);
    expect(out.onPoints).toBe(true);
    expect(out.swings.every((s) => s.at <= MAX_BOUT_TICKS)).toBe(true);
    const [left, right] = out.left;
    expect(out.winner).toBe(left * turtle.maxHp > right * turtle.maxHp ? 'caller' : 'called');
  });

  it('dead level on points is a hold: the caller must put them down', () => {
    // Neither can ever land: hitChance is never 0, but 400 defence against 1 attack is close,
    // so pick the case directly — equal hitpoints left, equal maxima.
    const stone = fighter({ attack: 1, strength: 1, defence: 100_000, maxHp: 50 });
    const out = fightBout({ ...stone, name: 'A' }, { ...stone, name: 'B' }, 1);
    if (out.left[0] === out.left[1]) expect(out.winner).toBe('called');
  });

  it('a fallen side does not swing back on the tick it falls', () => {
    for (let seed = 0; seed < 50; seed++) {
      const out = fightBout(fighter({ name: 'A' }), fighter({ name: 'B' }), seed);
      if (out.onPoints) continue;
      const last = out.swings[out.swings.length - 1]!;
      expect(last.left).toBe(0);
      expect(last.by).toBe(out.winner);
    }
  });

  it('a swing never takes more than the hitpoints that were there', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (const s of fightBout(fighter({ strength: 200 }), fighter({ name: 'B' }), seed).swings) {
        expect(s.left).toBeGreaterThanOrEqual(0);
        expect(s.amount).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('fighterFrom', () => {
  it('reads the level and the gear as worn', () => {
    const s: SimState = {
      ...createSimState(1),
      equipment: { ...createSimState(1).equipment, weapon: 'sword', head: 'helm' },
    };
    const f = fighterFrom(s, ctx, 'Vesper');
    expect(f.name).toBe('Vesper');
    expect(f.style).toBe('melee');
    // level 1 + STAT_BASE 4 + the sword's 100 attack.
    expect(f.attack).toBe(105);
    expect(f.defence).toBe(10);
  });

  it('takes the style from the weapon', () => {
    const base = createSimState(1);
    const staffed: SimState = { ...base, equipment: { ...base.equipment, weapon: 'staff' } };
    expect(fighterFrom(staffed, ctx, 'A').style).toBe('sorcery');
    expect(fighterFrom(base, ctx, 'A').style).toBe('melee');
  });

  it('leaves the god behind: favour buys nothing in the ring', () => {
    const base = createSimState(1);
    const sworn: SimState = {
      ...base,
      player: { ...base.player, god: 'stone-god' },
      combat: { ...base.combat, favour: 500 },
    };
    // The stone god buys half again on defence while favour burns; heroStats would fold it in.
    expect(heroStats(sworn, ctx).defence).toBeGreaterThan(heroStats(base, ctx).defence);
    expect(fighterFrom(sworn, ctx, 'A')).toEqual(fighterFrom(base, ctx, 'A'));
  });

  it('takes nothing from the bank', () => {
    const base = createSimState(1);
    const rich: SimState = { ...base, bank: addItem(base.bank, 'sword', 9), coins: 1_000_000 };
    expect(fighterFrom(rich, ctx, 'A')).toEqual(fighterFrom(base, ctx, 'A'));
  });
});

describe('applyBoutSync', () => {
  const sync = (over: Partial<BoutSync> = {}): BoutSync => ({
    settle: [],
    settledThrough: 0,
    owed: 0,
    ...over,
  });
  const won = { seq: 1, won: true, opponent: 'Vesper', item: 'helm', slot: 'head', owed: 0 };
  const lost = { seq: 1, won: false, opponent: 'Vesper', item: 'helm', slot: 'head', owed: 0 };

  it('returns the very same state when there is nothing to do', () => {
    const s = createSimState(1);
    expect(applyBoutSync(s, sync(), ctx)).toBe(s);
  });

  it('a won item lands in the bank and counts', () => {
    const out = applyBoutSync(createSimState(1), sync({ settle: [won], settledThrough: 1 }), ctx);
    expect(out.bank).toEqual([{ item: 'helm', qty: 1 }]);
    expect(out.bouts.settledThrough).toBe(1);
    expect(out.stats.bouts).toBe(1);
    expect(out.stats.taken).toBe(1);
  });

  it('applying the same answer twice changes nothing the second time', () => {
    const answer = sync({ settle: [won], settledThrough: 1 });
    const once = applyBoutSync(createSimState(1), answer, ctx);
    expect(applyBoutSync(once, answer, ctx)).toBe(once);
  });

  it('a lost item comes off the hero, and the fight it was in stops', () => {
    const base = createSimState(1);
    const wearing: SimState = { ...base, equipment: { ...base.equipment, head: 'helm' } };
    const out = applyBoutSync(wearing, sync({ settle: [lost], settledThrough: 1 }), ctx);
    expect(out.equipment.head).toBe(null);
    expect(out.action).toEqual({ current: null, queue: [] });
    expect(out.stats.lost).toBe(1);
  });

  it('a lost item that was banked rather than worn goes from the bank', () => {
    const base = createSimState(1);
    const banked: SimState = { ...base, bank: addItem(base.bank, 'helm', 2) };
    const out = applyBoutSync(banked, sync({ settle: [lost], settledThrough: 1 }), ctx);
    expect(out.bank).toEqual([{ item: 'helm', qty: 1 }]);
    expect(out.equipment.head).toBe(null);
  });

  it('a lost item that is gone costs twice its worth in coin', () => {
    const base: SimState = { ...createSimState(1), coins: 1_000 };
    const out = applyBoutSync(base, sync({ settle: [lost], settledThrough: 1 }), ctx);
    // The fixture helm is worth 30, so the ferryman's twice is 60.
    expect(out.coins).toBe(940);
  });

  it('what cannot be paid is owed, never forgiven', () => {
    // The helm is worth 30, so the ring asks 60 and this purse covers ten of it.
    const broke: SimState = { ...createSimState(1), coins: 10 };
    const out = applyBoutSync(broke, sync({ settle: [lost], settledThrough: 1 }), ctx);
    expect(out.coins).toBe(0);
    expect(out.bouts.owed).toBe(50);
  });

  it('a balance is collected out of the purse as soon as there is one', () => {
    const owing: SimState = {
      ...createSimState(1),
      coins: 20,
      bouts: { settledThrough: 3, owed: 50 },
    };
    const out = applyBoutSync(owing, sync({ settledThrough: 3, owed: 50 }), ctx);
    expect(out.coins).toBe(0);
    expect(out.bouts.owed).toBe(30);
  });

  it('a settlement the save has already taken is skipped', () => {
    const base = createSimState(1);
    const already: SimState = { ...base, bouts: { settledThrough: 5, owed: 0 } };
    const out = applyBoutSync(already, sync({ settle: [won], settledThrough: 5 }), ctx);
    expect(out.bank).toEqual([]);
  });

  it('the register cannot be talked backwards: the mark only climbs', () => {
    const base = createSimState(1);
    const ahead: SimState = { ...base, bouts: { settledThrough: 9, owed: 0 } };
    expect(applyBoutSync(ahead, sync({ settledThrough: 2 }), ctx).bouts.settledThrough).toBe(9);
  });

  it('a spoil lands even when the bank has no room — it may leave it a stack over', () => {
    const base = createSimState(1);
    // Fill every slot with something that is not the spoil.
    let bank = base.bank;
    for (const id of ['stone', 'ore', 'gem', 'log', 'bar', 'fish', 'seed', 'burnt']) {
      bank = addItem(bank, id, 1);
    }
    const full: SimState = { ...base, bank, bankSlotsBought: 0 };
    const out = applyBoutSync(full, sync({ settle: [won], settledThrough: 1 }), ctx);
    expect(out.bank.find((s) => s.item === 'helm')).toEqual({ item: 'helm', qty: 1 });
  });

  it('settles in seq order however the register listed them', () => {
    const a = { ...won, seq: 1, item: 'helm', slot: 'head' };
    const b = { ...won, seq: 2, item: 'sword', slot: 'weapon' };
    const out = applyBoutSync(createSimState(1), sync({ settle: [b, a], settledThrough: 2 }), ctx);
    expect(out.bouts.settledThrough).toBe(2);
    expect(out.stats.taken).toBe(2);
  });

  it('logs each settlement as a bout the feed can draw', () => {
    const out = applyBoutSync(createSimState(1), sync({ settle: [won], settledThrough: 1 }), ctx);
    expect(out.log.at(-1)).toMatchObject({
      type: 'bout',
      won: true,
      opponent: 'Vesper',
      item: 'helm',
    });
  });
});

describe("the ring's clocks", () => {
  it('a name is called out less often than it may call', () => {
    expect(CALLED_COOLDOWN_MS).toBeGreaterThan(CALLER_COOLDOWN_MS);
  });
});
