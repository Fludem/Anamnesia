import { z } from 'zod';

import { EquipmentSlotSchema } from '../slots.ts';

/**
 * Content is data, not code. These schemas are the contract every content file is validated
 * against at load. Adding an item, rock or skill never touches engine code.
 *
 * Ids are stable identifiers used in saves; names and descriptions are presentation and may
 * change freely. Setting and tone (Phase 3): the hill — plain geological and material words,
 * dry one-line descriptions, faintly Greek underneath. See DECISIONS.md.
 */

export const IdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'ids are lowercase-kebab');
/** `author/slug` from the icon index; the build ships every icon referenced here. */
export const IconRefSchema = z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/);

export const SkillDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  icon: IconRefSchema,
  /** Whether the skill has a screen and a nav row. Hitpoints is trained by combat and only read. */
  listed: z.boolean().default(true),
  /**
   * A table rolled once per successful cycle of the skill, on top of whatever the cycle paid:
   * what the hill leaves for someone who works it long enough (a cape, say). Never rolled when
   * the bank has no room for what it might drop.
   */
  finds: z
    .lazy(() => DropTableOrRefSchema)
    .nullable()
    .default(null),
});
/** A skill as authored (`finds` may be a `$ref`). */
export type SkillSource = z.infer<typeof SkillDefSchema>;
/** A skill as the sim sees it: the finds table resolved inline. */
export type SkillDef = Omit<SkillSource, 'finds'> & { finds: DropTable | null };

/** Lowercase 6-digit hex. Palettes are data so a new tier is a content change, not a code change. */
export const HexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/, 'colours are lowercase #rrggbb');

/** The three stops every material renders with (design: 150° gradient, highlight 8% → primary 50% → shadow 96%). */
export const PaletteSchema = z.object({
  highlight: HexColorSchema,
  primary: HexColorSchema,
  shadow: HexColorSchema,
});
export type Palette = z.infer<typeof PaletteSchema>;

/** A material tier: the colour an item or node is rendered in. */
export const MaterialDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  palette: PaletteSchema,
  /** Position on the equipment ladder (0 = first tier); scales procedural stats. 0 for non-tier palettes. */
  tier: z.number().int().min(0).default(0),
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

/**
 * `gather` is a tool's percentage cut to its skill's action time (10 = −10%). `heal` is the
 * hitpoints a consumable restores; `favour` is what an offering buys from the sworn god when
 * burnt. `attack`, `strength` and `defence` add to the hero's level-derived numbers; `speed`
 * is ticks added to the base swing (a spear is slower).
 */
export const StatKeySchema = z.enum([
  'attack',
  'strength',
  'defence',
  'speed',
  'gather',
  'heal',
  'favour',
]);
export type StatKey = z.infer<typeof StatKeySchema>;
export const ItemStatsSchema = z.partialRecord(StatKeySchema, z.number());
export type ItemStats = z.infer<typeof ItemStatsSchema>;

/** Corner marks layered over an item's icon. Each maps to a badge glyph in the renderer. */
export const BadgeKindSchema = z.enum([
  'enchanted',
  'upgraded',
  'burning',
  'locked',
  'cursed',
  'set',
  'poison',
]);
export type BadgeKind = z.infer<typeof BadgeKindSchema>;

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

/** A stack of one item as content refers to it (recipe inputs/outputs, guaranteed drops). */
export const ItemQtySchema = z.object({
  item: IdSchema,
  qty: z.number().int().min(1).default(1),
});
export type ItemQty = z.infer<typeof ItemQtySchema>;

export const XpBoostSchema = z.object({
  skill: IdSchema.nullable(),
  fraction: z.number().positive(),
});
export type XpBoost = z.infer<typeof XpBoostSchema>;

export const ItemDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  /** One dry line. Presentation only; may be empty for fixtures. */
  description: z.string().default(''),
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
  /**
   * Rendered from a procedural generator instead of a fixed icon. The icon is still required
   * (it is the fallback and what the icon index ships); the generator is seeded from the item id
   * until rolled item instances exist.
   */
  procedural: z.enum(['sword']).nullable().default(null),
  /** For `container` items: the table rolled once per opened item. */
  opens: DropTableOrRefSchema.nullable().default(null),
  /**
   * Worn, the item pays more xp: `fraction` on top in `skill`, or in every skill when `skill`
   * is null. A cape knows its trade; a pendant is less particular.
   */
  xpBoost: XpBoostSchema.nullable().default(null),
  /** Base sell value in coins. */
  value: z.number().int().min(0),
  tags: z.array(z.string()).default([]),
});
/** An item as authored (`opens` may be a `$ref`). */
export type ItemSource = z.infer<typeof ItemDefSchema>;
/** An item as the sim sees it: container contents resolved inline. */
export type ItemDef = Omit<ItemSource, 'opens'> & { opens: DropTable | null };

/**
 * Chance an action cycle succeeds: `min(1, base + perLevel * (level - requiredLevel))`.
 * `{ base: 1 }` never fails. Failure consumes the cycle and awards nothing.
 */
export const SuccessRuleSchema = z.object({
  base: z.number().min(0).max(1),
  perLevel: z.number().min(0).default(0),
});
export type SuccessRule = z.infer<typeof SuccessRuleSchema>;

/**
 * A gathering node: a rock for mining, a tree for woodcutting. One shape, one handler; only
 * the skill and the content list differ.
 */
export const GatherNodeDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  /** One dry line about what the node is for (or not for). Presentation only. */
  description: z.string().default(''),
  icon: IconRefSchema,
  /** Material tier the node's icon is rendered in; null for the neutral icon colour. */
  material: IdSchema.nullable().default(null),
  /** Skill level required to start. */
  level: z.number().int().min(1),
  /** Ticks per cycle (100 ms each). */
  durationTicks: z.number().int().min(1),
  /** XP awarded per successful cycle. */
  xp: z.number().min(0),
  success: SuccessRuleSchema,
  /** Each table is rolled independently on success — e.g. the ore itself plus a rare gem table. */
  drops: z.array(DropTableOrRefSchema).min(1),
  /**
   * A quick method: more xp per hour than the tier's proper node, and little worth banking.
   * The UI marks it; the progression model leaves it out of the "standard" path.
   */
  quick: z.boolean().default(false),
});
/** A node as authored (drops may be `$ref`s). */
export type GatherNodeSource = z.infer<typeof GatherNodeDefSchema>;
/** A node as the sim sees it: every drop table resolved inline. */
export type GatherNodeDef = Omit<GatherNodeSource, 'drops'> & { drops: readonly DropTable[] };
export const RockDefSchema = GatherNodeDefSchema;
export type RockDef = GatherNodeDef;
export const TreeDefSchema = GatherNodeDefSchema;
export type TreeDef = GatherNodeDef;
export const WaterDefSchema = GatherNodeDefSchema;
export type WaterDef = GatherNodeDef;
export const PatchDefSchema = GatherNodeDefSchema;
export type PatchDef = GatherNodeDef;

/** A level in another skill a recipe asks for — cooking wants a hot enough fire, say. */
export const SkillRequirementSchema = z.object({
  skill: IdSchema,
  level: z.number().int().min(1),
});
export type SkillRequirement = z.infer<typeof SkillRequirementSchema>;

/**
 * A crafting recipe: consume `inputs` from the bank, wait `durationTicks`, receive `outputs`
 * and XP in `skill`. `category` groups recipes in the UI (bars, tools, weapons, armour…).
 * `requires` adds levels in other skills; `success` is the chance the cycle pays out (cooking
 * burns at low levels) and a failed cycle still eats the inputs and yields `failOutputs`.
 */
export const RecipeDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  skill: IdSchema,
  category: z.string().min(1),
  level: z.number().int().min(1),
  requires: z.array(SkillRequirementSchema).default([]),
  durationTicks: z.number().int().min(1),
  xp: z.number().min(0),
  success: SuccessRuleSchema.default({ base: 1, perLevel: 0 }),
  inputs: z.array(ItemQtySchema).min(1),
  outputs: z.array(ItemQtySchema).default([]),
  failOutputs: z.array(ItemQtySchema).default([]),
});
export type RecipeDef = z.infer<typeof RecipeDefSchema>;

/** A combat area. `level` is the combat level the UI recommends before entering. */
export const ZoneDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().default(''),
  icon: IconRefSchema,
  level: z.number().int().min(1),
});
export type ZoneDef = z.infer<typeof ZoneDefSchema>;

/** Combat numbers shared by monsters (and, later, the player). `speed` is ticks between attacks. */
export const CombatStatsSchema = z.object({
  attack: z.number().int().min(0),
  strength: z.number().int().min(0),
  defence: z.number().int().min(0),
  speed: z.number().int().min(1),
});
export type CombatStats = z.infer<typeof CombatStatsSchema>;

/**
 * A monster. Data only until the combat loop lands: `drops` are rolled per kill, `always` is
 * guaranteed per kill, `coins` is an inclusive range per kill.
 */
export const MonsterDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().default(''),
  icon: IconRefSchema,
  material: IdSchema.nullable().default(null),
  zone: IdSchema,
  level: z.number().int().min(1),
  hp: z.number().int().min(1),
  stats: CombatStatsSchema,
  xp: z.number().min(0),
  coins: z
    .tuple([z.number().int().min(0), z.number().int().min(0)])
    .refine(([min, max]) => max >= min, 'coins max must be >= min')
    .default([0, 0]),
  drops: z.array(DropTableOrRefSchema).default([]),
  always: z.array(ItemQtySchema).default([]),
});
export type MonsterSource = z.infer<typeof MonsterDefSchema>;
export type MonsterDef = Omit<MonsterSource, 'drops'> & { drops: readonly DropTable[] };

/**
 * A god's combat boon: what favour buys while it burns in a fight. `attack`, `strength` and
 * `defence` scale the hero's number by `1 + fraction`; `regen` gives one hitpoint back every
 * `everyTicks` ticks of fighting. `name` is the boon's title ("Stone Skin"); `line` is one dry
 * line for the cards.
 */
export const CombatBoonSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['attack', 'strength', 'defence']),
    fraction: z.number().positive(),
    name: z.string().min(1),
    line: z.string().min(1),
  }),
  z.object({
    kind: z.literal('regen'),
    everyTicks: z.number().int().min(1),
    name: z.string().min(1),
    line: z.string().min(1),
  }),
]);
export type CombatBoon = z.infer<typeof CombatBoonSchema>;

/**
 * What swearing to a god does. Every perk is data keyed by skill so a new god is a content
 * entry: `xp` is a fractional bonus to xp gained in that skill (0.1 = +10%), `extraDrops`
 * rolls one more table on every successful cycle of that skill, `doubleYield` is the chance a
 * successful cycle of that skill lands twice, `combat` is the boon favour buys in a fight.
 */
export const GodPerksSchema = z.object({
  xp: z.record(IdSchema, z.number().min(0)).default({}),
  extraDrops: z.array(z.object({ skill: IdSchema, table: DropTableOrRefSchema })).default([]),
  doubleYield: z.array(z.object({ skill: IdSchema, chance: z.number().min(0).max(1) })).default([]),
  combat: CombatBoonSchema.nullable().default(null),
});
export type GodPerksSource = z.infer<typeof GodPerksSchema>;
export type GodPerks = Omit<GodPerksSource, 'extraDrops'> & {
  extraDrops: readonly { skill: string; table: DropTable }[];
};

/** A god the hero may swear to once, at the start. Copy is Screen D's. */
export const GodDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  /** "the Deep Delver" — the epithet shown beside the name. */
  title: z.string().min(1),
  icon: IconRefSchema,
  /** "God of stone, ore, and stubbornness." */
  description: z.string().default(''),
  /** The boon as one line: "+10% Mining & Smithing xp". */
  boon: z.string().min(1),
  perks: GodPerksSchema.default({ xp: {}, extraDrops: [], doubleYield: [], combat: null }),
});
export type GodSource = z.infer<typeof GodDefSchema>;
export type GodDef = Omit<GodSource, 'perks'> & { perks: GodPerks };

/** What a ware does once bought. Effects are engine-known, like a god's perks. */
export const WareEffectSchema = z.discriminatedUnion('kind', [
  /** Offline progress counts for this many hours instead of the base cap. */
  z.object({ kind: z.literal('offline-cap'), hours: z.number().positive() }),
  /** A skill's `finds` table is rolled twice per cycle. */
  z.object({ kind: z.literal('second-look') }),
  /** The sworn god lets go: the hero may swear again. */
  z.object({ kind: z.literal('release-oath') }),
]);
export type WareEffect = z.infer<typeof WareEffectSchema>;

/**
 * Something the trader sells for coins. `price × growth^bought`, rounded to 10 gp, is what it
 * costs next; a `once` ware is sold one time. `requires` is a ware that must be owned first.
 */
export const WareDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  /** One dry line. */
  line: z.string().min(1),
  icon: IconRefSchema,
  price: z.number().int().min(1),
  growth: z.number().min(1).default(1),
  once: z.boolean().default(true),
  requires: IdSchema.nullable().default(null),
  effect: WareEffectSchema,
});
export type WareDef = z.infer<typeof WareDefSchema>;

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
  trees: contentList(TreeDefSchema).default([]),
  waters: contentList(WaterDefSchema).default([]),
  /** Foraging's nodes: where offerings grow. */
  patches: contentList(PatchDefSchema).default([]),
  recipes: contentList(RecipeDefSchema).default([]),
  gods: contentList(GodDefSchema).default([]),
  zones: contentList(ZoneDefSchema).default([]),
  monsters: contentList(MonsterDefSchema).default([]),
  /** What the trader sells. */
  wares: contentList(WareDefSchema).default([]),
});
export type ContentPack = z.infer<typeof ContentPackSchema>;
