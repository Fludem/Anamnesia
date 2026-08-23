import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands.ts';
import {
  BODY_SLOTS,
  WEAKNESS_BONUS,
  expectedSwingsToKill,
  heroStats,
  hitChance,
  maxHit,
  maxHitAgainst,
} from '../combat.ts';
import { eventsOfType, type SimEventOf } from '../events.ts';
import { countItem } from '../items.ts';
import { createSimState, type SimState } from '../save.ts';
import { stepTick } from '../step.ts';
import { fightingState, fixtureContext as ctx } from '../testing/fixture.ts';
import { combatHandler } from './combat.ts';

function run(state: SimState, ticks: number): SimState {
  let s = state;
  for (let i = 0; i < ticks; i++) s = stepTick(s, ctx);
  return s;
}

/** Step until an event of `type` appears (or give up). */
function runUntil<T extends 'kill' | 'died'>(
  state: SimState,
  type: T,
  limit = 2000,
): [SimState, SimEventOf<T>] {
  let s = state;
  for (let i = 0; i < limit; i++) {
    s = stepTick(s, ctx);
    const ev = eventsOfType(s, type);
    if (ev.length > 0) return [s, ev[ev.length - 1]!];
  }
  throw new Error(`no ${type} within ${String(limit)} ticks`);
}

describe('the numbers', () => {
  it('hero stats: level plus a base plus the worn body slots; tools count for nothing', () => {
    const s = createSimState(1);
    const bare = heroStats(s, ctx);
    expect(bare).toMatchObject({ attack: 5, strength: 5, defence: 5, swingTicks: 30, maxHp: 10 });
    const armed = heroStats(
      {
        ...s,
        equipment: {
          ...s.equipment,
          weapon: 'sword',
          head: 'helm',
          body: 'cuirass',
          pickaxe: 'pick',
        },
      },
      ctx,
    );
    expect(armed).toMatchObject({ attack: 105, strength: 15, defence: 20, swingTicks: 30 });
    const spear = heroStats({ ...s, equipment: { ...s.equipment, weapon: 'spear' } }, ctx);
    expect(spear.swingTicks).toBe(36);
    expect(BODY_SLOTS).not.toContain('pickaxe');
  });

  it('hit chance is attack against defence, never certain; max hit grows with strength', () => {
    expect(hitChance(5, 0)).toBeCloseTo(7 / 9);
    expect(hitChance(100000, 5)).toBeLessThan(1);
    expect(maxHit(5)).toBe(3);
    expect(maxHit(15)).toBe(8);
  });

  it('expected swings to kill counts overkill: 1 hp takes 1/chance swings', () => {
    expect(expectedSwingsToKill(1, 0.5, 3)).toBeCloseTo(2);
    expect(expectedSwingsToKill(6, 1, 1)).toBeCloseTo(6);
    expect(expectedSwingsToKill(6, 1, 8)).toBeLessThan(2);
  });
});

describe('a fight', () => {
  it('the first swing lands after the weapon’s ticks; a kill pays xp per damage and drops', () => {
    const s0 = fightingState(7, 'goat', { weapon: 'sword' });
    expect(s0.action.current?.durationTicks).toBe(30);
    const [s, kill] = runUntil(s0, 'kill');
    expect(kill.monster).toBe('goat');
    expect(kill.xp).toBe(12);
    expect(kill.coins).toBe(1);
    expect(countItem(s.bank, 'bone')).toBe(1);
    expect(countItem(s.bank, 'hide')).toBe(1);
    expect(s.coins).toBe(1);
    expect(s.stats.kills['goat']).toBe(1);
    expect(s.stats.items['bone']).toBe(1);
    // 2 xp per point of the goat's 6 hp, paid as the hits land; a third again to hitpoints.
    expect(s.skills['combat']?.xp).toBe(12);
    expect(s.skills['hitpoints']?.xp).toBeCloseTo(4, 0);
    // The next goat is already there, fresh.
    expect(s.combat.fight).toMatchObject({ monster: 'goat', hp: 6 });
    expect(s.action.current?.request).toEqual({ kind: 'combat', monster: 'goat', count: null });
    expect(s.combat.fight?.splats.some((p) => p.side === 'them' && p.kind === 'hit')).toBe(true);
  });

  it('the monster swings on its own clock and the hero eats below the threshold', () => {
    const base = fightingState(3, 'brute');
    const s0: SimState = {
      ...base,
      bank: [{ item: 'cooked-fish', qty: 3 }],
      combat: { ...base.combat, food: 'cooked-fish', eatAt: 0.5 },
    };
    // One hitpoint every second tick: 4 after tick 12; tick 14 eats first (9), then 8.
    expect(run(s0, 12).combat.hp).toBe(4);
    const s14 = run(s0, 14);
    expect(s14.combat.hp).toBe(8);
    expect(countItem(s14.bank, 'cooked-fish')).toBe(2);
    expect(s14.combat.fight?.splats.filter((p) => p.kind === 'heal')).toEqual([
      { tick: 14, side: 'you', kind: 'heal', amount: 5 },
    ]);
    // The food runs out and the brute finishes it.
    const [s, died] = runUntil(s14, 'died', 200);
    expect(died.monster).toBe('brute');
    expect(countItem(s.bank, 'cooked-fish')).toBe(0);
  });

  it('death takes one worn body item at random, never a tool, refills hitpoints, ends the action', () => {
    const taken = new Set<string | null>();
    for (let seed = 1; seed <= 12; seed++) {
      const s0 = fightingState(seed, 'brute', { pickaxe: 'pick', head: 'helm', body: 'cuirass' });
      const [s, died] = runUntil(s0, 'died', 200);
      expect(s.equipment.pickaxe).toBe('pick');
      const gone = (['head', 'body'] as const).filter((slot) => s.equipment[slot] === null);
      expect(gone).toHaveLength(1);
      expect(died.lost).toBe(gone[0] === 'head' ? 'helm' : 'cuirass');
      taken.add(died.lost);
      expect(s.combat.hp).toBe(heroStats(s, ctx).maxHp);
      expect(s.stats.deaths).toBe(1);
      expect(s.combat.fight).toBeNull();
      expect(s.action).toEqual({ current: null, queue: [] });
      // The world goes on afterwards.
      expect(() => run(s, 5)).not.toThrow();
    }
    expect(taken).toEqual(new Set(['helm', 'cuirass']));
  });

  it('with nothing worn, death takes nothing', () => {
    const [, died] = runUntil(fightingState(2, 'brute'), 'died', 200);
    expect(died.lost).toBeNull();
  });

  it('a death clears the queue too', () => {
    const s0 = fightingState(2, 'brute');
    const queued: SimState = {
      ...s0,
      action: { ...s0.action, queue: [{ kind: 'mining', rock: 'sure-rock', count: null }] },
    };
    const [s] = runUntil(queued, 'died', 200);
    expect(s.action.queue).toEqual([]);
  });

  it('is deterministic for a seed', () => {
    const a = run(fightingState(11, 'goat'), 400);
    const b = run(fightingState(11, 'goat'), 400);
    expect(a).toEqual(b);
    expect(eventsOfType(a, 'kill').length).toBeGreaterThan(0);
  });
});

describe('regeneration', () => {
  it('out of combat one hitpoint comes back every ten ticks, up to the maximum', () => {
    const s0: SimState = { ...createSimState(1), combat: { ...createSimState(1).combat, hp: 3 } };
    expect(run(s0, 9).combat.hp).toBe(3);
    expect(run(s0, 10).combat.hp).toBe(4);
    expect(run(s0, 200).combat.hp).toBe(10);
  });

  it('never ticks during a fight', () => {
    const f = fightingState(1, 'goat');
    const s0: SimState = { ...f, combat: { ...f.combat, hp: 5 } };
    expect(run(s0, 10).combat.hp).toBeLessThanOrEqual(5);
  });
});

describe('the other fight', () => {
  it('the style is the staff’s: a cast pays sorcery and a third to hitpoints, nothing to combat', () => {
    const s0: SimState = {
      ...fightingState(7, 'goat', { weapon: 'staff', ammo: 'mark' }),
      bank: [{ item: 'mark', qty: 50 }],
    };
    expect(heroStats(s0, ctx)).toMatchObject({ style: 'sorcery', skill: 'sorcery' });
    const [s, kill] = runUntil(s0, 'kill');
    expect(kill.xp).toBe(12);
    expect(s.skills['sorcery']?.xp).toBe(12);
    expect(s.skills['combat']).toBeUndefined();
    expect(s.skills['hitpoints']?.xp).toBeCloseTo(4, 0);
    expect(s.stats.actions['sorcery']).toBeGreaterThan(0);
    expect(s.stats.actions['combat']).toBeUndefined();
    expect(s.stats.cast).toBeGreaterThan(0);
    expect(s.stats.thrown).toBe(0);
  });

  it('a staff without marks cannot start, and stops itself when the last mark goes', () => {
    const bare = createSimState(1);
    const staff: SimState = { ...bare, equipment: { ...bare.equipment, weapon: 'staff' } };
    expect(
      combatHandler.canStart(staff, { kind: 'combat', monster: 'goat', count: null }, ctx),
    ).toEqual({ ok: false, reason: 'the staff wants marks' });
    const javelins: SimState = { ...staff, equipment: { ...staff.equipment, ammo: 'javelin' } };
    expect(
      combatHandler.canStart(javelins, { kind: 'combat', monster: 'goat', count: null }, ctx).ok,
    ).toBe(false);
    // One in hand, one in the bank: two casts, then the fight ends with its reason.
    const s0: SimState = {
      ...fightingState(7, 'goat', { weapon: 'staff', ammo: 'mark' }),
      bank: [{ item: 'mark', qty: 1 }],
    };
    const s = run(s0, 90);
    expect(s.stats.cast).toBe(2);
    expect(s.equipment.ammo).toBeNull();
    expect(countItem(s.bank, 'mark')).toBe(0);
    expect(s.action.current).toBeNull();
    expect(eventsOfType(s, 'stopped').at(-1)).toMatchObject({
      skill: 'sorcery',
      reason: 'the staff wants marks',
    });
  });

  it('a weakness raises the max hit by a quarter, never the accuracy', () => {
    const sword = heroStats(fightingState(1, 'goat', { weapon: 'sword' }), ctx);
    const staff = heroStats(fightingState(1, 'goat', { weapon: 'staff', ammo: 'mark' }), ctx);
    const goat = ctx.content.monster('goat'); // weak to sorcery
    const brute = ctx.content.monster('brute'); // weak to melee
    expect(maxHitAgainst(staff, goat)).toBe(
      Math.round(maxHit(staff.strength) * (1 + WEAKNESS_BONUS)),
    );
    expect(maxHitAgainst(staff, brute)).toBe(maxHit(staff.strength));
    expect(maxHitAgainst(sword, brute)).toBe(
      Math.round(maxHit(sword.strength) * (1 + WEAKNESS_BONUS)),
    );
    expect(maxHitAgainst(sword, goat)).toBe(maxHit(sword.strength));
    const req = { kind: 'combat' as const, monster: 'goat', count: null };
    const swing = combatHandler.successChance(
      fightingState(1, 'goat', { weapon: 'sword' }),
      req,
      ctx,
    );
    const cast = combatHandler.successChance(
      fightingState(1, 'goat', { weapon: 'staff', ammo: 'mark' }),
      req,
      ctx,
    );
    expect(cast).toBeCloseTo(hitChance(staff.attack, goat.stats.defence));
    expect(swing).toBeCloseTo(hitChance(sword.attack, goat.stats.defence));
  });

  it('the zone gate reads the style’s skill by name', () => {
    const bare = createSimState(1);
    const caster: SimState = {
      ...bare,
      equipment: { ...bare.equipment, weapon: 'staff', ammo: 'mark' },
      skills: { ...bare.skills, combat: { xp: 0 }, sorcery: { xp: ctx.xp.xpForLevel(20) } },
    };
    const req = { kind: 'combat' as const, monster: 'high', count: null };
    expect(combatHandler.canStart(caster, req, ctx)).toEqual({ ok: true });
    const sworded: SimState = { ...caster, equipment: { ...caster.equipment, weapon: 'sword' } };
    expect(combatHandler.canStart(sworded, req, ctx)).toEqual({
      ok: false,
      reason: 'The Heights wants Combat level 20 (you are 1)',
    });
    const unlevelled: SimState = { ...caster, skills: {} };
    expect(combatHandler.canStart(unlevelled, req, ctx)).toEqual({
      ok: false,
      reason: 'The Heights wants Sorcery level 20 (you are 1)',
    });
  });
});

describe('starting', () => {
  it('a zone above the hero’s level is locked by name', () => {
    const check = combatHandler.canStart(
      createSimState(1),
      { kind: 'combat', monster: 'high', count: null },
      ctx,
    );
    expect(check).toEqual({ ok: false, reason: 'The Heights wants Combat level 20 (you are 1)' });
  });

  it('unknown monsters and a full bank are refused', () => {
    const s = createSimState(1);
    expect(
      combatHandler.canStart(s, { kind: 'combat', monster: 'nope', count: null }, ctx).ok,
    ).toBe(false);
    const full: SimState = {
      ...s,
      bank: Array.from({ length: 999 }, (_, i) => ({ item: i % 2 ? 'stone' : 'ore', qty: 1 })),
    };
    const check = combatHandler.canStart(
      full,
      { kind: 'combat', monster: 'goat', count: null },
      ctx,
    );
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/bank is full/);
  });
});

describe('commands', () => {
  const s = createSimState(1);

  it('choosing food wants a consumable that heals; null clears it', () => {
    expect(applyCommand(s, { type: 'combat:food', item: 'stone' }, ctx)).toMatchObject({
      ok: false,
      reason: 'Stone is not food',
    });
    expect(applyCommand(s, { type: 'combat:food', item: 'nope' }, ctx).ok).toBe(false);
    const chosen = applyCommand(s, { type: 'combat:food', item: 'cooked-fish' }, ctx);
    expect(chosen.ok && chosen.state.combat.food).toBe('cooked-fish');
    const cleared = applyCommand(chosen.state, { type: 'combat:food', item: null }, ctx);
    expect(cleared.ok && cleared.state.combat.food).toBeNull();
  });

  it('eating now heals from the bank, and says why when it cannot', () => {
    expect(applyCommand(s, { type: 'combat:eat' }, ctx)).toMatchObject({
      ok: false,
      reason: 'no food chosen',
    });
    const hungry: SimState = {
      ...s,
      bank: [{ item: 'cooked-fish', qty: 1 }],
      combat: { ...s.combat, hp: 2, food: 'cooked-fish' },
    };
    const ate = applyCommand(hungry, { type: 'combat:eat' }, ctx);
    expect(ate.ok && ate.state.combat.hp).toBe(7);
    expect(ate.ok && countItem(ate.state.bank, 'cooked-fish')).toBe(0);
    expect(applyCommand(ate.state, { type: 'combat:eat' }, ctx)).toMatchObject({
      ok: false,
      reason: 'no Cooked fish left in the bank',
    });
    const full: SimState = { ...hungry, combat: { ...hungry.combat, hp: 10 } };
    expect(applyCommand(full, { type: 'combat:eat' }, ctx)).toMatchObject({
      ok: false,
      reason: 'hitpoints are full',
    });
  });

  it('the eat threshold is a fraction', () => {
    const r = applyCommand(s, { type: 'combat:eat-at', fraction: 0.5 }, ctx);
    expect(r.ok && r.state.combat.eatAt).toBe(0.5);
  });

  it('stopping, or starting anything else, ends the fight', () => {
    const mid = run(fightingState(5, 'goat', { weapon: 'sword' }), 10);
    expect(mid.combat.fight).not.toBeNull();
    const stopped = applyCommand(mid, { type: 'action:stop' }, ctx);
    expect(stopped.ok && stopped.state.combat.fight).toBeNull();
    const mining = applyCommand(
      mid,
      { type: 'action:start', request: { kind: 'mining', rock: 'sure-rock', count: null } },
      ctx,
    );
    expect(mining.ok && mining.state.combat.fight).toBeNull();
  });
});

describe('favour and the boon', () => {
  const sworn = (
    seed: number,
    god: string,
    monster = 'goat',
    combat: Partial<SimState['combat']> = {},
    bank: SimState['bank'] = [],
  ): SimState => {
    const base = fightingState(seed, monster);
    return {
      ...base,
      bank,
      player: { ...base.player, god },
      combat: { ...base.combat, ...combat },
    };
  };

  it('favour burns one a second in a fight, and not at all outside one', () => {
    const s0 = sworn(1, 'stone-god', 'goat', { favour: 3 });
    expect(run(s0, 9).combat.favour).toBe(3);
    expect(run(s0, 10).combat.favour).toBe(2);
    expect(run(s0, 30).combat.favour).toBe(0);
    expect(run(s0, 100).combat.favour).toBe(0);
    const idle = createSimState(1);
    expect(run({ ...idle, combat: { ...idle.combat, favour: 3 } }, 100).combat.favour).toBe(3);
  });

  it('when favour runs out an offering is burnt from the bank, so the boon never lapses', () => {
    const s0 = sworn(2, 'stone-god', 'goat', { favour: 1, offering: 'sprig' }, [
      { item: 'sprig', qty: 2 },
    ]);
    const s10 = run(s0, 10);
    expect(s10.combat.favour).toBe(5);
    expect(countItem(s10.bank, 'sprig')).toBe(1);
    expect(s10.stats.offered).toBe(1);
    expect(eventsOfType(s10, 'offered')).toEqual([
      { type: 'offered', tick: 10, item: 'sprig', favour: 5 },
    ]);
    // Five seconds later the second one burns; five more and there is nothing left to burn.
    expect(run(s0, 60).combat.favour).toBe(5);
    expect(countItem(run(s0, 60).bank, 'sprig')).toBe(0);
    expect(run(s0, 100).combat.favour).toBe(1);
    expect(run(s0, 110).combat.favour).toBe(0);
    expect(run(s0, 110).stats.offered).toBe(2);
  });

  it('the boon holds while favour lasts: half again on defence, or double attack', () => {
    const base = createSimState(1);
    const stone = { ...base, player: { ...base.player, god: 'stone-god' } };
    expect(heroStats(stone, ctx).defence).toBe(5);
    expect(heroStats(stone, ctx).boon).toBeNull();
    const lit = { ...stone, combat: { ...stone.combat, favour: 1 } };
    expect(heroStats(lit, ctx).defence).toBe(8);
    expect(heroStats(lit, ctx).attack).toBe(5);
    expect(heroStats(lit, ctx).boon?.name).toBe('Stone skin');
    const sea = { ...lit, player: { ...lit.player, god: 'sea-god' } };
    expect(heroStats(sea, ctx).attack).toBe(10);
    expect(heroStats(sea, ctx).defence).toBe(5);
  });

  it('the regen boon gives a hitpoint back on its own clock, while favour lasts', () => {
    // The brute takes one every second tick; green return gives one back every fourth.
    const s0 = sworn(1, 'green-god', 'brute', { favour: 2 });
    expect(run(s0, 12).combat.hp).toBe(7);
    expect(run(fightingState(1, 'brute'), 12).combat.hp).toBe(4);
    // Favour is gone at tick 20; from there the brute has it all its own way.
    expect(run(s0, 22).combat.hp).toBe(3);
  });

  it('choosing an offering wants a consumable with favour; burning one now pays at once', () => {
    const base = createSimState(1);
    const s0: SimState = {
      ...base,
      player: { ...base.player, god: 'stone-god' },
      bank: [{ item: 'sprig', qty: 1 }],
    };
    const bad = applyCommand(s0, { type: 'combat:offering', item: 'cooked-fish' }, ctx);
    expect(bad).toMatchObject({ ok: false, reason: 'Cooked fish is no offering' });
    expect(applyCommand(s0, { type: 'combat:offer' }, ctx)).toMatchObject({
      ok: false,
      reason: 'no offering chosen',
    });
    const chosen = applyCommand(s0, { type: 'combat:offering', item: 'sprig' }, ctx);
    expect(chosen.ok && chosen.state.combat.offering).toBe('sprig');
    const burnt = applyCommand(chosen.state, { type: 'combat:offer' }, ctx);
    expect(burnt.ok).toBe(true);
    expect(burnt.state.combat.favour).toBe(5);
    expect(countItem(burnt.state.bank, 'sprig')).toBe(0);
    expect(burnt.state.stats.offered).toBe(1);
    expect(applyCommand(burnt.state, { type: 'combat:offer' }, ctx)).toMatchObject({
      ok: false,
      reason: 'no Sprig left in the bank',
    });
    const cleared = applyCommand(burnt.state, { type: 'combat:offering', item: null }, ctx);
    expect(cleared.ok && cleared.state.combat.offering).toBeNull();
  });
});
