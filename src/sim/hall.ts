import { TICKS_PER_HOUR } from './constants.ts';
import { IdSchema, type RoomDef, type RoomPerk, type RoomTier } from './content/schema.ts';
import type { SimContext } from './context.ts';
import { pushEvent } from './events.ts';
import { addItem, countItem, removeItem } from './items.ts';
import type { SimState } from './save.ts';
import { z } from 'zod';

/**
 * The hall: a clan's place on the hill, raised room by room with what its names give. The hall
 * itself is the register's — members, progress, the ledger — and the sim only ever holds what
 * the register last said: which hall this name is in and how each room stands. Perks read
 * those tiers. A gift is the one thing that starts here: `give` takes it out of the bank and
 * onto the cart (`state.hall.gifts`); the save carries the cart to the register, which takes
 * what the room still needs and answers with a `HallSync`; `applyHallSync` clears the cart,
 * sends back what was not taken, and sets the rooms. The sync is droppable — a gift stays on
 * the cart until this name's own save has been answered, and a re-sent gift is answered the
 * same way — so nothing is lost if a tab dies between the reply and its next save.
 */

/** Gifts the register has not yet answered; more than this and the hall is told to wait. */
export const MAX_PENDING_GIFTS = 100;
export const MAX_GIFT_QTY = 1_000_000;

/** A gift on its way to the hall: taken from the bank, not yet counted by the register. */
export const GiftSchema = z.object({
  id: z.number().int().min(1),
  room: IdSchema,
  /** The tier it was meant to raise; a tier someone else finished first sends it back. */
  tier: z.number().int().min(1),
  /** The item, or null for coins. */
  item: IdSchema.nullable(),
  qty: z.number().int().min(1).max(MAX_GIFT_QTY),
});
export type Gift = z.infer<typeof GiftSchema>;

export const HallStateSchema = z.object({
  id: z.number().int().min(1).nullable(),
  rooms: z.record(IdSchema, z.number().int().min(0)),
  gifts: z.array(GiftSchema).max(MAX_PENDING_GIFTS),
  given: z.number().int().min(0),
});
export type HallState = z.infer<typeof HallStateSchema>;

/** What the register answers a save with: where this name stands and what it took. */
export const HallSyncSchema = z.object({
  /** The hall this name is in, or null. */
  id: z.number().int().min(1).nullable(),
  rooms: z.record(IdSchema, z.number().int().min(0)),
  /** Each gift answered: how much of it the hall took (the rest comes back). */
  took: z.array(z.object({ id: z.number().int().min(1), qty: z.number().int().min(0) })),
  /** The gift count the register knows; a save cannot fall behind it. */
  given: z.number().int().min(0),
});
export type HallSync = z.infer<typeof HallSyncSchema>;

export const NO_HALL: HallState = { id: null, rooms: {}, gifts: [], given: 0 };

export function inHall(state: SimState): boolean {
  return state.hall.id !== null;
}

/** The tier `room` stands at, 0 when unraised or unknown. */
export function roomTier(state: SimState, room: string): number {
  return state.hall.rooms[room] ?? 0;
}

/** The tier that would be raised next, or null at the top. */
export function nextTier(room: RoomDef, state: SimState): RoomTier | null {
  return room.tiers[roomTier(state, room.id)] ?? null;
}

/** The perk of every raised room at its tier, in content order. */
export function hallPerks(state: SimState, ctx: SimContext): RoomPerk[] {
  const out: RoomPerk[] = [];
  for (const room of ctx.content.rooms) {
    const tier = roomTier(state, room.id);
    const t = room.tiers[Math.min(tier, room.tiers.length) - 1];
    if (tier > 0 && t) out.push(t.perk);
  }
  return out;
}

/** Fractional xp bonus the hall gives in `skill`. */
export function hallXpBonus(state: SimState, skill: string, ctx: SimContext): number {
  let bonus = 0;
  for (const p of hallPerks(state, ctx)) {
    if (p.kind === 'xp' && (p.skill === null || p.skill === skill)) bonus += p.bonus;
  }
  return bonus;
}

/** Chance the hall adds that a gathering cycle of `skill` lands twice. */
export function hallDoubleYield(state: SimState, skill: string, ctx: SimContext): number {
  let chance = 0;
  for (const p of hallPerks(state, ctx)) {
    if (p.kind === 'double-yield' && (p.skill === null || p.skill === skill)) chance += p.chance;
  }
  return chance;
}

/** Fraction more that food heals. */
export function hallHealBonus(state: SimState, ctx: SimContext): number {
  let bonus = 0;
  for (const p of hallPerks(state, ctx)) if (p.kind === 'heal') bonus += p.bonus;
  return bonus;
}

/** Bank slots the hall adds. */
export function hallBankSlots(state: SimState, ctx: SimContext): number {
  let slots = 0;
  for (const p of hallPerks(state, ctx)) if (p.kind === 'bank-slots') slots += p.slots;
  return slots;
}

/** Ticks the hall adds to the offline cap. */
export function hallNightTicks(state: SimState, ctx: SimContext): number {
  let hours = 0;
  for (const p of hallPerks(state, ctx)) if (p.kind === 'night') hours += p.hours;
  return Math.round(hours * TICKS_PER_HOUR);
}

/** The fraction the hall knocks off the ferryman's fee, at most 1. */
export function hallFerrymanDiscount(state: SimState, ctx: SimContext): number {
  let discount = 0;
  for (const p of hallPerks(state, ctx)) if (p.kind === 'ferryman') discount += p.discount;
  return Math.min(1, discount);
}

export type GiveResult = { ok: true; state: SimState } | { ok: false; reason: string };

/**
 * Put a gift on the cart: `qty` of `item` (or coins when null) toward the next tier of
 * `room`. Rejected, with the state untouched, when this name has no hall, the room is unknown
 * or finished, the tier does not want that, the bank does not hold it, or the cart is full.
 * The register may take less than is given; the rest comes back with its answer.
 */
export function give(
  state: SimState,
  gift: { room: string; item: string | null; qty: number },
  ctx: SimContext,
): GiveResult {
  if (!inHall(state)) return { ok: false, reason: 'you have no hall to give to' };
  if (!ctx.content.hasRoom(gift.room)) return { ok: false, reason: `unknown room "${gift.room}"` };
  const room = ctx.content.room(gift.room);
  const tier = nextTier(room, state);
  if (tier === null) return { ok: false, reason: `${room.name} is finished` };
  if (!Number.isInteger(gift.qty) || gift.qty < 1)
    return { ok: false, reason: 'give at least one' };
  if (state.hall.gifts.length >= MAX_PENDING_GIFTS)
    return { ok: false, reason: 'the hall has not taken your last gifts yet' };
  const n = roomTier(state, room.id) + 1;
  let s: SimState;
  let worth: number;
  if (gift.item === null) {
    if (tier.coins === 0) return { ok: false, reason: `${room.name} wants no coins for now` };
    if (state.coins < gift.qty)
      return {
        ok: false,
        reason: `that is ${String(gift.qty)} gp (you have ${String(state.coins)})`,
      };
    s = { ...state, coins: state.coins - gift.qty };
    worth = gift.qty;
  } else {
    const item = gift.item;
    if (!tier.cost.some((c) => c.item === item)) {
      const name = ctx.content.hasItem(item) ? ctx.content.item(item).name : item;
      return { ok: false, reason: `${room.name} has no use for ${name}` };
    }
    const bank = removeItem(state.bank, item, gift.qty);
    if (bank === null) {
      return {
        ok: false,
        reason: `you have ${String(countItem(state.bank, item))} ${ctx.content.item(item).name}`,
      };
    }
    s = { ...state, bank };
    worth = ctx.content.item(item).value * gift.qty;
  }
  const id = state.hall.given + 1;
  const entry: Gift = { id, room: room.id, tier: n, item: gift.item, qty: gift.qty };
  s = {
    ...s,
    hall: { ...s.hall, gifts: [...s.hall.gifts, entry], given: id },
    stats: { ...s.stats, given: s.stats.given + worth },
  };
  return {
    ok: true,
    state: pushEvent(s, {
      type: 'gave',
      tick: s.tick,
      room: room.id,
      item: gift.item,
      qty: gift.qty,
    }),
  };
}

/** Whether two room maps say the same thing. */
function sameRooms(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

/**
 * Apply what the register answered. Each answered gift leaves the cart and whatever the hall
 * did not take comes back to the bank (or the purse); the hall and its rooms are set to what
 * the register said; a room that now stands higher is logged. Never throws — a garbage
 * answer is simply ignored — and returns the very same state when nothing changes, so the
 * host can tell.
 */
export function applyHallSync(state: SimState, sync: HallSync, ctx: SimContext): SimState {
  let bank = state.bank;
  let coins = state.coins;
  const answered = new Map(sync.took.map((t) => [t.id, t.qty]));
  const gifts = state.hall.gifts.some((g) => answered.has(g.id))
    ? state.hall.gifts.filter((g) => !answered.has(g.id))
    : state.hall.gifts;
  for (const g of state.hall.gifts) {
    const taken = answered.get(g.id);
    if (taken === undefined) continue;
    const back = g.qty - Math.max(0, Math.min(g.qty, Math.trunc(taken)));
    if (back <= 0) continue;
    if (g.item === null) coins += back;
    else if (ctx.content.hasItem(g.item)) bank = addItem(bank, g.item, back);
  }
  const rooms = Object.fromEntries(
    Object.entries(sync.rooms).filter(([id]) => ctx.content.hasRoom(id)),
  );
  const given = Math.max(state.hall.given, sync.given);
  const unchanged =
    gifts === state.hall.gifts &&
    bank === state.bank &&
    coins === state.coins &&
    sync.id === state.hall.id &&
    given === state.hall.given &&
    sameRooms(rooms, state.hall.rooms);
  if (unchanged) return state;
  let s: SimState = { ...state, bank, coins, hall: { id: sync.id, rooms, gifts, given } };
  for (const [id, tier] of Object.entries(rooms)) {
    if (tier > roomTier(state, id))
      s = pushEvent(s, { type: 'raised', tick: s.tick, room: id, tier });
  }
  return s;
}
