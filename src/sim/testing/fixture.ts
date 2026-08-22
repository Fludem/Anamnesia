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
  ],
  tables: {
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
