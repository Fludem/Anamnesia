import { z } from 'zod';

/** Equipment slots, in display order. Lives apart from save.ts so content schemas can use it. */
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
] as const;
export const EquipmentSlotSchema = z.enum(EQUIPMENT_SLOTS);
export type EquipmentSlot = z.infer<typeof EquipmentSlotSchema>;
