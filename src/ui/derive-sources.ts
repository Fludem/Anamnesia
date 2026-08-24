/**
 * Where a thing comes from. A recipe row names its inputs and how many; this answers the next
 * question — which rock, which beast, which other recipe — so a bench that wants five hound
 * teeth says where the hound is. Pure over content: the odds are the ones the sim rolls with
 * (derive-drops.ts), and nothing here reads the save.
 */
import type { ContentDb } from '../sim/content/db.ts';
import type { DropTable, ItemDef, RecipeDef } from '../sim/content/schema.ts';
import type { SimContext } from '../sim/context.ts';
import { entryChance, formatChance, formatQty } from './derive-drops.ts';

/** Where a source sits in the list: the bench first, then the hill, then the odd ways. */
export type SourceKind = 'bench' | 'gather' | 'monster' | 'container' | 'god';

const KIND_ORDER: readonly SourceKind[] = ['bench', 'gather', 'monster', 'container', 'god'];

export interface SourceLine {
  kind: SourceKind;
  /** "Silver Vein", "Hound of the Deep", "Silver Bar". */
  name: string;
  icon: string;
  /** Material the icon is tinted with, or null for the neutral colour. */
  material: string | null;
  /** "Mining Lv 55", "the Deep · Lv 60", "Smithing Lv 55". */
  where: string;
  /** "×2–4" for a range, "" for one at a time. */
  qty: string;
  /** The odds as the hill says them, or null where nothing is rolled (a recipe pays out). */
  odds: string | null;
  /** 0–1, for sorting; 1 for anything that is not a roll. */
  chance: number;
  /** The level the source itself asks for, for sorting within a kind. */
  level: number;
}

export interface InputSources {
  item: ItemDef;
  /** How many the recipe eats per cycle. */
  qty: number;
  lines: SourceLine[];
  /** Ways left off the end of `lines`. */
  more: number;
}

const GATHERING = ['mining', 'woodcutting', 'fishing', 'foraging'];

/** Every entry for `item` in `table`, as the chance at least one lands in a single roll. */
function linesFromTable(table: DropTable, item: string): { chance: number; qty: string }[] {
  const out: { chance: number; qty: string }[] = [];
  for (const e of table.entries) {
    if (e.item !== item) continue;
    out.push({ chance: entryChance(table, e.weight), qty: formatQty(e.quantity) });
  }
  return out;
}

/** One line per source: several tables on the same source fold into "either lands". */
function fold(parts: { chance: number; qty: string }[]): { chance: number; qty: string } | null {
  if (parts.length === 0) return null;
  let miss = 1;
  for (const p of parts) miss *= 1 - p.chance;
  return { chance: 1 - miss, qty: parts.find((p) => p.qty !== '')?.qty ?? '' };
}

/** Everything in the game that hands out `item`, best-first. */
export function itemSources(item: string, ctx: SimContext): SourceLine[] {
  const content: ContentDb = ctx.content;
  const lines: SourceLine[] = [];

  for (const recipe of content.recipes) {
    const out = recipe.outputs.find((o) => o.item === item);
    if (!out) continue;
    const skill = content.skill(recipe.skill);
    lines.push({
      kind: 'bench',
      name: recipe.name,
      icon: skill.icon,
      material: null,
      where: `${skill.name} Lv ${String(recipe.level)}`,
      qty: out.qty > 1 ? `×${String(out.qty)}` : '',
      odds: null,
      chance: 1,
      level: recipe.level,
    });
  }

  for (const id of GATHERING) {
    if (!content.hasSkill(id)) continue;
    const skill = content.skill(id);
    for (const node of content.nodesFor(id)) {
      const rolled = fold(node.drops.flatMap((t) => linesFromTable(t, item)));
      if (!rolled) continue;
      lines.push({
        kind: 'gather',
        name: node.name,
        icon: node.icon,
        material: node.material,
        where: `${skill.name} Lv ${String(node.level)}`,
        qty: rolled.qty,
        odds: formatChance(rolled.chance),
        chance: rolled.chance,
        level: node.level,
      });
    }
  }

  for (const monster of content.monsters) {
    const always = monster.always.find((a) => a.item === item);
    const rolled = fold(monster.drops.flatMap((t) => linesFromTable(t, item)));
    if (!always && !rolled) continue;
    const chance = always ? 1 : rolled!.chance;
    lines.push({
      kind: 'monster',
      name: monster.name,
      icon: monster.icon,
      material: monster.material,
      where: `${content.zone(monster.zone).name} · Lv ${String(monster.level)}`,
      qty: always ? (always.qty > 1 ? `×${String(always.qty)}` : '') : rolled!.qty,
      odds: formatChance(chance),
      chance,
      level: monster.level,
    });
  }

  for (const box of content.items) {
    if (box.opens === null) continue;
    const rolled = fold(linesFromTable(box.opens, item));
    if (!rolled) continue;
    lines.push({
      kind: 'container',
      name: box.name,
      icon: box.icon,
      material: box.material,
      where: 'opened',
      qty: rolled.qty,
      odds: formatChance(rolled.chance),
      chance: rolled.chance,
      level: 1,
    });
  }

  for (const god of content.gods) {
    for (const extra of god.perks.extraDrops) {
      const rolled = fold(linesFromTable(extra.table, item));
      if (!rolled) continue;
      const skill = content.hasSkill(extra.skill) ? content.skill(extra.skill).name : extra.skill;
      lines.push({
        kind: 'god',
        name: `Sworn to ${god.name}`,
        icon: god.icon,
        material: null,
        where: `${skill}, every cycle`,
        qty: rolled.qty,
        odds: formatChance(rolled.chance),
        chance: rolled.chance,
        level: 1,
      });
    }
  }

  return lines.sort((a, b) => {
    const kind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (kind !== 0) return kind;
    if (a.chance !== b.chance) return b.chance - a.chance;
    return a.level - b.level;
  });
}

/** What a recipe eats and where each of it comes from, at most `limit` ways per input. */
export function recipeSources(recipe: RecipeDef, ctx: SimContext, limit = 3): InputSources[] {
  return recipe.inputs.map((input) => {
    const all = itemSources(input.item, ctx);
    return {
      item: ctx.content.item(input.item),
      qty: input.qty,
      lines: all.slice(0, limit),
      more: Math.max(0, all.length - limit),
    };
  });
}
