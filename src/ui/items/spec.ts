/**
 * Builds renderer specs from game data. This is the only place that knows both the content
 * model (items, materials, rarities) and the icon renderer's plain inputs.
 */

import { icons } from '../../icons/registry.ts';
import { swordSpec, type SwordPalettes } from '../../icons/procedural/sword.ts';
import type { Fill, IconSpec, Palette, TileSpec } from '../../icons/render.ts';
import type { ContentDb } from '../../sim/content/db.ts';
import type { BadgeKind, ItemDef, MonsterDef, RockDef } from '../../sim/content/schema.ts';
import { rollSword, type SwordParts } from '../../sim/procedural/sword.ts';
import { seedFromString } from '../../sim/rng.ts';
import { color, rarity as rarityTheme, tile as tileSizes } from '../theme/theme.ts';
import { badgeMark } from './badges.ts';

export type TileSize = keyof typeof tileSizes;

export interface TileOptions {
  size?: TileSize | undefined;
  /** Render in the locked (disabled) colour regardless of material. */
  locked?: boolean | undefined;
  /** Use the brighter feed ring for a fresh drop. */
  feed?: boolean | undefined;
}

/** Material palette for an id, or the neutral flat fill when the thing has no material. */
export function materialFill(content: ContentDb, materialId: string | null, locked = false): Fill {
  if (locked) return { kind: 'flat', color: color.fgDisabled };
  if (materialId === null) return { kind: 'flat', color: color.fgIcon };
  return { kind: 'palette', palette: content.material(materialId).palette };
}

export function itemIconSpec(content: ContentDb, item: ItemDef, locked = false): IconSpec {
  if (item.procedural === 'sword' && item.material !== null && !locked) {
    return swordIconSpec(content, proceduralSwordParts(content, item), item.material, item.rarity);
  }
  const entry = icons.get(item.icon);
  return {
    layers: [{ id: entry.id, d: entry.d, fill: materialFill(content, item.material, locked) }],
  };
}

/**
 * The archetype look of a procedural item def: rolled from its id, so every "Copper Sword" in
 * every bank is the same sword until rolled instances carry their own parts.
 */
export function proceduralSwordParts(content: ContentDb, item: ItemDef): SwordParts {
  const materialRank = item.material === null ? 0 : content.material(item.material).tier;
  const rarityRank = content.rarity(item.rarity).rank;
  return rollSword(seedFromString(item.id), { materialRank, rarityRank }).parts;
}

/** An icon reference in a material's palette — for everything that is not an item. */
export function refIconSpec(
  content: ContentDb,
  icon: string,
  material: string | null,
  locked = false,
): IconSpec {
  const entry = icons.get(icon);
  return { layers: [{ id: entry.id, d: entry.d, fill: materialFill(content, material, locked) }] };
}

export function monsterIconSpec(content: ContentDb, monster: MonsterDef): IconSpec {
  return refIconSpec(content, monster.icon, monster.material);
}

export function rockIconSpec(content: ContentDb, rock: RockDef, locked = false): IconSpec {
  return refIconSpec(content, rock.icon, rock.material, locked);
}

/** Gem colour by rarity: rare gems read as `gem`, epic as `aether` (the design's pairing). */
const GEM_MATERIAL_BY_RARITY: Record<string, string> = { rare: 'gem', epic: 'aether' };
const GRIP_MATERIAL = 'oak';

export function swordIconSpec(
  content: ContentDb,
  parts: SwordParts,
  materialId: string,
  rarityId: string,
): IconSpec {
  const gemMaterial = GEM_MATERIAL_BY_RARITY[rarityId];
  const palettes: SwordPalettes = {
    metal: content.material(materialId).palette,
    grip: content.material(GRIP_MATERIAL).palette,
    gem: gemMaterial ? content.material(gemMaterial).palette : null,
  };
  return swordSpec(parts, palettes);
}

/** Wraps an icon spec in tile chrome for a rarity and badge set. */
export function tileSpec(
  content: ContentDb,
  icon: IconSpec,
  rarityId: string,
  badges: readonly BadgeKind[],
  opts: TileOptions = {},
): TileSpec {
  const dims = tileSizes[opts.size ?? 'md'];
  const r = content.rarity(rarityId);
  const treatment = rarityTheme[r.id];
  return {
    ...icon,
    size: dims.size,
    iconSize: dims.icon,
    radius: dims.radius,
    background: color.bgInset,
    border: treatment ? (opts.feed ? treatment.borderFeed : treatment.border) : color.borderStrong,
    tag: treatment && r.tag ? { text: r.tag, color: treatment.color } : null,
    badges: badges.map(badgeMark),
    badgeBackground: color.bgPanel,
  };
}

export function itemTileSpec(content: ContentDb, item: ItemDef, opts: TileOptions = {}): TileSpec {
  return tileSpec(
    content,
    itemIconSpec(content, item, opts.locked),
    item.rarity,
    item.badges,
    opts,
  );
}

/** The CSS glow a tile gets outside its border (box-shadow), or null for common / no-juice. */
export function tileGlow(rarityId: string, feed = false): string | null {
  const t = rarityTheme[rarityId];
  if (!t) return null;
  return `0 0 ${feed ? '10px' : '10px'} ${feed ? t.glowFeed : t.glow}`;
}

export type { Palette };
