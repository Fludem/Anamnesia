import { pushEvent } from './events.ts';
import type { SimState } from './save.ts';

/**
 * First steps: a short, linear walk through every skill and the bank, checked by the sim
 * once per tick while it is unfinished. Each step reads lifetime counters (never the bank,
 * which can be sold down) so a step, once met, stays met; completing one pays a few coins
 * and logs a `tutorial` event for the card to react to. Rewards add up to more than the first
 * bank slot's price, which is the point of them.
 */
export interface TutorialStep {
  id: string;
  /** "Mine 10 Copper Ore" */
  title: string;
  /** One dry line of help. */
  hint: string;
  /** The screen the step happens on: a skill id or 'bank'. */
  where: string;
  reward: number;
  /** `[done, of]` for the card's counter; `done` is clamped to `of`. */
  progress: (state: SimState) => readonly [number, number];
}

const items = (state: SimState, id: string) => state.stats.items[id] ?? 0;
const count = (id: string, of: number) => (state: SimState) =>
  [Math.min(of, items(state, id)), of] as const;

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'mine-copper',
    title: 'Mine 10 Copper Ore',
    hint: 'Pick the Copper Vein. It is the one that lets you.',
    where: 'mining',
    reward: 50,
    progress: count('copper-ore', 10),
  },
  {
    id: 'smelt-copper',
    title: 'Smelt 5 Copper Bars',
    hint: 'Smithing, under Bars. One ore each.',
    where: 'smithing',
    reward: 50,
    progress: count('copper-bar', 5),
  },
  {
    id: 'smith-pick',
    title: 'Smith a Copper Pick',
    hint: 'Smithing, under Tools. Two bars.',
    where: 'smithing',
    reward: 100,
    progress: count('copper-pick', 1),
  },
  {
    id: 'equip-pick',
    title: 'Equip the pick',
    hint: 'Bank → the pick → Equip. It takes 5% off every swing.',
    where: 'bank',
    reward: 50,
    progress: (s) => [s.equipment.pickaxe === null ? 0 : 1, 1] as const,
  },
  {
    id: 'cut-pine',
    title: 'Cut 10 Pine Logs',
    hint: 'Woodcutting. The Pine Stand grows it out of spite.',
    where: 'woodcutting',
    reward: 50,
    progress: count('pine-logs', 10),
  },
  {
    id: 'burn-pine',
    title: 'Burn 5 Pine Logs',
    hint: 'Firemaking. The logs become ash, and you become slightly better at it.',
    where: 'firemaking',
    reward: 50,
    progress: count('ash', 5),
  },
  {
    id: 'catch-minnows',
    title: 'Catch 5 Minnows',
    hint: 'Fishing, at the Rain Pool. A rod helps; Smithing makes one from a bar and a log.',
    where: 'fishing',
    reward: 50,
    progress: count('raw-minnow', 5),
  },
  {
    id: 'cook-minnows',
    title: 'Cook 3 Minnows',
    hint: 'Cooking. Some will burn. That is also cooking.',
    where: 'cooking',
    reward: 50,
    progress: count('minnow', 3),
  },
  {
    id: 'fight-goats',
    title: 'Kill 3 Hill Goats',
    hint: 'Combat. Choose the minnows as food first; the goat has not chosen anything.',
    where: 'combat',
    reward: 100,
    progress: (s) => [Math.min(3, s.stats.kills['hill-goat'] ?? 0), 3] as const,
  },
  {
    id: 'forage-thyme',
    title: 'Gather 5 Thyme Sprigs',
    hint: 'Foraging, at the Wild Thyme. No tool for this one; the hill provides, grudgingly.',
    where: 'foraging',
    reward: 50,
    progress: count('thyme-sprig', 5),
  },
  {
    id: 'offer-thyme',
    title: 'Burn an offering',
    hint: 'Combat → the offering row → Thyme Sprig → Offer. Favour burns while you fight; so does the boon.',
    where: 'combat',
    reward: 50,
    progress: (s) => [Math.min(1, s.stats.offered), 1] as const,
  },
  {
    id: 'sell-something',
    title: 'Sell something',
    hint: 'Bank → anything → Sell. The hill pays badly but it pays.',
    where: 'bank',
    reward: 100,
    progress: (s) => [Math.min(1, s.stats.sold), 1] as const,
  },
  {
    id: 'buy-slot',
    title: 'Buy a bank slot',
    hint: 'Bank → the + cell. The rewards so far cover it, with change.',
    where: 'bank',
    reward: 0,
    progress: (s) => [Math.min(1, s.bankSlotsBought), 1] as const,
  },
];

export function tutorialStep(id: string): TutorialStep | undefined {
  return TUTORIAL_STEPS.find((s) => s.id === id);
}

/** The next unfinished step, or null when every step is done. */
export function currentTutorialStep(state: SimState): TutorialStep | null {
  return TUTORIAL_STEPS.find((s) => !state.tutorial.done.includes(s.id)) ?? null;
}

export function tutorialFinished(state: SimState): boolean {
  return currentTutorialStep(state) === null;
}

/**
 * Complete the current step if its condition holds. One step per tick, so a save that
 * already satisfies several steps walks through them visibly over a few ticks.
 */
export function tickTutorial(state: SimState): SimState {
  if (state.tutorial.dismissed) return state;
  const step = currentTutorialStep(state);
  if (step === null) return state;
  const [done, of] = step.progress(state);
  if (done < of) return state;
  const next: SimState = {
    ...state,
    coins: state.coins + step.reward,
    tutorial: { ...state.tutorial, done: [...state.tutorial.done, step.id] },
  };
  return pushEvent(next, { type: 'tutorial', tick: next.tick, step: step.id, reward: step.reward });
}
