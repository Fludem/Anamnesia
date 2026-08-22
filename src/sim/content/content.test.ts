import { describe, expect, it } from 'vitest';
import { content } from '../../content/index.ts';
import { FIXTURE_PACK, fixtureContent } from '../testing/fixture.ts';
import { ContentDb, ContentError } from './db.ts';

const problems = (pack: unknown): string[] => {
  try {
    ContentDb.fromPack(pack);
  } catch (e) {
    if (e instanceof ContentError) return [...e.problems];
    throw e;
  }
  return [];
};

describe('ContentDb', () => {
  it('the shipped content pack validates', () => {
    expect(content.skills.map((s) => s.id)).toContain('mining');
    expect(content.rocks.length).toBeGreaterThan(0);
    for (const rock of content.rocks) {
      expect(rock.drops.length).toBeGreaterThanOrEqual(1);
      for (const t of rock.drops) expect('$ref' in t).toBe(false);
    }
  });

  it('resolves $ref drop tables inline and ignores $-prefixed keys', () => {
    const flaky = fixtureContent.rock('flaky-rock');
    expect(flaky.drops).toHaveLength(2);
    expect(flaky.drops[1]).toEqual({
      rolls: 1,
      nothingWeight: 8,
      entries: [
        { item: 'gem', weight: 1, quantity: [1, 1] },
        { item: 'rare-gem', weight: 1, quantity: [1, 1] },
      ],
    });
    expect(
      problems({ ...FIXTURE_PACK, tables: { ...FIXTURE_PACK.tables, $comment: 'hi' } }),
    ).toEqual([]);
  });

  it('reports every cross-reference problem at once', () => {
    const bad = {
      ...FIXTURE_PACK,
      items: [...FIXTURE_PACK.items, FIXTURE_PACK.items[0]],
      rocks: [
        ...FIXTURE_PACK.rocks,
        {
          ...FIXTURE_PACK.rocks[0],
          id: 'broken',
          drops: [{ entries: [{ item: 'nope', weight: 1 }] }, { $ref: 'missing' }],
        },
      ],
    };
    const list = problems(bad);
    expect(list).toContain('duplicate item id "stone"');
    expect(list).toContain('rock "broken" drops[0]: drop references unknown item "nope"');
    expect(list).toContain('rock "broken" drops[1]: unknown drop table "missing"');
    expect(list).toHaveLength(3);
  });

  it('rejects shape errors with a path', () => {
    const list = problems({
      ...FIXTURE_PACK,
      rocks: [{ ...FIXTURE_PACK.rocks[0], durationTicks: 0 }],
    });
    expect(list[0]).toMatch(/^rocks\.0\.durationTicks/);
  });

  it('nodes without their skill are a content error', () => {
    expect(problems({ ...FIXTURE_PACK, skills: [] })).toEqual([
      'rocks exist but there is no "mining" skill',
      'trees exist but there is no "woodcutting" skill',
      'recipe "bar": unknown skill "smithing"',
      'recipe "gated-bar": unknown skill "smithing"',
    ]);
  });

  it('checks recipes, zones, monsters, containers, tools and procedural flags', () => {
    const list = problems({
      ...FIXTURE_PACK,
      items: [
        ...FIXTURE_PACK.items,
        { id: 'hat', name: 'Hat', icon: 'sbed/helmet', class: 'armour', slot: 'pickaxe', value: 1 },
        { id: 'saw', name: 'Saw', icon: 'lorc/wood-axe', class: 'tool', slot: 'weapon', value: 1 },
        { id: 'nest', name: 'Nest', icon: 'delapouite/nest-eggs', class: 'container', value: 1 },
        { id: 'box', name: 'Box', icon: 'delapouite/chest', opens: { $ref: 'gems' }, value: 1 },
        { id: 'wand', name: 'Wand', icon: 'lorc/wood-axe', procedural: 'sword', value: 1 },
      ],
      recipes: [
        ...FIXTURE_PACK.recipes,
        {
          id: 'bad',
          name: 'Bad',
          skill: 'alchemy',
          category: 'x',
          level: 1,
          durationTicks: 1,
          xp: 0,
          inputs: [{ item: 'nope' }],
          outputs: [{ item: 'bar' }],
        },
      ],
      monsters: [
        {
          id: 'goat',
          name: 'Goat',
          icon: 'skoll/goat',
          zone: 'nowhere',
          level: 1,
          hp: 1,
          stats: { attack: 0, strength: 0, defence: 0, speed: 1 },
          xp: 0,
          drops: [{ $ref: 'missing' }],
          always: [{ item: 'nope' }],
        },
      ],
    });
    expect(list).toEqual([
      'item "hat": only tools go in the "pickaxe" slot',
      'item "saw": tools go in a tool slot',
      'item "nest": a container must say what it opens into',
      'item "box": only containers can be opened',
      'item "wand": only weapons are procedural',
      'recipe "bad": unknown skill "alchemy"',
      'recipe "bad" inputs: unknown item "nope"',
      'monster "goat": unknown zone "nowhere"',
      'monster "goat" always: unknown item "nope"',
      'monster "goat" drops[0]: unknown drop table "missing"',
    ]);
  });

  it('resolves container contents and exposes trees, recipes, zones and monsters', () => {
    const db = ContentDb.fromPack({
      ...FIXTURE_PACK,
      items: [
        ...FIXTURE_PACK.items,
        {
          id: 'nest',
          name: 'Nest',
          icon: 'delapouite/nest-eggs',
          class: 'container',
          opens: { $ref: 'gems' },
          value: 1,
        },
      ],
      zones: [{ id: 'slope', name: 'Slope', icon: 'lorc/crags', level: 1 }],
      monsters: [
        {
          id: 'goat',
          name: 'Goat',
          icon: 'skoll/goat',
          zone: 'slope',
          level: 1,
          hp: 1,
          stats: { attack: 0, strength: 0, defence: 0, speed: 1 },
          xp: 0,
          drops: [{ $ref: 'gems' }],
        },
      ],
    });
    expect(db.item('nest').opens?.entries.map((e) => e.item)).toEqual(['gem', 'rare-gem']);
    expect(db.item('stone').opens).toBeNull();
    expect(db.tree('sure-tree').drops).toHaveLength(1);
    expect(db.recipesFor('smithing').map((r) => r.id)).toEqual(['bar', 'gated-bar']);
    expect(db.monstersIn('slope').map((m) => m.id)).toEqual(['goat']);
    expect(db.monster('goat').drops[0]?.nothingWeight).toBe(8);
    expect(db.zone('slope').level).toBe(1);
  });

  it('lookups throw on unknown ids (a content bug, not a fallback)', () => {
    expect(() => fixtureContent.rock('nope')).toThrow(/unknown rock/);
    expect(() => fixtureContent.item('nope')).toThrow(/unknown item/);
    expect(fixtureContent.hasRock('sure-rock')).toBe(true);
    expect(fixtureContent.hasItem('nope')).toBe(false);
  });
});
