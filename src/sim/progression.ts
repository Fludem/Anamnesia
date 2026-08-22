import type { GatherNodeDef, RecipeDef } from './content/schema.ts';
import { TICK_MS } from './constants.ts';
import type { SimContext } from './context.ts';
import { TOOL_SLOTS, type ToolSlot } from './slots.ts';

/**
 * The progression model: how long a skill takes to reach the cap if the player always trains
 * the best method open to them. It is the tuning target ("skills average about 36 hours of
 * idle time to 99") as code, so a content change that drifts from it fails a test instead of
 * being discovered a month later. No god bonus, no failure streaks — expected values only.
 */

const TICKS_PER_HOUR = 3_600_000 / TICK_MS;

/** A tool arriving at a level: "from level 10 the pick cuts 10%". */
export interface ToolStep {
  level: number;
  cut: number;
}

/**
 * The assumed tool ladder per gathering skill: the tier's tool arrives with the tier's node
 * (the ore for a pick is what that node drops; rods track the rod recipes). An assumption,
 * not a rule the sim enforces — the model is about the shape of the climb.
 */
export const TOOL_LADDERS: Readonly<Record<ToolSlot, readonly ToolStep[]>> = {
  pickaxe: [
    { level: 1, cut: 5 },
    { level: 10, cut: 10 },
    { level: 25, cut: 15 },
    { level: 55, cut: 20 },
    { level: 65, cut: 25 },
    { level: 80, cut: 30 },
  ],
  axe: [
    { level: 1, cut: 5 },
    { level: 12, cut: 10 },
    { level: 24, cut: 15 },
    { level: 52, cut: 20 },
    { level: 65, cut: 25 },
    { level: 78, cut: 30 },
  ],
  rod: [
    { level: 1, cut: 5 },
    { level: 10, cut: 10 },
    { level: 22, cut: 15 },
    { level: 55, cut: 20 },
    { level: 65, cut: 25 },
    { level: 80, cut: 30 },
  ],
};

/** A method as the model sees it: one row of a skill's list. */
export interface Method {
  id: string;
  level: number;
  durationTicks: number;
  xp: number;
  success: { base: number; perLevel: number };
  quick: boolean;
  /** Whether a tool in the skill's slot shortens it. */
  tooled: boolean;
}

export function methodOfNode(n: GatherNodeDef): Method {
  return {
    id: n.id,
    level: n.level,
    durationTicks: n.durationTicks,
    xp: n.xp,
    success: n.success,
    quick: n.quick,
    tooled: true,
  };
}

export function methodOfRecipe(r: RecipeDef): Method {
  return {
    id: r.id,
    level: r.level,
    durationTicks: r.durationTicks,
    xp: r.xp,
    success: r.success,
    quick: false,
    tooled: false,
  };
}

function toolCutAt(level: number, ladder: readonly ToolStep[]): number {
  let cut = 0;
  for (const step of ladder) if (level >= step.level) cut = step.cut;
  return cut;
}

/** Expected xp per hour of `m` at skill `level` with a `cut`% tool. 0 when locked. */
export function methodRate(m: Method, level: number, cut: number): number {
  if (level < m.level) return 0;
  const chance = Math.min(1, m.success.base + m.success.perLevel * (level - m.level));
  const ticks = m.tooled
    ? Math.max(1, Math.round(m.durationTicks * (1 - cut / 100)))
    : m.durationTicks;
  return (m.xp * chance * TICKS_PER_HOUR) / ticks;
}

export interface Climb {
  hours: number;
  /** Hours at which each milestone level is reached, keyed by level. */
  milestones: Record<number, number>;
  /** Expected actions on each method along the way. */
  actions: Record<string, number>;
}

export const MILESTONES = [10, 30, 50, 70, 80, 90, 99] as const;

/**
 * Hours to reach `maxLevel` training the best of `methods` at every level. Infinite when no
 * method is open at some level (a gap in the content).
 */
export function climb(
  methods: readonly Method[],
  ctx: SimContext,
  ladder: readonly ToolStep[] = [],
): Climb {
  const max = ctx.xp.maxLevel;
  let hours = 0;
  const milestones: Record<number, number> = {};
  const actions: Record<string, number> = {};
  for (let level = 1; level < max; level++) {
    const need = ctx.xp.xpForLevel(level + 1) - ctx.xp.xpForLevel(level);
    const cut = toolCutAt(level, ladder);
    let best: Method | null = null;
    let bestRate = 0;
    for (const m of methods) {
      const r = methodRate(m, level, cut);
      if (r > bestRate) [best, bestRate] = [m, r];
    }
    if (best === null) return { hours: Infinity, milestones, actions };
    const h = need / bestRate;
    hours += h;
    const ticks = best.tooled
      ? Math.max(1, Math.round(best.durationTicks * (1 - cut / 100)))
      : best.durationTicks;
    actions[best.id] = (actions[best.id] ?? 0) + (h * TICKS_PER_HOUR) / ticks;
    if ((MILESTONES as readonly number[]).includes(level + 1)) milestones[level + 1] = hours;
  }
  return { hours, milestones, actions };
}

/** The category a crafting skill is measured on: its staple, not its showpieces. */
export const STAPLE_CATEGORY: Readonly<Record<string, string>> = {
  smithing: 'bars',
  firemaking: 'fires',
  cooking: 'fish',
};

/** The methods a skill is measured on. `quick` nodes are left out unless asked for. */
export function standardMethods(
  skill: string,
  ctx: SimContext,
  opts: { quick?: boolean } = {},
): Method[] {
  const nodes = ctx.content.nodesFor(skill);
  if (nodes.length > 0) {
    return nodes.filter((n) => opts.quick === true || !n.quick).map(methodOfNode);
  }
  const staple = STAPLE_CATEGORY[skill];
  return ctx.content
    .recipesFor(skill)
    .filter((r) => staple === undefined || r.category === staple)
    .map(methodOfRecipe);
}

export function toolLadderFor(skill: string): readonly ToolStep[] {
  for (const [slot, s] of Object.entries(TOOL_SLOTS)) {
    if (s === skill) return TOOL_LADDERS[slot as ToolSlot];
  }
  return [];
}

/** Hours to the cap on the standard path (and, with `quick`, taking the quick methods too). */
export function hoursToCap(skill: string, ctx: SimContext, opts: { quick?: boolean } = {}) {
  return climb(standardMethods(skill, ctx, opts), ctx, toolLadderFor(skill));
}
