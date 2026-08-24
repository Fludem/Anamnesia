import { STYLE_SKILL } from './combat.ts';
import type { ItemDef, WearRequirement } from './content/schema.ts';
import type { SimContext } from './context.ts';
import { skillLevel } from './progress.ts';
import type { SimState } from './save.ts';

/**
 * What the hill asks before gear goes on. A weapon and its ammo are measured in the fight they
 * belong to — a sword in Combat, a staff in Sorcery — and everything else in whichever fight
 * its wearer is better at, because a cuirass does not care how the blows are struck and a
 * sorcerer wears the same plate a swordsman does.
 *
 * The check is made once, when the thing is put on. What is already worn stays worn: a level
 * is never lost, so nothing that has been earned can be taken back off by a rule change.
 */

/** The fights a requirement may be answered in: the one it names, or either of them. */
export function wearSkills(req: WearRequirement): readonly string[] {
  return req.skill === null ? Object.values(STYLE_SKILL) : [req.skill];
}

/** The level the hero brings to `req`: the named skill's, or the better of the two fights. */
export function wearLevel(state: SimState, req: WearRequirement, ctx: SimContext): number {
  return Math.max(...wearSkills(req).map((skill) => skillLevel(state, skill, ctx)));
}

/** "Combat level 45", "Combat or Sorcery level 45" — what the requirement asks for, in words. */
export function wearAsk(req: WearRequirement, ctx: SimContext): string {
  const names = wearSkills(req).map((skill) => ctx.content.skill(skill).name);
  return `${names.join(' or ')} level ${String(req.level)}`;
}

/** Whether the hero is far enough along to wear `item`. Anything with no requirement always is. */
export function meetsWear(state: SimState, item: ItemDef, ctx: SimContext): boolean {
  return item.wear === null || wearLevel(state, item.wear, ctx) >= item.wear.level;
}

/** Why `item` cannot go on, or null when it can. Reads after "COULD NOT". */
export function wearRefusal(state: SimState, item: ItemDef, ctx: SimContext): string | null {
  if (meetsWear(state, item, ctx)) return null;
  return `wear the ${item.name} — it wants ${wearAsk(item.wear!, ctx)}`;
}
