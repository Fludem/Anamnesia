import { tickAction } from './actions.ts';
import { REGEN_EVERY_TICKS } from './combat.ts';
import type { SimContext } from './context.ts';
import type { SimState } from './save.ts';
import { regenTick } from './skills/combat.ts';
import { tickTutorial } from './tutorial.ts';

/** Advances the simulation by exactly one tick. Pure. */
export type StepFn = (state: SimState) => SimState;

/**
 * One tick: bump the counter, advance the active action, regenerate hitpoints when idle, then
 * let first steps notice what changed. Everything else that happens in the game happens
 * inside an action, so this stays small as skills are added.
 */
export function stepTick(state: SimState, ctx: SimContext): SimState {
  const ticked = tickAction({ ...state, tick: state.tick + 1 }, ctx);
  return tickTutorial(regenTick(ticked, ctx, REGEN_EVERY_TICKS));
}

/** Bind a context so the runtime and the advance planner see a plain `(state) => state`. */
export function makeStep(ctx: SimContext): StepFn {
  return (state) => stepTick(state, ctx);
}
