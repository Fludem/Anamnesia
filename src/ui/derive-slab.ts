/**
 * The slab, as the Fishing screen reads it: one row per kind of fish the hill gives, the
 * biggest ever landed against the band it was drawn from, and where the trophy line sits.
 * Pure over save and content — every number comes from the same functions the sim weighs
 * with (`sim/records.ts`), so the card cannot drift from what the water is actually doing.
 */
import type { ContentDb } from '../sim/content/db.ts';
import type { GatherNodeDef, ItemDef, SizeBand } from '../sim/content/schema.ts';
import type { SimContext } from '../sim/context.ts';
import { skillLevel } from '../sim/progress.ts';
import { bandCeiling, reachOf, trophyLevel, trophyWeight } from '../sim/records.ts';
import type { SimState } from '../sim/save.ts';

export interface SlabRow {
  fish: ItemDef;
  band: SizeBand;
  /** The water it comes out of; its level is what the row is sorted and gated by. */
  water: GatherNodeDef;
  /** The biggest ever landed, in grams; 0 for a kind never caught. */
  best: number;
  /** The tick that fish was landed on, or null. */
  tick: number | null;
  /** Where the best sits in the whole band, 0–1: the bar's fill. */
  into: number;
  /** The weight to beat, and where that line sits in the band, 0–1: the mark on the bar. */
  trophy: number;
  trophyInto: number;
  /** Paid for already. */
  won: boolean;
  bounty: number;
  /** The Fishing level at which this water's trophy line first comes into reach. */
  opensAt: number;
  /** The heaviest this hero can pull out of this water right now. */
  ceiling: number;
  /** The line cannot be crossed at this level, however long the hero fishes. */
  outOfReach: boolean;
  /** The water itself is still above the hero's level. */
  locked: boolean;
}

export interface SlabView {
  rows: SlabRow[];
  /** Kinds with a line on the slab, of all the kinds there are. */
  weighed: number;
  kinds: number;
  /** Trophies won, and the coins still on the table for the ones that are not. */
  won: number;
  owed: number;
}

/** One row per water that gives a weighed fish, in the waters' own order (by level). */
export function slabView(sim: SimState, content: ContentDb, ctx: SimContext): SlabView {
  const level = skillLevel(sim, 'fishing', ctx);
  const rows: SlabRow[] = [];
  for (const water of content.waters) {
    const fish = water.drops
      .flatMap((t) => t.entries.map((e) => content.item(e.item)))
      .find((i) => i.size !== null);
    if (!fish?.size) continue;
    const band = fish.size;
    const span = band.max - band.min;
    const line = sim.records.fish[fish.id] ?? null;
    const best = line?.grams ?? 0;
    const trophy = trophyWeight(band);
    const ceiling = bandCeiling(band, reachOf(level, water.level, ctx.xp.maxLevel));
    rows.push({
      fish,
      band,
      water,
      best,
      tick: line?.tick ?? null,
      into: best === 0 ? 0 : Math.min(1, Math.max(0, (best - band.min) / span)),
      trophy,
      trophyInto: (trophy - band.min) / span,
      won: sim.records.trophies.includes(fish.id),
      bounty: band.bounty,
      opensAt: trophyLevel(water.level, ctx.xp.maxLevel),
      ceiling,
      outOfReach: ceiling < trophy,
      locked: level < water.level,
    });
  }
  return {
    rows,
    weighed: rows.filter((r) => r.best > 0).length,
    kinds: rows.length,
    won: rows.filter((r) => r.won).length,
    owed: rows.filter((r) => !r.won).reduce((sum, r) => sum + r.bounty, 0),
  };
}
