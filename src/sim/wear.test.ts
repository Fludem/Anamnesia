import { describe, expect, it } from 'vitest';
import { applyCommand } from './commands.ts';
import { countItem } from './items.ts';
import { addXp } from './progress.ts';
import { createSimState, type SimState } from './save.ts';
import { fixtureContext as ctx } from './testing/fixture.ts';
import { meetsWear, wearAsk, wearLevel } from './wear.ts';

const at = (skill: string, level: number): SimState =>
  addXp(createSimState(3), skill, ctx.xp.xpForLevel(level));
const item = (id: string) => ctx.content.item(id);

describe('what the hill asks before gear goes on', () => {
  it('measures a weapon in its own fight and armour in the better of the two', () => {
    const swordsman = at('combat', 20);
    const sorcerer = at('sorcery', 20);
    expect(meetsWear(swordsman, item('great-sword'), ctx)).toBe(true);
    expect(meetsWear(swordsman, item('great-staff'), ctx)).toBe(false);
    expect(meetsWear(sorcerer, item('great-staff'), ctx)).toBe(true);
    expect(meetsWear(sorcerer, item('great-sword'), ctx)).toBe(false);
    // Plate is plate: either fight answers for it, so both may wear it and a novice may not.
    expect(meetsWear(swordsman, item('plate'), ctx)).toBe(true);
    expect(meetsWear(sorcerer, item('plate'), ctx)).toBe(true);
    expect(meetsWear(createSimState(3), item('plate'), ctx)).toBe(false);
    expect(wearLevel(sorcerer, item('plate').wear!, ctx)).toBe(20);
    expect(wearLevel(sorcerer, item('great-sword').wear!, ctx)).toBe(1);
  });

  it('asks nothing of gear that carries no requirement', () => {
    const bare = createSimState(3);
    expect(meetsWear(bare, item('sword'), ctx)).toBe(true);
    expect(meetsWear(bare, item('pick'), ctx)).toBe(true);
  });

  it('says what it wants in words', () => {
    expect(wearAsk(item('great-sword').wear!, ctx)).toBe('Combat level 20');
    expect(wearAsk(item('great-staff').wear!, ctx)).toBe('Sorcery level 20');
    expect(wearAsk(item('plate').wear!, ctx)).toBe('Combat or Sorcery level 20');
  });
});

describe('equipping under the requirement', () => {
  const withGear = (s: SimState): SimState => ({
    ...s,
    bank: [
      { item: 'great-sword', qty: 1 },
      { item: 'plate', qty: 1 },
    ],
  });

  it('refuses the gear and leaves it in the bank, saying what it wants', () => {
    const s = withGear(at('combat', 19));
    const r = applyCommand(s, { type: 'equip', item: 'great-sword' }, ctx);
    expect(r).toMatchObject({
      ok: false,
      reason: 'wear the Great sword — it wants Combat level 20',
    });
    expect(r.state.equipment.weapon).toBeNull();
    expect(countItem(r.state.bank, 'great-sword')).toBe(1);
  });

  it('hands it over at the level it asks for', () => {
    const s = withGear(at('combat', 20));
    const r = applyCommand(s, { type: 'equip', item: 'great-sword' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.state.equipment.weapon).toBe('great-sword');
    const armoured = applyCommand(r.state, { type: 'equip', item: 'plate' }, ctx);
    expect(armoured.ok).toBe(true);
    expect(armoured.state.equipment.body).toBe('plate');
  });

  it('lets a sorcerer wear the plate a swordsman wears, but not the blade', () => {
    const s = withGear(at('sorcery', 30));
    expect(applyCommand(s, { type: 'equip', item: 'plate' }, ctx).ok).toBe(true);
    expect(applyCommand(s, { type: 'equip', item: 'great-sword' }, ctx)).toMatchObject({
      ok: false,
      reason: 'wear the Great sword — it wants Combat level 20',
    });
  });

  it('leaves worn gear alone: what is on stays on, and goes back to the bank when taken off', () => {
    // A save from before the rule, or from a level since lost to nothing: the slot is not emptied.
    const worn: SimState = {
      ...createSimState(3),
      equipment: { ...createSimState(3).equipment, body: 'plate' },
    };
    const off = applyCommand(worn, { type: 'unequip', slot: 'body' }, ctx);
    expect(off.ok).toBe(true);
    expect(countItem(off.state.bank, 'plate')).toBe(1);
    // And it cannot go back on until the level is there.
    expect(applyCommand(off.state, { type: 'equip', item: 'plate' }, ctx).ok).toBe(false);
  });
});
