import { z } from 'zod';

import { EquipmentSlotSchema } from '../slots.ts';

/**
 * Content is data, not code. These schemas are the contract every content file is validated
 * against at load. Adding an item, rock or skill never touches engine code.
 *
 * Ids are stable identifiers used in saves; names and descriptions are presentation and may
 * change freely (Phase 3 decides setting and tone).
 */

export const IdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'ids are lowercase-kebab');
/** `author/slug` from the icon index; the build ships every icon referenced here. */
export const IconRefSchema = z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/);

export const SkillDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  icon: IconRefSchema,
});
export type SkillDef = z.infer<typeof SkillDefSchema>;

/** Lowercase 6-digit hex. Palettes are data so a new tier is a content change, not a code change. */
export const HexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/, 'colours are lowercase #rrggbb');

/** The three stops every material renders with (design: 150° gradient, highlight 8% → primary 50% → shadow 96%). */
export const PaletteSchema = z.object({
  highlight: HexColorSchema,
  primary: HexColorSchema,
  shadow: HexColorSchema,
});
export type Palette = z.infer<typeof PaletteSchema>;

/** A material tier: the colour an item or node is rendered in. Names are placeholders until Phase 3. */
export const MaterialDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  palette: PaletteSchema,
});
export type MaterialDef = z.infer<typeof MaterialDefSchema>;

/**
 * A rarity tier. `rank` orders tiers (0 = baseline); `tag` is the one-letter mark the bank cell
 * shows so rarity never relies on colour alone. Treatment colours live in the UI theme, keyed by id.
 */
export const RarityDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  rank: z.number().int().min(0),
  tag: z.string().min(1).max(2).nullable().default(null),
});
export type RarityDef = z.infer<typeof RarityDefSchema>;
export const COMMON_RARITY: RarityDef = { id: 'common', name: 'Common', rank: 0, tag: null };

export const ItemClassSchema = z.enum([
  'resource',
  'gem',
  'weapon',
  'armour',
  'tool',
  'consumable',
  'container',
  'misc',
]);
export type ItemClass = z.infer<typeof ItemClassSchema>;

export const StatKeySchema = z.enum(['attack', 'strength', 'defence', 'speed', 'gather']);
export type StatKey = z.infer<typeof StatKeySchema>;
export const ItemStatsSchema = z.partialRecord(StatKeySchema, z.number());
export type ItemStats = z.infer<typeof ItemStatsSchema>;

/** Corner marks layered over an item's icon. Each maps to a badge glyph in the renderer. */
export const BadgeKindSchema = z.enum(['enchanted', 'upgraded', 'burning', 'locked', 'cursed']);
export type BadgeKind = z.infer<typeof BadgeKindSchema>;

export const ItemDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  /** Base icon geometry; the renderer recolours it by material and layers rarity + badges on top. */
  icon: IconRefSchema,
  class: ItemClassSchema.default('resource'),
  /** Material tier id, or null to render in the neutral icon colour. */
  material: IdSchema.nullable().default(null),
  rarity: IdSchema.default(COMMON_RARITY.id),
  /** Equipment slot for wearables; null for everything else. */
  slot: EquipmentSlotSchema.nullable().default(null),
  stats: ItemStatsSchema.default({}),
  badges: z.array(BadgeKindSchema).default([]),
  /** Base sell value in coins. */
  value: z.number().int().min(0),
  tags: z.array(z.string()).default([]),
});
export type ItemDef = z.infer<typeof ItemDefSchema>;

/** One weighted line of a drop table. `quantity` is inclusive `[min, max]`. */
export const DropEntrySchema = z.object({
  item: IdSchema,
  weight: z.number().positive(),
  quantity: z
    .tuple([z.number().int().min(1), z.number().int().min(1)])
    .refine(([min, max]) => max >= min, 'quantity max must be >= min')
    .default([1, 1]),
});
export type DropEntry = z.infer<typeof DropEntrySchema>;

/**
 * A weighted table rolled once per `rolls`. `nothingWeight` adds an empty outcome, so a table
 * with entries totalling 1 and `nothingWeight: 99` drops something 1% of the time.
 */
export const DropTableSchema = z.object({
  rolls: z.number().int().min(1).default(1),
  nothingWeight: z.number().min(0).default(0),
  entries: z.array(DropEntrySchema).min(1),
});
export type DropTable = z.infer<typeof DropTableSchema>;

/** Either an inline table or a reference to a named one in the pack's `tables`. */
export const DropTableOrRefSchema = z.union([
  z.object({ $ref: z.string().min(1) }),
  DropTableSchema,
]);
export type DropTableOrRef = z.infer<typeof DropTableOrRefSchema>;

/**
 * Chance an action cycle succeeds: `min(1, base + perLevel * (level - requiredLevel))`.
 * `{ base: 1 }` never fails. Failure consumes the cycle and awards nothing.
 */
export const SuccessRuleSchema = z.object({
  base: z.number().min(0).max(1),
  perLevel: z.number().min(0).default(0),
});
export type SuccessRule = z.infer<typeof SuccessRuleSchema>;

/** A mineable node. Every gathering node in later skills is a variation of this shape. */
export const RockDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  icon: IconRefSchema,
  /** Material tier the node's icon is rendered in; null for the neutral icon colour. */
  material: IdSchema.nullable().default(null),
  /** Mining level required to start. */
  level: z.number().int().min(1),
  /** Ticks per cycle (100 ms each). */
  durationTicks: z.number().int().min(1),
  /** XP awarded per successful cycle. */
  xp: z.number().min(0),
  success: SuccessRuleSchema,
  /** Each table is rolled independently on success — e.g. the ore itself plus a rare gem table. */
  drops: z.array(DropTableOrRefSchema).min(1),
});
/** A rock as authored (drops may be `$ref`s). */
export type RockSource = z.infer<typeof RockDefSchema>;
/** A rock as the sim sees it: every drop table resolved inline. */
export type RockDef = Omit<RockSource, 'drops'> & { drops: readonly DropTable[] };

function stripDollarKeys(v: unknown): unknown {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
  return Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('$')));
}

/** Array files may carry `{ "$comment": … }` entries (objects whose keys all start with `$`). */
function stripCommentEntries(v: unknown): unknown {
  if (!Array.isArray(v)) return v;
  return v.filter(
    (e: unknown) =>
      !(
        typeof e === 'object' &&
        e !== null &&
        !Array.isArray(e) &&
        Object.keys(e).length > 0 &&
        Object.keys(e).every((k) => k.startsWith('$'))
      ),
  );
}

/** `z.array(schema)` that ignores comment entries. */
const contentList = <T extends z.ZodType>(schema: T) =>
  z.preprocess(stripCommentEntries, z.array(schema));

/** The raw shape of a whole content pack before cross-reference checks. */
export const ContentPackSchema = z.object({
  skills: contentList(SkillDefSchema),
  materials: contentList(MaterialDefSchema).default([]),
  /** Defaults to just `common` so a pack without rarities still validates. */
  rarities: contentList(RarityDefSchema).default([COMMON_RARITY]),
  items: contentList(ItemDefSchema),
  /** Named drop tables shared between nodes. Keys starting with `$` are ignored (comments). */
  tables: z.preprocess(stripDollarKeys, z.record(z.string(), DropTableSchema)).default({}),
  rocks: contentList(RockDefSchema),
});
export type ContentPack = z.infer<typeof ContentPackSchema>;
