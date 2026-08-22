import { content, simContext } from '../content/index.ts';
import { maxHitpoints } from '../sim/combat.ts';
import { formatInt } from './format.ts';

const NODE_VERB: Record<string, string> = {
  mining: 'New vein surveyed',
  woodcutting: 'New grove surveyed',
  fishing: 'New water found',
};
const RECIPE_VERB: Record<string, string> = {
  firemaking: 'New fire',
  cooking: 'New dish',
};

/** What `level` in `skill` opens, or the next milestone. Mirrors the design's UNLOCKS copy. */
export function unlockText(skill: string, level: number): string {
  const node = content.nodesFor(skill).find((n) => n.level === level);
  if (node) return `${NODE_VERB[skill] ?? 'New'}: ${node.name}`;
  const recipe = content.recipesFor(skill).find((r) => r.level === level);
  if (recipe) return `${RECIPE_VERB[skill] ?? 'New recipe'}: ${recipe.name}`;
  const zone = skill === 'combat' ? content.zones.find((z) => z.level === level) : undefined;
  if (zone) return `New ground: ${zone.name}`;
  if (skill === 'hitpoints') return `${String(maxHitpoints(level))} hitpoints now`;
  if (level >= simContext.xp.maxLevel) return 'The top. There is no further.';
  return `Next: Lv ${String(level + 1)} · ${formatInt(simContext.xp.xpForLevel(level + 1))} xp`;
}
