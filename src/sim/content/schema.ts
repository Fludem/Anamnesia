import { z } from 'zod';

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

export const ItemDefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  icon: IconRefSchema,
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

/** The raw shape of a whole content pack before cross-reference checks. */
export const ContentPackSchema = z.object({
  skills: z.array(SkillDefSchema),
  items: z.array(ItemDefSchema),
  /** Named drop tables shared between nodes. Keys starting with `$` are ignored (comments). */
  tables: z.preprocess(stripDollarKeys, z.record(z.string(), DropTableSchema)).default({}),
  rocks: z.array(RockDefSchema),
});
export type ContentPack = z.infer<typeof ContentPackSchema>;
