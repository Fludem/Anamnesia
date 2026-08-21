import { z } from 'zod';
import { seedRng } from './rng.ts';

export const CURRENT_SAVE_VERSION = 1;

const Uint32 = z.number().int().min(0).max(0xffffffff);

export const RngStateSchema = z.tuple([Uint32, Uint32, Uint32, Uint32]).readonly();

/**
 * Everything the simulation reads and writes. Pure data; the sim never sees the envelope.
 * Phase 1 replaces `placeholder` with real game state (skills, inventory, …).
 */
export const SimStateSchema = z.object({
  /** Number of ticks processed so far. The single source of truth for elapsed game time. */
  tick: z.number().int().min(0),
  rng: RngStateSchema,
  placeholder: z.object({
    draws: z.number().int().min(0),
    checksum: Uint32,
  }),
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

export function createSimState(seed: number): SimState {
  return { tick: 0, rng: seedRng(seed), placeholder: { draws: 0, checksum: 0 } };
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
