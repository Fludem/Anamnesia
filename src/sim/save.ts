import { z } from 'zod';
import { ActionQueueSchema } from './actions.ts';
import { IdSchema } from './content/schema.ts';
import { SimEventSchema } from './events.ts';
import { ContainerSchema } from './items.ts';
import { seedRng } from './rng.ts';
import { EQUIPMENT_SLOTS, EquipmentSlotSchema } from './slots.ts';

export const CURRENT_SAVE_VERSION = 4;

const Uint32 = z.number().int().min(0).max(0xffffffff);

export const RngStateSchema = z.tuple([Uint32, Uint32, Uint32, Uint32]).readonly();

export { EQUIPMENT_SLOTS, EquipmentSlotSchema, type EquipmentSlot } from './slots.ts';

/** Every slot is present (null when empty) so the shape never varies by save. */
export const EquipmentSchema = z.record(EquipmentSlotSchema, IdSchema.nullable());
export type Equipment = z.infer<typeof EquipmentSchema>;

export const SkillProgressSchema = z.object({ xp: z.number().min(0) });

/**
 * Everything the simulation reads and writes. Pure data; the sim never sees the envelope.
 * Content is referenced by id only, so content changes never require a save migration
 * unless an id is removed.
 */
export const SimStateSchema = z.object({
  /** Number of ticks processed so far. The single source of truth for elapsed game time. */
  tick: z.number().int().min(0),
  rng: RngStateSchema,
  player: z.object({ name: z.string().min(1) }),
  /** Keyed by skill id; a skill absent here has 0 xp. */
  skills: z.record(IdSchema, SkillProgressSchema),
  /** Carried items: consumables a later combat loop draws from. Unused in Phase 1. */
  inventory: ContainerSchema,
  equipment: EquipmentSchema,
  /** Main storage; gathering deposits here. One slot per distinct item. */
  bank: ContainerSchema,
  /** Extra bank slots bought with coins (capacity = BASE_BANK_SLOTS + this). */
  bankSlotsBought: z.number().int().min(0),
  /** Currency, kept apart from the bank so it never takes a slot. */
  coins: z.number().int().min(0),
  action: ActionQueueSchema,
  /** Recent events, oldest first; see events.ts. */
  log: z.array(SimEventSchema),
  /** Lifetime counters. `actions[skill]` = cycles completed in that skill. */
  stats: z.object({ actions: z.record(IdSchema, z.number().int().min(0)) }),
});
export type SimState = z.infer<typeof SimStateSchema>;

/**
 * The stored record: sim state plus the envelope the runtime needs for single-writer
 * discipline and offline catch-up.
 */
export const SaveRecordSchema = z.object({
  version: z.literal(CURRENT_SAVE_VERSION),
  /** Monotonically increasing; bumped by the store on every successful write. */
  saveCounter: z.number().int().min(0),
  /** UUID of the tab that performed the last write. */
  writerId: z.string().min(1),
  /** Wall-clock ms (Date.now() domain) at which `sim.tick` was current. Invariant: always moves with tick. */
  wallMs: z.number().finite(),
  sim: SimStateSchema,
});
export type SaveRecord = z.infer<typeof SaveRecordSchema>;

export const DEFAULT_PLAYER_NAME = 'Nameless';

export function emptyEquipment(): Equipment {
  return Object.fromEntries(EQUIPMENT_SLOTS.map((s) => [s, null])) as Equipment;
}

export function createSimState(seed: number): SimState {
  return {
    tick: 0,
    rng: seedRng(seed),
    player: { name: DEFAULT_PLAYER_NAME },
    skills: {},
    inventory: [],
    equipment: emptyEquipment(),
    bank: [],
    bankSlotsBought: 0,
    coins: 0,
    action: { current: null, queue: [] },
    log: [],
    stats: { actions: {} },
  };
}

export function createNewSave(opts: { seed: number; nowMs: number; writerId: string }): SaveRecord {
  return {
    version: CURRENT_SAVE_VERSION,
    saveCounter: 0,
    writerId: opts.writerId,
    wallMs: opts.nowMs,
    sim: createSimState(opts.seed),
  };
}
