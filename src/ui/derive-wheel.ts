/**
 * Pure views of the table for the wheel screen: where the round stands on the register's
 * clock, what is down on each spot (this name's and everyone's), the strip of last pockets,
 * and a line for the last spin. No React, no clock of its own — the screen passes `nowMs`.
 */
import type { WheelGet, WheelSpin } from '../api/protocol.ts';
import { payout, pocketColour, pocketLabel, spotLabel, spotOdds, type Spot } from '../sim/wheel.ts';
import { formatInt } from './format.ts';

export type Phase =
  /** Bets are being taken; `leftMs` until they close. */
  | { kind: 'open'; leftMs: number }
  /** The pocket is drawn and shown; `leftMs` until the next round opens. */
  | { kind: 'shown'; leftMs: number; pocket: number }
  /** Between the close and the draw arriving, or a round whose draw the screen has not seen. */
  | { kind: 'turning'; leftMs: number };

/** Where the round stands at `nowMs` of the register's clock. */
export function phaseAt(data: WheelGet, nowMs: number): Phase {
  const r = data.round;
  if (nowMs < r.closesAt) return { kind: 'open', leftMs: r.closesAt - nowMs };
  const leftMs = Math.max(0, r.endsAt - nowMs);
  return r.pocket === null
    ? { kind: 'turning', leftMs }
    : { kind: 'shown', leftMs, pocket: r.pocket };
}

/** The last seconds of the open phase, when the countdown turns gold. */
export const CLOSING_MS = 4_000;

export function closing(phase: Phase): boolean {
  return phase.kind === 'open' && phase.leftMs <= CLOSING_MS;
}

// ---- the reveal -----------------------------------------------------------------------------

/** How long the reveal stands after the bets close, and when it starts to go. */
export const REVEAL_MS = 4_600;
export const REVEAL_HOLD_MS = 4_000;

export interface Reveal {
  /** The pocket, once the register has shown it; null while the wheel still turns. */
  pocket: number | null;
  /** Seconds until the next round opens, for the landed face's line. */
  leftS: number;
  /** The reveal is on its way out. */
  fading: boolean;
  /** What this name put down this round, and what the pocket gave back for it. */
  put: number;
  got: number;
}

/**
 * The moment between rounds, as the screen shows it: from the close until the next round is
 * nearly open, the drawn pocket stands over the table — or a turning face, while the register
 * has not answered yet. Null outside that window, and the phase chip carries the pocket alone.
 */
export function revealAt(data: WheelGet, me: string, nowMs: number): Reveal | null {
  const since = nowMs - data.round.closesAt;
  if (since < 0 || since >= REVEAL_MS) return null;
  const pocket = data.round.pocket;
  const put = myStake(data, me);
  const got =
    pocket === null
      ? 0
      : data.table
          .filter((p) => p.name === me)
          .flatMap((p) => p.bets)
          .reduce((n, b) => n + payout(b.stake, b.spot, pocket), 0);
  return {
    pocket,
    leftS: Math.max(0, Math.ceil((data.round.endsAt - nowMs) / 1000)),
    fading: since >= REVEAL_HOLD_MS,
    put,
    got,
  };
}

export interface SpotStack {
  /** This name's chips on the spot. */
  mine: number;
  /** Everyone's, this name included. */
  all: number;
}

/** Chips per spot this round. */
export function stacks(data: WheelGet, me: string): Map<Spot, SpotStack> {
  const out = new Map<Spot, SpotStack>();
  for (const p of data.table) {
    for (const b of p.bets) {
      const s = out.get(b.spot) ?? { mine: 0, all: 0 };
      s.all += b.stake;
      if (p.name === me) s.mine += b.stake;
      out.set(b.spot, s);
    }
  }
  return out;
}

/** What this name has down this round, in all. */
export function myStake(data: WheelGet, me: string): number {
  return data.table
    .filter((p) => p.name === me)
    .flatMap((p) => p.bets)
    .reduce((n, b) => n + b.stake, 0);
}

export interface StripPocket {
  id: number;
  pocket: number;
  label: string;
  colour: 'red' | 'black' | 'house';
  /** "17 · black", "0 · the house" — the token's title, so colour is never the only signal. */
  word: string;
}

/** The last pockets, newest first, for the strip. */
export function strip(data: WheelGet): StripPocket[] {
  return data.last.map((s) => ({
    id: s.id,
    pocket: s.pocket,
    label: pocketLabel(s.pocket),
    colour: pocketColour(s.pocket),
    word: `${pocketLabel(s.pocket)} · ${colourWord(s.pocket)}`,
  }));
}

/** "17 black · you took 450 for 140 · Bea lost 250", or "17 black · nobody had a bet down". */
export function spinLine(spin: WheelSpin, me = ''): string {
  const head = `${pocketLabel(spin.pocket)} ${colourWord(spin.pocket)}`;
  if (spin.players.length === 0) return `${head} · nobody had a bet down`;
  const parts = spin.players.map((p) => {
    const who = p.name === me ? 'you' : p.name;
    return p.returned > p.staked
      ? `${who} took ${formatInt(p.returned)} for ${formatInt(p.staked)}`
      : p.returned === p.staked
        ? `${who} broke even`
        : `${who} lost ${formatInt(p.staked - p.returned)}`;
  });
  return `${head} · ${parts.join(' · ')}`;
}

export function colourWord(pocket: number): string {
  const c = pocketColour(pocket);
  return c === 'house' ? 'the house' : c;
}

/** The table laid out for the screen: three rows of twelve, top row the third column. */
export const GRID_ROWS: readonly (readonly number[])[] = [3, 2, 1].map((row) =>
  Array.from({ length: 12 }, (_, i) => i * 3 + row),
);

export const OUTSIDE_ROW_1: readonly Spot[] = ['dozen:1', 'dozen:2', 'dozen:3'];
export const OUTSIDE_ROW_2: readonly Spot[] = ['low', 'even', 'red', 'black', 'odd', 'high'];
export const COLUMN_SPOTS: readonly Spot[] = ['column:3', 'column:2', 'column:1'];

/** The stake values the chip row offers, never more than the purse holds. */
export const CHIP_VALUES: readonly number[] = [100, 1_000, 10_000, 100_000, 1_000_000];

/** A short name for a stack on the table: 1.5k, 20k, 2M. */
export function chipText(n: number): string {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${trim(n / 1_000)}k`;
  return String(n);
}

function trim(x: number): string {
  return x >= 10 ? String(Math.round(x)) : String(Math.round(x * 10) / 10);
}

/**
 * The spot's title: with chips down, what they would bring back and how to take them back;
 * bare, what the spot pays.
 */
export function spotTip(spot: Spot, mine: number): string {
  const odds = spotOdds(spot);
  return mine > 0
    ? `${spotLabel(spot)} · ${formatInt(mine)} pays ${formatInt(mine * (odds + 1))} · right-click takes it back`
    : `${spotLabel(spot)} · pays ${formatInt(odds)} to 1`;
}
