import type { ItemDef } from './content/schema.ts';
import type { SimContext } from './context.ts';
import type { SimState } from './save.ts';
import { EQUIPMENT_SLOTS, isToolSlot, type EquipmentSlot } from './slots.ts';

/**
 * What is worn, as the sim reads it: the body slots (everything that is not a tool) add to
 * the hero's numbers and may pay more xp. Tools live on the belt and only shorten actions.
 */

/** Worn slots that are not tools. */
export const BODY_SLOTS: readonly EquipmentSlot[] = EQUIPMENT_SLOTS.filter((s) => !isToolSlot(s));

/** What the hill may take on death: worn, not a tool, and not the javelin in hand. */
export const LOSABLE_SLOTS: readonly EquipmentSlot[] = BODY_SLOTS.filter((s) => s !== 'ammo');

/** The items in the body slots, skipping anything content no longer knows. */
export function wornBodyItems(state: SimState, ctx: SimContext): ItemDef[] {
  const worn: ItemDef[] = [];
  for (const slot of BODY_SLOTS) {
    const id = state.equipment[slot];
    if (id !== null && ctx.content.hasItem(id)) worn.push(ctx.content.item(id));
  }
  return worn;
}

/** The worn gear's xp bonus for `skill`, as a fraction: every boost for that skill or for all. */
export function gearXpBoost(state: SimState, skill: string, ctx: SimContext): number {
  let boost = 0;
  for (const item of wornBodyItems(state, ctx)) {
    const b = item.xpBoost;
    if (b !== null && (b.skill === null || b.skill === skill)) boost += b.fraction;
  }
  return boost;
}
