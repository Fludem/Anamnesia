import {
  HITPOINTS_SKILL,
  HITPOINTS_XP_SHARE,
  combatStyle,
  expectedDamageTakenPerTick,
  expectedKillTicks,
  heroStats,
} from './combat.ts';
import type { MonsterDef } from './content/schema.ts';
import type { SimContext } from './context.ts';
import { rollDropTable } from './drops.ts';
import { pushEvent } from './events.ts';
import { roomFor } from './bank.ts';
import { addStacks, type ItemStack } from './items.ts';
import { awardXp, recordItems } from './perks.ts';
import { skillLevel } from './progress.ts';
import { nextFloat, nextInt } from './rng.ts';
import type { SimState } from './save.ts';

/**
 * The open road (Phase 18). Walk it open and, every so often, something on the road tries the
 * hero in the middle of whatever they were doing — priced against the gear they are actually
 * wearing, not the gear in the bank. The reward for walking open: ambushers carry far more
 * than they should, and every monster kill pays a quarter more coin.
 *
 * An ambush resolves in one draw, online and offline alike — the sim cannot tell the two
 * apart, and must not. Fought off: the spoils land and the work goes on. Driven off: the
 * action ends and a little coin walks, but never a worn item and never a death — the road
 * robs, it does not bury.
 *
 * Determinism: a barred road (the default) draws nothing, ever, so every save from before the
 * road is bit-identical. Open, the gap to the next ambush is one draw made when the last one
 * resolves, never a draw per tick.
 */

/** The gap between ambushes, drawn uniformly: 15 to 60 minutes of walking open. */
export const AMBUSH_MIN_GAP_TICKS = 9_000;
export const AMBUSH_MAX_GAP_TICKS = 36_000;
/** The standing reward for walking open: kills pay this fraction more coin. */
export const ROAD_COIN_BONUS = 0.25;
/** On a rout the ambusher takes this fraction of the purse. */
export const AMBUSH_STEAL_FRACTION = 0.05;
/** Driven off at this fraction of full health, never dead. */
export const ROUT_HP_FRACTION = 0.25;
/** However lopsided the fight, the roll keeps a sliver of doubt each way. */
export const WIN_CHANCE_FLOOR = 0.1;
export const WIN_CHANCE_CEIL = 0.95;

/** The next ambush scheduled: one gap draw. The road must be open. */
export function scheduleAmbush(state: SimState): SimState {
  const [gap, rng] = nextInt(state.rng, AMBUSH_MIN_GAP_TICKS, AMBUSH_MAX_GAP_TICKS);
  return {
    ...state,
    rng,
    combat: { ...state.combat, road: { open: true, ambushAt: state.tick + gap } },
  };
}

/** The road-figure for this hero: the highest zone the style's level has opened. */
export function pickAmbusher(state: SimState, ctx: SimContext): MonsterDef | null {
  const { skill } = combatStyle(state, ctx);
  const level = skillLevel(state, skill, ctx);
  let picked: MonsterDef | null = null;
  let pickedLevel = -1;
  for (const a of ctx.content.ambushers) {
    const zone = ctx.content.zone(a.zone).level;
    if (zone <= level && zone > pickedLevel) {
      picked = a;
      pickedLevel = zone;
    }
  }
  return picked;
}

/** Chance the hero fends the ambusher off, priced purely from the numbers as worn. */
export function ambushWinChance(state: SimState, a: MonsterDef, ctx: SimContext): number {
  const hero = heroStats(state, ctx);
  const tKill = expectedKillTicks(hero, a);
  const taken = expectedDamageTakenPerTick(hero, a);
  // With nothing coming back the hero never falls; the ceiling still keeps the doubt.
  const tFall = taken > 0 ? state.combat.hp / taken : Number.POSITIVE_INFINITY;
  const raw = tFall / (tFall + tKill);
  return Math.min(WIN_CHANCE_CEIL, Math.max(WIN_CHANCE_FLOOR, raw));
}

/**
 * The ambush itself. One draw decides it; the spoils roll in a kill's order (always, tables,
 * coins) and are skipped-not-wasted when the bank is full, though the coins are always taken.
 * The gap to the next one is drawn last in both branches.
 */
function resolveAmbush(state: SimState, a: MonsterDef, ctx: SimContext): SimState {
  const hero = heroStats(state, ctx);
  const chance = ambushWinChance(state, a, ctx);
  const [f, rng] = nextFloat(state.rng);
  let s: SimState = { ...state, rng };
  if (f < chance) {
    // Fought off: the scar, the spoils, a little xp, and the work goes on untouched.
    const scar = Math.round(expectedKillTicks(hero, a) * expectedDamageTakenPerTick(hero, a));
    const hp = Math.max(1, s.combat.hp - scar);
    let landed: ItemStack[] = [];
    const wants = [
      ...a.always.map((q) => q.item),
      ...a.drops.flatMap((t) => t.entries.map((e) => e.item)),
    ];
    if (roomFor(s, wants, ctx).ok) {
      let r = s.rng;
      landed = addStacks([], a.always);
      for (const table of a.drops) {
        let stacks;
        [stacks, r] = rollDropTable(table, r);
        landed = addStacks(landed, stacks);
      }
      s = { ...s, rng: r };
    }
    let coins = 0;
    if (a.coins[1] > 0) {
      let r;
      [coins, r] = nextInt(s.rng, a.coins[0], a.coins[1]);
      s = { ...s, rng: r };
    }
    s = { ...s, bank: addStacks(s.bank, landed), coins: s.coins + coins };
    s = recordItems(s, landed);
    s = awardXp(s, hero.skill, a.xp, ctx).state;
    s = awardXp(s, HITPOINTS_SKILL, a.xp * HITPOINTS_XP_SHARE, ctx).state;
    s = {
      ...s,
      combat: { ...s.combat, hp },
      stats: { ...s.stats, ambushes: s.stats.ambushes + 1 },
    };
    s = pushEvent(s, {
      type: 'ambush',
      tick: s.tick,
      ambusher: a.id,
      won: true,
      items: landed,
      coins,
      stolen: 0,
    });
  } else {
    // Driven off: the day is lost and a little coin with it — never a worn item, never a death.
    const stolen = Math.round(AMBUSH_STEAL_FRACTION * s.coins);
    const hp = Math.max(1, Math.round(ROUT_HP_FRACTION * hero.maxHp));
    s = {
      ...s,
      coins: s.coins - stolen,
      action: { current: null, queue: [] },
      combat: { ...s.combat, hp },
      stats: { ...s.stats, routed: s.stats.routed + 1 },
    };
    s = pushEvent(s, {
      type: 'ambush',
      tick: s.tick,
      ambusher: a.id,
      won: false,
      items: [],
      coins: 0,
      stolen,
    });
  }
  return scheduleAmbush(s);
}

/**
 * The per-tick gate, called from `stepTick` after the action has run. A due ambush waits out
 * an idle hero and a fight — the road wants someone mid-work — and fires on the first working
 * tick after its time. Living here, offline catch-up replays it exactly.
 */
export function ambushTick(state: SimState, ctx: SimContext): SimState {
  const road = state.combat.road;
  if (!road.open || road.ambushAt === null || state.tick < road.ambushAt) return state;
  const current = state.action.current;
  if (current === null || current.request.kind === 'combat') return state;
  const a = pickAmbusher(state, ctx);
  if (a === null) return state;
  return resolveAmbush(state, a, ctx);
}
