import type { SimState } from './save.ts';

/**
 * Bank capacity, in stacks. Every distinct item takes one slot however many of it there are;
 * extra slots are bought with coins. The numbers are the design's (Screen C): 30 to start,
 * 500 gp for the first extra slot, ×1.18 per slot after that, rounded to 10 gp.
 */
export const BASE_BANK_SLOTS = 30;
export const SLOT_COST_BASE = 500;
export const SLOT_COST_GROWTH = 1.18;

export function bankCapacity(state: SimState): number {
  return BASE_BANK_SLOTS + state.bankSlotsBought;
}

export function bankSlotsUsed(state: SimState): number {
  return state.bank.length;
}

export function bankFull(state: SimState): boolean {
  return bankSlotsUsed(state) >= bankCapacity(state);
}

/** Price of the next slot after `bought` have been bought. */
export function bankSlotCost(bought: number): number {
  return Math.round((SLOT_COST_BASE * Math.pow(SLOT_COST_GROWTH, bought)) / 10) * 10;
}

/**
 * Whether every one of `items` could be deposited without a new slot that does not exist. A
 * full bank still accepts items it already holds (they stack). Used before an action cycle
 * starts and before a container is opened, so nothing is ever rolled and then lost: the
 * action stops *before* the drop instead of discarding it after. Conservative on purpose —
 * it treats every possible drop as if it will land.
 */
export function roomFor(
  state: SimState,
  items: Iterable<string>,
): { ok: true } | { ok: false; item: string } {
  if (!bankFull(state)) return { ok: true };
  const held = new Set(state.bank.map((s) => s.item));
  for (const item of items) if (!held.has(item)) return { ok: false, item };
  return { ok: true };
}

/** Total sale value of everything in the bank. */
export function bankWorth(state: SimState, value: (item: string) => number): number {
  let total = 0;
  for (const s of state.bank) total += value(s.item) * s.qty;
  return total;
}
