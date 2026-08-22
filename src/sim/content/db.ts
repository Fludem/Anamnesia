import {
  ContentPackSchema,
  type DropTable,
  type DropTableOrRef,
  type ItemDef,
  type MaterialDef,
  type RarityDef,
  type RockDef,
  type SkillDef,
} from './schema.ts';

interface ResolvedPack {
  skills: readonly SkillDef[];
  materials: readonly MaterialDef[];
  rarities: readonly RarityDef[];
  items: readonly ItemDef[];
  rocks: readonly RockDef[];
}

export class ContentError extends Error {
  override readonly name = 'ContentError';
  constructor(readonly problems: readonly string[]) {
    super(`content is invalid:\n  ${problems.join('\n  ')}`);
  }
}

/** Validated, cross-checked, indexed content. Read-only; the sim is handed one of these. */
export class ContentDb {
  readonly skills: readonly SkillDef[];
  readonly materials: readonly MaterialDef[];
  /** Sorted by rank ascending. */
  readonly rarities: readonly RarityDef[];
  readonly items: readonly ItemDef[];
  readonly rocks: readonly RockDef[];
  private readonly skillById: ReadonlyMap<string, SkillDef>;
  private readonly materialById: ReadonlyMap<string, MaterialDef>;
  private readonly rarityById: ReadonlyMap<string, RarityDef>;
  private readonly itemById: ReadonlyMap<string, ItemDef>;
  private readonly rockById: ReadonlyMap<string, RockDef>;

  private constructor(pack: ResolvedPack) {
    this.skills = pack.skills;
    this.materials = pack.materials;
    this.rarities = [...pack.rarities].sort((a, b) => a.rank - b.rank);
    this.items = pack.items;
    this.rocks = pack.rocks;
    this.skillById = new Map(pack.skills.map((s) => [s.id, s]));
    this.materialById = new Map(pack.materials.map((m) => [m.id, m]));
    this.rarityById = new Map(pack.rarities.map((r) => [r.id, r]));
    this.itemById = new Map(pack.items.map((i) => [i.id, i]));
    this.rockById = new Map(pack.rocks.map((r) => [r.id, r]));
  }

  /** Validate shape, then every cross-reference. Throws `ContentError` listing all problems. */
  static fromPack(raw: unknown): ContentDb {
    const parsed = ContentPackSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ContentError(
        parsed.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`),
      );
    }
    const pack = parsed.data;
    const problems: string[] = [];
    const tables = new Map(Object.entries(pack.tables));
    const resolve = (owner: string, t: DropTableOrRef): DropTable | null => {
      if (!('$ref' in t)) return t;
      const found = tables.get(t.$ref);
      if (!found) problems.push(`${owner}: unknown drop table "${t.$ref}"`);
      return found ?? null;
    };
    const dupes = (label: string, ids: string[]): void => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) problems.push(`duplicate ${label} id "${id}"`);
        seen.add(id);
      }
    };
    dupes(
      'skill',
      pack.skills.map((s) => s.id),
    );
    dupes(
      'material',
      pack.materials.map((m) => m.id),
    );
    dupes(
      'rarity',
      pack.rarities.map((r) => r.id),
    );
    dupes(
      'item',
      pack.items.map((i) => i.id),
    );

    const materialIds = new Set(pack.materials.map((m) => m.id));
    const rarityIds = new Set(pack.rarities.map((r) => r.id));
    for (const item of pack.items) {
      if (item.material !== null && !materialIds.has(item.material))
        problems.push(`item "${item.id}": unknown material "${item.material}"`);
      if (!rarityIds.has(item.rarity))
        problems.push(`item "${item.id}": unknown rarity "${item.rarity}"`);
      if (
        item.slot !== null &&
        item.class !== 'weapon' &&
        item.class !== 'armour' &&
        item.class !== 'tool'
      )
        problems.push(`item "${item.id}": class "${item.class}" cannot have an equipment slot`);
    }
    for (const rock of pack.rocks) {
      if (rock.material !== null && !materialIds.has(rock.material))
        problems.push(`rock "${rock.id}": unknown material "${rock.material}"`);
    }
    dupes(
      'rock',
      pack.rocks.map((r) => r.id),
    );

    const itemIds = new Set(pack.items.map((i) => i.id));
    const checkTable = (owner: string, table: DropTable): void => {
      for (const e of table.entries) {
        if (!itemIds.has(e.item))
          problems.push(`${owner}: drop references unknown item "${e.item}"`);
      }
    };
    for (const [name, table] of tables) checkTable(`table "${name}"`, table);
    if (!pack.skills.some((s) => s.id === 'mining') && pack.rocks.length > 0) {
      problems.push('rocks exist but there is no "mining" skill');
    }
    const rocks: RockDef[] = pack.rocks.map((rock) => ({
      ...rock,
      drops: rock.drops.flatMap((t, i) => {
        const owner = `rock "${rock.id}" drops[${String(i)}]`;
        const table = resolve(owner, t);
        if (table === null) return [];
        if (!('$ref' in t)) checkTable(owner, table);
        return [table];
      }),
    }));
    if (problems.length) throw new ContentError(problems);
    return new ContentDb({
      skills: pack.skills,
      materials: pack.materials,
      rarities: pack.rarities,
      items: pack.items,
      rocks,
    });
  }

  skill(id: string): SkillDef {
    return lookup(this.skillById, 'skill', id);
  }
  material(id: string): MaterialDef {
    return lookup(this.materialById, 'material', id);
  }
  rarity(id: string): RarityDef {
    return lookup(this.rarityById, 'rarity', id);
  }
  item(id: string): ItemDef {
    return lookup(this.itemById, 'item', id);
  }
  rock(id: string): RockDef {
    return lookup(this.rockById, 'rock', id);
  }
  hasItem(id: string): boolean {
    return this.itemById.has(id);
  }
  hasRock(id: string): boolean {
    return this.rockById.has(id);
  }
}

function lookup<T>(map: ReadonlyMap<string, T>, kind: string, id: string): T {
  const v = map.get(id);
  if (v === undefined) throw new Error(`unknown ${kind} "${id}"`);
  return v;
}
