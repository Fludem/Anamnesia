/**
 * The live half of the "?" on a skill screen: what is lifting this skill right now, the best
 * xp an hour the hero can actually run, and the next thing a level opens. The prose half is
 * `screens/help.ts`; nothing here is written down twice — every number is read from the same
 * place the sim reads it, so the panel cannot drift from the game.
 */
import { expectedKillTicks, heroStats } from '../sim/combat.ts';
import type { ContentDb } from '../sim/content/db.ts';
import type { SkillDef } from '../sim/content/schema.ts';
import type { SimContext } from '../sim/context.ts';
import { gearXpBoost, wornBodyItems } from '../sim/equipment.ts';
import { hallXpBonus, inHall } from '../sim/hall.ts';
import { doubleYieldChance, godOf, xpMultiplier } from '../sim/perks.ts';
import type { SimState } from '../sim/save.ts';
import { findsRolls } from '../sim/trader.ts';
import { meetsWear, wearAsk } from '../sim/wear.ts';
import { boonText, zoneRows } from './derive-combat.ts';
import { entryChance, formatChance } from './derive-drops.ts';
import {
  nodeRequest,
  nodeViews,
  recipeViews,
  skillView,
  toolCutPercent,
  toolSlotForSkill,
  xpPerHour,
  type SkillView,
} from './derive.ts';
import { formatInt } from './format.ts';

/** The topic the fight's "?" opens; every other topic is a skill id. */
export const FIGHT = 'fight';

/** Which shape of screen the topic is read on, and so which lifts and lists apply. */
export type HelpFamily = 'gather' | 'craft' | 'fight';

export interface HelpLift {
  /** "Tool", "Oath", "Worn" — the label down the left. */
  k: string;
  /** What it does now, or a dash where it does nothing. */
  v: string;
  /** Whether the hero has it: an off row is the panel saying what to go and get. */
  on: boolean;
  /** Where it comes from, in one line. */
  note: string;
}

export interface HelpBest {
  name: string;
  xpHr: number;
  /** A quick method: more xp an hour, nothing worth banking. */
  quick: boolean;
  /** Whether it can be started right now (a recipe wants its inputs in the bank). */
  ready: boolean;
}

export interface HelpView {
  family: HelpFamily;
  /** The skill the panel is about; for the fight, the one the worn weapon pays. */
  skill: SkillDef;
  level: SkillView;
  /** Everything multiplying xp here as one number: 1.16 for +16%. */
  xp: number;
  lifts: HelpLift[];
  /** The best xp an hour the hero could be running, of everything open to them. */
  best: HelpBest | null;
  /** The next thing a level opens, and the level it wants. */
  next: { name: string; level: number } | null;
}

export function helpFamily(topic: string, content: ContentDb): HelpFamily {
  if (topic === FIGHT) return 'fight';
  return content.nodesFor(topic).length > 0 ? 'gather' : 'craft';
}

/** The skill a topic reads: the fight's is the worn weapon's to say. */
export function helpSkill(sim: SimState, topic: string, ctx: SimContext): SkillDef {
  return ctx.content.skill(topic === FIGHT ? heroStats(sim, ctx).skill : topic);
}

export function helpView(sim: SimState, topic: string, ctx: SimContext): HelpView {
  const family = helpFamily(topic, ctx.content);
  const skill = helpSkill(sim, topic, ctx);
  const level = skillView(sim, skill.id, ctx);
  const found =
    family === 'gather'
      ? gatherWork(sim, skill.id, ctx)
      : family === 'craft'
        ? craftWork(sim, skill.id, ctx)
        : fightWork(sim, ctx);
  return {
    family,
    skill,
    level,
    xp: xpMultiplier(sim, skill.id, ctx),
    lifts: family === 'fight' ? fightLifts(sim, skill, ctx) : workLifts(sim, skill, family, ctx),
    best: found.best,
    next: found.next,
  };
}

// ---- what is open, and what is best of it --------------------------------------------------

interface Work {
  best: HelpBest | null;
  next: { name: string; level: number } | null;
}

function gatherWork(sim: SimState, skill: string, ctx: SimContext): Work {
  const nodes = ctx.content.nodesFor(skill);
  const views = nodeViews(
    sim,
    nodes,
    { skill, toolSlot: toolSlotForSkill(skill), request: (id) => nodeRequest(skill, id) },
    ctx,
  );
  const open = views.filter((v) => !v.locked);
  const best = open.reduce<(typeof open)[number] | null>(
    (b, v) => (b === null || v.xpHr > b.xpHr ? v : b),
    null,
  );
  const locked = views.filter((v) => v.locked).sort((a, b) => a.node.level - b.node.level)[0];
  return {
    best:
      best === null
        ? null
        : { name: best.node.name, xpHr: best.xpHr, quick: best.node.quick, ready: true },
    next: locked ? { name: locked.node.name, level: locked.node.level } : null,
  };
}

function craftWork(sim: SimState, skill: string, ctx: SimContext): Work {
  const views = recipeViews(sim, ctx.content.recipesFor(skill), ctx);
  // A recipe another skill still gates is not open, whatever the bank holds.
  const open = views.filter((v) => !v.locked && v.needs === null);
  const best = open.reduce<(typeof open)[number] | null>(
    (b, v) => (b === null || v.xpHr > b.xpHr ? v : b),
    null,
  );
  const locked = views.filter((v) => v.locked).sort((a, b) => a.recipe.level - b.recipe.level)[0];
  return {
    best:
      best === null
        ? null
        : { name: best.recipe.name, xpHr: best.xpHr, quick: false, ready: best.canAfford },
    next: locked ? { name: locked.recipe.name, level: locked.recipe.level } : null,
  };
}

function fightWork(sim: SimState, ctx: SimContext): Work {
  const hero = heroStats(sim, ctx);
  const rows = zoneRows(sim, ctx);
  let best: HelpBest | null = null;
  for (const zone of rows) {
    if (zone.locked) continue;
    for (const m of zone.monsters) {
      const hr = xpPerHour(m.xp, expectedKillTicks(hero, m.monster));
      if (best === null || hr > best.xpHr)
        best = { name: m.monster.name, xpHr: hr, quick: false, ready: true };
    }
  }
  const shut = rows.filter((z) => z.locked).sort((a, b) => a.zone.level - b.zone.level)[0];
  return { best, next: shut ? { name: shut.zone.name, level: shut.zone.level } : null };
}

// ---- what is lifting it --------------------------------------------------------------------

const pct = (fraction: number) => `+${String(Math.round(fraction * 100))}%`;

/** The lifts a gathering or crafting skill reads: the tool, the oath, the gear, the hall, the trader. */
function workLifts(
  sim: SimState,
  skill: SkillDef,
  family: HelpFamily,
  ctx: SimContext,
): HelpLift[] {
  const lifts: HelpLift[] = [];
  const slot = toolSlotForSkill(skill.id);
  if (slot !== null) {
    const id = sim.equipment[slot];
    const cut = toolCutPercent(sim, slot, ctx.content);
    lifts.push({
      k: 'Tool',
      v: cut > 0 ? `−${String(cut)}% action time` : '—',
      on: cut > 0,
      note:
        id !== null && ctx.content.hasItem(id)
          ? ctx.content.item(id).name
          : 'smith one, then equip it from the bank',
    });
  }
  lifts.push(oathLift(sim, skill, ctx), wornLift(sim, skill, ctx), hallLift(sim, skill, ctx));
  if (family === 'gather') {
    const twice = doubleYieldChance(sim, skill.id, ctx);
    lifts.push({
      k: 'Doubled',
      v: twice > 0 ? `${String(Math.round(twice * 100))}% of hauls land twice` : '—',
      on: twice > 0,
      note: "a hall's Storehouse, and Maren over the water",
    });
  }
  const finds = findsLift(sim, skill, ctx);
  if (finds !== null) lifts.push(finds);
  return lifts;
}

/** The lifts a fight reads: the style, the boon, the worn numbers, the hall, the weakness. */
function fightLifts(sim: SimState, skill: SkillDef, ctx: SimContext): HelpLift[] {
  const hero = heroStats(sim, ctx);
  const weapon = sim.equipment.weapon;
  const boon = hero.boon;
  return [
    {
      k: 'Style',
      v: `${hero.style === 'sorcery' ? 'casting' : 'swinging'} · pays ${skill.name}`,
      on: true,
      note:
        weapon !== null && ctx.content.hasItem(weapon)
          ? ctx.content.item(weapon).name
          : 'nothing in hand is melee',
    },
    {
      k: 'Numbers',
      v: `att ${formatInt(hero.attack)} · str ${formatInt(hero.strength)} · def ${formatInt(hero.defence)}`,
      on: true,
      note: `${String(skill.name)} level and everything worn, hp ${String(sim.combat.hp)} / ${String(hero.maxHp)}`,
    },
    {
      k: 'Boon',
      v: boon === null ? '—' : boonText(boon),
      on: boon !== null,
      note:
        boon !== null
          ? `${boon.name} · ${String(sim.combat.favour)} favour left, one a second`
          : 'burn an offering for favour and the god lends a hand',
    },
    {
      k: 'Weakness',
      v: '+25% max hit',
      on: true,
      note: `against whatever is weak to ${hero.style === 'sorcery' ? 'sorcery' : 'melee'}`,
    },
    gearLift(sim, ctx),
    wornLift(sim, skill, ctx),
    hallLift(sim, skill, ctx),
  ];
}

/** The fight's gear row: whether anything in the bank is waiting on a level, and what it wants. */
function gearLift(sim: SimState, ctx: SimContext): HelpLift {
  const waiting = sim.bank
    .filter((s) => ctx.content.hasItem(s.item))
    .map((s) => ctx.content.item(s.item))
    .filter((i) => i.wear !== null && !meetsWear(sim, i, ctx))
    .sort((a, b) => a.wear!.level - b.wear!.level);
  const next = waiting[0];
  return {
    k: 'Gear',
    v: next === undefined ? 'nothing waiting' : `${String(waiting.length)} waiting on a level`,
    on: next === undefined,
    note:
      next === undefined
        ? 'a weapon asks for its own fight, armour for either'
        : `${next.name} wants ${wearAsk(next.wear!, ctx)}`,
  };
}

function oathLift(sim: SimState, skill: SkillDef, ctx: SimContext): HelpLift {
  const god = godOf(sim, ctx);
  const mine = god?.perks.xp[skill.id] ?? 0;
  const patron = ctx.content.gods.find((g) => (g.perks.xp[skill.id] ?? 0) > 0);
  return {
    k: 'Oath',
    v: mine > 0 ? `${pct(mine)} xp` : '—',
    on: mine > 0,
    note:
      mine > 0
        ? `sworn to ${god!.name}`
        : patron
          ? `${patron.name} pays ${pct(patron.perks.xp[skill.id] ?? 0)} more here`
          : 'no god favours this one',
  };
}

function wornLift(sim: SimState, skill: SkillDef, ctx: SimContext): HelpLift {
  const boost = gearXpBoost(sim, skill.id, ctx);
  const names = wornBodyItems(sim, ctx)
    .filter((i) => i.xpBoost !== null && (i.xpBoost.skill === null || i.xpBoost.skill === skill.id))
    .map((i) => i.name);
  const cape = capeOf(skill, ctx.content);
  return {
    k: 'Worn',
    v: boost > 0 ? `${pct(boost)} xp` : '—',
    on: boost > 0,
    note:
      names.length > 0
        ? names.join(' · ')
        : cape !== null
          ? 'no cape worn · see below for where one comes from'
          : 'nothing worn lifts this one',
  };
}

function hallLift(sim: SimState, skill: SkillDef, ctx: SimContext): HelpLift {
  const bonus = hallXpBonus(sim, skill.id, ctx);
  return {
    k: 'Hall',
    v: bonus > 0 ? `${pct(bonus)} xp` : '—',
    on: bonus > 0,
    note:
      bonus > 0
        ? 'the Hearth, warm'
        : inHall(sim)
          ? 'raise the Hearth'
          : 'join a hall, raise the Hearth',
  };
}

/** What the hill leaves for the work: the skill's cape, and how often, with a second look. */
function findsLift(sim: SimState, skill: SkillDef, ctx: SimContext): HelpLift | null {
  const table = skill.finds;
  const cape = capeOf(skill, ctx.content);
  if (table === null || cape === null) return null;
  const rolls = findsRolls(sim, ctx);
  const entry = table.entries.find((e) => e.item === cape.id);
  const odds = formatChance(entryChance(table, entry?.weight ?? 1, rolls));
  return {
    k: 'Finds',
    v: `${odds} a cycle`,
    on: rolls > 1,
    note:
      rolls > 1
        ? `the ${cape.name}, rolled twice by A Second Look`
        : `the ${cape.name} · the trader's Second Look doubles it`,
  };
}

/** The item a skill's finds table leaves — its cape. */
function capeOf(skill: SkillDef, content: ContentDb) {
  const first = skill.finds?.entries[0];
  return first !== undefined && content.hasItem(first.item) ? content.item(first.item) : null;
}
