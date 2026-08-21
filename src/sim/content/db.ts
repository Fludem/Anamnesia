import {
  ContentPackSchema,
  type DropTable,
  type DropTableOrRef,
  type ItemDef,
  type RockDef,
  type SkillDef,
} from './schema.ts';

interface ResolvedPack {
  skills: readonly SkillDef[];
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
  readonly items: readonly ItemDef[];
  readonly rocks: readonly RockDef[];
  private readonly skillById: ReadonlyMap<string, SkillDef>;
  private readonly itemById: ReadonlyMap<string, ItemDef>;
  private readonly rockById: ReadonlyMap<string, RockDef>;

  private constructor(pack: ResolvedPack) {
    this.skills = pack.skills;
    this.items = pack.items;
    this.rocks = pack.rocks;
    this.skillById = new Map(pack.skills.map((s) => [s.id, s]));
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
      'item',
      pack.items.map((i) => i.id),
    );
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
    return new ContentDb({ skills: pack.skills, items: pack.items, rocks });
  }

  skill(id: string): SkillDef {
    return lookup(this.skillById, 'skill', id);
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
