/**
 * The highscores' arithmetic: what one hero scores on every board. The boards themselves are
 * ranked on the server (server/highscores.ts) across every account's last save; this file is
 * what both ends agree a standing is. Pure: no React, no clock, no save changes.
 */
import { bankWorth } from './bank.ts';
import type { ContentDb } from './content/db.ts';
import type { SimContext } from './context.ts';
import { skillXp } from './progress.ts';
import type { SimState } from './save.ts';
import { EQUIPMENT_SLOTS } from './slots.ts';

export type BoardId = 'total' | 'wealth' | 'ring' | (string & {});

/** Every board, in the order the screen lists them: total, wealth, the ring, then each skill. */
export function boardIds(content: ContentDb): BoardId[] {
  return ['total', 'wealth', 'ring', ...content.skills.map((s) => s.id)];
}

/** Coins, the bank at sale value, and everything worn — tools and ammo included. */
export function heroWealth(sim: SimState, content: ContentDb): number {
  const value = (id: string) => (content.hasItem(id) ? content.item(id).value : 0);
  let worn = 0;
  for (const slot of EQUIPMENT_SLOTS) {
    const id = sim.equipment[slot];
    if (id !== null) worn += value(id);
  }
  return sim.coins + bankWorth(sim, value) + worn;
}

export interface Standing {
  board: BoardId;
  /** Level in the skill, or the total level; null on the wealth board. */
  level: number | null;
  /** XP in the skill, total xp, or gp on the wealth board. */
  score: number;
  /**
   * Sort keys, best first. Total level ranks by level then xp; the others by score alone.
   * Ties beyond these go to whoever was on the hill first.
   */
  keys: readonly [number, number];
}

/** One hero's standing on every board. */
export function standingsOf(sim: SimState, ctx: SimContext): Standing[] {
  const { content } = ctx;
  return boardIds(content).map((board): Standing => {
    if (board === 'wealth') {
      const gp = heroWealth(sim, content);
      return { board, level: null, score: gp, keys: [gp, 0] };
    }
    if (board === 'ring') {
      // Bouts won, then bouts fought: a name that fights often and wins is above one that
      // has won as many and been called out less. Nothing here is a level.
      const { taken, bouts } = sim.stats;
      return { board, level: null, score: taken, keys: [taken, bouts] };
    }
    if (board === 'total') {
      let level = 0;
      let xp = 0;
      for (const s of content.skills) {
        const v = skillXp(sim, s.id);
        level += ctx.xp.levelForXp(v);
        xp += v;
      }
      return { board, level, score: xp, keys: [level, xp] };
    }
    const xp = skillXp(sim, board);
    return { board, level: ctx.xp.levelForXp(xp), score: xp, keys: [xp, 0] };
  });
}
