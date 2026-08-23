import type { GodDef } from './content/schema.ts';
import type { SimContext } from './context.ts';
import { gearXpBoost } from './equipment.ts';
import { hallDoubleYield, hallXpBonus } from './hall.ts';
import type { ItemStack } from './items.ts';
import { addXp } from './progress.ts';
import type { SimState } from './save.ts';

/**
 * What the sworn god changes. Every perk is read from content through these few functions, so
 * a handler never knows which god exists — only that xp may be multiplied, a cycle may land
 * twice, and one more table may roll.
 */

export function godOf(state: SimState, ctx: SimContext): GodDef | null {
  const id = state.player.god;
  return id !== null && ctx.content.hasGod(id) ? ctx.content.god(id) : null;
}

/** 1 + the god's bonus for `skill` (0 when unsworn) + the worn gear's + the hall's hearth. */
export function xpMultiplier(state: SimState, skill: string, ctx: SimContext): number {
  return (
    1 +
    (godOf(state, ctx)?.perks.xp[skill] ?? 0) +
    gearXpBoost(state, skill, ctx) +
    hallXpBonus(state, skill, ctx)
  );
}

/** The xp a base amount actually pays in `skill`, to a tenth. */
export function xpAwarded(state: SimState, skill: string, base: number, ctx: SimContext): number {
  return Math.round(base * xpMultiplier(state, skill, ctx) * 10) / 10;
}

/** Award `base` xp with the god's bonus applied; returns the new state and what was paid. */
export function awardXp(
  state: SimState,
  skill: string,
  base: number,
  ctx: SimContext,
): { state: SimState; xp: number } {
  const xp = xpAwarded(state, skill, base, ctx);
  return { state: addXp(state, skill, xp), xp };
}

/** Chance a successful cycle of `skill` lands twice: the god's (for that god's skill) + the hall's. */
export function doubleYieldChance(state: SimState, skill: string, ctx: SimContext): number {
  const god = godOf(state, ctx);
  const fromGod = god?.perks.doubleYield.find((d) => d.skill === skill)?.chance ?? 0;
  return Math.min(1, fromGod + hallDoubleYield(state, skill, ctx));
}

/** Extra tables the god rolls on every successful cycle of `skill`. */
export function extraDropTables(state: SimState, skill: string, ctx: SimContext) {
  const god = godOf(state, ctx);
  if (god === null) return [];
  return god.perks.extraDrops.filter((e) => e.skill === skill).map((e) => e.table);
}

/** Lifetime item counters: every unit that ever landed, for first steps and the recap. */
export function recordItems(state: SimState, stacks: readonly ItemStack[]): SimState {
  if (stacks.length === 0) return state;
  const items = { ...state.stats.items };
  for (const s of stacks) items[s.item] = (items[s.item] ?? 0) + s.qty;
  return { ...state, stats: { ...state.stats, items } };
}
