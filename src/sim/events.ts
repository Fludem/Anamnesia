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

/** One fish as it came out of the water. `best` says the slab kept it. See records.ts. */
export const WeighingSchema = z.object({
  item: IdSchema,
  grams: z.number().int().min(1),
  best: z.boolean().default(false),
});
export type WeighingEntry = z.infer<typeof WeighingSchema>;

export const SimEventSchema = z.discriminatedUnion('type', [
  /**
   * One completed cycle: what landed in the bank and the XP it paid. `sizes` is what was
   * weighed on the way in — fishing only, empty everywhere else and in every old log.
   */
  z.object({
    type: z.literal('gain'),
    tick: z.number().int().min(0),
    skill: IdSchema,
    xp: z.number().min(0),
    items: z.array(ItemStackSchema),
    sizes: z.array(WeighingSchema).default([]),
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
  /**
   * The action could not continue (inputs ran out, bank full, …). `fight` says whether it was
   * a fight: sorcery stops at the bench and in the zones, and each screen shows only its own.
   */
  z.object({
    type: z.literal('stopped'),
    tick: z.number().int().min(0),
    skill: IdSchema,
    reason: z.string().min(1),
    fight: z.boolean().default(false),
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
  /** The hero fell: the hill took `lost`, or the ferryman was paid and `kept` stayed on. */
  z.object({
    type: z.literal('died'),
    tick: z.number().int().min(0),
    monster: IdSchema,
    /** The worn item the hill took, or null. */
    lost: IdSchema.nullable(),
    /** The worn item the ferryman let the hero keep, or null. */
    kept: IdSchema.nullable().default(null),
    /** Coins the ferryman took for it. */
    paid: z.number().int().min(0).default(0),
    /** Whether an obol settled the crossing instead. */
    obol: z.boolean().default(false),
  }),
  /** An offering burnt for the sworn god: the item and the favour it bought. */
  z.object({
    type: z.literal('offered'),
    tick: z.number().int().min(0),
    item: IdSchema,
    favour: z.number().int().min(0),
  }),
  /** The skill's finds table paid out: what the hill left on top of the cycle's own haul. */
  z.object({
    type: z.literal('found'),
    tick: z.number().int().min(0),
    skill: IdSchema,
    items: z.array(ItemStackSchema).min(1),
  }),
  /** A first-steps step was completed and its reward paid. */
  z.object({
    type: z.literal('tutorial'),
    tick: z.number().int().min(0),
    step: z.string().min(1),
    reward: z.number().int().min(0),
  }),
  /** A gift put on the cart for the hall: the room, the item (null for coins) and how much. */
  z.object({
    type: z.literal('gave'),
    tick: z.number().int().min(0),
    room: IdSchema,
    item: IdSchema.nullable(),
    qty: z.number().int().min(1),
  }),
  /** The register said a room of the hall now stands at this tier. */
  z.object({
    type: z.literal('raised'),
    tick: z.number().int().min(0),
    room: IdSchema,
    tier: z.number().int().min(1),
  }),
  /** A kind of fish crossed its trophy line for the first time, and the trader paid for it. */
  z.object({
    type: z.literal('trophy'),
    tick: z.number().int().min(0),
    item: IdSchema,
    grams: z.number().int().min(1),
    coins: z.number().int().min(0),
  }),
  /** Coins staked on the wheel's table. */
  z.object({
    type: z.literal('bought-in'),
    tick: z.number().int().min(0),
    coins: z.number().int().min(1),
  }),
  /** Coins the wheel sent home: winnings, and bets taken back before the close. */
  z.object({
    type: z.literal('cashed-out'),
    tick: z.number().int().min(0),
    coins: z.number().int().min(0),
  }),
  /** The road tried the hero: fought off (`won`, the work went on) or driven off (the day lost). */
  z.object({
    type: z.literal('ambush'),
    tick: z.number().int().min(0),
    ambusher: IdSchema,
    won: z.boolean(),
    items: z.array(ItemStackSchema),
    coins: z.number().int().min(0),
    /** Coins the ambusher made off with on a rout. */
    stolen: z.number().int().min(0).default(0),
  }),
  /** A bout in the ring, as the register settled it: what was played for, and who kept it. */
  z.object({
    type: z.literal('bout'),
    tick: z.number().int().min(0),
    /** The other name. Not an id: the ring is names, and a name can be renamed. */
    opponent: z.string().min(1),
    won: z.boolean(),
    item: IdSchema,
    slot: z.string().min(1),
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
