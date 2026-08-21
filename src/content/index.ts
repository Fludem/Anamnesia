/**
 * The shipped content pack. JSON files in this directory are the only place game content is
 * authored; the build scans them for `"icon"` references so every icon used here ships.
 * Validation happens once at import; a broken pack fails loudly at startup and in tests.
 */
import { ContentDb } from '../sim/content/db.ts';
import type { SimContext } from '../sim/context.ts';
import { DEFAULT_XP_CURVE } from '../sim/xp.ts';
import tables from './drop-tables.json';
import items from './items.json';
import rocks from './rocks.json';
import skills from './skills.json';

export const content: ContentDb = ContentDb.fromPack({ skills, items, tables, rocks });

export const simContext: SimContext = { content, xp: DEFAULT_XP_CURVE };
