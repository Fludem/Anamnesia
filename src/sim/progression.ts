import {
  COMBAT_SKILL,
  HITPOINTS_XP_SHARE,
  expectedDamageTakenPerTick,
  expectedKillTicks,
  gearStats,
  heroStatsFrom,
  hitChance,
  maxHit,
  type HeroStats,
} from './combat.ts';
import type {
  CombatBoon,
  CombatStyle,
  DropTable,
  GatherNodeDef,
  MonsterDef,
  RecipeDef,
  RoomTier,
} from './content/schema.ts';
import { TICK_MS, TICKS_PER_HOUR } from './constants.ts';
import type { SimContext } from './context.ts';
import { TOOL_SLOTS, type ToolSlot } from './slots.ts';

/**
 * The progression model: how long a skill takes to reach the cap if the player always trains
 * the best method open to them. It is the tuning target ("skills average about 36 hours of
 * idle time to 99") as code, so a content change that drifts from it fails a test instead of
 * being discovered a month later. No god bonus, no failure streaks — expected values only.
 */

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
  sorcery: 'marks',
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

// ---- coins --------------------------------------------------------------------------------

/** Expected sale value of one roll of `table`. */
export function tableValue(table: DropTable, ctx: SimContext): number {
  const total = table.nothingWeight + table.entries.reduce((n, e) => n + e.weight, 0);
  if (total === 0) return 0;
  let value = 0;
  for (const e of table.entries) {
    const qty = (e.quantity[0] + e.quantity[1]) / 2;
    value += (e.weight / total) * qty * ctx.content.item(e.item).value;
  }
  return table.rolls * value;
}

/** Expected sale value of what one successful cycle of a node lands. */
export function nodeValue(n: GatherNodeDef, ctx: SimContext): number {
  return n.drops.reduce((v, t) => v + tableValue(t, ctx), 0);
}

/** Value a recipe adds per successful cycle: outputs less inputs, both at sale value. */
export function recipeValue(r: RecipeDef, ctx: SimContext): number {
  const value = (stacks: readonly { item: string; qty: number }[]) =>
    stacks.reduce((v, s) => v + ctx.content.item(s.item).value * s.qty, 0);
  return value(r.outputs) - value(r.inputs);
}

/**
 * Coins per hour at `level`, selling everything the best open standard method of `skill`
 * lands (gathering) or adds (crafting, on the staple), with the tier's tool. The trader's
 * prices are set against this; `scripts/tune-trader.ts` prints it.
 */
export function coinsPerHour(skill: string, level: number, ctx: SimContext): number {
  const cut = toolCutAt(level, toolLadderFor(skill));
  const nodes = ctx.content.nodesFor(skill);
  let best = 0;
  if (nodes.length > 0) {
    for (const n of nodes) {
      if (n.quick) continue;
      const m = methodOfNode(n);
      const perHour = methodRate(m, level, cut) / m.xp;
      best = Math.max(best, perHour * nodeValue(n, ctx));
    }
  } else {
    const staple = STAPLE_CATEGORY[skill];
    for (const r of ctx.content.recipesFor(skill)) {
      if (staple !== undefined && r.category !== staple) continue;
      const m = methodOfRecipe(r);
      if (m.xp === 0) continue;
      const perHour = methodRate(m, level, 0) / m.xp;
      best = Math.max(best, perHour * recipeValue(r, ctx));
    }
  }
  return best;
}

// ---- the hall -----------------------------------------------------------------------------

/** The level a room's tier is costed at: its materials open by then. */
export const ROOM_TIER_LEVELS: readonly number[] = [20, 55, 80];

/**
 * Hours one name at `level` in every skill takes to come by `qty` of `item`: gathered from the
 * best open standard node that drops it (expected units per cycle counted), taken from the
 * monster in an open zone that drops it fastest (kills per hour in ladder gear, expected units
 * per kill), or made on the best open recipe that outputs it, its inputs gathered or made the
 * same way. Infinity when there is no way at that level. The hall's rooms are costed against
 * this; `scripts/tune-hall.ts` prints it.
 */
export function hoursToMake(item: string, qty: number, level: number, ctx: SimContext): number {
  return hoursFor(item, qty, level, ctx, new Set());
}

/** Expected units of `item` one kill of `m` lands: its tables and what it always carries. */
function unitsPerKill(m: MonsterDef, item: string): number {
  let units = 0;
  for (const t of m.drops) {
    const total = t.nothingWeight + t.entries.reduce((w, e) => w + e.weight, 0);
    for (const e of t.entries) {
      if (e.item !== item || total === 0) continue;
      units += t.rolls * (e.weight / total) * ((e.quantity[0] + e.quantity[1]) / 2);
    }
  }
  for (const a of m.always) if (a.item === item) units += a.qty;
  return units;
}

function hoursFor(
  item: string,
  qty: number,
  level: number,
  ctx: SimContext,
  making: Set<string>,
): number {
  if (qty <= 0) return 0;
  let best = Infinity;
  for (const skill of ctx.content.skills) {
    const cut = toolCutAt(level, toolLadderFor(skill.id));
    for (const n of ctx.content.nodesFor(skill.id)) {
      if (n.quick) continue;
      const m = methodOfNode(n);
      const perHour = methodRate(m, level, cut) / m.xp;
      if (perHour === 0) continue;
      let unitsPerCycle = 0;
      for (const t of n.drops) {
        const total = t.nothingWeight + t.entries.reduce((w, e) => w + e.weight, 0);
        for (const e of t.entries) {
          if (e.item !== item || total === 0) continue;
          unitsPerCycle += t.rolls * (e.weight / total) * ((e.quantity[0] + e.quantity[1]) / 2);
        }
      }
      if (unitsPerCycle > 0) best = Math.min(best, qty / (perHour * unitsPerCycle));
    }
  }
  // A monster is priced by the fight it is for: the hero of the style it is weak to.
  const heroes: Partial<Record<CombatStyle, HeroStats>> = {};
  for (const m of monstersOpenAt(level, ctx)) {
    const units = unitsPerKill(m, item);
    if (units === 0) continue;
    const hero = (heroes[m.weak] ??= modelHero(level, ctx, { style: m.weak }));
    const killsPerHour = TICKS_PER_HOUR / expectedKillTicks(hero, m);
    if (killsPerHour > 0) best = Math.min(best, qty / (killsPerHour * units));
  }
  if (making.has(item)) return best;
  for (const r of ctx.content.recipes) {
    const out = r.outputs.find((o) => o.item === item);
    if (!out || r.xp === 0) continue;
    const m = methodOfRecipe(r);
    const perHour = methodRate(m, level, 0) / m.xp;
    if (perHour === 0) continue;
    const cycles = qty / out.qty;
    let hours = cycles / perHour;
    const deeper = new Set(making).add(item);
    for (const i of r.inputs) hours += hoursFor(i.item, i.qty * cycles, level, ctx, deeper);
    best = Math.min(best, hours);
  }
  return best;
}

/** Hours one name at `level` takes to raise one tier of a room alone: every need, plus the coins. */
export function hoursForTier(tier: RoomTier, level: number, ctx: SimContext): number {
  let hours = 0;
  for (const c of tier.cost) hours += hoursToMake(c.item, c.qty, level, ctx);
  if (tier.coins > 0) {
    let gp = 0;
    for (const skill of ctx.content.skills) gp = Math.max(gp, coinsPerHour(skill.id, level, ctx));
    hours += gp > 0 ? tier.coins / gp : Infinity;
  }
  return hours;
}

// ---- combat -------------------------------------------------------------------------------

/** A gear set arriving at a combat level: "from level 25 the hero wears basalt". */
export interface GearStep {
  level: number;
  /** Material tier; the set is `<tier>-sword`, `-shield`, `-helm`, `-cuirass`, `-greaves`, `-boots`, `-gauntlets`. */
  tier: string;
}

/**
 * The assumed gear ladder: each tier's set arrives around when its bars can be smithed and
 * its zone opens. Like the tool ladders, an assumption about the shape of the climb.
 */
export const GEAR_LADDER: readonly GearStep[] = [
  { level: 1, tier: 'copper' },
  { level: 10, tier: 'iron' },
  { level: 25, tier: 'basalt' },
  { level: 45, tier: 'silver' },
  { level: 60, tier: 'gold' },
  { level: 75, tier: 'aether' },
];

export const SET_PIECES = ['sword', 'shield', 'helm', 'cuirass', 'greaves', 'boots', 'gauntlets'];

/** The staff each tier's caster carries: the wood that arrives with the metal. */
export const STAFF_BY_TIER: Readonly<Record<string, string>> = {
  copper: 'pine-staff',
  iron: 'oak-staff',
  basalt: 'birch-staff',
  silver: 'willow-staff',
  gold: 'blightwood-staff',
  aether: 'elder-staff',
};

/**
 * What the combat model assumes beyond the level: the gear ladder, a boon always burning,
 * whether the tier's javelin is in the ammo slot with the bank never running dry, and the
 * style — a sorcerer carries the tier's staff and always has marks, since a cast wants one.
 */
export interface CombatModelOptions {
  ladder?: readonly GearStep[];
  boon?: CombatBoon | null;
  ammo?: boolean;
  style?: CombatStyle;
}

/**
 * The hero as the model assumes them at `level`: ladder gear, hitpoints from the xp share,
 * and the boon if one is given (favour never runs out in the model).
 */
export function modelHero(
  level: number,
  ctx: SimContext,
  opts: CombatModelOptions = {},
): HeroStats {
  const ladder = opts.ladder ?? GEAR_LADDER;
  const style = opts.style ?? 'melee';
  let tier = ladder[0]?.tier ?? '';
  for (const step of ladder) if (level >= step.level) tier = step.tier;
  const ids =
    style === 'sorcery'
      ? [
          STAFF_BY_TIER[tier] ?? '',
          `${tier}-mark`,
          ...SET_PIECES.filter((p) => p !== 'sword').map((p) => `${tier}-${p}`),
        ]
      : (opts.ammo ? [...SET_PIECES, 'javelin'] : SET_PIECES).map((p) => `${tier}-${p}`);
  const worn = ids.filter((id) => ctx.content.hasItem(id)).map((id) => ctx.content.item(id));
  const hpLevel = ctx.xp.levelForXp(ctx.xp.xpForLevel(level) * HITPOINTS_XP_SHARE);
  return heroStatsFrom(level, hpLevel, gearStats(worn, style), opts.boon ?? null, style);
}

export interface CombatStep {
  level: number;
  monster: string;
  /** Whether the chosen monster is weak to the hero's style. */
  weak: boolean;
  /** Combat xp per hour on the best monster. */
  rate: number;
  /** Expected seconds per kill. */
  killSeconds: number;
  /** Hitpoints the hero loses per hour, to be eaten back (net of a regen boon). */
  damagePerHour: number;
  /** The monster's biggest hit against the hero's max hitpoints. */
  maxHitFraction: number;
  /** Swings that land per hour: what the ammo slot throws, if it holds anything. */
  hitsPerHour: number;
}

export interface CombatClimb extends Climb {
  steps: CombatStep[];
}

/** Monsters the hero may face at `level`: every one in an open zone. */
export function monstersOpenAt(level: number, ctx: SimContext): MonsterDef[] {
  return ctx.content.monsters.filter((m) => ctx.content.zone(m.zone).level <= level);
}

/** Hitpoints a regen boon gives back per hour; 0 for any other boon. */
export function regenPerHour(boon: CombatBoon | null | undefined): number {
  return boon?.kind === 'regen' ? TICKS_PER_HOUR / boon.everyTicks : 0;
}

/**
 * Hours to the combat cap fighting the best monster open at every level, in ladder gear. The
 * steps carry what the choice costs: damage per hour (food) and how hard the monster hits.
 * With a boon, the same climb as the god's favour would make it.
 */
export function combatClimb(ctx: SimContext, opts: CombatModelOptions = {}): CombatClimb {
  const max = ctx.xp.maxLevel;
  let hours = 0;
  const milestones: Record<number, number> = {};
  const actions: Record<string, number> = {};
  const steps: CombatStep[] = [];
  const regen = regenPerHour(opts.boon);
  for (let level = 1; level < max; level++) {
    const hero = modelHero(level, ctx, opts);
    const need = ctx.xp.xpForLevel(level + 1) - ctx.xp.xpForLevel(level);
    let best: MonsterDef | null = null;
    let bestRate = 0;
    let bestTicks = 0;
    for (const m of monstersOpenAt(level, ctx)) {
      const ticks = expectedKillTicks(hero, m);
      const rate = (m.xp * TICKS_PER_HOUR) / ticks;
      if (rate > bestRate) [best, bestRate, bestTicks] = [m, rate, ticks];
    }
    if (best === null) return { hours: Infinity, milestones, actions, steps };
    const h = need / bestRate;
    hours += h;
    actions[best.id] = (actions[best.id] ?? 0) + (h * TICKS_PER_HOUR) / bestTicks;
    steps.push({
      level,
      monster: best.id,
      weak: best.weak === hero.style,
      rate: bestRate,
      killSeconds: (bestTicks * TICK_MS) / 1000,
      damagePerHour: Math.max(0, expectedDamageTakenPerTick(hero, best) * TICKS_PER_HOUR - regen),
      maxHitFraction: maxHit(best.stats.strength) / hero.maxHp,
      hitsPerHour: (TICKS_PER_HOUR / hero.swingTicks) * hitChance(hero.attack, best.stats.defence),
    });
    if ((MILESTONES as readonly number[]).includes(level + 1)) milestones[level + 1] = hours;
  }
  return { hours, milestones, actions, steps };
}

export { COMBAT_SKILL };
