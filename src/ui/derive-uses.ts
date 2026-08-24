/**
 * What a thing is for. `derive-sources.ts` answers where a thing comes from; this answers the
 * question the bank asks — what is it good for once you have it: the benches that eat it, what
 * it does in hand, and which room of the hall would take it as a gift. Pure over content: the
 * levels and counts are the ones the sim works from, and nothing here reads the save.
 */
import type { ItemDef, RecipeDef } from '../sim/content/schema.ts';
import type { SimContext } from '../sim/context.ts';
import { FERRYMAN_COIN_TAG } from '../sim/skills/combat.ts';
import { isToolSlot, TOOL_SLOTS } from '../sim/slots.ts';
import { formatInt } from './format.ts';

/** What kind of use a line is. The first five are things the item does in hand. */
export type UseKind = 'wear' | 'eat' | 'offer' | 'open' | 'ferry' | 'bench' | 'gift';
/** The three answers a use falls under, in the order the tip lists them. */
export type UseGroup = 'hand' | 'bench' | 'hall';

const GROUP_OF: Record<UseKind, UseGroup> = {
  wear: 'hand',
  eat: 'hand',
  offer: 'hand',
  open: 'hand',
  ferry: 'hand',
  bench: 'bench',
  gift: 'hall',
};
const GROUP_ORDER: readonly UseGroup[] = ['hand', 'bench', 'hall'];
const GROUP_TITLE: Record<UseGroup, string> = {
  hand: 'In hand',
  bench: 'Benches',
  hall: 'The hall',
};
/** Within "in hand": what the thing plainly is, before the odder uses. */
const KIND_ORDER: readonly UseKind[] = ['wear', 'eat', 'offer', 'open', 'ferry', 'bench', 'gift'];

/** Icons for the uses that are not a bench, a room or the item itself. */
const WEAR_ICON = 'delapouite/chest-armor';
const THROWN_ICON = 'lorc/thrown-spear';
const MARK_ICON = 'lorc/rune-stone';
const EAT_ICON = 'lorc/meat';
const OFFER_ICON = 'lorc/incense';
const FERRY_ICON = 'lorc/crown-coin';

export interface UseLine {
  kind: UseKind;
  /** "Silver Bar", "Worn", "The Storehouse". */
  name: string;
  icon: string;
  /** Material the icon is tinted with, or null for the neutral colour. */
  material: string | null;
  /** "Smithing Lv 55", "the head slot", "tier 2". */
  where: string;
  /** "×2" for what one turn eats, "" where it takes the one. */
  qty: string;
  /** The level (or tier) the use itself asks for, for sorting within a group. */
  level: number;
}

export interface UseSection {
  group: UseGroup;
  /** "In hand", "Benches", "The hall". */
  title: string;
  lines: UseLine[];
  /** Uses left off the end of `lines`. */
  more: number;
}

/** How many one turn of a use eats, said the way a recipe row says it. */
function eats(qty: number): string {
  return qty > 1 ? `×${formatInt(qty)}` : '';
}

/** What wearing it is: a tool serves its skill, ammo is thrown or burnt, the rest is worn. */
function wearLine(item: ItemDef, ctx: SimContext): UseLine {
  const slot = item.slot!;
  if (isToolSlot(slot)) {
    const skill = TOOL_SLOTS[slot];
    const known = ctx.content.hasSkill(skill);
    return {
      kind: 'wear',
      name: 'Worn as a tool',
      icon: known ? ctx.content.skill(skill).icon : WEAR_ICON,
      material: null,
      where: known ? `${ctx.content.skill(skill).name}, the ${slot} slot` : `the ${slot} slot`,
      qty: '',
      level: 0,
    };
  }
  if (slot === 'ammo') {
    const sorcery = item.style === 'sorcery';
    return {
      kind: 'wear',
      name: sorcery ? 'Burnt as a mark' : 'Thrown',
      icon: sorcery ? MARK_ICON : THROWN_ICON,
      material: null,
      where: 'the ammo slot, one a swing',
      qty: '',
      level: 0,
    };
  }
  return {
    kind: 'wear',
    name: 'Worn',
    icon: WEAR_ICON,
    material: null,
    where: `the ${slot} slot`,
    qty: '',
    level: 0,
  };
}

/** The icon a bench line wears: what it makes, or the skill where it makes nothing. */
function benchIcon(recipe: RecipeDef, ctx: SimContext): { icon: string; material: string | null } {
  const out = recipe.outputs[0];
  if (out && ctx.content.hasItem(out.item)) {
    const made = ctx.content.item(out.item);
    return { icon: made.icon, material: made.material };
  }
  const skill = ctx.content.hasSkill(recipe.skill) ? ctx.content.skill(recipe.skill) : null;
  return { icon: skill ? skill.icon : WEAR_ICON, material: null };
}

/** Everything on the hill that wants `item`, the plainest use first. */
export function itemUses(id: string, ctx: SimContext): UseLine[] {
  const content = ctx.content;
  if (!content.hasItem(id)) return [];
  const item = content.item(id);
  const lines: UseLine[] = [];

  if (item.slot !== null) lines.push(wearLine(item, ctx));

  const heal = item.stats.heal ?? 0;
  if (heal > 0) {
    lines.push({
      kind: 'eat',
      name: 'Eaten in a fight',
      icon: EAT_ICON,
      material: null,
      where: `heals ${formatInt(heal)}`,
      qty: '',
      level: 0,
    });
  }

  const favour = item.stats.favour ?? 0;
  if (favour > 0) {
    lines.push({
      kind: 'offer',
      name: 'Burnt for favour',
      icon: OFFER_ICON,
      material: null,
      where: `${formatInt(favour)} favour the offering`,
      qty: '',
      level: 0,
    });
  }

  if (item.opens !== null) {
    const inside = new Set(item.opens.entries.map((e) => e.item)).size;
    lines.push({
      kind: 'open',
      name: 'Opened',
      icon: item.icon,
      material: item.material,
      where: inside === 1 ? 'one thing inside' : `${formatInt(inside)} things inside`,
      qty: '',
      level: 0,
    });
  }

  if (item.tags.includes(FERRYMAN_COIN_TAG)) {
    lines.push({
      kind: 'ferry',
      name: 'The ferryman',
      icon: FERRY_ICON,
      material: null,
      where: 'one settles a death',
      qty: '',
      level: 0,
    });
  }

  for (const recipe of content.recipes) {
    const input = recipe.inputs.find((i) => i.item === id);
    if (!input) continue;
    const skill = content.hasSkill(recipe.skill) ? content.skill(recipe.skill).name : recipe.skill;
    lines.push({
      kind: 'bench',
      name: recipe.name,
      ...benchIcon(recipe, ctx),
      where: `${skill} Lv ${String(recipe.level)}`,
      qty: eats(input.qty),
      level: recipe.level,
    });
  }

  for (const room of content.rooms) {
    room.tiers.forEach((tier, i) => {
      const cost = tier.cost.find((c) => c.item === id);
      if (!cost) return;
      lines.push({
        kind: 'gift',
        name: room.name,
        icon: room.icon,
        material: null,
        where: `tier ${String(i + 1)}`,
        qty: eats(cost.qty),
        level: i + 1,
      });
    });
  }

  return lines.sort((a, b) => {
    const kind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (kind !== 0) return kind;
    if (a.level !== b.level) return a.level - b.level;
    return a.name.localeCompare(b.name);
  });
}

/**
 * The uses grouped as the tip shows them, at most `limit` lines per group. What a thing does
 * in hand is never trimmed — there are never more than a few — and the benches and the rooms
 * are cut to the soonest, with the rest counted.
 */
export function itemUseTip(id: string, ctx: SimContext, limit = 5): UseSection[] {
  const all = itemUses(id, ctx);
  const sections: UseSection[] = [];
  for (const group of GROUP_ORDER) {
    const lines = all.filter((l) => GROUP_OF[l.kind] === group);
    if (lines.length === 0) continue;
    const shown = group === 'hand' ? lines : lines.slice(0, limit);
    sections.push({
      group,
      title: GROUP_TITLE[group],
      lines: shown,
      more: lines.length - shown.length,
    });
  }
  return sections;
}
