import { z } from 'zod';

/**
 * Equipment slots, in display order. Lives apart from save.ts so content schemas can use it.
 * `pickaxe`, `axe` and `rod` are the per-skill tool slots: a tool shortens its skill's action
 * time and nothing else, so it never competes with the weapon slot.
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
  'rod',
] as const;
export const EquipmentSlotSchema = z.enum(EQUIPMENT_SLOTS);
export type EquipmentSlot = z.infer<typeof EquipmentSlotSchema>;

/** Slots that hold a skill tool, and the skill each one serves. */
export const TOOL_SLOTS = { pickaxe: 'mining', axe: 'woodcutting', rod: 'fishing' } as const;
export type ToolSlot = keyof typeof TOOL_SLOTS;
export function isToolSlot(slot: string): slot is ToolSlot {
  return slot in TOOL_SLOTS;
}
