import { describe, expect, it } from 'vitest';
import { applyCommand } from './commands.ts';
import { eventsOfType } from './events.ts';
import { createSimState, type SimState } from './save.ts';
import { stepTick } from './step.ts';
import { fixtureContext as ctx } from './testing/fixture.ts';
import { currentTutorialStep, TUTORIAL_STEPS, tutorialFinished } from './tutorial.ts';

const run = (s: SimState, ticks: number): SimState => {
  for (let i = 0; i < ticks; i++) s = stepTick(s, ctx);
  return s;
};

describe('first steps', () => {
  it('starts on the first step and reads lifetime counters, not the bank', () => {
    const s0 = createSimState(1);
    expect(currentTutorialStep(s0)?.id).toBe('mine-copper');
    expect(currentTutorialStep(s0)?.progress(s0)).toEqual([0, 10]);
    const gathered: SimState = {
      ...s0,
      stats: { ...s0.stats, items: { 'copper-ore': 12 } },
    };
    expect(currentTutorialStep(gathered)?.progress(gathered)).toEqual([10, 10]);
    const s1 = run(gathered, 1);
    expect(s1.tutorial.done).toEqual(['mine-copper']);
    expect(s1.coins).toBe(50);
    expect(eventsOfType(s1, 'tutorial')).toEqual([
      { type: 'tutorial', tick: 1, step: 'mine-copper', reward: 50 },
    ]);
    expect(currentTutorialStep(s1)?.id).toBe('smelt-copper');
  });

  it('completes one step per tick, so a save that already did several walks through them', () => {
    const s0 = createSimState(1);
    const done: SimState = {
      ...s0,
      stats: { ...s0.stats, items: { 'copper-ore': 10, 'copper-bar': 5, 'copper-pick': 1 } },
    };
    expect(run(done, 1).tutorial.done).toHaveLength(1);
    expect(run(done, 2).tutorial.done).toHaveLength(2);
    const s3 = run(done, 3);
    expect(s3.tutorial.done).toEqual(['mine-copper', 'smelt-copper', 'smith-pick']);
    expect(s3.coins).toBe(200);
    // The pick is not equipped, so it stops here.
    expect(run(done, 10).tutorial.done).toHaveLength(3);
  });

  it('the rewards add up to the first bank slot, and the whole walk ends', () => {
    const total = TUTORIAL_STEPS.reduce((n, s) => n + s.reward, 0);
    // 750: the first slot costs 500 and the hill refunds nothing, so some is left over.
    expect(total).toBe(750);
    const s0 = createSimState(1);
    const everything: SimState = {
      ...s0,
      equipment: { ...s0.equipment, pickaxe: 'pick' },
      bankSlotsBought: 1,
      stats: {
        actions: {},
        kills: { 'hill-goat': 3 },
        deaths: 0,
        offered: 1,
        thrown: 0,
        cast: 0,
        spent: 0,
        ferried: 0,
        given: 0,
        boughtIn: 0,
        cashedOut: 0,
        ambushes: 0,
        routed: 0,
        bouts: 0,
        taken: 0,
        lost: 0,
        sold: 3,
        items: {
          'copper-ore': 10,
          'copper-bar': 5,
          'copper-pick': 1,
          'pine-logs': 10,
          ash: 5,
          'raw-minnow': 5,
          minnow: 3,
          'thyme-sprig': 5,
        },
      },
    };
    const s = run(everything, TUTORIAL_STEPS.length + 2);
    expect(tutorialFinished(s)).toBe(true);
    expect(s.tutorial.done).toEqual(TUTORIAL_STEPS.map((t) => t.id));
    expect(s.coins).toBe(750);
    expect(eventsOfType(s, 'tutorial')).toHaveLength(TUTORIAL_STEPS.length);
  });

  it('dismissing stops the checks; the ids are unique and every step names a screen', () => {
    const s0 = createSimState(1);
    const r = applyCommand(s0, { type: 'tutorial:dismiss' }, ctx);
    expect(r.ok).toBe(true);
    const gathered: SimState = {
      ...r.state,
      stats: { ...s0.stats, items: { 'copper-ore': 10 } },
    };
    expect(run(gathered, 3).tutorial.done).toEqual([]);
    expect(new Set(TUTORIAL_STEPS.map((t) => t.id)).size).toBe(TUTORIAL_STEPS.length);
    for (const t of TUTORIAL_STEPS) expect(t.where.length).toBeGreaterThan(0);
  });
});
