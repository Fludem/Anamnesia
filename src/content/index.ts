/**
 * The shipped content pack. JSON files in this directory are the only place game content is
 * authored; the build scans them for `"icon"` references so every icon used here ships.
 * Validation happens once at import; a broken pack fails loudly at startup and in tests.
 */
import { ContentDb } from '../sim/content/db.ts';
import type { SimContext } from '../sim/context.ts';
import { DEFAULT_XP_CURVE } from '../sim/xp.ts';
import tables from './drop-tables.json' with { type: 'json' };
import gods from './gods.json' with { type: 'json' };
import halls from './halls.json' with { type: 'json' };
import items from './items.json' with { type: 'json' };
import materials from './materials.json' with { type: 'json' };
import monsters from './monsters.json' with { type: 'json' };
import patches from './patches.json' with { type: 'json' };
import rarities from './rarities.json' with { type: 'json' };
import recipes from './recipes.json' with { type: 'json' };
import rocks from './rocks.json' with { type: 'json' };
import skills from './skills.json' with { type: 'json' };
import trader from './trader.json' with { type: 'json' };
import trees from './trees.json' with { type: 'json' };
import waters from './waters.json' with { type: 'json' };
import zones from './zones.json' with { type: 'json' };

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
  wares: trader,
  rooms: halls,
});

export const simContext: SimContext = { content, xp: DEFAULT_XP_CURVE };
