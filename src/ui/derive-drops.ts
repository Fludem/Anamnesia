/**
 * What a gathering node leaves per successful cycle, as lines for a hover tip: the node's own
 * tables, the sworn god's extra table for that skill, the skill's finds (a cape, once in a
 * long while — twice as often with A Second Look), and the chance the haul lands twice. Pure;
 * every number here is the same one the sim rolls with (drops.ts, finds.ts, perks.ts).
 */
import type { DropTable, GatherNodeDef, ItemDef } from '../sim/content/schema.ts';
import type { SimContext } from '../sim/context.ts';
import { doubleYieldChance, extraDropTables, godOf } from '../sim/perks.ts';
import type { SimState } from '../sim/save.ts';
import { findsRolls } from '../sim/trader.ts';
import { formatInt } from './format.ts';

export interface DropLine {
  item: ItemDef;
  /** "×2–4" for a range, "×3" for a fixed stack above one, "" for one. */
  qty: string;
  /** Chance the item lands at least once in a successful cycle, 0–1. */
  chance: number;
  /** The chance as the hill says it: "always", "12%", "1 in 2,000". */
  odds: string;
}

export interface DropSection {
  /** "Drops", "Sworn to Vessith", "Finds". */
  title: string;
  /** A note under the title: "once a cycle, twice with A Second Look". */
  note: string | null;
  lines: DropLine[];
}

export interface DropTip {
  sections: DropSection[];
  /** "the haul lands twice 5% of the time", or null when nothing doubles it. */
  double: string | null;
}

/** The chance a line lands at least once when `table` is rolled `times` times. */
export function entryChance(table: DropTable, weight: number, times = 1): number {
  const total = table.entries.reduce((n, e) => n + e.weight, 0) + table.nothingWeight;
  const once = weight / total;
  return 1 - Math.pow(1 - once, table.rolls * times);
}

/** "always" above 99.5%, a percentage down to 5%, "1 in N" below. */
export function formatChance(p: number): string {
  if (p >= 0.995) return 'always';
  if (p >= 0.05) return `${String(Math.round(p * 100))}%`;
  if (p <= 0) return 'never';
  return `1 in ${formatInt(Math.round(1 / p))}`;
}

export function formatQty([min, max]: readonly [number, number]): string {
  if (max > min) return `×${String(min)}–${String(max)}`;
  return min > 1 ? `×${String(min)}` : '';
}

function tableLines(table: DropTable, ctx: SimContext, times = 1): DropLine[] {
  const out: DropLine[] = [];
  for (const e of table.entries) {
    if (!ctx.content.hasItem(e.item)) continue;
    const chance = entryChance(table, e.weight, times);
    out.push({
      item: ctx.content.item(e.item),
      qty: formatQty(e.quantity),
      chance,
      odds: formatChance(chance),
    });
  }
  return out;
}

/** Merge lines for the same item across tables: the chance of either landing. */
function merge(lines: DropLine[]): DropLine[] {
  const byItem = new Map<string, DropLine>();
  for (const l of lines) {
    const seen = byItem.get(l.item.id);
    if (!seen) {
      byItem.set(l.item.id, l);
      continue;
    }
    const chance = 1 - (1 - seen.chance) * (1 - l.chance);
    byItem.set(l.item.id, { ...seen, chance, odds: formatChance(chance) });
  }
  return [...byItem.values()].sort((a, b) => b.chance - a.chance);
}

export function dropTip(
  state: SimState,
  node: GatherNodeDef,
  skill: string,
  ctx: SimContext,
): DropTip {
  const sections: DropSection[] = [];
  const own = merge(node.drops.flatMap((t) => tableLines(t, ctx)));
  if (own.length > 0) sections.push({ title: 'Drops', note: null, lines: own });
  const god = godOf(state, ctx);
  const extra = merge(extraDropTables(state, skill, ctx).flatMap((t) => tableLines(t, ctx)));
  if (god && extra.length > 0) {
    sections.push({
      title: `Sworn to ${god.name}`,
      note: 'one more table, every cycle',
      lines: extra,
    });
  }
  if (ctx.content.hasSkill(skill)) {
    const finds = ctx.content.skill(skill).finds;
    if (finds !== null) {
      const rolls = findsRolls(state, ctx);
      const lines = merge(tableLines(finds, ctx, rolls));
      if (lines.length > 0) {
        sections.push({
          title: 'Finds',
          note:
            rolls > 1
              ? 'rolled twice a cycle, for the second look'
              : 'once a cycle, when the bank has room',
          lines,
        });
      }
    }
  }
  const twice = doubleYieldChance(state, skill, ctx);
  return {
    sections,
    double: twice > 0 ? `the haul lands twice ${formatChance(twice)} of the time` : null,
  };
}
