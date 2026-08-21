import { OFFLINE_CAP_TICKS, TICK_MS } from './constants.ts';
import type { SimState } from './save.ts';
import type { StepFn } from './step.ts';

export interface PlanInput {
  /** Last processed tick (`sim.tick`). */
  tick: number;
  /** Wall-clock ms at which `tick` was current. */
  wallMs: number;
  /** Current wall-clock ms from the injected clock. */
  nowMs: number;
  tickMs?: number;
  capTicks?: number;
}

/**
 * A tick range to process, derived purely from timestamps. Keyed on tick numbers, so applying
 * the same plan twice is a no-op the second time.
 */
export interface AdvancePlan {
  fromTick: number;
  toTick: number;
  /** Wall-clock ms corresponding to `fromTick`. */
  fromWallMs: number;
  /** Wall-clock ms corresponding to `toTick` (the new anchor once the plan is fully applied). */
  newWallMs: number;
  tickMs: number;
  /** Ticks that should have elapsed but were discarded by the cap. */
  skippedTicks: number;
  clockWentBackwards: boolean;
}

/**
 * Work out how many ticks *should* have elapsed between `wallMs` and `nowMs`.
 *
 * - Negative delta (NTP correction, manual clock change, sleep quirks): zero ticks, and the
 *   anchor is moved to `nowMs` so the game does not freeze until the clock catches up.
 * - Sub-tick remainder stays in the anchor, so 150 ms + 150 ms yields 3 ticks, not 2.
 * - Beyond `capTicks`, the excess is discarded (anchor jumps to `nowMs`) and reported.
 */
export function planAdvance(input: PlanInput): AdvancePlan {
  const tickMs = input.tickMs ?? TICK_MS;
  const capTicks = input.capTicks ?? OFFLINE_CAP_TICKS;
  const { tick, wallMs, nowMs } = input;
  const base = { fromTick: tick, fromWallMs: wallMs, tickMs };

  const delta = nowMs - wallMs;
  if (!(delta > 0)) {
    // Covers delta <= 0 and NaN. Re-anchor only when the clock actually went backwards.
    const backwards = delta < 0;
    return {
      ...base,
      toTick: tick,
      fromWallMs: backwards ? nowMs : wallMs,
      newWallMs: backwards ? nowMs : wallMs,
      skippedTicks: 0,
      clockWentBackwards: backwards,
    };
  }

  const n = Math.floor(delta / tickMs);
  if (n > capTicks) {
    return {
      ...base,
      toTick: tick + capTicks,
      newWallMs: nowMs,
      skippedTicks: n - capTicks,
      clockWentBackwards: false,
    };
  }
  return {
    ...base,
    toTick: tick + n,
    newWallMs: wallMs + n * tickMs,
    skippedTicks: 0,
    clockWentBackwards: false,
  };
}

export function planTickCount(plan: AdvancePlan): number {
  return plan.toTick - plan.fromTick;
}

/**
 * The wall-clock anchor that is consistent with having processed up to `tick` within `plan`.
 * Keeps the invariant "wallMs is the wall time of sim.tick" even when a plan is applied in
 * batches and saved part-way.
 */
export function wallMsAt(plan: AdvancePlan, tick: number): number {
  if (tick >= plan.toTick) return plan.newWallMs;
  if (tick <= plan.fromTick) return plan.fromWallMs;
  return plan.fromWallMs + (tick - plan.fromTick) * plan.tickMs;
}

/**
 * Run `step` from the later of `state.tick` / `plan.fromTick` up to `plan.toTick` (or at most
 * `maxTicks` of them). Idempotent: a plan already covered by `state.tick` returns `state` as-is.
 */
export function applyPlan(
  state: SimState,
  plan: AdvancePlan,
  step: StepFn,
  maxTicks: number = Number.POSITIVE_INFINITY,
): SimState {
  const start = Math.max(state.tick, plan.fromTick);
  const end = Math.min(plan.toTick, start + maxTicks);
  if (end <= state.tick) return state;
  let s = state;
  // `step` is the only thing that moves `tick`; the loop is bounded by tick numbers, not counts,
  // so a step that fails to advance would be an error rather than an infinite loop.
  while (s.tick < end) {
    const next = step(s);
    if (next.tick !== s.tick + 1) {
      throw new Error(
        `step must advance tick by exactly 1 (got ${String(s.tick)} → ${String(next.tick)})`,
      );
    }
    s = next;
  }
  return s;
}
