/**
 * Audits the shipped content pack as a whole. The schema and ContentDb check references; this
 * checks that the content makes a game: everything is obtainable, the economy is not upside
 * down, every skill has something to do, and names and descriptions follow the house style.
 */
import { describe, expect, it } from 'vitest';
import { icons } from '../icons/registry.ts';
import type { DropTable } from '../sim/content/schema.ts';
import { DEFAULT_XP_CURVE } from '../sim/xp.ts';
import { content } from './index.ts';

const tableItems = (t: DropTable) => t.entries.map((e) => e.item);
const GATHERING = ['mining', 'woodcutting', 'fishing', 'foraging'];

/** Every item id something in the game hands out. */
function obtainable(): Set<string> {
  const out = new Set<string>();
  for (const node of [...content.rocks, ...content.trees, ...content.waters, ...content.patches])
    for (const t of node.drops) tableItems(t).forEach((i) => out.add(i));
  for (const g of content.gods)
    for (const e of g.perks.extraDrops) tableItems(e.table).forEach((i) => out.add(i));
  for (const sk of content.skills) if (sk.finds) tableItems(sk.finds).forEach((i) => out.add(i));
  for (const r of content.recipes)
    for (const o of [...r.outputs, ...r.failOutputs]) out.add(o.item);
  for (const m of content.monsters) {
    for (const t of m.drops) tableItems(t).forEach((i) => out.add(i));
    for (const a of m.always) out.add(a.item);
  }
  for (const item of content.items)
    if (item.opens !== null) tableItems(item.opens).forEach((i) => out.add(i));
  return out;
}

describe('shipped content', () => {
  it('ships the roster Phase 3 set out, plus Phase 5’s three skills, four gods and Phase 7’s foraging', () => {
    expect(content.skills.map((s) => s.id)).toEqual([
      'mining',
      'woodcutting',
      'fishing',
      'foraging',
      'firemaking',
      'cooking',
      'smithing',
      'combat',
      'hitpoints',
    ]);
    expect(content.rarities.map((r) => r.id)).toEqual(['common', 'rare', 'epic', 'legendary']);
    expect(content.rocks.length).toBe(11);
    expect(content.trees.length).toBe(10);
    expect(content.waters.length).toBe(11);
    expect(content.patches.length).toBe(11);
    expect(content.gods.map((g) => g.name)).toEqual(['Tharok', 'Vessith', 'Maren', 'Ashkar']);
    // Every god has a combat boon to burn favour on.
    for (const g of content.gods) expect(g.perks.combat, g.id).not.toBeNull();
    expect(content.zones.length).toBe(5);
    expect(content.monsters.length).toBeGreaterThanOrEqual(20);
    expect(content.items.length).toBeGreaterThanOrEqual(100);
  });

  it('every item is obtainable and every recipe input can be obtained', () => {
    const have = obtainable();
    const orphans = content.items.filter((i) => !have.has(i.id)).map((i) => i.id);
    expect(orphans).toEqual([]);
    for (const r of content.recipes)
      for (const input of r.inputs)
        expect(have.has(input.item), `${r.id} ← ${input.item}`).toBe(true);
  });

  it('every icon reference is in the shipped icon set', () => {
    const refs = [
      ...content.skills,
      ...content.items,
      ...content.rocks,
      ...content.trees,
      ...content.waters,
      ...content.patches,
      ...content.zones,
      ...content.monsters,
      ...content.gods,
      ...content.wares,
      ...content.rooms,
    ].map((x) => x.icon);
    for (const ref of refs) expect(() => icons.get(ref), ref).not.toThrow();
  });

  it('every skill has something to do and every level requirement is reachable', () => {
    for (const skill of GATHERING) expect(content.nodesFor(skill).length, skill).toBeGreaterThan(0);
    for (const skill of ['smithing', 'firemaking', 'cooking'])
      expect(content.recipesFor(skill).length, skill).toBeGreaterThan(0);
    for (const z of content.zones) expect(content.monstersIn(z.id).length, z.id).toBeGreaterThan(0);
    const max = DEFAULT_XP_CURVE.maxLevel;
    for (const x of [
      ...content.rocks,
      ...content.trees,
      ...content.waters,
      ...content.patches,
      ...content.recipes,
      ...content.zones,
    ])
      expect(x.level, x.id).toBeLessThanOrEqual(max);
    for (const r of content.recipes)
      for (const q of r.requires) expect(q.level, r.id).toBeLessThanOrEqual(max);
    // Each skill's first node/recipe is available at level 1, so a new save can start anywhere.
    for (const skill of GATHERING)
      expect(Math.min(...content.nodesFor(skill).map((n) => n.level)), skill).toBe(1);
    for (const skill of ['smithing', 'firemaking', 'cooking'])
      expect(Math.min(...content.recipesFor(skill).map((r) => r.level)), skill).toBe(1);
  });

  it('nodes get harder as they go: levels rise with the list; xp and time rise along each path', () => {
    for (const skill of GATHERING) {
      const list = content.nodesFor(skill);
      for (let i = 1; i < list.length; i++)
        expect(list[i]!.level, list[i]!.id).toBeGreaterThan(list[i - 1]!.level);
      for (const quick of [false, true]) {
        const path = list.filter((n) => n.quick === quick);
        for (let i = 1; i < path.length; i++) {
          const a = path[i - 1]!;
          const b = path[i]!;
          expect(b.xp, b.id).toBeGreaterThan(a.xp);
          expect(b.durationTicks, b.id).toBeGreaterThanOrEqual(a.durationTicks);
        }
      }
    }
  });

  it('quick nodes out-earn the tier they sit in and bank nothing worth keeping', () => {
    for (const skill of GATHERING) {
      const list = content.nodesFor(skill);
      for (const q of list.filter((n) => n.quick)) {
        const tier = [...list].reverse().find((n) => !n.quick && n.level <= q.level)!;
        const rate = (n: (typeof list)[number]) => (n.xp * n.success.base) / n.durationTicks;
        expect(rate(q), `${q.id} vs ${tier.id}`).toBeGreaterThan(rate(tier));
        // Its guaranteed drop (if any) is worth less per cycle than the tier's.
        const worth = (n: (typeof list)[number]) =>
          n.drops
            .filter((t) => t.nothingWeight === 0)
            .reduce((s, t) => s + Math.max(...t.entries.map((e) => content.item(e.item).value)), 0);
        expect(worth(q), q.id).toBeLessThan(worth(tier));
      }
    }
  });

  it('a recipe never destroys value (except a fire, which is the point), and tier recipes unlock at or after their bar', () => {
    const value = (id: string) => content.item(id).value;
    for (const r of content.recipes) {
      const inValue = r.inputs.reduce((s, i) => s + value(i.item) * i.qty, 0);
      const outValue = r.outputs.reduce((s, o) => s + value(o.item) * o.qty, 0);
      if (r.skill === 'firemaking') expect(outValue, r.id).toBeLessThanOrEqual(inValue);
      else expect(outValue, r.id).toBeGreaterThanOrEqual(inValue);
      for (const i of r.inputs) {
        const producer = content.recipes.find((p) => p.outputs.some((o) => o.item === i.item));
        if (producer)
          expect(r.level, `${r.id} needs ${producer.id}`).toBeGreaterThanOrEqual(producer.level);
      }
    }
  });

  it('equipment has a slot and stats; tools cut time; consumables heal or buy favour; nothing else has stats', () => {
    for (const item of content.items) {
      const wearable = item.class === 'weapon' || item.class === 'armour' || item.class === 'tool';
      expect(item.slot !== null, item.id).toBe(wearable);
      if (item.class === 'tool') expect(item.stats.gather, item.id).toBeGreaterThan(0);
      if (item.class === 'consumable') {
        const heal = item.stats.heal ?? 0;
        const favour = item.stats.favour ?? 0;
        expect(heal > 0 !== favour > 0, `${item.id} heals or is offered, not both`).toBe(true);
      }
      if (wearable) expect(Object.keys(item.stats).length, item.id).toBeGreaterThan(0);
      if (!wearable && item.class !== 'consumable') expect(item.stats, item.id).toEqual({});
      if (item.procedural !== null) expect(item.material, item.id).not.toBeNull();
      if (item.xpBoost !== null) expect(item.slot, item.id).not.toBeNull();
      expect(item.slot === 'ammo', item.id).toBe(item.tags.includes('ammo'));
    }
  });

  it('every body slot fills from the anvil at each tier; the capes come from the work and the beasts', () => {
    const tiers = content.materials.filter((m) => m.tier > 0 || m.id === 'copper');
    expect(tiers).toHaveLength(6);
    const smithed = new Set(content.recipes.flatMap((r) => r.outputs.map((o) => o.item)));
    for (const tier of tiers) {
      for (const slot of ['weapon', 'shield', 'head', 'body', 'legs', 'hands', 'feet', 'ammo']) {
        const piece = content.items.find((i) => i.slot === slot && i.material === tier.id);
        expect(piece, `${tier.id} ${slot}`).toBeDefined();
        expect(smithed.has(piece!.id), piece!.id).toBe(true);
      }
    }
    // Rings and necks: something to wear before silver, and something past gold.
    for (const slot of ['ring', 'amulet']) {
      const levels = content.recipes
        .filter((r) => content.item(r.outputs[0]!.item).slot === slot)
        .map((r) => r.level);
      expect(Math.min(...levels), slot).toBeLessThan(10);
      expect(Math.max(...levels), slot).toBeGreaterThan(85);
    }
    // Every skill with a screen and no fight has a cape to find, boosting its own xp.
    for (const sk of content.skills.filter((x) => x.listed && x.id !== 'combat')) {
      expect(sk.finds, sk.id).not.toBeNull();
      const capes = sk.finds!.entries.map((e) => content.item(e.item));
      expect(capes.length, sk.id).toBe(1);
      expect(capes[0]!.slot, sk.id).toBe('cape');
      expect(capes[0]!.xpBoost, sk.id).toEqual({ skill: sk.id, fraction: 0.05 });
      // One in two thousand cycles: an hour or two of work at the standard nodes.
      expect(sk.finds!.nothingWeight / sk.finds!.entries[0]!.weight).toBe(1999);
    }
    expect(content.skill('combat').finds).toBeNull();
    const beastCapes = content.monsters.filter((m) =>
      m.drops.some((t) => t.entries.some((e) => content.item(e.item).slot === 'cape')),
    );
    expect(beastCapes.map((m) => m.zone)).toEqual([
      'lower-slope',
      'the-copse',
      'the-deep',
      'the-summit',
    ]);
  });

  it('monsters belong to their zone level band and get harder up the hill', () => {
    const zones = content.zones;
    for (const m of content.monsters) {
      const zi = zones.findIndex((z) => z.id === m.zone);
      const zone = zones[zi]!;
      const next = zones[zi + 1];
      expect(m.level, m.id).toBeGreaterThanOrEqual(zone.level);
      if (next) expect(m.level, m.id).toBeLessThan(next.level);
      expect(m.drops.length + m.always.length, `${m.id} drops nothing`).toBeGreaterThan(0);
      const [min, max] = m.coins;
      expect(max).toBeGreaterThanOrEqual(min);
    }
    const byLevel = [...content.monsters].sort((a, b) => a.level - b.level);
    for (let i = 1; i < byLevel.length; i++) {
      expect(byLevel[i]!.hp, byLevel[i]!.id).toBeGreaterThanOrEqual(byLevel[i - 1]!.hp * 0.75);
    }
  });

  it('names are Title Case and unique; every description is one dry line', () => {
    const named = [
      ...content.items,
      ...content.rocks,
      ...content.trees,
      ...content.recipes,
      ...content.zones,
      ...content.monsters,
      ...content.wares,
      ...content.rooms,
    ];
    const minor = new Set(['of', 'the', 'and', 'for', 'from']);
    for (const x of named) {
      const words = x.name.split(' ');
      for (const [i, w] of words.entries()) {
        if (i > 0 && minor.has(w)) continue;
        expect(w, `${x.id}: "${x.name}"`).toMatch(/^[A-Z]/);
      }
    }
    const names = content.items.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
    const lines: [string, string][] = [
      ...[...content.items, ...content.zones, ...content.monsters].map((x): [string, string] => [
        x.id,
        x.description,
      ]),
      ...content.wares.map((w): [string, string] => [w.id, w.line]),
      ...content.rooms.map((r): [string, string] => [r.id, r.line]),
    ];
    for (const [id, line] of lines) {
      expect(line.length, id).toBeGreaterThan(0);
      expect(line.length, id).toBeLessThanOrEqual(140);
      expect(line, id).toMatch(/[.!?]$/);
      expect(line, id).not.toMatch(/\n/);
    }
  });

  it('the trader sells a lamp ladder, a second look and release from the oath; the ferryman has his coin', () => {
    const ids = content.wares.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The lamp ladder: each rung requires the one before and lasts longer.
    const lamps = content.wares.flatMap((w) =>
      w.effect.kind === 'offline-cap' ? [{ ...w, hours: w.effect.hours }] : [],
    );
    expect(lamps.length).toBeGreaterThanOrEqual(3);
    let previous: (typeof lamps)[number] | null = null;
    for (const lamp of lamps) {
      expect(lamp.requires, lamp.id).toBe(previous?.id ?? null);
      if (previous !== null) {
        expect(lamp.hours, lamp.id).toBeGreaterThan(previous.hours);
        expect(lamp.price, lamp.id).toBeGreaterThan(previous.price);
      }
      previous = lamp;
    }
    expect(lamps[0]?.hours).toBeGreaterThan(12);
    expect(lamps.at(-1)?.hours).toBe(24);
    expect(content.wares.filter((w) => w.effect.kind === 'second-look')).toHaveLength(1);
    // Release: one ware, sold again and again, from 100,000 doubling; dearer than any one-time ware.
    const release = content.wares.filter((w) => w.effect.kind === 'release-oath');
    expect(release).toHaveLength(1);
    expect(release[0]).toMatchObject({ once: false, growth: 2, price: 100_000 });
    for (const w of content.wares)
      if (w.once) expect(w.price, w.id).toBeLessThanOrEqual(release[0]!.price);
    // An obol drops somewhere, and nothing else passes for the ferryman's coin.
    const coins = content.items.filter((i) => i.tags.includes('coin'));
    expect(coins.map((i) => i.id)).toEqual(['obol']);
    expect(obtainable().has('obol')).toBe(true);
  });

  it('the hall has six rooms of three tiers, each a different perk, costed in things the hill gives', () => {
    expect(content.rooms).toHaveLength(6);
    const kinds = content.rooms.map((r) => r.tiers[0]!.perk.kind);
    expect(new Set(kinds).size).toBe(6);
    const can = obtainable();
    for (const room of content.rooms) {
      expect(room.tiers, room.id).toHaveLength(3);
      room.tiers.forEach((t, i) => {
        expect(t.cost.length, `${room.id} ${String(i + 1)}`).toBeGreaterThanOrEqual(2);
        for (const c of t.cost) {
          expect(can.has(c.item), `${room.id}: ${c.item}`).toBe(true);
          expect(['kindling', 'obol'], `${room.id}: ${c.item}`).not.toContain(c.item);
        }
        // Coins come in from the second tier: the first is raised with work alone.
        expect(t.coins > 0, `${room.id} ${String(i + 1)}`).toBe(i > 0);
      });
    }
  });

  it('the four rarities are all used, and the legendary tier is scarce', () => {
    const byRarity = new Map<string, number>();
    for (const i of content.items) byRarity.set(i.rarity, (byRarity.get(i.rarity) ?? 0) + 1);
    for (const r of content.rarities) expect(byRarity.get(r.id) ?? 0, r.id).toBeGreaterThan(0);
    expect(byRarity.get('legendary')).toBeLessThanOrEqual(5);
  });
});
