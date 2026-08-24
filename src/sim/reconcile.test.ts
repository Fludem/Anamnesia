import { describe, expect, it } from 'vitest';
import { beginAction } from './actions.ts';
import { reconcileWithContent, requestKnown } from './reconcile.ts';
import { createSimState, type SimState } from './save.ts';
import { fixtureContent as content, fixtureContext as ctx } from './testing/fixture.ts';

/** A save from a build whose content had things this one does not. */
function stale(): SimState {
  const s = beginAction(createSimState(1), { kind: 'mining', rock: 'sure-rock', count: null }, ctx);
  return {
    ...s,
    action: {
      current: {
        ...s.action.current!,
        request: { kind: 'mining', rock: 'coal-rock', count: null },
      },
      queue: [
        { kind: 'woodcutting', tree: 'gone-tree', count: null },
        { kind: 'mining', rock: 'sure-rock', count: 5 },
      ],
    },
    skills: { mining: { xp: 100 }, alchemy: { xp: 5 } },
    bank: [
      { item: 'stone', qty: 3 },
      { item: 'coal', qty: 7 },
    ],
    inventory: [{ item: 'old-potion', qty: 1 }],
    equipment: { ...s.equipment, pickaxe: 'pick', axe: 'bronze-hatchet' },
    combat: { ...s.combat, food: 'cooked-fish', offering: 'lost-votive', fight: null },
    upgrades: { lamp: 1, 'gone-ware': 2 },
    hall: {
      id: 1,
      rooms: { hearth: 2, 'gone-room': 1 },
      gifts: [
        { id: 1, room: 'hearth', tier: 3, item: 'log', qty: 4 },
        { id: 2, room: 'gone-room', tier: 1, item: 'log', qty: 1 },
        { id: 3, room: 'hearth', tier: 3, item: 'old-potion', qty: 2 },
      ],
      given: 3,
    },
    log: [
      {
        type: 'gain',
        tick: 1,
        skill: 'mining',
        xp: 10,
        items: [{ item: 'coal', qty: 1 }],
        sizes: [],
      },
      {
        type: 'gain',
        tick: 2,
        skill: 'mining',
        xp: 10,
        items: [{ item: 'stone', qty: 1 }],
        sizes: [],
      },
      { type: 'kill', tick: 3, monster: 'dragon', xp: 1, items: [], coins: 0 },
      { type: 'tutorial', tick: 4, step: 'anything', reward: 0 },
    ],
  };
}

describe('reconciling a save with the content', () => {
  it('leaves a clean save untouched, by identity', () => {
    const s = beginAction(
      createSimState(1),
      { kind: 'mining', rock: 'sure-rock', count: null },
      ctx,
    );
    const r = reconcileWithContent(s, content);
    expect(r.sim).toBe(s);
    expect(r.dropped).toEqual([]);
  });

  it('drops only what the content no longer has, and says so', () => {
    const { sim, dropped } = reconcileWithContent(stale(), content);
    expect(sim.action.current).toBeNull();
    expect(sim.action.queue).toEqual([{ kind: 'mining', rock: 'sure-rock', count: 5 }]);
    expect(sim.skills).toEqual({ mining: { xp: 100 } });
    expect(sim.bank).toEqual([{ item: 'stone', qty: 3 }]);
    expect(sim.inventory).toEqual([]);
    expect(sim.equipment.pickaxe).toBe('pick');
    expect(sim.equipment.axe).toBeNull();
    expect(sim.combat.food).toBe('cooked-fish');
    expect(sim.combat.offering).toBeNull();
    expect(sim.log.map((e) => e.tick)).toEqual([2, 4]);
    expect(sim.upgrades).toEqual({ lamp: 1 });
    expect(sim.hall.rooms).toEqual({ hearth: 2 });
    expect(sim.hall.gifts.map((g) => g.id)).toEqual([1, 2]);
    expect(dropped).toEqual([
      'action: unknown mining target "coal-rock"',
      'queue: unknown woodcutting target "gone-tree"',
      'worn axe: unknown item "bronze-hatchet"',
      'skills: unknown skill "alchemy"',
      'log: 2 entries naming things that are gone',
      'inventory: 1 × unknown item "old-potion"',
      'bank: 7 × unknown item "coal"',
      'offering: unknown item "lost-votive"',
      'upgrades: unknown ware "gone-ware"',
      'hall: unknown room "gone-room"',
      'hall: gift of 2 × unknown item "old-potion"',
    ]);
  });

  it('a fight with a monster that is gone ends', () => {
    const s = createSimState(1);
    const fight = { monster: 'dragon', hp: 5, swingIn: 3, startedTick: 0, splats: [] };
    const r = reconcileWithContent({ ...s, combat: { ...s.combat, fight } }, content);
    expect(r.sim.combat.fight).toBeNull();
    expect(r.dropped).toEqual(['fight: unknown monster "dragon"']);
  });

  it('knows every request kind', () => {
    expect(requestKnown({ kind: 'mining', rock: 'sure-rock', count: null }, content)).toBe(true);
    expect(requestKnown({ kind: 'mining', rock: 'coal-rock', count: null }, content)).toBe(false);
    expect(requestKnown({ kind: 'combat', monster: 'goat', count: null }, content)).toBe(true);
    expect(requestKnown({ kind: 'crafting', recipe: 'nope', count: null }, content)).toBe(false);
  });
});
