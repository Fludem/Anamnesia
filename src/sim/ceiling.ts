import {
  COMBAT_SKILL,
  HITPOINTS_SKILL,
  SORCERY_SKILL,
  STYLE_SKILL,
  expectedKillTicks,
} from './combat.ts';
import { OFFLINE_CAP_MS, TICK_MS, TICKS_PER_HOUR } from './constants.ts';
import type { CombatStyle, MonsterDef } from './content/schema.ts';
import type { SimContext } from './context.ts';
import { heroWealth } from './highscores.ts';
import { skillLevel, skillXp } from './progress.ts';
import {
  coinsPerHour,
  methodOfNode,
  methodOfRecipe,
  methodRate,
  modelHero,
  monstersOpenAt,
  tableValue,
} from './progression.ts';
import type { SimState } from './save.ts';

/**
 * What an hour on the hill can possibly be worth.
 *
 * The simulation runs in the browser and the register stores what it is handed, so the save is
 * the one thing on the hill nobody has to earn: a request with a bigger number in it is a
 * bigger number. This file is the answer to that — not by re-running the game on the server,
 * which would mean the client sending its every command instead of its state, but by asking
 * the progression model the same question it already answers for tuning: at this level, what
 * is the most the best method open to this hero could have paid in the time that actually
 * passed? A save claiming more than that did not come from playing.
 *
 * It is content-derived on purpose. `progression.ts` is where the hill's rates already live —
 * the model that keeps every skill near its 36 hours to the cap — so a new node, monster or
 * recipe raises this ceiling on the day it lands, and nobody has to remember a magic number.
 *
 * The numbers below are loose by design. A false refusal costs a real player the minute since
 * their last save; letting a cheat through by a factor of four costs nothing, because nobody
 * hijacks a save request to gain four times a fair hour. The ceiling is here to catch a month
 * claimed in a minute.
 */

/** The best cut any tool ladder reaches: the ceiling always assumes the best tool in the slot. */
const BEST_TOOL_CUT = 30;

/**
 * How much better than the model one hour is allowed to be. The model counts expected values
 * with no god sworn, no xp on the gear and no hearth in the hall — together worth about four
 * parts in ten — and the slab pays a cycle again for a new best fish, which can double a
 * lucky spell of fishing. Six times the model is well clear of all of it.
 */
export const HEADROOM = 6;

/** The skills a fight pays: both styles, and the hitpoints that come with either. */
const FIGHT_SKILLS: ReadonlySet<string> = new Set([COMBAT_SKILL, SORCERY_SKILL, HITPOINTS_SKILL]);

const STYLES = Object.keys(STYLE_SKILL) as CombatStyle[];

/** Expected sale value of everything one kill of `m` leaves behind. */
function killValue(m: MonsterDef, ctx: SimContext): number {
  let value = m.always.reduce((v, a) => v + ctx.content.item(a.item).value * a.qty, 0);
  for (const t of m.drops) value += tableValue(t, ctx);
  return value;
}

/**
 * The best monster open at `level`, measured by `worth` per kill, in whichever style suits it.
 * Both styles are tried and the better taken: the ceiling never assumes the hero fights the
 * way the save says they do.
 */
function bestPerHour(
  level: number,
  ctx: SimContext,
  worth: (m: MonsterDef, ctx: SimContext) => number,
): number {
  let best = 0;
  for (const style of STYLES) {
    const hero = modelHero(level, ctx, { style, ammo: true });
    for (const m of monstersOpenAt(level, ctx)) {
      const ticks = expectedKillTicks(hero, m);
      if (ticks > 0) best = Math.max(best, (worth(m, ctx) * TICKS_PER_HOUR) / ticks);
    }
  }
  return best;
}

/** The most combat xp an hour of fighting can pay at `level`. */
export function bestFightXpPerHour(level: number, ctx: SimContext): number {
  return bestPerHour(level, ctx, (m) => m.xp);
}

/**
 * The most xp `skill` can be paid in an hour at `level`, over every method the hill offers —
 * quick nodes and showpiece recipes included, since a ceiling has no business preferring the
 * standard path the tuning model measures.
 */
export function bestXpPerHour(skill: string, level: number, ctx: SimContext): number {
  let best = FIGHT_SKILLS.has(skill) ? bestFightXpPerHour(level, ctx) : 0;
  for (const n of ctx.content.nodesFor(skill)) {
    best = Math.max(best, methodRate(methodOfNode(n), level, BEST_TOOL_CUT));
  }
  for (const r of ctx.content.recipesFor(skill)) {
    best = Math.max(best, methodRate(methodOfRecipe(r), level, BEST_TOOL_CUT));
  }
  return best;
}

/** The most one hero's worth can grow in an hour at `level`: the best trade, or the best kill. */
export function bestWealthPerHour(level: number, ctx: SimContext): number {
  let best = bestPerHour(level, ctx, killValue);
  for (const s of ctx.content.skills) best = Math.max(best, coinsPerHour(s.id, level, ctx));
  return best;
}

/** The dearest thing on the hill. One of them may land in any window, however short. */
function dearest(ctx: SimContext): number {
  return ctx.content.items.reduce((v, i) => Math.max(v, i.value), 0);
}

/**
 * The level a ceiling is measured at: the one the save has *reached*, since rates only rise
 * with level and the hero was never better than they ended up. A fight pays by the better of
 * the two styles, so hitpoints and either style are all measured on the same climb.
 */
function levelFor(skill: string, state: SimState, ctx: SimContext): number {
  if (!FIGHT_SKILLS.has(skill)) return skillLevel(state, skill, ctx);
  return Math.max(skillLevel(state, COMBAT_SKILL, ctx), skillLevel(state, SORCERY_SKILL, ctx));
}

/** A claim the time cannot account for. `what` is a skill id, `wealth`, or `time` itself. */
export interface Overreach {
  what: string;
  /** How much more the save says it has than the record before it; ms of hill for `time`. */
  gained: number;
  /** The most that could have come honestly, in the same units. */
  ceiling: number;
  /** The span it was measured over, in ms. */
  windowMs: number;
}

/** What the register knows of its own accord — nothing here is a number the hero can write. */
export interface Elapsed {
  /** Milliseconds since the register last wrote this name's save. */
  sinceWrite: number;
  /** Milliseconds since the name was made. */
  sinceName: number;
  /**
   * The tick the register first took on trust for this name, and measures growth from. The
   * first save an account makes cannot be weighed against anything — a browser adopting the
   * save it played before there were names arrives honestly with forty hours on it — so it is
   * believed once, written down, and never believed again.
   */
  tickBase: number;
}

/**
 * What `after` claims that time cannot account for, or null when all of it is possible.
 * `before` is the state the register itself last stored — never one the caller sent with this
 * request — and `elapsed` is the register's clock, not the save's.
 *
 * Two things are asked, because either alone can be walked around.
 *
 * The first is how long the hero has been on the hill at all. A tick is a tenth of a second
 * and nothing makes them but time passing, so the ticks a save has gathered since the register
 * first wrote its name down can never have outrun the age of that name — one offline cap's
 * grace for a browser whose clock jumps. Without this a save could keep claiming the cap it is
 * owed for being away, over and over, and four hours of the best hour there is is half a climb.
 *
 * The second is what those ticks were worth. The window is the ticks themselves, since the
 * gains are made in ticks and in nothing else: it is a tab's one save after a whole night of
 * catching up that needs the room, not the seconds the register waited for it. Capped, in
 * turn, by the register's own clock and the cap, so the count cannot buy its own allowance.
 *
 * Only growth is measured. Everything a save can honestly lose — gear given up in the ring,
 * goods put on the hall's cart, coins staked at the wheel — makes these numbers smaller, and
 * a smaller number is never a lie worth telling.
 */
export function overreach(
  before: SimState | null,
  after: SimState,
  elapsed: Elapsed,
  ctx: SimContext,
): Overreach | null {
  const lived = Math.max(0, after.tick - elapsed.tickBase) * TICK_MS;
  const couldLive = Math.max(0, elapsed.sinceName) + OFFLINE_CAP_MS;
  if (lived > couldLive) {
    return { what: 'time', gained: lived, ceiling: couldLive, windowMs: elapsed.sinceName };
  }
  const ticked = Math.max(0, after.tick - (before?.tick ?? 0)) * TICK_MS;
  const windowMs = Math.min(ticked, Math.max(0, elapsed.sinceWrite) + OFFLINE_CAP_MS);
  const hours = windowMs / 3_600_000;
  for (const skill of ctx.content.skills) {
    const gained = skillXp(after, skill.id) - (before ? skillXp(before, skill.id) : 0);
    if (gained <= 0) continue;
    const ceiling = bestXpPerHour(skill.id, levelFor(skill.id, after, ctx), ctx) * hours * HEADROOM;
    if (gained > ceiling) return { what: skill.id, gained, ceiling, windowMs };
  }
  const worth = heroWealth(after, ctx.content) - (before ? heroWealth(before, ctx.content) : 0);
  if (worth > 0) {
    const level = Math.max(...ctx.content.skills.map((s) => skillLevel(after, s.id, ctx)));
    // One dearest thing on top: a single rare landing, or an anvil turning a night's parts into
    // one piece of gear, is luck and timing rather than arithmetic, and an expectation per hour
    // has nothing to say about either.
    const ceiling = bestWealthPerHour(level, ctx) * hours * HEADROOM + dearest(ctx);
    if (worth > ceiling) return { what: 'wealth', gained: worth, ceiling, windowMs };
  }
  return null;
}
