/**
 * The shipped content pack. JSON files in this directory are the only place game content is
 * authored; the build scans them for `"icon"` references so every icon used here ships.
 * Validation happens once at import; a broken pack fails loudly at startup and in tests.
 */
import { ContentDb } from '../sim/content/db.ts';
import type { SimContext } from '../sim/context.ts';
import { DEFAULT_XP_CURVE } from '../sim/xp.ts';
import tables from './drop-tables.json';
import gods from './gods.json';
import items from './items.json';
import materials from './materials.json';
import monsters from './monsters.json';
import patches from './patches.json';
import rarities from './rarities.json';
import recipes from './recipes.json';
import rocks from './rocks.json';
import skills from './skills.json';
import trees from './trees.json';
import waters from './waters.json';
import zones from './zones.json';

export const content: ContentDb = ContentDb.fromPack({
  skills,
  materials,
  rarities,
  items,
  tables,
  rocks,
  trees,
  waters,
  patches,
  recipes,
  zones,
  monsters,
  gods,
});

export const simContext: SimContext = { content, xp: DEFAULT_XP_CURVE };
