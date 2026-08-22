import { OFFLINE_CAP_TICKS, TICK_MS } from './constants.ts';
import type { WareDef } from './content/schema.ts';
import type { SimContext } from './context.ts';
import type { SimState } from './save.ts';

/**
 * The trader: wares bought with coins, each an engine-known effect carried as content. A
 * purchase is recorded as a count per ware in `state.upgrades`; the lamp ladder raises the
 * offline cap, a second look rolls finds twice, release from the oath lets the hero swear
 * again. Prices are `price × growth^bought`, rounded to 10 gp, so a repeatable ware climbs.
 */

const TICKS_PER_HOUR = 3_600_000 / TICK_MS;

export type WareStatus = 'owned' | 'locked' | 'for-sale';

/** Times `ware` was bought. */
export function timesBought(state: SimState, ware: string): number {
  return state.upgrades[ware] ?? 0;
}

export function ownsWare(state: SimState, ware: string): boolean {
  return timesBought(state, ware) > 0;
}

/** What `ware` costs next. */
export function warePrice(ware: WareDef, state: SimState): number {
  const bought = timesBought(state, ware.id);
  return Math.round((ware.price * Math.pow(ware.growth, bought)) / 10) * 10;
}

/** Owned (a `once` ware already bought), locked (its requirement is not owned), or for sale. */
export function wareStatus(ware: WareDef, state: SimState): WareStatus {
  if (ware.once && ownsWare(state, ware.id)) return 'owned';
  if (ware.requires !== null && !ownsWare(state, ware.requires)) return 'locked';
  return 'for-sale';
}

/** The owned wares, in content order. */
export function ownedWares(state: SimState, ctx: SimContext): WareDef[] {
  return ctx.content.wares.filter((w) => ownsWare(state, w.id));
}

/** Offline progress counts for this many ticks: the base cap, or the best lamp owned. */
export function offlineCapTicks(state: SimState, ctx: SimContext): number {
  let cap = OFFLINE_CAP_TICKS;
  for (const w of ownedWares(state, ctx)) {
    if (w.effect.kind === 'offline-cap') cap = Math.max(cap, w.effect.hours * TICKS_PER_HOUR);
  }
  return cap;
}

/** How many times a skill's `finds` table is rolled per successful cycle. */
export function findsRolls(state: SimState, ctx: SimContext): number {
  return ownedWares(state, ctx).some((w) => w.effect.kind === 'second-look') ? 2 : 1;
}

/** Times the hero has been released from an oath. */
export function oathsReleased(state: SimState, ctx: SimContext): number {
  let n = 0;
  for (const w of ctx.content.wares) {
    if (w.effect.kind === 'release-oath') n += timesBought(state, w.id);
  }
  return n;
}

export type BuyResult = { ok: true; state: SimState } | { ok: false; reason: string };

/**
 * Buy one of `ware`. Rejected, with the state untouched, when the ware is unknown, locked,
 * already owned, or costs more than the hero has. Coins go, the lifetime `spent` counter and
 * the ware's count rise, and the effect that happens at purchase (release) is applied.
 */
export function buyWare(state: SimState, id: string, ctx: SimContext): BuyResult {
  if (!ctx.content.hasWare(id)) return { ok: false, reason: `unknown ware "${id}"` };
  const ware = ctx.content.ware(id);
  const status = wareStatus(ware, state);
  if (status === 'owned') return { ok: false, reason: `you already have ${ware.name}` };
  if (status === 'locked') {
    const needs = ctx.content.ware(ware.requires!);
    return { ok: false, reason: `${ware.name} comes after ${needs.name}` };
  }
  if (ware.effect.kind === 'release-oath' && state.player.god === null)
    return { ok: false, reason: 'no oath to be released from' };
  const price = warePrice(ware, state);
  if (state.coins < price) {
    return {
      ok: false,
      reason: `${ware.name} costs ${String(price)} gp (you have ${String(state.coins)})`,
    };
  }
  let s: SimState = {
    ...state,
    coins: state.coins - price,
    stats: { ...state.stats, spent: state.stats.spent + price },
    upgrades: { ...state.upgrades, [ware.id]: timesBought(state, ware.id) + 1 },
  };
  if (ware.effect.kind === 'release-oath') {
    // Favour is the hill's, not the god's: it stays, and the next oath inherits it.
    s = { ...s, player: { ...s.player, god: null } };
  }
  return { ok: true, state: s };
}
