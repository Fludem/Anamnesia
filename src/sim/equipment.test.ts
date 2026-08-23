import { describe, expect, it } from 'vitest';
import { heroStats } from './combat.ts';
import { ContentDb } from './content/db.ts';
import { countItem } from './items.ts';
import { xpAwarded, xpMultiplier } from './perks.ts';
import { createSimState, type SimState } from './save.ts';
import { stepTick } from './step.ts';
import { FIXTURE_PACK, fixtureContext as ctx, fightingState } from './testing/fixture.ts';
import { eventsOfType } from './events.ts';
import { beginAction } from './actions.ts';
import type { SimContext } from './context.ts';

const wearing = (s: SimState, equipment: Partial<SimState['equipment']>): SimState => ({
  ...s,
  equipment: { ...s.equipment, ...equipment },
});
const run = (s: SimState, ticks: number, c: SimContext = ctx): SimState => {
  for (let i = 0; i < ticks; i++) s = stepTick(s, c);
  return s;
};

describe('xp from gear', () => {
  it('a cape pays more in its skill, a pendant everywhere, and the god adds on top', () => {
    const s = createSimState(1);
    expect(xpMultiplier(s, 'mining', ctx)).toBe(1);
    const caped = wearing(s, { cape: 'cape' });
    expect(xpMultiplier(caped, 'mining', ctx)).toBe(1.5);
    expect(xpMultiplier(caped, 'woodcutting', ctx)).toBe(1);
    const both = wearing(caped, { amulet: 'pendant' });
    expect(xpMultiplier(both, 'mining', ctx)).toBe(1.75);
    expect(xpMultiplier(both, 'fishing', ctx)).toBe(1.25);
    // Sworn to the stone god (+50% mining in the fixture): the bonuses add, not multiply.
    const sworn: SimState = { ...both, player: { ...both.player, god: 'stone-god' } };
    expect(xpMultiplier(sworn, 'mining', ctx)).toBe(2.25);
    expect(xpAwarded(sworn, 'mining', 10, ctx)).toBe(22.5);
  });

  it('a cape in the bank pays nothing; tools never boost', () => {
    const s = { ...createSimState(1), bank: [{ item: 'cape', qty: 1 }] };
    expect(xpMultiplier(s, 'mining', ctx)).toBe(1);
  });
});

describe('ammo', () => {
  it('the javelin in the slot adds to the swing; every landed swing throws one from the bank', () => {
    const base = fightingState(7, 'goat', { weapon: 'sword', ammo: 'javelin' });
    const s0: SimState = { ...base, bank: [{ item: 'javelin', qty: 2 }] };
    const bare = heroStats(fightingState(7, 'goat', { weapon: 'sword' }), ctx);
    const armed = heroStats(s0, ctx);
    expect(armed.attack).toBe(bare.attack + 5);
    expect(armed.strength).toBe(bare.strength + 4);
    // The fixture sword always lands: one javelin per swing, the bank first.
    const s1 = run(s0, 30);
    expect(countItem(s1.bank, 'javelin')).toBe(1);
    expect(s1.equipment.ammo).toBe('javelin');
    expect(s1.stats.thrown).toBe(1);
    const s2 = run(s1, 30);
    expect(countItem(s2.bank, 'javelin')).toBe(0);
    expect(s2.equipment.ammo).toBe('javelin');
    // The last one goes from the hand, and the numbers drop with it.
    const s3 = run(s2, 30);
    expect(s3.equipment.ammo).toBeNull();
    expect(s3.stats.thrown).toBe(3);
    expect(heroStats(s3, ctx).attack).toBe(bare.attack);
    expect(run(s3, 30).stats.thrown).toBe(3);
  });

  it('a miss throws nothing, and death never takes the javelin', () => {
    // The spear misses the goat now and then; every cycle is a swing, so throws < swings.
    const s0: SimState = {
      ...fightingState(5, 'goat', { weapon: 'spear', ammo: 'javelin', body: 'cuirass' }),
      bank: [{ item: 'javelin', qty: 500 }],
    };
    const s = run(s0, 700);
    expect(eventsOfType(s, 'died')).toEqual([]);
    const swings = s.stats.actions['combat'] ?? 0;
    expect(swings).toBeGreaterThan(15);
    expect(s.stats.thrown).toBeGreaterThan(swings / 2);
    expect(s.stats.thrown).toBeLessThan(swings);
    expect(s.stats.thrown).toBe(500 - countItem(s.bank, 'javelin'));
    for (let seed = 1; seed <= 6; seed++) {
      const only = fightingState(seed, 'brute', { ammo: 'javelin', head: 'helm' });
      let f = only;
      let died = eventsOfType(f, 'died');
      for (let i = 0; i < 400 && died.length === 0; i++) {
        f = stepTick(f, ctx);
        died = eventsOfType(f, 'died');
      }
      expect(died[0]?.lost).toBe('helm');
      expect(f.equipment.ammo).toBe('javelin');
    }
  });
});

describe('marks', () => {
  it('a javelin under a staff adds nothing and is never thrown; a mark under a sword the same', () => {
    const staffBare = heroStats(fightingState(7, 'goat', { weapon: 'staff', ammo: 'mark' }), ctx);
    const staffJav: SimState = {
      ...fightingState(7, 'goat', { weapon: 'staff', ammo: 'mark' }),
      equipment: { ...fightingState(7, 'goat').equipment, weapon: 'staff', ammo: 'javelin' },
      bank: [{ item: 'javelin', qty: 5 }],
    };
    expect(heroStats(staffJav, ctx).attack).toBe(staffBare.attack - 5);
    const swordBare = heroStats(fightingState(7, 'goat', { weapon: 'sword' }), ctx);
    const s0: SimState = {
      ...fightingState(7, 'goat', { weapon: 'sword', ammo: 'mark' }),
      bank: [{ item: 'mark', qty: 5 }],
    };
    expect(heroStats(s0, ctx).attack).toBe(swordBare.attack);
    const s = run(s0, 90);
    expect(s.stats.thrown).toBe(0);
    expect(s.stats.cast).toBe(0);
    expect(countItem(s.bank, 'mark')).toBe(5);
    expect(s.equipment.ammo).toBe('mark');
  });

  it('marks go one per landed cast, the bank first, then the hand; death never takes the mark', () => {
    const s0: SimState = {
      ...fightingState(7, 'goat', { weapon: 'staff', ammo: 'mark' }),
      bank: [{ item: 'mark', qty: 2 }],
    };
    const s1 = run(s0, 30);
    expect(countItem(s1.bank, 'mark')).toBe(1);
    expect(s1.equipment.ammo).toBe('mark');
    expect(s1.stats.cast).toBe(1);
    const s3 = run(s1, 60);
    expect(s3.equipment.ammo).toBeNull();
    expect(s3.stats.cast).toBe(3);
    for (let seed = 1; seed <= 4; seed++) {
      let f: SimState = {
        ...fightingState(seed, 'brute', { weapon: 'staff', ammo: 'mark', head: 'helm' }),
        bank: [{ item: 'mark', qty: 500 }],
      };
      let died = eventsOfType(f, 'died');
      for (let i = 0; i < 400 && died.length === 0; i++) {
        f = stepTick(f, ctx);
        died = eventsOfType(f, 'died');
      }
      expect(['helm', 'staff']).toContain(died[0]?.lost);
      expect(f.equipment.ammo).toBe('mark');
    }
  });
});

describe('finds', () => {
  /** The fixture with mining finding a cape every cycle, and combat claiming to. */
  const pack = {
    ...FIXTURE_PACK,
    skills: FIXTURE_PACK.skills.map((sk) =>
      sk.id === 'mining' || sk.id === 'combat'
        ? { ...sk, finds: { nothingWeight: 0, entries: [{ item: 'cape', weight: 1 }] } }
        : sk,
    ),
  };
  const finding: SimContext = { ...ctx, content: ContentDb.fromPack(pack) };
  const mining = (s: SimState) =>
    beginAction(s, { kind: 'mining', rock: 'flaky-rock', count: null }, finding);

  it('a successful cycle rolls the skill’s finds on top of its haul, and says so', () => {
    let s = mining(createSimState(1));
    let found = eventsOfType(s, 'found');
    for (let i = 0; i < 200 && found.length === 0; i++) {
      s = stepTick(s, finding);
      found = eventsOfType(s, 'found');
    }
    expect(found[0]).toMatchObject({ skill: 'mining', items: [{ item: 'cape', qty: 1 }] });
    expect(countItem(s.bank, 'cape')).toBeGreaterThan(0);
    expect(s.stats.items['cape']).toBe(countItem(s.bank, 'cape'));
    // Failed cycles find nothing: the flaky rock pays ore and cape together or not at all.
    const gains = eventsOfType(s, 'gain').length;
    expect(found.length).toBe(gains);
  });

  it('a full bank finds nothing and spends no rng; a fight never rolls', () => {
    const junk = Array.from({ length: 30 }, (_, i) => ({ item: `junk-${String(i)}`, qty: 1 }));
    const fullPack = {
      ...pack,
      items: [
        ...pack.items,
        ...junk.map((j) => ({ id: j.item, name: j.item, icon: 'lorc/rock', value: 1 })),
      ],
    };
    const full: SimContext = { ...ctx, content: ContentDb.fromPack(fullPack) };
    const plain: SimContext = {
      ...ctx,
      content: ContentDb.fromPack({ ...fullPack, skills: FIXTURE_PACK.skills }),
    };
    const s0 = { ...createSimState(3), bank: [...junk, { item: 'ore', qty: 1 }] };
    const req = { kind: 'mining', rock: 'sure-rock', count: null } as const;
    const a = run(beginAction(s0, req, full), 20, full);
    const b = run(beginAction(s0, req, plain), 20, plain);
    expect(countItem(a.bank, 'cape')).toBe(0);
    expect(eventsOfType(a, 'found')).toEqual([]);
    expect(a.rng).toEqual(b.rng);
    expect(a.bank).toEqual(b.bank);
    const fought = run(fightingState(7, 'goat', { weapon: 'sword' }), 120, finding);
    expect(eventsOfType(fought, 'kill').length).toBeGreaterThan(0);
    expect(eventsOfType(fought, 'found')).toEqual([]);
  });
});
