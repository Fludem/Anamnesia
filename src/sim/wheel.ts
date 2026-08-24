import { z } from 'zod';
import { pushEvent } from './events.ts';
import type { SimState } from './save.ts';

/**
 * The wheel: one table on the hill, turned by the register, that every name bets on at once.
 * A round is thirty seconds of the register's clock — bets for the first twenty-four, the
 * pocket for the last six — and the pocket is drawn there, not here, so the sim's own dice
 * never touch it. A bet is staked straight from the purse: the screen tells the register
 * (`/api/wheel/bet`) and, once it says yes, `stake` takes the coins out of the save. What the
 * wheel gives back — winnings, and bets taken back before the close — becomes a numbered
 * payout at the register that `applyWheelSync` brings home with the next save, repeated until
 * the save says it has been seen (`paidThrough`), so a tab that reloads onto a stored record
 * is never owed twice and never short.
 *
 * The cart is the old road coins took to the table (buy-ins, Phase 14); no save puts anything
 * on it any more, but a cart carried in by an old save is still credited by the register and
 * flushed straight home, so nothing a name ever set down is lost.
 */

export const MAX_PENDING_BUY_INS = 20;
export const MAX_STAKE = 1_000_000_000;

/** Coins an old save is still carrying to the table; nothing new ever joins them. */
export const BuyInSchema = z.object({
  id: z.number().int().min(1),
  coins: z.number().int().min(1).max(MAX_STAKE),
});
export type BuyIn = z.infer<typeof BuyInSchema>;

export const WheelStateSchema = z.object({
  cart: z.array(BuyInSchema).max(MAX_PENDING_BUY_INS),
  /** The highest buy-in number ever put on the cart; the register knows it too. */
  bought: z.number().int().min(0),
  /** The last payout this save has taken; the register repeats anything newer. */
  paidThrough: z.number().int().min(0),
});
export type WheelState = z.infer<typeof WheelStateSchema>;

/** What the register answers a save with about the table. */
export const WheelSyncSchema = z.object({
  /** Buy-ins credited (or already known): they leave the cart. */
  took: z.array(z.number().int().min(1)),
  /** Cash-outs this save has not taken yet, oldest first. */
  paid: z.array(z.object({ seq: z.number().int().min(1), coins: z.number().int().min(0) })),
  /** Chips at the table after all of the above. */
  purse: z.number().int().min(0),
  /** The buy-in count the register knows; a save cannot fall behind it. */
  bought: z.number().int().min(0),
});
export type WheelSync = z.infer<typeof WheelSyncSchema>;

export const NO_WHEEL: WheelState = { cart: [], bought: 0, paidThrough: 0 };

export type StakeResult = { ok: true; state: SimState } | { ok: false; reason: string };

/**
 * Coins the register just accepted as a bet leave the purse. Rejected, with the state
 * untouched, when the stake is less than one or more than the purse holds — the screen asks
 * the register first, so a refusal here means the two disagreed about the purse.
 */
export function stake(state: SimState, coins: number): StakeResult {
  if (!Number.isInteger(coins) || coins < 1)
    return { ok: false, reason: 'a stake is at least 1 gp' };
  if (coins > MAX_STAKE) return { ok: false, reason: 'the table will not take that much at once' };
  if (state.coins < coins)
    return { ok: false, reason: `that is ${String(coins)} gp (you have ${String(state.coins)})` };
  const s: SimState = {
    ...state,
    coins: state.coins - coins,
    stats: { ...state.stats, boughtIn: state.stats.boughtIn + coins },
  };
  return { ok: true, state: pushEvent(s, { type: 'bought-in', tick: s.tick, coins }) };
}

/**
 * Apply what the register answered. Credited buy-ins leave the cart; payouts newer than
 * `paidThrough` come into the purse and are logged; the counters can only go up. Returns the
 * very same state when nothing changes, so the host can tell.
 */
export function applyWheelSync(state: SimState, sync: WheelSync): SimState {
  const took = new Set(sync.took);
  const cart = state.wheel.cart.some((b) => took.has(b.id))
    ? state.wheel.cart.filter((b) => !took.has(b.id))
    : state.wheel.cart;
  let coins = state.coins;
  let paidThrough = state.wheel.paidThrough;
  const landed: number[] = [];
  for (const p of [...sync.paid].sort((a, b) => a.seq - b.seq)) {
    if (p.seq <= paidThrough) continue;
    paidThrough = p.seq;
    coins += p.coins;
    landed.push(p.coins);
  }
  const bought = Math.max(state.wheel.bought, sync.bought);
  if (
    cart === state.wheel.cart &&
    coins === state.coins &&
    paidThrough === state.wheel.paidThrough &&
    bought === state.wheel.bought
  )
    return state;
  let s: SimState = {
    ...state,
    coins,
    wheel: { cart, bought, paidThrough },
    stats: { ...state.stats, cashedOut: state.stats.cashedOut + landed.reduce((a, b) => a + b, 0) },
  };
  for (const c of landed) s = pushEvent(s, { type: 'cashed-out', tick: s.tick, coins: c });
  return s;
}

// ---- the table's arithmetic, shared with the register and the screen ------------------------

/** Pockets on the wheel: 0, 1–36, and 37 for the double zero. */
export const POCKETS = 38;
export const DOUBLE_ZERO = 37;

export const RED: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

/** Thirty seconds a round; bets for the first twenty-four. */
export const ROUND_MS = 30_000;
export const BETS_MS = 24_000;

/**
 * A spot on the table. Written as one short string so it keys a bet in the register and on the
 * wire: `straight:17`, `red`, `dozen:2`, `column:3`.
 */
export const SpotSchema = z
  .string()
  .regex(/^(straight:(\d|[12]\d|3[0-7])|red|black|odd|even|low|high|dozen:[123]|column:[123])$/);
export type Spot = z.infer<typeof SpotSchema>;

export function isSpot(s: string): s is Spot {
  return SpotSchema.safeParse(s).success;
}

/** What a winning spot pays on top of the stake: 35 to 1 on a number, 2 on a third, even money. */
export function spotOdds(spot: Spot): number {
  if (spot.startsWith('straight:')) return 35;
  if (spot.startsWith('dozen:') || spot.startsWith('column:')) return 2;
  return 1;
}

export function pocketColour(pocket: number): 'red' | 'black' | 'house' {
  if (pocket === 0 || pocket === DOUBLE_ZERO) return 'house';
  return RED.has(pocket) ? 'red' : 'black';
}

/** Whether `spot` wins when the ball lands in `pocket`. The house pockets beat every outside bet. */
export function spotWins(spot: Spot, pocket: number): boolean {
  if (spot.startsWith('straight:')) return Number(spot.slice(9)) === pocket;
  if (pocket === 0 || pocket === DOUBLE_ZERO) return false;
  switch (spot) {
    case 'red':
      return RED.has(pocket);
    case 'black':
      return !RED.has(pocket);
    case 'odd':
      return pocket % 2 === 1;
    case 'even':
      return pocket % 2 === 0;
    case 'low':
      return pocket <= 18;
    case 'high':
      return pocket >= 19;
  }
  if (spot.startsWith('dozen:')) return Math.ceil(pocket / 12) === Number(spot.slice(6));
  if (spot.startsWith('column:')) return ((pocket - 1) % 3) + 1 === Number(spot.slice(7));
  return false;
}

/** What comes back for `stake` on `spot`: the stake and its odds on a win, nothing otherwise. */
export function payout(stake: number, spot: Spot, pocket: number): number {
  return spotWins(spot, pocket) ? stake * (spotOdds(spot) + 1) : 0;
}

export function pocketLabel(pocket: number): string {
  return pocket === DOUBLE_ZERO ? '00' : String(pocket);
}

export function spotLabel(spot: Spot): string {
  if (spot.startsWith('straight:')) return pocketLabel(Number(spot.slice(9)));
  if (spot.startsWith('dozen:')) return ['1st 12', '2nd 12', '3rd 12'][Number(spot.slice(6)) - 1]!;
  if (spot.startsWith('column:'))
    return ['1st column', '2nd column', '3rd column'][Number(spot.slice(7)) - 1]!;
  return { red: 'red', black: 'black', odd: 'odd', even: 'even', low: '1 to 18', high: '19 to 36' }[
    spot
  ]!;
}

/** Which round the register's clock is in, and its edges. */
export function roundAt(nowMs: number): {
  id: number;
  opensAt: number;
  closesAt: number;
  endsAt: number;
} {
  const id = Math.floor(nowMs / ROUND_MS);
  const opensAt = id * ROUND_MS;
  return { id, opensAt, closesAt: opensAt + BETS_MS, endsAt: opensAt + ROUND_MS };
}
