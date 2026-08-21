import type { SimContext } from './context.ts';
import type { SimState } from './save.ts';

/** XP in a skill; skills the save has never touched read as 0. */
export function skillXp(state: SimState, skill: string): number {
  return state.skills[skill]?.xp ?? 0;
}

export function skillLevel(state: SimState, skill: string, ctx: SimContext): number {
  return ctx.xp.levelForXp(skillXp(state, skill));
}

export function addXp(state: SimState, skill: string, amount: number): SimState {
  if (!(amount >= 0)) throw new RangeError(`addXp: amount ${String(amount)}`);
  if (amount === 0) return state;
  return {
    ...state,
    skills: { ...state.skills, [skill]: { xp: skillXp(state, skill) + amount } },
  };
}
