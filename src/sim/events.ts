import { z } from 'zod';
import { IdSchema } from './content/schema.ts';
import { ItemStackSchema } from './items.ts';
import type { SimState } from './save.ts';

/**
 * The event log: the last few things that happened, stamped with the tick they happened on.
 * It lives in the save so it is deterministic, so followers render the same feed as the
 * leader, and so the UI never has to diff snapshots to learn that a drop landed. It is a
 * ring buffer, not a history — `LOG_CAP` entries, oldest dropped.
 */
export const SimEventSchema = z.discriminatedUnion('type', [
  /** One completed cycle: what landed in the bank and the XP it paid. */
  z.object({
    type: z.literal('gain'),
    tick: z.number().int().min(0),
    skill: IdSchema,
    xp: z.number().min(0),
    items: z.array(ItemStackSchema),
  }),
  z.object({
    type: z.literal('level'),
    tick: z.number().int().min(0),
    skill: IdSchema,
    from: z.number().int().min(1),
    to: z.number().int().min(2),
  }),
  /** Containers opened by the player, and what came out (merged across `qty`). */
  z.object({
    type: z.literal('opened'),
    tick: z.number().int().min(0),
    item: IdSchema,
    qty: z.number().int().min(1),
    items: z.array(ItemStackSchema),
  }),
  /** The action could not continue (inputs ran out, bank full, …). */
  z.object({
    type: z.literal('stopped'),
    tick: z.number().int().min(0),
    skill: IdSchema,
    reason: z.string().min(1),
  }),
  /** A monster fell: the xp it paid (combat, before the hitpoints share) and what it dropped. */
  z.object({
    type: z.literal('kill'),
    tick: z.number().int().min(0),
    monster: IdSchema,
    xp: z.number().min(0),
    items: z.array(ItemStackSchema),
    coins: z.number().int().min(0),
  }),
  /** The hero fell. `lost` is the worn item the hill took, or null if nothing was worn. */
  z.object({
    type: z.literal('died'),
    tick: z.number().int().min(0),
    monster: IdSchema,
    lost: IdSchema.nullable(),
  }),
  /** A first-steps step was completed and its reward paid. */
  z.object({
    type: z.literal('tutorial'),
    tick: z.number().int().min(0),
    step: z.string().min(1),
    reward: z.number().int().min(0),
  }),
]);
export type SimEvent = z.infer<typeof SimEventSchema>;
export type SimEventOf<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;

export const LOG_CAP = 40;

export function pushEvent(state: SimState, event: SimEvent): SimState {
  const log = state.log.length >= LOG_CAP ? state.log.slice(1 - LOG_CAP) : state.log;
  return { ...state, log: [...log, event] };
}

/** Newest last, like the log itself. */
export function eventsOfType<T extends SimEvent['type']>(
  state: SimState,
  type: T,
): SimEventOf<T>[] {
  return state.log.filter((e): e is SimEventOf<T> => e.type === type);
}
