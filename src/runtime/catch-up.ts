import { applyPlan, wallMsAt, type AdvancePlan } from '../sim/advance.ts';
import type { SimState } from '../sim/save.ts';
import type { StepFn } from '../sim/step.ts';

export const DEFAULT_BATCH_TICKS = 2_000;

export interface BatchProgress {
  sim: SimState;
  /** Wall-clock anchor consistent with `sim.tick` — safe to persist together. */
  wallMs: number;
  done: number;
  total: number;
}

export interface RunAdvanceOptions {
  batchTicks?: number;
  yieldToEventLoop: () => Promise<void>;
  /** Called after every batch with state that is safe to commit/save. */
  onBatch?: (progress: BatchProgress) => void;
  signal?: AbortSignal;
}

export interface RunAdvanceResult {
  sim: SimState;
  wallMs: number;
  /** False if aborted via the signal before reaching `plan.toTick`. */
  completed: boolean;
  batches: number;
}

/**
 * Apply a plan in batches, yielding to the event loop between them. This is the ONE path for
 * advancing the sim: a 100 ms live tick is a single batch with no yield; a 12-hour catch-up is
 * 216 batches with a progress callback. Re-running a plan already covered by `state.tick` does
 * nothing (no batches, no callbacks) and returns the same state object.
 */
export async function runAdvance(
  state: SimState,
  plan: AdvancePlan,
  step: StepFn,
  options: RunAdvanceOptions,
): Promise<RunAdvanceResult> {
  const batchTicks = Math.max(1, options.batchTicks ?? DEFAULT_BATCH_TICKS);
  const start = Math.max(state.tick, plan.fromTick);
  const total = Math.max(0, plan.toTick - start);
  let sim = state;
  let batches = 0;

  while (sim.tick < plan.toTick) {
    if (options.signal?.aborted) {
      return { sim, wallMs: wallMsAt(plan, sim.tick), completed: false, batches };
    }
    sim = applyPlan(sim, plan, step, batchTicks);
    batches++;
    options.onBatch?.({ sim, wallMs: wallMsAt(plan, sim.tick), done: sim.tick - start, total });
    if (sim.tick < plan.toTick) await options.yieldToEventLoop();
  }
  return { sim, wallMs: wallMsAt(plan, sim.tick), completed: true, batches };
}
