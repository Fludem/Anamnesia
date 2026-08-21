import type { ActionHandler } from '../actions.ts';
import { rollDropTable } from '../drops.ts';
import { addStacks } from '../items.ts';
import { addXp, skillLevel } from '../progress.ts';

export const MINING = 'mining';

/**
 * Mining: the reference gathering skill. Select a rock, wait out its duration, roll success,
 * then roll every drop table into the bank and award XP. Every later gathering skill is this
 * handler with different content.
 */
export const miningHandler: ActionHandler<'mining'> = {
  canStart(state, req, ctx) {
    if (!ctx.content.hasRock(req.rock)) return { ok: false, reason: `unknown rock "${req.rock}"` };
    const rock = ctx.content.rock(req.rock);
    const level = skillLevel(state, MINING, ctx);
    if (level < rock.level) {
      return { ok: false, reason: `requires Mining level ${String(rock.level)} (you are ${String(level)})` };
    }
    return { ok: true };
  },

  durationTicks(_state, req, ctx) {
    return ctx.content.rock(req.rock).durationTicks;
  },

  successChance(state, req, ctx) {
    const rock = ctx.content.rock(req.rock);
    const level = skillLevel(state, MINING, ctx);
    const chance = rock.success.base + rock.success.perLevel * (level - rock.level);
    return Math.max(0, Math.min(1, chance));
  },

  resolve(state, req, success, ctx) {
    if (!success) return state;
    const rock = ctx.content.rock(req.rock);
    let rng = state.rng;
    let bank = state.bank;
    for (const table of rock.drops) {
      let stacks;
      [stacks, rng] = rollDropTable(table, rng);
      bank = addStacks(bank, stacks);
    }
    return addXp({ ...state, rng, bank }, MINING, rock.xp);
  },
};
