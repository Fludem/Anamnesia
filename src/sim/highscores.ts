/**
 * The highscores: the hero ranked against the hill's other names, per skill, by total level
 * and by wealth. Nobody else is simulated — each rival is a curve through the progression
 * model, so "forty hours of the mining climb" is exactly where a full-time miner would be,
 * and the board moves with `sim.tick` (game time, offline catch-up included) and nothing
 * else. Pure: no React, no clock, no save changes.
 */
import { bankWorth } from './bank.ts';
import { COMBAT_SKILL, HITPOINTS_XP_SHARE } from './combat.ts';
import { TICK_MS } from './constants.ts';
import type { ContentDb } from './content/db.ts';
import type { RivalDef } from './content/schema.ts';
import type { SimContext } from './context.ts';
import { combatClimb, methodRate, standardMethods, toolLadderFor } from './progression.ts';
import { skillXp } from './progress.ts';
import type { SimState } from './save.ts';
import { EQUIPMENT_SLOTS } from './slots.ts';

export const HITPOINTS_SKILL = 'hitpoints';

// ---- the climb as a rate table -------------------------------------------------------------

/**
 * Expected xp per hour at each level on a skill's standard path (index = level; 0 unused).
 * Past the cap the top rate holds — the hill does not stop paying at 99, it just stops
 * counting levels.
 */
function rateTable(skill: string, ctx: SimContext): readonly number[] {
  const max = ctx.xp.maxLevel;
  const rates: number[] = [0];
  if (skill === COMBAT_SKILL) {
    const steps = combatClimb(ctx).steps;
    for (let level = 1; level <= max; level++) {
      rates.push(steps.find((s) => s.level === level)?.rate ?? rates[level - 1] ?? 0);
    }
    return rates;
  }
  const methods = standardMethods(skill, ctx);
  const ladder = toolLadderFor(skill);
  for (let level = 1; level <= max; level++) {
    let cut = 0;
    for (const step of ladder) if (level >= step.level) cut = step.cut;
    let best = 0;
    for (const m of methods) best = Math.max(best, methodRate(m, level, cut));
    rates.push(best);
  }
  return rates;
}

const tables = new WeakMap<SimContext, Map<string, readonly number[]>>();

function rates(skill: string, ctx: SimContext): readonly number[] {
  let bySkill = tables.get(ctx);
  if (bySkill === undefined) {
    bySkill = new Map<string, readonly number[]>();
    tables.set(ctx, bySkill);
  }
  let table = bySkill.get(skill);
  if (table === undefined) bySkill.set(skill, (table = rateTable(skill, ctx)));
  return table;
}

/** Total xp after `hours` on the standard climb, always taking the best method open. */
export function xpAfterHours(skill: string, hours: number, ctx: SimContext): number {
  if (!(hours > 0)) return 0;
  const table = rates(skill, ctx);
  const max = ctx.xp.maxLevel;
  let xp = 0;
  let left = hours;
  for (let level = 1; level < max; level++) {
    const rate = table[level] ?? 0;
    if (rate <= 0) return xp; // a gap in the content: the climb stops here
    const need = ctx.xp.xpForLevel(level + 1) - xp;
    const h = need / rate;
    if (h >= left) return xp + left * rate;
    xp += need;
    left -= h;
  }
  return xp + left * (table[max] ?? 0);
}

// ---- rivals -----------------------------------------------------------------------------

export function hoursElapsed(sim: SimState): number {
  return (sim.tick * TICK_MS) / 3_600_000;
}

/** A rival's xp in `skill` after `hours` of the hero's time. Hitpoints follows combat. */
export function rivalXp(rival: RivalDef, skill: string, hours: number, ctx: SimContext): number {
  if (skill === HITPOINTS_SKILL)
    return rivalXp(rival, COMBAT_SKILL, hours, ctx) * HITPOINTS_XP_SHARE;
  const s = rival.skills[skill];
  if (s === undefined) return 0;
  return xpAfterHours(skill, s.hours + s.pace * hours, ctx);
}

export function rivalWealth(rival: RivalDef, hours: number): number {
  return Math.floor(rival.wealth.start + rival.wealth.perHour * Math.max(0, hours));
}

// ---- the hero -----------------------------------------------------------------------------

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

// ---- boards -------------------------------------------------------------------------------

export type BoardId = 'total' | 'wealth' | (string & {});

export interface BoardRow {
  /** 1-based position. */
  rank: number;
  /** The rival's id, or null for the hero. */
  rival: string | null;
  name: string;
  god: string | null;
  line: string | null;
  /** Level in the skill, or the total level; null on the wealth board. */
  level: number | null;
  /** XP in the skill, total xp, or coins on the wealth board. */
  score: number;
}

interface Entry {
  rival: RivalDef | null;
  level: number | null;
  score: number;
  /** Sort keys, best first: the score and a tiebreaker. */
  keys: readonly [number, number];
}

/**
 * Everyone on the hill sorted for one board. Ties go to whoever was here first: rivals
 * before the hero, then roster order.
 */
function rank(entries: readonly Entry[], heroName: string): BoardRow[] {
  const indexed = entries.map((e, i) => ({ ...e, i }));
  indexed.sort(
    (a, b) =>
      b.keys[0] - a.keys[0] ||
      b.keys[1] - a.keys[1] ||
      Number(a.rival === null) - Number(b.rival === null) ||
      a.i - b.i,
  );
  return indexed.map((e, i) => ({
    rank: i + 1,
    rival: e.rival?.id ?? null,
    name: e.rival?.name ?? heroName,
    god: e.rival?.god ?? null,
    line: e.rival?.line ?? null,
    level: e.level,
    score: e.score,
  }));
}

/** The rows of one board, best first, with the hero's row carrying `rival: null`. */
export function board(sim: SimState, id: BoardId, ctx: SimContext): BoardRow[] {
  const { content } = ctx;
  const hours = hoursElapsed(sim);
  const everyone: (RivalDef | null)[] = [null, ...content.rivals];
  const xpOf = (rival: RivalDef | null, skill: string) =>
    rival === null ? skillXp(sim, skill) : rivalXp(rival, skill, hours, ctx);
  return rank(
    everyone.map((rival): Entry => {
      if (id === 'wealth') {
        const gp = rival === null ? heroWealth(sim, content) : rivalWealth(rival, hours);
        return { rival, level: null, score: gp, keys: [gp, 0] };
      }
      if (id === 'total') {
        let level = 0;
        let xp = 0;
        for (const s of content.skills) {
          const v = xpOf(rival, s.id);
          level += ctx.xp.levelForXp(v);
          xp += v;
        }
        return { rival, level, score: xp, keys: [level, xp] };
      }
      const xp = xpOf(rival, id);
      return { rival, level: ctx.xp.levelForXp(xp), score: xp, keys: [xp, 0] };
    }),
    sim.player.name,
  );
}

export interface Standing {
  board: BoardId;
  rank: number;
  /** How many names are on the board, the hero included. */
  of: number;
  level: number | null;
  score: number;
}

/** The hero's own row on every board: total, wealth, then each skill in content order. */
export function standings(sim: SimState, ctx: SimContext): Standing[] {
  const ids: BoardId[] = ['total', 'wealth', ...ctx.content.skills.map((s) => s.id)];
  return ids.map((id) => {
    const rows = board(sim, id, ctx);
    const me = rows.find((r) => r.rival === null);
    if (me === undefined) throw new Error('the hero is always on the board');
    return { board: id, rank: me.rank, of: rows.length, level: me.level, score: me.score };
  });
}
