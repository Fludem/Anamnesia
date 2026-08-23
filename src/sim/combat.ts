import type { CombatBoon, CombatStyle, ItemDef, MonsterDef } from './content/schema.ts';
import type { SimContext } from './context.ts';
import { BODY_SLOTS, wornBodyItems } from './equipment.ts';
import { godOf } from './perks.ts';
import { skillLevel } from './progress.ts';
import type { SimState } from './save.ts';

/**
 * The combat numbers, in one place so the sim, the progression model and the screens agree.
 * No attack/strength/defence split: one level does all three, plus hitpoints, which the fight
 * feeds. Which level is the worn weapon's to say — a sword swings on Combat, a staff casts on
 * Sorcery — and every monster is weak to one of the two, which raises that style's max hit.
 * Everything is small integers rolled with the save's rng; no floats leak into the state.
 */

export const COMBAT_SKILL = 'combat';
export const SORCERY_SKILL = 'sorcery';
export const HITPOINTS_SKILL = 'hitpoints';

/** The skill each style trains and is gated by. */
export const STYLE_SKILL: Record<CombatStyle, string> = {
  melee: COMBAT_SKILL,
  sorcery: SORCERY_SKILL,
};

/** Against a monster weak to the hero's style, the max hit grows by this much. */
export const WEAKNESS_BONUS = 0.25;

/** Ticks between the hero's swings before the weapon's `speed` is added. */
export const BASE_SWING_TICKS = 30;
export const MIN_SWING_TICKS = 10;
/** What the level alone contributes to attack, strength and defence, on top of gear. */
export const STAT_BASE = 4;
/** Max hitpoints = hitpoints level + this (level 1 → 10). */
export const HP_PER_LEVEL_OFFSET = 9;
/** Out of combat, one hitpoint comes back every this many ticks. */
export const REGEN_EVERY_TICKS = 10;
/** Hitpoints xp per kill as a fraction of the combat xp. */
export const HITPOINTS_XP_SHARE = 1 / 3;
/** How many numbers a fight keeps for the bars to pop. */
export const SPLAT_CAP = 8;
/** In a fight, one favour burns every this many ticks (one a second). */
export const FAVOUR_EVERY_TICKS = 10;

export { BODY_SLOTS };

export interface HeroStats {
  attack: number;
  strength: number;
  defence: number;
  swingTicks: number;
  maxHp: number;
  /** How the hero fights: the worn weapon's style, melee with nothing in hand. */
  style: CombatStyle;
  /** The skill that style trains, gates the zones and lends the level term. */
  skill: string;
  /** The gear's share alone, for the equipment screen's totals. */
  gear: { attack: number; strength: number; defence: number; speed: number };
  /** The god's boon folded into the numbers above, or null when favour is spent. */
  boon: CombatBoon | null;
}

export type GearStats = HeroStats['gear'];

/** The style a worn set fights in: the weapon's, or melee with nothing in the weapon slot. */
export function styleOf(items: readonly ItemDef[]): CombatStyle {
  return items.find((i) => i.slot === 'weapon')?.style ?? 'melee';
}

/**
 * The stats of a set of worn items added up. Ammo counts only for the weapon's style: a
 * javelin under a staff, or a mark under a sword, is carried and nothing more.
 */
export function gearStats(
  items: readonly ItemDef[],
  style: CombatStyle = styleOf(items),
): GearStats {
  const gear = { attack: 0, strength: 0, defence: 0, speed: 0 };
  for (const item of items) {
    if (item.slot === 'ammo' && item.style !== style) continue;
    gear.attack += item.stats.attack ?? 0;
    gear.strength += item.stats.strength ?? 0;
    gear.defence += item.stats.defence ?? 0;
    gear.speed += item.stats.speed ?? 0;
  }
  return gear;
}

/** A stat with the boon's share on top, rounded so the state never sees a float. */
function boosted(stat: 'attack' | 'strength' | 'defence', base: number, boon: CombatBoon | null) {
  if (boon === null || boon.kind !== stat) return base;
  return Math.round(base * (1 + boon.fraction));
}

/**
 * The hero's numbers from the style's level, a hitpoints level, the gear's sums and, while
 * favour burns, the god's boon.
 */
export function heroStatsFrom(
  level: number,
  hitpointsLevel: number,
  gear: GearStats,
  boon: CombatBoon | null = null,
  style: CombatStyle = 'melee',
): HeroStats {
  return {
    attack: boosted('attack', level + STAT_BASE + gear.attack, boon),
    strength: boosted('strength', level + STAT_BASE + gear.strength, boon),
    defence: boosted('defence', level + STAT_BASE + gear.defence, boon),
    swingTicks: Math.max(MIN_SWING_TICKS, BASE_SWING_TICKS + gear.speed),
    maxHp: maxHitpoints(hitpointsLevel),
    style,
    skill: STYLE_SKILL[style],
    gear,
    boon,
  };
}

/** The style the save fights in and the skill it trains, from the worn weapon. */
export function combatStyle(
  state: SimState,
  ctx: SimContext,
): { style: CombatStyle; skill: string } {
  const style = styleOf(wornBodyItems(state, ctx));
  return { style, skill: STYLE_SKILL[style] };
}

/** The sworn god's combat boon, whether or not there is favour to run it on. */
export function godBoon(state: SimState, ctx: SimContext): CombatBoon | null {
  return godOf(state, ctx)?.perks.combat ?? null;
}

/** The boon in effect: the god's, while there is favour to burn. */
export function activeBoon(state: SimState, ctx: SimContext): CombatBoon | null {
  return state.combat.favour > 0 ? godBoon(state, ctx) : null;
}

/** The hero's numbers from the save: the style's level, hitpoints level, everything in a body slot. */
export function heroStats(state: SimState, ctx: SimContext): HeroStats {
  const worn = wornBodyItems(state, ctx);
  const style = styleOf(worn);
  return heroStatsFrom(
    skillLevel(state, STYLE_SKILL[style], ctx),
    skillLevel(state, HITPOINTS_SKILL, ctx),
    gearStats(worn, style),
    activeBoon(state, ctx),
    style,
  );
}

export function maxHitpoints(hitpointsLevel: number): number {
  return hitpointsLevel + HP_PER_LEVEL_OFFSET;
}

/** Chance a swing lands: attack against defence, never 0 and never 1. */
export function hitChance(attack: number, defence: number): number {
  return (attack + 2) / (attack + defence + 4);
}

/** The biggest hit `strength` can land; a hit is uniform in 1..maxHit. */
export function maxHit(strength: number): number {
  return 1 + Math.floor(strength / 2);
}

/** The biggest hit the hero can land on `m`: a quarter more when it is weak to the style. */
export function maxHitAgainst(hero: HeroStats, m: MonsterDef): number {
  const max = maxHit(hero.strength);
  return m.weak === hero.style ? Math.round(max * (1 + WEAKNESS_BONUS)) : max;
}

/** Expected damage per swing, for the model and the screens. */
export function expectedHit(attack: number, strength: number, defence: number): number {
  return (hitChance(attack, defence) * (1 + maxHit(strength))) / 2;
}

/** Expected damage per swing the hero lands on `m`, weakness included. */
export function expectedHeroHit(hero: HeroStats, m: MonsterDef): number {
  return (hitChance(hero.attack, m.stats.defence) * (1 + maxHitAgainst(hero, m))) / 2;
}

/**
 * Expected swings to take `hp` down, with hit chance `chance` and hits uniform in 1..`max`.
 * Exact (a small dynamic programme), so overkill on a weak monster counts against it.
 */
export function expectedSwingsToKill(hp: number, chance: number, max: number): number {
  const e: number[] = [0];
  for (let h = 1; h <= hp; h++) {
    let sum = 0;
    for (let d = 1; d <= max; d++) sum += e[Math.max(0, h - d)]!;
    e[h] = (1 + (chance * sum) / max) / chance;
  }
  return e[hp]!;
}

/** Expected ticks for the hero to kill `m` once, with these numbers. */
export function expectedKillTicks(hero: HeroStats, m: MonsterDef): number {
  const swings = expectedSwingsToKill(
    m.hp,
    hitChance(hero.attack, m.stats.defence),
    maxHitAgainst(hero, m),
  );
  return swings * hero.swingTicks;
}

/**
 * Xp a hit pays: the monster's xp in proportion to the damage dealt, so a kill pays exactly
 * `m.xp` however it is spread, and a swing that overkills pays only for what was left.
 */
export function xpForDamage(m: MonsterDef, dealt: number): number {
  return (m.xp * dealt) / m.hp;
}

/** Expected hitpoints `m` takes off the hero per tick. */
export function expectedDamageTakenPerTick(hero: HeroStats, m: MonsterDef): number {
  return expectedHit(m.stats.attack, m.stats.strength, hero.defence) / m.stats.speed;
}
