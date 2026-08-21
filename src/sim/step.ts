import { nextU32 } from './rng.ts';
import type { SimState } from './save.ts';

/** Advances the simulation by exactly one tick. Pure. */
export type StepFn = (state: SimState) => SimState;

/**
 * Phase 0.5 placeholder: one PRNG draw per tick folded into a checksum, so determinism,
 * batching and idempotence are all observable. Phase 1 replaces the body, not the signature.
 */
export const stepTick: StepFn = (state) => {
  const [u, rng] = nextU32(state.rng);
  const checksum = (Math.imul(state.placeholder.checksum, 31) + u) >>> 0;
  return {
    tick: state.tick + 1,
    rng,
    placeholder: { draws: state.placeholder.draws + 1, checksum },
  };
};
