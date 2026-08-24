import type { BoutRow, RingCard, RingGet, RingWorn } from '../api/protocol.ts';
import { MAX_BOUT_TICKS, fightBout, type BoutResult, type Fighter } from '../sim/bout.ts';
import { TICK_MS } from '../sim/constants.ts';
import { maxHit } from '../sim/combat.ts';
import { formatInt } from './format.ts';

/**
 * Pure view helpers for the ring. Like derive.ts: no React, no clock, no fetching — the numbers
 * the screen draws are worked out here so tests can pin them.
 *
 * The one thing worth knowing about this file: it never asks the register what happened in a
 * bout. A bout row carries both fighters and the seed, so `replay` runs the very same
 * `fightBout` the register decided it with and gets the very same blows. The screen is not
 * shown a retelling it has to trust; it re-derives the fight and can only agree.
 */

/** Ticks a bout's replay holds on its last blow before the card settles. */
export const REPLAY_TAIL_TICKS = 20;

export interface BoutSideView {
  name: string;
  /** The fighter as the register resolved them, at the moment of the bout. */
  fighter: Fighter;
  hp: number;
  maxHp: number;
  /** 0–1 through this side's swing at the replay's current tick. */
  swingFrac: number;
  statsLine: string;
  /** The last blow landed on this side, for the number that pops over the bar. */
  splat: { amount: number; hit: boolean; at: number } | null;
  won: boolean;
}

export interface BoutView {
  id: number;
  caller: BoutSideView;
  called: BoutSideView;
  /** What was played for, and what was put up. */
  prize: string;
  stake: string;
  slot: string;
  winner: string;
  onPoints: boolean;
  /** True when the reader is the one who did the calling. */
  yours: boolean;
  /** True when the reader won it, whichever side they were. */
  youWon: boolean;
  agoMs: number;
  /** The whole fight, so a card can scrub or replay it. */
  result: BoutResult;
  /** Ticks the replay runs for, including the tail. */
  ticks: number;
}

/** One side's numbers as a line, the way the fight card writes them. */
export function statsLine(f: Fighter): string {
  const seconds = (f.swingTicks * TICK_MS) / 1000;
  return `atk ${formatInt(f.attack)} · str ${formatInt(f.strength)} · def ${formatInt(
    f.defence,
  )} · max ${formatInt(maxHit(f.strength))} · ${seconds.toFixed(1)}s`;
}

/**
 * The bout as it stands `at` ticks in. `at` past the end is simply the end, so a card that has
 * finished animating and one that was never animated draw the same thing.
 */
export function boutView(
  row: BoutRow,
  you: string,
  at: number = Number.POSITIVE_INFINITY,
): BoutView {
  const result = replay(row);
  const last = result.swings[result.swings.length - 1]?.at ?? 0;
  const ticks = last + REPLAY_TAIL_TICKS;
  const cut = Math.min(at, ticks);

  const side = (which: 'caller' | 'called'): BoutSideView => {
    const fighter = which === 'caller' ? row.callerFighter : row.calledFighter;
    // Hitpoints are whatever the last blow *against* this side left, up to the cut.
    const against = result.swings.filter((s) => s.by !== which && s.at <= cut);
    const hp = against.length > 0 ? against[against.length - 1]!.left : fighter.maxHp;
    const mine = result.swings.filter((s) => s.by === which && s.at <= cut);
    const lastMine = mine[mine.length - 1]?.at ?? 0;
    const since = cut - lastMine;
    const landed = against[against.length - 1] ?? null;
    return {
      name: fighter.name,
      fighter,
      hp,
      maxHp: fighter.maxHp,
      swingFrac: hp === 0 ? 0 : Math.min(1, Math.max(0, since / fighter.swingTicks)),
      statsLine: statsLine(fighter),
      splat:
        landed !== null && cut - landed.at <= REPLAY_TAIL_TICKS
          ? { amount: landed.amount, hit: landed.hit, at: landed.at }
          : null,
      won: result.winner === which,
    };
  };

  const youWon = row.winner === you;
  return {
    id: row.id,
    caller: side('caller'),
    called: side('called'),
    prize: row.prize,
    stake: row.stake,
    slot: row.slot,
    winner: row.winner,
    onPoints: row.onPoints,
    yours: row.yours,
    youWon,
    agoMs: row.agoMs,
    result,
    ticks,
  };
}

/** The fight itself, re-run from what the row carries. Never asks the register. */
export function replay(row: BoutRow): BoutResult {
  return fightBout(row.callerFighter, row.calledFighter, row.seed);
}

/**
 * Roughly how a bout would go, for the challenge list — the same shape the road prices an
 * ambush with: how long each side would need to put the other down, taken against each other.
 * Never a promise, and the screen says so.
 */
export function oddsAgainst(you: Fighter, them: Fighter): number {
  const ticksToFell = (a: Fighter, b: Fighter) => {
    const chance = (a.attack + 2) / (a.attack + b.defence + 4);
    const perSwing = (chance * (1 + maxHit(a.strength))) / 2;
    return perSwing > 0 ? (b.maxHp / perSwing) * a.swingTicks : Number.POSITIVE_INFINITY;
  };
  const yours = ticksToFell(you, them);
  const theirs = ticksToFell(them, you);
  if (!Number.isFinite(yours)) return 0;
  if (!Number.isFinite(theirs)) return 1;
  return theirs / (yours + theirs);
}

/** What the ring will not let you play for, in one line, or null when it will. */
export function refusalOf(worn: RingWorn): string | null {
  return worn.refusal;
}

/** The things on a card that can actually be played for, dearest first. */
export function playable(card: RingCard): RingWorn[] {
  return [...card.worn].sort((a, b) => Number(b.ok) - Number(a.ok) || b.value - a.value);
}

/** Whether the reader may call anyone at all right now, and why not. */
export function callBar(ring: RingGet): string | null {
  if (!ring.in) return 'step into the ring first';
  if (ring.owed > 0) return `the ring wants the ${formatInt(ring.owed)} gp you owe it first`;
  if (ring.restMs > 0) return `you may call again in ${restLine(ring.restMs)}`;
  return null;
}

/** A rest as the screen says it: minutes under an hour, hours above. */
export function restLine(ms: number): string {
  const m = Math.ceil(ms / 60_000);
  if (m < 60) return `${String(m)} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${String(h)} h` : `${String(h)} h ${String(rest)} min`;
}

/** The longest a bout can run, in seconds, for the help card. */
export const MAX_BOUT_SECONDS = (MAX_BOUT_TICKS * TICK_MS) / 1000;
