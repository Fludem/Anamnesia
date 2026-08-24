import { describe, expect, it } from 'vitest';
import { createSimState, type SimState } from '../sim/save.ts';
import { fixtureContext as ctx } from '../sim/testing/fixture.ts';
import { FIGHT, helpFamily, helpSkill, helpView } from './derive-help.ts';

const at = (skill: string, level: number, extra: Partial<SimState> = {}): SimState => {
  const base = createSimState(1);
  return { ...base, skills: { [skill]: { xp: ctx.xp.xpForLevel(level) } }, ...extra };
};
const lift = (state: SimState, topic: string, k: string) =>
  helpView(state, topic, ctx).lifts.find((l) => l.k === k);

describe('which panel a topic opens', () => {
  it('is the shape of the screen it sits on, and the fight follows the worn weapon', () => {
    expect(helpFamily('mining', ctx.content)).toBe('gather');
    expect(helpFamily('smithing', ctx.content)).toBe('craft');
    expect(helpFamily(FIGHT, ctx.content)).toBe('fight');
    const bare = createSimState(1);
    expect(helpSkill(bare, FIGHT, ctx).id).toBe('combat');
    const staff: SimState = {
      ...bare,
      equipment: { ...bare.equipment, weapon: 'staff', ammo: 'mark' },
    };
    expect(helpSkill(staff, FIGHT, ctx).id).toBe('sorcery');
    // A bench skill that is also a fight still reads as the bench on its own screen.
    expect(helpFamily('sorcery', ctx.content)).toBe('craft');
  });
});

describe('the best a hero could be doing', () => {
  it('gathering: the best xp an hour of what is open, and the next thing a level opens', () => {
    const one = helpView(at('mining', 1), 'mining', ctx);
    expect(one.best).toMatchObject({ name: 'Sure rock', ready: true });
    expect(one.next).toEqual({ name: 'Gated rock', level: 10 });
    // Ten levels on: the gated rock is open and pays far more.
    const ten = helpView(at('mining', 10), 'mining', ctx);
    expect(ten.best?.name).toBe('Gated rock');
    expect(ten.best!.xpHr).toBeGreaterThan(one.best!.xpHr);
    expect(ten.next).toBeNull();
  });

  it('gathering: the tool shortens the cycle, so it can change which node is best', () => {
    const bare = at('mining', 1);
    const armed: SimState = { ...bare, equipment: { ...bare.equipment, pickaxe: 'pick' } };
    // The fixture's pick is −50%, and rounding favours the longer rock: 4 ticks halve, 3 do not.
    expect(helpView(bare, 'mining', ctx).best?.name).toBe('Sure rock');
    expect(helpView(armed, 'mining', ctx).best?.name).toBe('Flaky rock');
    expect(helpView(armed, 'mining', ctx).best!.xpHr).toBeGreaterThan(
      helpView(bare, 'mining', ctx).best!.xpHr,
    );
  });

  it('crafting: a recipe another skill still gates is not counted as open', () => {
    const cooking = helpView(at('cooking', 1), 'cooking', ctx);
    // The fixture's only dish wants Firemaking 5, which this hero has not got.
    expect(cooking.best).toBeNull();
    const fed = helpView(
      at('cooking', 1, {
        skills: { cooking: { xp: 0 }, firemaking: { xp: ctx.xp.xpForLevel(5) } },
      }),
      'cooking',
      ctx,
    );
    expect(fed.best?.name).toBe('Cook fish');
  });

  it('crafting: what the bank cannot run is still the best, and says so', () => {
    const empty = helpView(at('smithing', 1), 'smithing', ctx);
    expect(empty.best).toMatchObject({ name: 'Bar', ready: false });
    const stocked = helpView(
      at('smithing', 1, { bank: [{ item: 'ore', qty: 20 }] }),
      'smithing',
      ctx,
    );
    expect(stocked.best?.ready).toBe(true);
  });

  it('the fight: the quickest xp of the zones that are open, and the next zone', () => {
    const view = helpView(createSimState(1), FIGHT, ctx);
    // The brute is unkillable at level 1; the goat is not.
    expect(view.best?.name).toBe('Goat');
    expect(view.next).toEqual({ name: 'The Heights', level: 20 });
  });
});

describe('what is lifting it', () => {
  it('names the god who pays here when the oath is elsewhere, and the bonus when it is not', () => {
    const unsworn = lift(at('mining', 1), 'mining', 'Oath');
    expect(unsworn).toMatchObject({ on: false, v: '—' });
    expect(unsworn!.note).toContain('Stone god');
    const sworn = at('mining', 1, { player: { name: 'x', god: 'stone-god' } });
    expect(lift(sworn, 'mining', 'Oath')).toMatchObject({ on: true, v: '+50% xp' });
    expect(helpView(sworn, 'mining', ctx).xp).toBeCloseTo(1.5, 6);
    // A skill no god favours says so rather than pointing anywhere.
    expect(lift(at('foraging', 1), 'foraging', 'Oath')!.note).toBe('no god favours this one');
  });

  it('the tool row is only there for a skill that has one', () => {
    const bare = at('mining', 1);
    expect(lift(bare, 'mining', 'Tool')).toMatchObject({ on: false });
    const armed: SimState = { ...bare, equipment: { ...bare.equipment, pickaxe: 'pick' } };
    expect(lift(armed, 'mining', 'Tool')).toMatchObject({ on: true, v: '−50% action time' });
    expect(lift(at('foraging', 1), 'foraging', 'Tool')).toBeUndefined();
  });

  it('only a gathering skill can have its haul doubled', () => {
    const sworn = at('fishing', 1, { player: { name: 'x', god: 'sea-god' } });
    expect(lift(sworn, 'fishing', 'Doubled')).toMatchObject({ on: true });
    expect(lift(at('smithing', 1), 'smithing', 'Doubled')).toBeUndefined();
  });

  it('the fight reads its own numbers, and the style is the worn weapon’s', () => {
    const bare = createSimState(1);
    expect(lift(bare, FIGHT, 'Style')!.v).toContain('Combat');
    const staff: SimState = {
      ...bare,
      equipment: { ...bare.equipment, weapon: 'staff', ammo: 'mark' },
    };
    expect(lift(staff, FIGHT, 'Style')!.v).toContain('Sorcery');
    expect(lift(staff, FIGHT, 'Weakness')!.note).toContain('sorcery');
    expect(lift(bare, FIGHT, 'Boon')).toMatchObject({ on: false });
  });
});
