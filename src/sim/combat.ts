import type { ItemDef, MonsterDef } from './content/schema.ts';
import type { SimContext } from './context.ts';
import { skillLevel } from './progress.ts';
import type { SimState } from './save.ts';
import { EQUIPMENT_SLOTS, isToolSlot, type EquipmentSlot } from './slots.ts';

/**
 * The combat numbers, in one place so the sim, the progression model and the screens agree.
 * One combat skill (no attack/strength/defence split) plus hitpoints, which combat feeds.
 * Everything is small integers rolled with the save's rng; no floats leak into the state.
 */

export const COMBAT_SKILL = 'combat';
export const HITPOINTS_SKILL = 'hitpoints';

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

/** Worn slots that are not tools: what the hill may take on death. */
export const BODY_SLOTS: readonly EquipmentSlot[] = EQUIPMENT_SLOTS.filter((s) => !isToolSlot(s));

export interface HeroStats {
  attack: number;
  strength: number;
  defence: number;
  swingTicks: number;
  maxHp: number;
  /** The gear's share alone, for the equipment screen's totals. */
  gear: { attack: number; strength: number; defence: number; speed: number };
}

export type GearStats = HeroStats['gear'];

/** The stats of a set of worn items added up. */
export function gearStats(items: readonly ItemDef[]): GearStats {
  const gear = { attack: 0, strength: 0, defence: 0, speed: 0 };
  for (const item of items) {
    gear.attack += item.stats.attack ?? 0;
    gear.strength += item.stats.strength ?? 0;
    gear.defence += item.stats.defence ?? 0;
    gear.speed += item.stats.speed ?? 0;
  }
  return gear;
}

/** The hero's numbers from a combat level, a hitpoints level and the gear's sums. */
export function heroStatsFrom(level: number, hitpointsLevel: number, gear: GearStats): HeroStats {
  return {
    attack: level + STAT_BASE + gear.attack,
    strength: level + STAT_BASE + gear.strength,
    defence: level + STAT_BASE + gear.defence,
    swingTicks: Math.max(MIN_SWING_TICKS, BASE_SWING_TICKS + gear.speed),
    maxHp: maxHitpoints(hitpointsLevel),
    gear,
  };
}

/** The hero's numbers from the save: combat level, hitpoints level, everything in a body slot. */
export function heroStats(state: SimState, ctx: SimContext): HeroStats {
  const worn: ItemDef[] = [];
  for (const slot of BODY_SLOTS) {
    const id = state.equipment[slot];
    if (id !== null && ctx.content.hasItem(id)) worn.push(ctx.content.item(id));
  }
  return heroStatsFrom(
    skillLevel(state, COMBAT_SKILL, ctx),
    skillLevel(state, HITPOINTS_SKILL, ctx),
    gearStats(worn),
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

/** Expected damage per swing, for the model and the screens. */
export function expectedHit(attack: number, strength: number, defence: number): number {
  return (hitChance(attack, defence) * (1 + maxHit(strength))) / 2;
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
    maxHit(hero.strength),
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
