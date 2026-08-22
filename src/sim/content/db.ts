import { isToolSlot } from '../slots.ts';
import {
  ContentPackSchema,
  type DropTable,
  type DropTableOrRef,
  type GatherNodeDef,
  type GodDef,
  type ItemDef,
  type ItemSource,
  type MaterialDef,
  type MonsterDef,
  type RarityDef,
  type RecipeDef,
  type RockDef,
  type SkillDef,
  type TreeDef,
  type WaterDef,
  type ZoneDef,
} from './schema.ts';

interface ResolvedPack {
  skills: readonly SkillDef[];
  materials: readonly MaterialDef[];
  rarities: readonly RarityDef[];
  items: readonly ItemDef[];
  rocks: readonly RockDef[];
  trees: readonly TreeDef[];
  waters: readonly WaterDef[];
  recipes: readonly RecipeDef[];
  zones: readonly ZoneDef[];
  monsters: readonly MonsterDef[];
  gods: readonly GodDef[];
}

export class ContentError extends Error {
  override readonly name = 'ContentError';
  constructor(readonly problems: readonly string[]) {
    super(`content is invalid:\n  ${problems.join('\n  ')}`);
  }
}

/** Which classes may sit in an equipment slot. Tools only in tool slots, and vice versa. */
function slotAllowed(item: ItemSource): string | null {
  if (item.slot === null) return null;
  if (item.class === 'tool') return isToolSlot(item.slot) ? null : 'tools go in a tool slot';
  if (isToolSlot(item.slot)) return `only tools go in the "${item.slot}" slot`;
  if (item.class !== 'weapon' && item.class !== 'armour')
    return `class "${item.class}" cannot have an equipment slot`;
  return null;
}

/** Validated, cross-checked, indexed content. Read-only; the sim is handed one of these. */
export class ContentDb {
  readonly skills: readonly SkillDef[];
  readonly materials: readonly MaterialDef[];
  /** Sorted by rank ascending. */
  readonly rarities: readonly RarityDef[];
  readonly items: readonly ItemDef[];
  readonly rocks: readonly RockDef[];
  readonly trees: readonly TreeDef[];
  readonly waters: readonly WaterDef[];
  readonly recipes: readonly RecipeDef[];
  /** Sorted by recommended level ascending. */
  readonly zones: readonly ZoneDef[];
  readonly monsters: readonly MonsterDef[];
  /** In authored order — the order Screen D lists them. */
  readonly gods: readonly GodDef[];
  private readonly skillById: ReadonlyMap<string, SkillDef>;
  private readonly materialById: ReadonlyMap<string, MaterialDef>;
  private readonly rarityById: ReadonlyMap<string, RarityDef>;
  private readonly itemById: ReadonlyMap<string, ItemDef>;
  private readonly rockById: ReadonlyMap<string, RockDef>;
  private readonly treeById: ReadonlyMap<string, TreeDef>;
  private readonly waterById: ReadonlyMap<string, WaterDef>;
  private readonly recipeById: ReadonlyMap<string, RecipeDef>;
  private readonly godById: ReadonlyMap<string, GodDef>;
  private readonly zoneById: ReadonlyMap<string, ZoneDef>;
  private readonly monsterById: ReadonlyMap<string, MonsterDef>;

  private constructor(pack: ResolvedPack) {
    this.skills = pack.skills;
    this.materials = pack.materials;
    this.rarities = [...pack.rarities].sort((a, b) => a.rank - b.rank);
    this.items = pack.items;
    this.rocks = pack.rocks;
    this.trees = pack.trees;
    this.waters = pack.waters;
    this.recipes = pack.recipes;
    this.zones = [...pack.zones].sort((a, b) => a.level - b.level);
    this.monsters = pack.monsters;
    this.gods = pack.gods;
    this.skillById = new Map(pack.skills.map((s) => [s.id, s]));
    this.materialById = new Map(pack.materials.map((m) => [m.id, m]));
    this.rarityById = new Map(pack.rarities.map((r) => [r.id, r]));
    this.itemById = new Map(pack.items.map((i) => [i.id, i]));
    this.rockById = new Map(pack.rocks.map((r) => [r.id, r]));
    this.treeById = new Map(pack.trees.map((t) => [t.id, t]));
    this.waterById = new Map(pack.waters.map((w) => [w.id, w]));
    this.recipeById = new Map(pack.recipes.map((r) => [r.id, r]));
    this.godById = new Map(pack.gods.map((g) => [g.id, g]));
    this.zoneById = new Map(pack.zones.map((z) => [z.id, z]));
    this.monsterById = new Map(pack.monsters.map((m) => [m.id, m]));
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
    const itemIds = new Set(pack.items.map((i) => i.id));
    const skillIds = new Set(pack.skills.map((s) => s.id));
    const materialIds = new Set(pack.materials.map((m) => m.id));
    const rarityIds = new Set(pack.rarities.map((r) => r.id));
    const zoneIds = new Set(pack.zones.map((z) => z.id));

    const checkTable = (owner: string, table: DropTable): void => {
      for (const e of table.entries) {
        if (!itemIds.has(e.item))
          problems.push(`${owner}: drop references unknown item "${e.item}"`);
      }
    };
    /** Resolve a `$ref` (checking named tables once, below) or check an inline table now. */
    const resolve = (owner: string, t: DropTableOrRef): DropTable | null => {
      if (!('$ref' in t)) {
        checkTable(owner, t);
        return t;
      }
      const found = tables.get(t.$ref);
      if (!found) problems.push(`${owner}: unknown drop table "${t.$ref}"`);
      return found ?? null;
    };
    const resolveAll = (owner: string, list: readonly DropTableOrRef[]): DropTable[] =>
      list.flatMap((t, i) => {
        const table = resolve(`${owner} drops[${String(i)}]`, t);
        return table === null ? [] : [table];
      });
    const dupes = (label: string, ids: readonly string[]): void => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) problems.push(`duplicate ${label} id "${id}"`);
        seen.add(id);
      }
    };
    const checkItemQty = (owner: string, list: readonly { item: string }[]): void => {
      for (const q of list)
        if (!itemIds.has(q.item)) problems.push(`${owner}: unknown item "${q.item}"`);
    };
    const checkMaterial = (owner: string, material: string | null): void => {
      if (material !== null && !materialIds.has(material))
        problems.push(`${owner}: unknown material "${material}"`);
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
    dupes(
      'rock',
      pack.rocks.map((r) => r.id),
    );
    dupes(
      'tree',
      pack.trees.map((t) => t.id),
    );
    dupes(
      'water',
      pack.waters.map((w) => w.id),
    );
    dupes(
      'god',
      pack.gods.map((g) => g.id),
    );
    dupes(
      'recipe',
      pack.recipes.map((r) => r.id),
    );
    dupes(
      'zone',
      pack.zones.map((z) => z.id),
    );
    dupes(
      'monster',
      pack.monsters.map((m) => m.id),
    );
    for (const [name, table] of tables) checkTable(`table "${name}"`, table);

    const items: ItemDef[] = pack.items.map((item) => {
      const owner = `item "${item.id}"`;
      checkMaterial(owner, item.material);
      if (!rarityIds.has(item.rarity)) problems.push(`${owner}: unknown rarity "${item.rarity}"`);
      const slotProblem = slotAllowed(item);
      if (slotProblem !== null) problems.push(`${owner}: ${slotProblem}`);
      if (item.procedural !== null && item.class !== 'weapon')
        problems.push(`${owner}: only weapons are procedural`);
      if (item.opens !== null && item.class !== 'container')
        problems.push(`${owner}: only containers can be opened`);
      if (item.opens === null && item.class === 'container')
        problems.push(`${owner}: a container must say what it opens into`);
      const opens = item.opens === null ? null : resolve(`${owner} opens`, item.opens);
      return { ...item, opens };
    });

    const node = (kind: string, skill: string, n: (typeof pack.rocks)[number]): GatherNodeDef => {
      const owner = `${kind} "${n.id}"`;
      checkMaterial(owner, n.material);
      if (!skillIds.has(skill)) problems.push(`${kind}s exist but there is no "${skill}" skill`);
      return { ...n, drops: resolveAll(owner, n.drops) };
    };
    const rocks = pack.rocks.map((r) => node('rock', 'mining', r));
    const trees = pack.trees.map((t) => node('tree', 'woodcutting', t));
    const waters = pack.waters.map((w) => node('water', 'fishing', w));

    for (const recipe of pack.recipes) {
      const owner = `recipe "${recipe.id}"`;
      if (!skillIds.has(recipe.skill)) problems.push(`${owner}: unknown skill "${recipe.skill}"`);
      for (const r of recipe.requires) {
        if (!skillIds.has(r.skill)) problems.push(`${owner}: requires unknown skill "${r.skill}"`);
        if (r.skill === recipe.skill)
          problems.push(`${owner}: requires its own skill; use "level" for that`);
      }
      checkItemQty(`${owner} inputs`, recipe.inputs);
      checkItemQty(`${owner} outputs`, recipe.outputs);
      checkItemQty(`${owner} failOutputs`, recipe.failOutputs);
      if (recipe.outputs.length === 0 && recipe.failOutputs.length > 0)
        problems.push(`${owner}: has failOutputs but no outputs`);
    }

    const gods: GodDef[] = pack.gods.map((g) => {
      const owner = `god "${g.id}"`;
      for (const skill of Object.keys(g.perks.xp))
        if (!skillIds.has(skill)) problems.push(`${owner}: xp perk for unknown skill "${skill}"`);
      for (const d of g.perks.doubleYield)
        if (!skillIds.has(d.skill))
          problems.push(`${owner}: doubleYield for unknown skill "${d.skill}"`);
      const extraDrops = g.perks.extraDrops.flatMap((e) => {
        if (!skillIds.has(e.skill))
          problems.push(`${owner}: extraDrops for unknown skill "${e.skill}"`);
        const table = resolve(`${owner} extraDrops(${e.skill})`, e.table);
        return table === null ? [] : [{ skill: e.skill, table }];
      });
      return { ...g, perks: { ...g.perks, extraDrops } };
    });

    const monsters: MonsterDef[] = pack.monsters.map((m) => {
      const owner = `monster "${m.id}"`;
      checkMaterial(owner, m.material);
      if (!zoneIds.has(m.zone)) problems.push(`${owner}: unknown zone "${m.zone}"`);
      checkItemQty(`${owner} always`, m.always);
      return { ...m, drops: resolveAll(owner, m.drops) };
    });
    // Duplicate problems from a table checked through several owners are not informative.
    const unique = [...new Set(problems)];
    if (unique.length) throw new ContentError(unique);
    return new ContentDb({
      skills: pack.skills,
      materials: pack.materials,
      rarities: pack.rarities,
      items,
      rocks,
      trees,
      waters,
      recipes: pack.recipes,
      zones: pack.zones,
      monsters,
      gods,
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
  tree(id: string): TreeDef {
    return lookup(this.treeById, 'tree', id);
  }
  water(id: string): WaterDef {
    return lookup(this.waterById, 'water', id);
  }
  god(id: string): GodDef {
    return lookup(this.godById, 'god', id);
  }
  recipe(id: string): RecipeDef {
    return lookup(this.recipeById, 'recipe', id);
  }
  zone(id: string): ZoneDef {
    return lookup(this.zoneById, 'zone', id);
  }
  monster(id: string): MonsterDef {
    return lookup(this.monsterById, 'monster', id);
  }
  hasItem(id: string): boolean {
    return this.itemById.has(id);
  }
  hasRock(id: string): boolean {
    return this.rockById.has(id);
  }
  hasTree(id: string): boolean {
    return this.treeById.has(id);
  }
  hasWater(id: string): boolean {
    return this.waterById.has(id);
  }
  hasGod(id: string): boolean {
    return this.godById.has(id);
  }
  hasRecipe(id: string): boolean {
    return this.recipeById.has(id);
  }
  /** The gathering nodes a skill trains on, or an empty list for crafting skills. */
  nodesFor(skill: string): readonly GatherNodeDef[] {
    switch (skill) {
      case 'mining':
        return this.rocks;
      case 'woodcutting':
        return this.trees;
      case 'fishing':
        return this.waters;
      default:
        return [];
    }
  }
  /** Recipes for one skill in authored order. */
  recipesFor(skill: string): RecipeDef[] {
    return this.recipes.filter((r) => r.skill === skill);
  }
  /** Monsters of one zone in authored order. */
  monstersIn(zone: string): MonsterDef[] {
    return this.monsters.filter((m) => m.zone === zone);
  }
}

function lookup<T>(map: ReadonlyMap<string, T>, kind: string, id: string): T {
  const v = map.get(id);
  if (v === undefined) throw new Error(`unknown ${kind} "${id}"`);
  return v;
}
