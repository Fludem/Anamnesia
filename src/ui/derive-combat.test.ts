import { describe, expect, it } from 'vitest';
import { applyCommand } from '../sim/commands.ts';
import { addXp } from '../sim/progress.ts';
import { createSimState, type SimState } from '../sim/save.ts';
import { stepTick } from '../sim/step.ts';
import {
  fightingState,
  fixtureContent as content,
  fixtureContext as ctx,
} from '../sim/testing/fixture.ts';
import {
  ammoView,
  bankItemsFor,
  boonText,
  favourView,
  fightView,
  foodOptions,
  foodView,
  killLog,
  lastDeath,
  offeringOptions,
  recentOffering,
  totalKills,
  wearView,
  wornBody,
  wornXpBoost,
  xpBoostText,
  zoneRows,
} from './derive-combat.ts';

function run(state: SimState, ticks: number): SimState {
  let s = state;
  for (let i = 0; i < ticks; i++) s = stepTick(s, ctx);
  return s;
}

describe('fightView', () => {
  it('is null when nothing is being fought', () => {
    expect(fightView(createSimState(1), ctx)).toBeNull();
  });

  it('shows both sides with their bars and clocks', () => {
    const s = run(fightingState(1, 'goat', { weapon: 'sword' }), 10);
    const v = fightView(s, ctx)!;
    expect(v.monster.id).toBe('goat');
    expect(v.you).toMatchObject({ sub: 'you · Lv 1 · swinging', maxHp: 10, swingSeconds: 3 });
    expect(v).toMatchObject({ style: 'melee', skill: 'combat', weak: 'sorcery', yourMaxHit: 8 });
    expect(v.you.swingFrac).toBeCloseTo(10 / 30);
    expect(v.you.statsLine).toBe('atk 105 · str 15 · def 5');
    expect(v.them).toMatchObject({
      name: 'Goat',
      sub: 'Lv 1 · the slope',
      maxHp: 6,
      swingSeconds: 0.5,
    });
    expect(v.them.statsLine).toBe('max hit 1 · 12 xp per kill');
    expect(v.fightSeconds).toBe(0.9); // the fight starts on the first tick after the request
    expect(v.xpPerKill).toBe(12);
    expect(v.xpHr).toBeGreaterThan(0);
  });

  it('with a staff in hand the fight is sorcery’s, and the goat is weak to it', () => {
    const s = run(fightingState(1, 'goat', { weapon: 'staff', ammo: 'mark' }), 10);
    const v = fightView(s, ctx)!;
    expect(v.you.sub).toBe('you · Lv 1 · casting');
    // Sword numbers plus the mark (strength 19, max hit 10), and a quarter more for the weakness.
    expect(v).toMatchObject({
      style: 'sorcery',
      skill: 'sorcery',
      weak: 'sorcery',
      yourMaxHit: 13,
    });
  });
});

describe('food', () => {
  it('reads the chosen food from the bank and lists what heals, best first', () => {
    const s0 = createSimState(1);
    const s: SimState = {
      ...s0,
      bank: [
        { item: 'stone', qty: 5 },
        { item: 'cooked-fish', qty: 3 },
      ],
    };
    expect(foodView(s, content)).toEqual({ item: null, have: 0, heal: 0 });
    expect(foodOptions(s, content).map((f) => f.item?.id)).toEqual(['cooked-fish']);
    const chosen = applyCommand(s, { type: 'combat:food', item: 'cooked-fish' }, ctx);
    expect(chosen.ok && foodView(chosen.state, content)).toMatchObject({ have: 3, heal: 5 });
  });
});

describe('zones and the log', () => {
  it('locks zones by combat level and marks the monster being fought', () => {
    const rows = zoneRows(fightingState(1, 'goat'), ctx);
    expect(rows.map((z) => [z.zone.id, z.locked, z.active])).toEqual([
      ['slope', false, true],
      ['heights', true, false],
    ]);
    const goat = rows[0]!.monsters.find((m) => m.monster.id === 'goat')!;
    expect(goat).toMatchObject({
      fighting: true,
      maxHit: 1,
      xp: 12,
      weak: 'sorcery',
      yourMaxHit: 3,
    });
    expect(goat.killSeconds).toBeGreaterThan(3);
  });

  it('with a staff the zones lock by sorcery level and the weak monsters take more', () => {
    const s0 = createSimState(1);
    const caster: SimState = {
      ...s0,
      equipment: { ...s0.equipment, weapon: 'staff', ammo: 'mark' },
      skills: { sorcery: { xp: ctx.xp.xpForLevel(20) } },
    };
    const rows = zoneRows(caster, ctx);
    expect(rows.map((z) => [z.zone.id, z.locked])).toEqual([
      ['slope', false],
      ['heights', false],
    ]);
    const goat = rows[0]!.monsters.find((m) => m.monster.id === 'goat')!;
    const brute = rows[0]!.monsters.find((m) => m.monster.id === 'brute')!;
    // Level 20 + 4 + staff 10 + mark 4 = 38 strength → max hit 20; the goat takes 25 for its weakness.
    expect(goat).toMatchObject({ weak: 'sorcery', yourMaxHit: 25 });
    expect(brute).toMatchObject({ weak: 'melee', yourMaxHit: 20 });
    expect(zoneRows(s0, ctx)[1]!.locked).toBe(true);
  });

  it('turns kills into rows and counts them', () => {
    let s = fightingState(4, 'goat', { weapon: 'sword' });
    while (totalKills(s) < 2) s = stepTick(s, ctx);
    const rows = killLog(s, content);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.monster.id).toBe('goat');
    expect(rows[0]!.xp).toBe(12);
    expect(rows[0]!.items).toMatch(/^Bone, Hide, 1 gp$/);
    expect(rows[0]!.rare).toBeNull();
    expect(rows[0]!.ageTicks).toBeLessThanOrEqual(rows[1]!.ageTicks);
  });

  it('remembers the last death until something is fought again', () => {
    let s = fightingState(2, 'brute', { head: 'helm' });
    while (lastDeath(s) === null) s = stepTick(s, ctx);
    expect(lastDeath(s)?.lost).toBe('helm');
    const again = applyCommand(
      s,
      { type: 'action:start', request: { kind: 'combat', monster: 'goat', count: null } },
      ctx,
    );
    expect(again.ok && lastDeath(again.state)).toBeNull();
  });
});

describe('worn', () => {
  it('lists body slots and what the bank holds for one, best first', () => {
    const s0 = createSimState(1);
    const s: SimState = {
      ...s0,
      equipment: { ...s0.equipment, head: 'helm', pickaxe: 'pick' },
      bank: [
        { item: 'spear', qty: 1 },
        { item: 'sword', qty: 1 },
      ],
    };
    const worn = wornBody(s, content);
    expect(worn.find((w) => w.slot === 'head')?.item?.id).toBe('helm');
    expect(worn.some((w) => w.slot === 'pickaxe')).toBe(false);
    expect(bankItemsFor(s, ctx, 'weapon').map((i) => i.id)).toEqual(['sword', 'spear']);
    expect(bankItemsFor(s, ctx, 'head')).toEqual([]);
    // What the level is not there for sinks under what can go on now, however good it is.
    const rich: SimState = { ...s, bank: [...s.bank, { item: 'great-sword', qty: 1 }] };
    expect(bankItemsFor(rich, ctx, 'weapon').map((i) => i.id)).toEqual([
      'sword',
      'spear',
      'great-sword',
    ]);
  });

  it('says what a piece wants and where the hero stands against it', () => {
    const s0 = createSimState(1);
    expect(wearView(s0, content.item('sword'), ctx)).toBeNull();
    expect(wearView(s0, content.item('great-sword'), ctx)).toEqual({
      ask: 'Combat level 20',
      have: 1,
      met: false,
    });
    const sorcerer = addXp(s0, 'sorcery', ctx.xp.xpForLevel(22));
    expect(wearView(sorcerer, content.item('plate'), ctx)).toEqual({
      ask: 'Combat or Sorcery level 20',
      have: 22,
      met: true,
    });
  });

  it('spells out xp boosts, adds the worn ones up, and counts the javelins', () => {
    expect(xpBoostText(content.item('cape'), content)).toBe('+50% mining xp');
    expect(xpBoostText(content.item('pendant'), content)).toBe('+25% xp in every skill');
    expect(xpBoostText(content.item('helm'), content)).toBeNull();
    const s0 = createSimState(1);
    expect(wornXpBoost(s0, content)).toEqual({ totalPercent: 0, lines: [] });
    const s: SimState = {
      ...s0,
      equipment: { ...s0.equipment, cape: 'cape', amulet: 'pendant', ammo: 'javelin' },
      bank: [{ item: 'javelin', qty: 12 }],
    };
    expect(wornXpBoost(s, content)).toEqual({
      totalPercent: 75,
      lines: ['+50% mining xp', '+25% xp in every skill'],
    });
    expect(ammoView(s0, content)).toBeNull();
    expect(ammoView(s, content)).toMatchObject({ inBank: 12, live: true });
    expect(ammoView(s, content)?.item.id).toBe('javelin');
    // A javelin under a staff is carried, not thrown.
    const staff: SimState = { ...s, equipment: { ...s.equipment, weapon: 'staff' } };
    expect(ammoView(staff, content)).toMatchObject({ inBank: 12, live: false });
  });
});

describe('favourView', () => {
  it('reads the god, the boon, the favour and the chosen offering; lists what burns, best first', () => {
    const base = createSimState(1);
    const unsworn = favourView(base, ctx);
    expect(unsworn.god).toBeNull();
    expect(unsworn.boon).toBeNull();
    const s: SimState = {
      ...base,
      player: { ...base.player, god: 'stone-god' },
      bank: [{ item: 'sprig', qty: 4 }],
      combat: { ...base.combat, offering: 'sprig', favour: 90 },
    };
    const fv = favourView(s, ctx);
    expect(fv.god?.id).toBe('stone-god');
    expect(fv.boon?.name).toBe('Stone skin');
    expect(fv.lit).toBe(true);
    expect(fv.seconds).toBe(90);
    expect(fv.offering?.id).toBe('sprig');
    expect(fv.have).toBe(4);
    expect(fv.each).toBe(5);
    expect(offeringOptions(s, content).map((o) => [o.item.id, o.have, o.each])).toEqual([
      ['sprig', 4, 5],
    ]);
    expect(favourView({ ...s, combat: { ...s.combat, favour: 0 } }, ctx).lit).toBe(false);
  });

  it('spells a boon out, and notices a fresh offering', () => {
    expect(boonText({ kind: 'defence', fraction: 0.5, name: 'x', line: 'y' })).toBe('+50% defence');
    expect(boonText({ kind: 'regen', everyTicks: 60, name: 'x', line: 'y' })).toBe(
      '1 hp every 6 s',
    );
    const base = createSimState(1);
    const s: SimState = {
      ...base,
      bank: [{ item: 'sprig', qty: 1 }],
      combat: { ...base.combat, offering: 'sprig' },
    };
    expect(recentOffering(s, 20)).toBeNull();
    const r = applyCommand(s, { type: 'combat:offer' }, ctx);
    expect(r.ok && recentOffering(r.state, 20)?.favour).toBe(5);
    expect(r.ok && recentOffering(run(r.state, 25), 20)).toBeNull();
  });
});
