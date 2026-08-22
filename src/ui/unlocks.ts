import { content, simContext } from '../content/index.ts';
import { formatInt } from './format.ts';

/** What `level` in `skill` opens, or the next milestone. Mirrors the design's UNLOCKS copy. */
export function unlockText(skill: string, level: number): string {
  const nodes = skill === 'mining' ? content.rocks : skill === 'woodcutting' ? content.trees : [];
  const node = nodes.find((n) => n.level === level);
  if (node)
    return `${skill === 'mining' ? 'New vein surveyed' : 'New grove surveyed'}: ${node.name}`;
  const recipe = content.recipesFor(skill).find((r) => r.level === level);
  if (recipe) return `New recipe: ${recipe.name}`;
  const zone = skill === 'combat' ? content.zones.find((z) => z.level === level) : undefined;
  if (zone) return `New ground: ${zone.name}`;
  if (level >= simContext.xp.maxLevel) return 'The top. There is no further.';
  return `Next: Lv ${String(level + 1)} · ${formatInt(simContext.xp.xpForLevel(level + 1))} xp`;
}
