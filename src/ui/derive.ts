/**
 * Pure view helpers: everything a screen shows is computed here from sim state and content,
 * with no React and no clock. The screens read these and draw them; the tests pin the numbers.
 */
import { actionHandler, skillOfRequest, type ActionRequest } from '../sim/actions.ts';
import { TICK_MS } from '../sim/constants.ts';
import type { ContentDb } from '../sim/content/db.ts';
import type { GatherNodeDef, ItemDef, RecipeDef } from '../sim/content/schema.ts';
import type { SimContext } from '../sim/context.ts';
import { eventsOfType, type SimEventOf } from '../sim/events.ts';
import type { ItemStack } from '../sim/items.ts';
import { skillXp } from '../sim/progress.ts';
import type { SimState } from '../sim/save.ts';
import { TOOL_SLOTS, type ToolSlot } from '../sim/slots.ts';
import { toolAdjustedTicks } from '../sim/skills/gathering.ts';

export const TICKS_PER_HOUR = 3_600_000 / TICK_MS;

// ---- skills -------------------------------------------------------------------------------

export interface SkillView {
  id: string;
  level: number;
  xp: number;
  /** XP at the start of the current level and at the next one (null at max). */
  floor: number;
  next: number | null;
  /** Progress through the current level, 0–1 (1 at max). */
  frac: number;
  /** "67,980 / 68,200" style pair: xp into the level and the level's size. */
  into: number;
  need: number | null;
}

export function skillView(sim: SimState, skill: string, ctx: SimContext): SkillView {
  const xp = skillXp(sim, skill);
  const level = ctx.xp.levelForXp(xp);
  const floor = ctx.xp.xpForLevel(level);
  const next = level < ctx.xp.maxLevel ? ctx.xp.xpForLevel(level + 1) : null;
  const need = next === null ? null : next - floor;
  const into = xp - floor;
  return {
    id: skill,
    level,
    xp,
    floor,
    next,
    frac: need === null ? 1 : Math.min(1, into / need),
    into,
    need,
  };
}

// ---- rates --------------------------------------------------------------------------------

/** Expected XP per hour for a cycle of `durationTicks` paying `xp` with success `chance`. */
export function xpPerHour(xp: number, durationTicks: number, chance = 1): number {
  return (xp * chance * TICKS_PER_HOUR) / durationTicks;
}

/** What the tool in `slot` does to action time, as a whole-percent cut (0 when no tool). */
export function toolCutPercent(sim: SimState, slot: ToolSlot, content: ContentDb): number {
  const id = sim.equipment[slot];
  if (id === null || !content.hasItem(id)) return 0;
  return content.item(id).stats.gather ?? 0;
}

// ---- nodes (veins / trees) ----------------------------------------------------------------

export interface NodeView {
  node: GatherNodeDef;
  locked: boolean;
  active: boolean;
  /** Ticks per cycle after the equipped tool. */
  ticks: number;
  chance: number;
  xpHr: number;
}

export function nodeViews(
  sim: SimState,
  nodes: readonly GatherNodeDef[],
  opts: { skill: string; toolSlot: ToolSlot; request(id: string): ActionRequest },
  ctx: SimContext,
): NodeView[] {
  const level = skillView(sim, opts.skill, ctx).level;
  const current = sim.action.current?.request;
  return nodes.map((node) => {
    const req = opts.request(node.id);
    const handler = actionHandler(req.kind);
    const locked = level < node.level;
    const ticks = toolAdjustedTicks(sim, opts.toolSlot, node.durationTicks, ctx);
    const chance = locked ? 0 : handler.successChance(sim, req, ctx);
    return {
      node,
      locked,
      active: current !== undefined && requestNode(current) === node.id,
      ticks,
      chance,
      xpHr: xpPerHour(node.xp, ticks, chance),
    };
  });
}

/** The node (rock / tree) a request targets, or null for crafting. */
export function requestNode(req: ActionRequest): string | null {
  switch (req.kind) {
    case 'mining':
      return req.rock;
    case 'woodcutting':
      return req.tree;
    case 'crafting':
      return null;
  }
}

export function requestRecipe(req: ActionRequest): string | null {
  return req.kind === 'crafting' ? req.recipe : null;
}

// ---- recipes ------------------------------------------------------------------------------

export interface RecipeView {
  recipe: RecipeDef;
  locked: boolean;
  active: boolean;
  /** Whether the bank currently holds every input. */
  canAfford: boolean;
  /** How many times the bank could run it right now. */
  times: number;
  xpHr: number;
}

export function recipeViews(sim: SimState, recipes: readonly RecipeDef[], ctx: SimContext) {
  const have = new Map<string, number>();
  for (const s of sim.bank) have.set(s.item, (have.get(s.item) ?? 0) + s.qty);
  const current = sim.action.current?.request;
  return recipes.map((recipe): RecipeView => {
    const level = skillView(sim, recipe.skill, ctx).level;
    const times = Math.min(
      ...recipe.inputs.map((i) => Math.floor((have.get(i.item) ?? 0) / i.qty)),
    );
    return {
      recipe,
      locked: level < recipe.level,
      active: current !== undefined && requestRecipe(current) === recipe.id,
      canAfford: times > 0,
      times: Number.isFinite(times) ? times : 0,
      xpHr: xpPerHour(recipe.xp, recipe.durationTicks),
    };
  });
}

// ---- the active action --------------------------------------------------------------------

export interface ActiveView {
  request: ActionRequest;
  skill: string;
  name: string;
  /** 0–1 through the current cycle. */
  frac: number;
  remainingMs: number;
  durationMs: number;
  xp: number;
  xpHr: number;
  /** Cycles left including this one; null = until stopped. */
  remaining: number | null;
}

export function activeView(sim: SimState, ctx: SimContext): ActiveView | null {
  const cur = sim.action.current;
  if (cur === null) return null;
  const req = cur.request;
  const skill = skillOfRequest(req, ctx);
  let name: string;
  let xp: number;
  switch (req.kind) {
    case 'mining':
      ({ name, xp } = ctx.content.rock(req.rock));
      break;
    case 'woodcutting':
      ({ name, xp } = ctx.content.tree(req.tree));
      break;
    case 'crafting':
      ({ name, xp } = ctx.content.recipe(req.recipe));
      break;
  }
  const chance = actionHandler(req.kind).successChance(sim, req, ctx);
  return {
    request: req,
    skill,
    name,
    frac: cur.elapsedTicks / cur.durationTicks,
    remainingMs: (cur.durationTicks - cur.elapsedTicks) * TICK_MS,
    durationMs: cur.durationTicks * TICK_MS,
    xp,
    xpHr: xpPerHour(xp, cur.durationTicks, chance),
    remaining: cur.remaining,
  };
}

// ---- the log, as the screens read it ------------------------------------------------------

export interface FeedRow {
  key: string;
  item: ItemDef;
  qty: number;
  /** Ticks since it landed, at the sim's current tick. */
  ageTicks: number;
  skill: string;
}

/** Newest first; one row per stack landed. `skill` limits the feed to one skill's drops. */
export function dropFeed(
  sim: SimState,
  content: ContentDb,
  opts: { skill?: string | undefined; limit?: number | undefined } = {},
): FeedRow[] {
  const rows: FeedRow[] = [];
  const gains = eventsOfType(sim, 'gain');
  for (let i = gains.length - 1; i >= 0; i--) {
    const g = gains[i]!;
    if (opts.skill !== undefined && g.skill !== opts.skill) continue;
    g.items.forEach((stack, j) => {
      rows.push({
        key: `${String(g.tick)}:${String(j)}`,
        item: content.item(stack.item),
        qty: stack.qty,
        ageTicks: sim.tick - g.tick,
        skill: g.skill,
      });
    });
    if (rows.length >= (opts.limit ?? 14)) break;
  }
  return rows.slice(0, opts.limit ?? 14);
}

/** The most recent level-up younger than `withinTicks`, for the overlay. */
export function recentLevelUp(sim: SimState, withinTicks: number): SimEventOf<'level'> | null {
  const levels = eventsOfType(sim, 'level');
  const last = levels[levels.length - 1];
  return last && sim.tick - last.tick < withinTicks ? last : null;
}

/** The newest drop of rarity rank ≥ `minRank` younger than `withinTicks`, for the toast. */
export function recentRareDrop(
  sim: SimState,
  content: ContentDb,
  opts: { minRank: number; withinTicks: number; skill?: string | undefined },
): FeedRow | null {
  for (const row of dropFeed(sim, content, { skill: opts.skill, limit: 40 })) {
    if (row.ageTicks >= opts.withinTicks) return null;
    if (content.rarity(row.item.rarity).rank >= opts.minRank) return row;
  }
  return null;
}

/** Gains younger than `withinTicks` for the floating "+68 xp" pops. */
export function recentGains(sim: SimState, withinTicks: number, skill?: string) {
  return eventsOfType(sim, 'gain').filter(
    (g) => sim.tick - g.tick < withinTicks && (skill === undefined || g.skill === skill),
  );
}

/** The last stop reason, if the action stopped less than `withinTicks` ago. */
export function recentStop(sim: SimState, withinTicks: number): SimEventOf<'stopped'> | null {
  const stops = eventsOfType(sim, 'stopped');
  const last = stops[stops.length - 1];
  return last && sim.tick - last.tick < withinTicks ? last : null;
}

// ---- offline recap ------------------------------------------------------------------------

export interface RecapSkill {
  skill: string;
  xp: number;
  from: number;
  to: number;
  actions: number;
}

export interface Recap {
  skills: RecapSkill[];
  /** Items that are in the bank now and were not (or were fewer) before. */
  items: ItemStack[];
  totalActions: number;
}

/** What changed between two states — the "you were away for 13h, you mined:" summary. */
export function recap(before: SimState, after: SimState, ctx: SimContext): Recap {
  const skills: RecapSkill[] = [];
  for (const id of new Set([...Object.keys(before.skills), ...Object.keys(after.skills)])) {
    const a = skillXp(before, id);
    const b = skillXp(after, id);
    const actions = (after.stats.actions[id] ?? 0) - (before.stats.actions[id] ?? 0);
    if (b > a || actions > 0) {
      skills.push({
        skill: id,
        xp: b - a,
        from: ctx.xp.levelForXp(a),
        to: ctx.xp.levelForXp(b),
        actions,
      });
    }
  }
  skills.sort((x, y) => y.xp - x.xp);
  const was = new Map(before.bank.map((s) => [s.item, s.qty]));
  const items: ItemStack[] = [];
  for (const s of after.bank) {
    const gained = s.qty - (was.get(s.item) ?? 0);
    if (gained > 0) items.push({ item: s.item, qty: gained });
  }
  items.sort((x, y) => y.qty - x.qty);
  return { skills, items, totalActions: skills.reduce((n, s) => n + s.actions, 0) };
}

// ---- tools --------------------------------------------------------------------------------

export function toolSlotForSkill(skill: string): ToolSlot | null {
  for (const [slot, s] of Object.entries(TOOL_SLOTS)) if (s === skill) return slot as ToolSlot;
  return null;
}
