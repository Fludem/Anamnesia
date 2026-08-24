/**
 * Audits the shipped content pack as a whole. The schema and ContentDb check references; this
 * checks that the content makes a game: everything is obtainable, the economy is not upside
 * down, every skill has something to do, and names and descriptions follow the house style.
 */
import { OFFLINE_CAP_MS } from '../sim/constants.ts';
import { describe, expect, it } from 'vitest';
import { icons } from '../icons/registry.ts';
import type { DropTable } from '../sim/content/schema.ts';
import { trophyLevel } from '../sim/records.ts';
import { DEFAULT_XP_CURVE } from '../sim/xp.ts';
import { content } from './index.ts';

const tableItems = (t: DropTable) => t.entries.map((e) => e.item);
const GATHERING = ['mining', 'woodcutting', 'fishing', 'foraging'];
const CRAFTING = ['smithing', 'firemaking', 'cooking', 'sorcery'];
const MAX_LEVEL = DEFAULT_XP_CURVE.maxLevel;

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
  it('ships the roster Phase 3 set out, plus Phase 5’s three skills, four gods, Phase 7’s foraging and Phase 16’s sorcery', () => {
    expect(content.skills.map((s) => s.id)).toEqual([
      'mining',
      'woodcutting',
      'fishing',
      'foraging',
      'firemaking',
      'cooking',
      'smithing',
      'sorcery',
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
    for (const skill of CRAFTING)
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
    for (const skill of CRAFTING)
      expect(Math.min(...content.recipesFor(skill).map((r) => r.level)), skill).toBe(1);
  });

  it('every monster is weak to one fight, and every zone has work for both', () => {
    for (const z of content.zones) {
      const weak = new Set(content.monstersIn(z.id).map((m) => m.weak));
      expect(weak.has('melee'), `${z.id} wants a monster weak to melee`).toBe(true);
      expect(weak.has('sorcery'), `${z.id} wants a monster weak to sorcery`).toBe(true);
    }
  });

  it('a style belongs to a weapon or its ammo; a sorcerer has a staff and marks at every tier', () => {
    for (const item of content.items) {
      if (item.style !== 'melee') expect(['weapon', 'ammo'], item.id).toContain(item.slot);
    }
    const inscribed = new Set(
      content.recipesFor('sorcery').flatMap((r) => r.outputs.map((o) => o.item)),
    );
    const tiers = content.materials.filter((m) => m.tier > 0 || m.id === 'copper');
    for (const tier of tiers) {
      const mark = content.items.find(
        (i) => i.slot === 'ammo' && i.style === 'sorcery' && i.material === tier.id,
      );
      expect(mark, `${tier.id} mark`).toBeDefined();
      expect(inscribed.has(mark!.id), mark!.id).toBe(true);
    }
    const staffs = content.items.filter((i) => i.slot === 'weapon' && i.style === 'sorcery');
    expect(staffs).toHaveLength(tiers.length);
    for (const staff of staffs) expect(inscribed.has(staff.id), staff.id).toBe(true);
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

  it('every raw fish is weighed, and only a raw fish is', () => {
    const raw = content.items.filter((i) => i.tags.includes('fish') && i.tags.includes('raw'));
    expect(raw.length).toBe(11);
    for (const fish of raw) expect(fish.size, fish.id).not.toBeNull();
    for (const item of content.items) {
      if (item.size === null) continue;
      expect(item.tags, item.id).toContain('raw');
      expect(item.size.max, item.id).toBeGreaterThan(item.size.min);
      // Room for the curve to matter: a band that barely opens is not worth going back for.
      expect(item.size.max / item.size.min, item.id).toBeGreaterThan(5);
    }
  });

  it('the standard waters give bigger fish as they go; the quick ones stay small', () => {
    const fishOf = (water: (typeof content.waters)[number]) =>
      water.drops
        .flatMap((t) => t.entries.map((e) => content.item(e.item)))
        .find((i) => i.size !== null) ?? null;
    const banded = content.waters.map((w) => ({ water: w, fish: fishOf(w) }));
    for (const { water, fish } of banded) expect(fish, water.id).not.toBeNull();

    const ladder = banded.filter(({ water }) => !water.quick);
    for (let i = 1; i < ladder.length; i++) {
      const a = ladder[i - 1]!.fish!.size!;
      const b = ladder[i]!.fish!.size!;
      expect(b.min, ladder[i]!.water.id).toBeGreaterThan(a.min);
      expect(b.max, ladder[i]!.water.id).toBeGreaterThan(a.max);
    }
    // A quick water's fish is smaller than what the tier below it gives, like its drop value.
    for (const { water, fish } of banded.filter(({ water }) => water.quick)) {
      const tier = [...ladder].reverse().find(({ water: w }) => w.level <= water.level);
      if (tier) expect(fish!.size!.max, water.id).toBeLessThan(tier.fish!.size!.max);
    }
  });

  it('a trophy pays a bounty that climbs with the level its line opens at', () => {
    const bounties = content.waters
      .map((w) => {
        const fish = w.drops
          .flatMap((t) => t.entries.map((e) => content.item(e.item)))
          .find((i) => i.size !== null);
        return { level: trophyLevel(w.level, MAX_LEVEL), bounty: fish?.size?.bounty ?? 0 };
      })
      .sort((a, b) => a.level - b.level);
    for (const b of bounties) expect(b.bounty).toBeGreaterThan(0);
    for (let i = 1; i < bounties.length; i++)
      expect(bounties[i]!.bounty).toBeGreaterThanOrEqual(bounties[i - 1]!.bounty);
    // Every line opens on the way up, and the last of them not before the cap.
    expect(bounties[0]!.level).toBeLessThan(MAX_LEVEL / 2);
    expect(bounties[bounties.length - 1]!.level).toBe(MAX_LEVEL);
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

  it('a trophy is a kill and a smith: a part only a beast leaves, and the combat level it asks', () => {
    const fromNodes = new Set<string>();
    for (const node of [...content.rocks, ...content.trees, ...content.waters, ...content.patches])
      for (const t of node.drops) tableItems(t).forEach((i) => fromNodes.add(i));
    for (const item of content.items)
      if (item.opens !== null) tableItems(item.opens).forEach((i) => fromNodes.add(i));
    const fromBench = new Set(content.recipes.flatMap((r) => r.outputs.map((o) => o.item)));
    const fromBeasts = new Set<string>();
    for (const m of content.monsters) {
      for (const t of m.drops) tableItems(t).forEach((i) => fromBeasts.add(i));
      for (const a of m.always) fromBeasts.add(a.item);
    }

    const trophies = content.recipes.filter((r) => r.category === 'trophies');
    expect(trophies.length).toBeGreaterThan(0);
    for (const r of trophies) {
      // Something in it comes off a beast and nowhere else: that is what makes it a trophy.
      const beastly = r.inputs.filter(
        (i) => fromBeasts.has(i.item) && !fromNodes.has(i.item) && !fromBench.has(i.item),
      );
      expect(beastly.length, `${r.id} asks for nothing a beast leaves`).toBeGreaterThan(0);
      // And it says so: a trophy is gated on the fight as well as the anvil.
      const fight = r.requires.find((q) => q.skill === 'combat');
      expect(fight, `${r.id} does not ask for a combat level`).toBeDefined();
      // The beast that leaves the part is worth that level: some monster dropping it is at or
      // above what the recipe asks, so the requirement is never a level nothing on the hill meets.
      for (const input of beastly) {
        const leaves = content.monsters.filter(
          (m) =>
            m.always.some((a) => a.item === input.item) ||
            m.drops.some((t) => tableItems(t).includes(input.item)),
        );
        expect(
          leaves.some((m) => m.level >= fight!.level),
          `${r.id}: nothing that leaves ${input.item} is Lv ${String(fight!.level)} or above`,
        ).toBe(true);
      }
      // A trophy is worn, never a stack of stuff.
      for (const out of r.outputs) expect(content.item(out.item).slot, out.item).not.toBeNull();
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
    expect(lamps[0]?.hours).toBeGreaterThan(OFFLINE_CAP_MS / 3_600_000);
    expect(lamps.at(-1)?.hours).toBe(24);
    expect(content.wares.filter((w) => w.effect.kind === 'second-look')).toHaveLength(1);
    // Release: one ware, sold again and again, from 100,000 doubling.
    const release = content.wares.filter((w) => w.effect.kind === 'release-oath');
    expect(release).toHaveLength(1);
    expect(release[0]).toMatchObject({ once: false, growth: 2, price: 100_000 });
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
    // Where a thing comes from, for the spread check: a node's skill, a recipe's, or the fight.
    const skillsOf = (item: string): Set<string> => {
      const out = new Set<string>();
      for (const sk of content.skills)
        if (
          content
            .nodesFor(sk.id)
            .some((n) => n.drops.some((t) => t.entries.some((e) => e.item === item)))
        )
          out.add(sk.id);
      for (const r of content.recipes) if (r.outputs.some((o) => o.item === item)) out.add(r.skill);
      if (content.monsters.some((m) => m.drops.some((t) => t.entries.some((e) => e.item === item))))
        out.add('combat');
      return out;
    };
    for (const room of content.rooms) {
      expect(room.tiers, room.id).toHaveLength(3);
      room.tiers.forEach((t, i) => {
        const where = `${room.id} ${String(i + 1)}`;
        // Every tier reaches across the hall: at least five things from at least four skills.
        expect(t.cost.length, where).toBeGreaterThanOrEqual(5);
        const skills = new Set(t.cost.flatMap((c) => [...skillsOf(c.item)]));
        expect(skills.size, `${where}: ${[...skills].join(', ')}`).toBeGreaterThanOrEqual(4);
        expect(new Set(t.cost.map((c) => c.item)).size, where).toBe(t.cost.length);
        for (const c of t.cost) {
          expect(can.has(c.item), `${room.id}: ${c.item}`).toBe(true);
          expect(['kindling', 'obol'], `${room.id}: ${c.item}`).not.toContain(c.item);
        }
        // Coins come in from the second tier: the first is raised with work alone.
        expect(t.coins > 0, where).toBe(i > 0);
      });
      // Each tier asks for a good deal more than the last, in things and in coin.
      const units = room.tiers.map((t) => t.cost.reduce((n, c) => n + c.qty, 0));
      expect(units[1]!, room.id).toBeGreaterThan(units[0]! * 2);
      expect(units[2]!, room.id).toBeGreaterThan(units[1]! * 2);
      expect(room.tiers[2]!.coins, room.id).toBeGreaterThanOrEqual(room.tiers[1]!.coins * 5);
    }
  });

  it('the four rarities are all used, and the legendary tier is scarce', () => {
    const byRarity = new Map<string, number>();
    for (const i of content.items) byRarity.set(i.rarity, (byRarity.get(i.rarity) ?? 0) + 1);
    for (const r of content.rarities) expect(byRarity.get(r.id) ?? 0, r.id).toBeGreaterThan(0);
    expect(byRarity.get('legendary')).toBeLessThanOrEqual(5);
  });
});
