import type { DropTable } from './content/schema.ts';
import type { ItemStack } from './items.ts';
import { nextFloat, nextInt, type RngState } from './rng.ts';

/**
 * Roll a drop table. Draw order is part of the save-compatible contract (tests pin it):
 * per roll, one draw picks the weighted entry; a second draw picks the quantity only when the
 * range is wider than a single value.
 */
export function rollDropTable(table: DropTable, rng: RngState): [ItemStack[], RngState] {
  const total = table.nothingWeight + table.entries.reduce((sum, e) => sum + e.weight, 0);
  const out: ItemStack[] = [];
  let s = rng;
  for (let r = 0; r < table.rolls; r++) {
    let f: number;
    [f, s] = nextFloat(s);
    let pick = f * total;
    if (pick < table.nothingWeight) continue;
    pick -= table.nothingWeight;
    for (const e of table.entries) {
      if (pick < e.weight) {
        const [min, max] = e.quantity;
        let qty = min;
        if (max > min) [qty, s] = nextInt(s, min, max);
        out.push({ item: e.item, qty });
        break;
      }
      pick -= e.weight;
    }
  }
  return [out, s];
}
