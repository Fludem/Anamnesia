import { describe, expect, it } from 'vitest';
import { simContext as ctx } from './index.ts';
import { overreach } from '../sim/ceiling.ts';
import { applyCommand } from '../sim/commands.ts';
import { addXp } from '../sim/progress.ts';
import { GEAR_LADDER, SET_PIECES, monstersOpenAt } from '../sim/progression.ts';
import { createSimState, type SimState } from '../sim/save.ts';
import { stepTick } from '../sim/step.ts';

/**
 * The other half of the ceiling (sim/ceiling.ts): the register refusing a save is a real cost
 * to a real player, so an hour of honest play on the shipped content must never come near the
 * line. This runs the actual simulation — not the model the ceiling is drawn from — and asks
 * after every ten minutes of it, which is about how often a tab saves.
 *
 * It is deliberately the best a hero can do at each level: the deepest node open to them, the
 * god whose favour pays that skill, the tier's gear on their back. If any of it were ever
 * refused the ceiling would be wrong, and the number to change is HEADROOM.
 */

/** Ten minutes: a save's worth of playing. */
const BATCH_TICKS = 6_000;
const HOUR = 6;
/** A register that wrote ten minutes ago, for a name old enough that its age is not the question. */
const ELAPSED = { sinceWrite: 600_000, sinceName: 1e12 };
const LEVELS = [1, 50, 90];

const GOD_FOR: Record<string, string> = {
  mining: 'tharok',
  woodcutting: 'vessith',
  fishing: 'maren',
};
const NODE_KEY: Record<string, string> = {
  mining: 'rock',
  woodcutting: 'tree',
  fishing: 'water',
  foraging: 'patch',
};

/** Play `state` for an hour, ten minutes at a time, and hand back what each stretch claimed. */
function anHourOf(state: SimState): SimState[] {
  const stretches: SimState[] = [state];
  let s = state;
  for (let b = 0; b < HOUR; b++) {
    for (let i = 0; i < BATCH_TICKS; i++) s = stepTick(s, ctx);
    stretches.push(s);
  }
  return stretches;
}

function refusalsIn(stretches: readonly SimState[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < stretches.length; i++) {
    const past = overreach(stretches[i - 1]!, stretches[i]!, ELAPSED, ctx);
    if (past !== null) out.push(JSON.stringify(past));
  }
  return out;
}

describe('an hour of honest gathering is never refused', () => {
  for (const skill of ['mining', 'woodcutting', 'fishing', 'foraging']) {
    for (const level of LEVELS) {
      it(`${skill} at level ${String(level)}, on the deepest node open to it`, () => {
        let s = addXp(createSimState(7), skill, ctx.xp.xpForLevel(level));
        const god = GOD_FOR[skill];
        if (god !== undefined) s = applyCommand(s, { type: 'player:swear', god }, ctx).state;
        const open = ctx.content.nodesFor(skill).filter((n) => n.level <= level);
        const node = open[open.length - 1]!;
        const started = applyCommand(
          s,
          {
            type: 'action:start',
            request: { kind: skill, [NODE_KEY[skill]!]: node.id, count: null },
          } as never,
          ctx,
        );
        expect(started.ok).toBe(true);
        expect(refusalsIn(anHourOf(started.state))).toEqual([]);
      });
    }
  }
});

describe('an hour of honest fighting is never refused', () => {
  for (const level of LEVELS) {
    it(`combat at level ${String(level)}, in the tier's gear against the deepest monster`, () => {
      let tier = GEAR_LADDER[0]!.tier;
      for (const step of GEAR_LADDER) if (level >= step.level) tier = step.tier;
      let s = addXp(createSimState(7), 'combat', ctx.xp.xpForLevel(level));
      s = addXp(s, 'hitpoints', ctx.xp.xpForLevel(Math.max(10, level)));
      const equipment = { ...s.equipment };
      for (const piece of SET_PIECES) {
        const id = `${tier}-${piece}`;
        if (!ctx.content.hasItem(id)) continue;
        const slot = ctx.content.item(id).slot;
        if (slot !== null) equipment[slot] = id;
      }
      // Fed, and never short: what is being measured is the xp, not how long the food lasts.
      s = {
        ...s,
        equipment,
        bank: [{ item: 'pale-fish', qty: 100_000 }],
        combat: { ...s.combat, food: 'pale-fish' },
      };
      const open = monstersOpenAt(level, ctx);
      const monster = open[open.length - 1]!;
      const started = applyCommand(
        s,
        { type: 'action:start', request: { kind: 'combat', monster: monster.id, count: null } },
        ctx,
      );
      expect(started.ok).toBe(true);
      expect(refusalsIn(anHourOf(started.state))).toEqual([]);
    });
  }
});
