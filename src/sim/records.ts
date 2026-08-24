import { z } from 'zod';
import { IdSchema, type GatherNodeDef, type SizeBand } from './content/schema.ts';
import type { SimContext } from './context.ts';
import { pushEvent } from './events.ts';
import type { ItemStack } from './items.ts';
import { skillLevel } from './progress.ts';
import { nextFloat, type RngState } from './rng.ts';
import type { SimState } from './save.ts';

/**
 * The slab: the flat stone by the water a fish is laid on to be measured. Every catch is
 * weighed, most of them are small, and the biggest of each kind is kept — that line, and only
 * that line, is what the slab remembers. Beating your own best pays a little xp for the
 * moment; the first fish of a kind over its trophy line pays coins, because the trader will
 * buy a fish worth talking about and there is nothing else to do with the story.
 *
 * Nothing here touches the bank. A fish is still one stack of one item worth what it is
 * worth — the weight is the moment, not the goods — so the economy, the cooking pot and the
 * hall's prices are exactly as they were before the fish was weighed.
 */

/** One line of the slab: the biggest ever landed, and the tick it was landed on. */
export const CatchRecordSchema = z.object({
  grams: z.number().int().min(1),
  tick: z.number().int().min(0),
});
export type CatchRecord = z.infer<typeof CatchRecordSchema>;

/**
 * What the slab holds: the best of each kind ever landed, and the kinds whose trophy line has
 * been passed and paid for. Trophies are kept rather than derived from the weights, so a later
 * retune of a band can never pay the same trophy twice.
 */
export const RecordsSchema = z.object({
  fish: z.record(IdSchema, CatchRecordSchema),
  trophies: z.array(IdSchema),
});
export type Records = z.infer<typeof RecordsSchema>;

export const EMPTY_RECORDS: Records = { fish: {}, trophies: [] };

/**
 * The curve the weight is drawn on: a uniform draw raised to this power, so most fish sit near
 * the bottom of what is in reach and a big one is an occasion. At 3, a catch beats nine tenths
 * of the reachable band about 3% of the time.
 */
export const SIZE_CURVE = 3;

/**
 * How much of the band is in reach at the water's own level. The rest opens as the skill
 * climbs, which is what sends a master angler back down the hill to the Rain Pool: a minnow
 * is only ever a big minnow in the hands of someone who has long since left the pool.
 */
export const REACH_FLOOR = 0.5;

/**
 * Levels above a water at which it has nothing left to hide. Thirty, not the whole climb, so
 * a trophy is something to go back for while the climb is still on rather than a chore saved
 * for 99 — and the last few waters, which have less than thirty levels of headroom left, are
 * the ones that hold out to the end.
 */
export const REACH_SPAN = 30;

/** Where in the full band the trophy line sits. Under `REACH_FLOOR` it could never be crossed. */
export const TROPHY_FRACTION = 0.95;

/** A record at the very top of the band pays a whole cycle's xp again; less, further down. */
export const RECORD_XP_FRACTION = 1;

/** Draws per stack are bounded, so no content change can make one cycle cost the rng dearly. */
export const MAX_WEIGHINGS = 10;

/** One fish, weighed as it landed. `best` says the slab kept it. */
export interface Weighing {
  item: string;
  grams: number;
  best: boolean;
}

/** What one weighing pass did: the state it left, the xp the records earned, what came out. */
export interface Weighed {
  state: SimState;
  xp: number;
  weighings: Weighing[];
}

/** The span of levels over which a water opens up: thirty, or what is left below the cap. */
export function reachSpan(nodeLevel: number, maxLevel: number): number {
  return Math.max(1, Math.min(REACH_SPAN, maxLevel - nodeLevel));
}

/** How far into that span the hero stands, as 0 (at the water's own level) to 1 (opened up). */
export function reachOf(level: number, nodeLevel: number, maxLevel: number): number {
  return Math.max(0, Math.min(1, (level - nodeLevel) / reachSpan(nodeLevel, maxLevel)));
}

/** The heaviest fish this hero can pull out of this water: the band, cut down by reach. */
export function bandCeiling(band: SizeBand, reach: number): number {
  const open = REACH_FLOOR + (1 - REACH_FLOOR) * reach;
  return band.min + (band.max - band.min) * open;
}

/** One weight, in grams, drawn on the curve between the band's floor and what is in reach. */
export function rollWeight(
  band: SizeBand,
  ceiling: number,
  rng: RngState,
): [grams: number, next: RngState] {
  const [f, next] = nextFloat(rng);
  return [
    Math.max(band.min, Math.round(band.min + (ceiling - band.min) * Math.pow(f, SIZE_CURVE))),
    next,
  ];
}

/** The weight a fish of this kind has to beat to be worth the trader's coins. */
export function trophyWeight(band: SizeBand): number {
  return Math.round(band.min + (band.max - band.min) * TROPHY_FRACTION);
}

/** The level at which the trophy line first comes into reach at all. */
export function trophyLevel(nodeLevel: number, maxLevel: number): number {
  const needed = (TROPHY_FRACTION - REACH_FLOOR) / (1 - REACH_FLOOR);
  return Math.min(maxLevel, Math.ceil(nodeLevel + needed * reachSpan(nodeLevel, maxLevel)));
}

/** What a new best pays on top of the cycle: the water's own xp, scaled by where in the band it sits. */
export function recordXp(node: GatherNodeDef, band: SizeBand, grams: number): number {
  const into = Math.max(0, Math.min(1, (grams - band.min) / (band.max - band.min)));
  return Math.round(node.xp * RECORD_XP_FRACTION * into * 10) / 10;
}

/** The best on the slab for a kind, in grams; 0 for one never landed. */
export function bestGrams(state: SimState, item: string): number {
  return state.records.fish[item]?.grams ?? 0;
}

/**
 * Weigh everything in a haul that carries a band. One draw per fish (a doubled catch gets two
 * chances and keeps the better), the slab updated where the best was beaten, the trader's
 * coins paid where a trophy line was crossed for the first time.
 */
export function weighCatch(
  state: SimState,
  landed: readonly ItemStack[],
  node: GatherNodeDef,
  skill: string,
  ctx: SimContext,
): Weighed {
  const level = skillLevel(state, skill, ctx);
  const reach = reachOf(level, node.level, ctx.xp.maxLevel);
  let rng = state.rng;
  let fish = state.records.fish;
  let trophies = state.records.trophies;
  let coins = state.coins;
  let xp = 0;
  const weighings: Weighing[] = [];
  const won: { item: string; grams: number; coins: number }[] = [];

  for (const stack of landed) {
    if (!ctx.content.hasItem(stack.item)) continue;
    const item = ctx.content.item(stack.item);
    const band = item.size;
    if (band === null) continue;
    const ceiling = bandCeiling(band, reach);
    let grams = 0;
    for (let i = 0; i < Math.min(stack.qty, MAX_WEIGHINGS); i++) {
      let g: number;
      [g, rng] = rollWeight(band, ceiling, rng);
      if (g > grams) grams = g;
    }
    const best = grams > (fish[item.id]?.grams ?? 0);
    weighings.push({ item: item.id, grams, best });
    if (!best) continue;
    fish = { ...fish, [item.id]: { grams, tick: state.tick } };
    xp += recordXp(node, band, grams);
    if (grams >= trophyWeight(band) && !trophies.includes(item.id)) {
      trophies = [...trophies, item.id];
      coins += band.bounty;
      won.push({ item: item.id, grams, coins: band.bounty });
    }
  }

  let out: SimState = { ...state, rng, coins, records: { fish, trophies } };
  for (const w of won) {
    out = pushEvent(out, {
      type: 'trophy',
      tick: state.tick,
      item: w.item,
      grams: w.grams,
      coins: w.coins,
    });
  }
  return { state: out, xp: Math.round(xp * 10) / 10, weighings };
}
