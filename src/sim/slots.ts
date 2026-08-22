import { z } from 'zod';

/**
 * Equipment slots, in display order. Lives apart from save.ts so content schemas can use it.
 * `pickaxe` and `axe` are the per-skill tool slots (Phase 3): a tool shortens its skill's
 * action time and nothing else, so it never competes with the weapon slot.
 */
export const EQUIPMENT_SLOTS = [
  'weapon',
  'shield',
  'head',
  'body',
  'legs',
  'hands',
  'feet',
  'cape',
  'amulet',
  'ring',
  'ammo',
  'pickaxe',
  'axe',
] as const;
export const EquipmentSlotSchema = z.enum(EQUIPMENT_SLOTS);
export type EquipmentSlot = z.infer<typeof EquipmentSlotSchema>;

/** Slots that hold a skill tool, and the skill each one serves. */
export const TOOL_SLOTS = { pickaxe: 'mining', axe: 'woodcutting' } as const;
export type ToolSlot = keyof typeof TOOL_SLOTS;
export function isToolSlot(slot: string): slot is ToolSlot {
  return slot in TOOL_SLOTS;
}
