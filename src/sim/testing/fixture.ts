/**
 * A tiny content pack for sim tests. Deliberately not the shipped content: tests pin exact
 * numbers, and content tuning must never break engine tests.
 */
import { beginAction } from '../actions.ts';
import { ContentDb } from '../content/db.ts';
import type { SimContext } from '../context.ts';
import { createSimState, type SimState } from '../save.ts';
import { runescapeCurve } from '../xp.ts';

export const FIXTURE_PACK = {
  skills: [
    { id: 'mining', name: 'Mining', icon: 'lorc/mining' },
    { id: 'woodcutting', name: 'Woodcutting', icon: 'lorc/pine-tree' },
    { id: 'smithing', name: 'Smithing', icon: 'lorc/anvil' },
    { id: 'fishing', name: 'Fishing', icon: 'delapouite/fishing' },
    { id: 'firemaking', name: 'Firemaking', icon: 'lorc/campfire' },
    { id: 'cooking', name: 'Cooking', icon: 'delapouite/cooking-pot' },
  ],
  items: [
    { id: 'stone', name: 'Stone', icon: 'lorc/rock', value: 1 },
    { id: 'ore', name: 'Ore', icon: 'faithtoken/ore', value: 5 },
    { id: 'gem', name: 'Gem', icon: 'lorc/gems', value: 50 },
    { id: 'rare-gem', name: 'Rare gem', icon: 'lorc/gems', value: 500 },
    { id: 'log', name: 'Log', icon: 'delapouite/log', value: 2 },
    { id: 'bar', name: 'Bar', icon: 'lorc/metal-bar', value: 12 },
    /** A −50% pick: halves rock time. */
    {
      id: 'pick',
      name: 'Pick',
      icon: 'delapouite/war-pick',
      class: 'tool',
      slot: 'pickaxe',
      stats: { gather: 50 },
      value: 20,
    },
    /** A −10% axe: 4 ticks → 3.6 → 4 after rounding; proves rounding, not just scaling. */
    {
      id: 'axe',
      name: 'Axe',
      icon: 'lorc/wood-axe',
      class: 'tool',
      slot: 'axe',
      stats: { gather: 10 },
      value: 20,
    },
    { id: 'fish', name: 'Fish', icon: 'delapouite/flatfish', value: 3 },
    { id: 'cooked-fish', name: 'Cooked fish', icon: 'darkzaitzev/fish-cooked', value: 8 },
    { id: 'burnt', name: 'Burnt', icon: 'darkzaitzev/fried-fish', value: 0 },
    { id: 'seed', name: 'Seed', icon: 'delapouite/plant-seed', value: 1 },
    /** A −50% rod. */
    {
      id: 'rod',
      name: 'Rod',
      icon: 'delapouite/fishing-pole',
      class: 'tool',
      slot: 'rod',
      stats: { gather: 50 },
      value: 20,
    },
  ],
  waters: [
    {
      id: 'sure-water',
      name: 'Sure water',
      icon: 'lorc/waves',
      level: 1,
      durationTicks: 4,
      xp: 6,
      success: { base: 1 },
      drops: [{ entries: [{ item: 'fish', weight: 1 }] }],
    },
  ],
  gods: [
    /** Half again on mining xp. */
    {
      id: 'stone-god',
      name: 'Stone god',
      title: 'of the test',
      icon: 'lorc/rune-stone',
      boon: '+50% Mining xp',
      perks: { xp: { mining: 0.5 } },
    },
    /** Every catch lands twice, for determinism. */
    {
      id: 'sea-god',
      name: 'Sea god',
      title: 'of the test',
      icon: 'delapouite/fishing',
      boon: '+10% Fishing xp · always double catch',
      perks: { xp: { fishing: 0.1 }, doubleYield: [{ skill: 'fishing', chance: 1 }] },
    },
    /** A seed with every log. */
    {
      id: 'green-god',
      name: 'Green god',
      title: 'of the test',
      icon: 'lorc/sprout',
      boon: 'seeds',
      perks: { extraDrops: [{ skill: 'woodcutting', table: { $ref: 'seed' } }] },
    },
  ],
  trees: [
    {
      id: 'sure-tree',
      name: 'Sure tree',
      icon: 'lorc/pine-tree',
      level: 1,
      durationTicks: 4,
      xp: 8,
      success: { base: 1 },
      drops: [{ entries: [{ item: 'log', weight: 1 }] }],
    },
  ],
  recipes: [
    /** Two ore → one bar, 3 ticks. */
    {
      id: 'bar',
      name: 'Bar',
      skill: 'smithing',
      category: 'bars',
      level: 1,
      durationTicks: 3,
      xp: 7,
      inputs: [{ item: 'ore', qty: 2 }],
      outputs: [{ item: 'bar', qty: 1 }],
    },
    {
      id: 'gated-bar',
      name: 'Gated bar',
      skill: 'smithing',
      category: 'bars',
      level: 20,
      durationTicks: 3,
      xp: 7,
      inputs: [{ item: 'ore', qty: 1 }],
      outputs: [{ item: 'bar', qty: 1 }],
    },
    /** Cooking: half the cycles burn at level 1, none from level 11; wants Firemaking 5. */
    {
      id: 'cook',
      name: 'Cook fish',
      skill: 'cooking',
      category: 'fish',
      level: 1,
      requires: [{ skill: 'firemaking', level: 5 }],
      durationTicks: 2,
      xp: 9,
      success: { base: 0.5, perLevel: 0.05 },
      inputs: [{ item: 'fish', qty: 1 }],
      outputs: [{ item: 'cooked-fish', qty: 1 }],
      failOutputs: [{ item: 'burnt', qty: 1 }],
    },
    /** Firemaking: a log goes in, nothing comes out. */
    {
      id: 'burn',
      name: 'Burn log',
      skill: 'firemaking',
      category: 'fires',
      level: 1,
      durationTicks: 2,
      xp: 4,
      inputs: [{ item: 'log', qty: 1 }],
    },
  ],
  tables: {
    seed: { entries: [{ item: 'seed', weight: 1 }] },
    gems: {
      nothingWeight: 8,
      entries: [
        { item: 'gem', weight: 1 },
        { item: 'rare-gem', weight: 1 },
      ],
    },
  },
  rocks: [
    {
      /** Never fails, one stone per 3 ticks. Fully predictable without the rng. */
      id: 'sure-rock',
      name: 'Sure rock',
      icon: 'lorc/rock',
      level: 1,
      durationTicks: 3,
      xp: 10,
      success: { base: 1 },
      drops: [{ entries: [{ item: 'stone', weight: 1 }] }],
    },
    {
      /** 50% success, 1–3 ore plus a 20% gem roll: exercises every draw. */
      id: 'flaky-rock',
      name: 'Flaky rock',
      icon: 'lorc/rock',
      level: 1,
      durationTicks: 4,
      xp: 25,
      success: { base: 0.5, perLevel: 0.05 },
      drops: [{ entries: [{ item: 'ore', weight: 1, quantity: [1, 3] }] }, { $ref: 'gems' }],
    },
    {
      id: 'gated-rock',
      name: 'Gated rock',
      icon: 'lorc/rock',
      level: 10,
      durationTicks: 5,
      xp: 100,
      success: { base: 1 },
      drops: [{ entries: [{ item: 'ore', weight: 1 }] }],
    },
  ],
};

export const fixtureContent: ContentDb = ContentDb.fromPack(FIXTURE_PACK);
export const fixtureContext: SimContext = { content: fixtureContent, xp: runescapeCurve() };

/** A fresh state already mining `rock` until stopped. */
export function miningState(seed: number, rock = 'flaky-rock'): SimState {
  return beginAction(createSimState(seed), { kind: 'mining', rock, count: null }, fixtureContext);
}
