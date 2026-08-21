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

  it('rocks without a mining skill are a content error', () => {
    expect(problems({ ...FIXTURE_PACK, skills: [] })).toEqual([
      'rocks exist but there is no "mining" skill',
    ]);
  });

  it('lookups throw on unknown ids (a content bug, not a fallback)', () => {
    expect(() => fixtureContent.rock('nope')).toThrow(/unknown rock/);
    expect(() => fixtureContent.item('nope')).toThrow(/unknown item/);
    expect(fixtureContent.hasRock('sure-rock')).toBe(true);
    expect(fixtureContent.hasItem('nope')).toBe(false);
  });
});
