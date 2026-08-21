import { describe, expect, it } from 'vitest';

import { searchIcons, tokenize, type SearchableIcon } from './search.ts';

const mk = (
  id: string,
  tags: string[] = [],
  license: 'CC-BY-3.0' | 'CC0-1.0' = 'CC-BY-3.0',
): SearchableIcon => {
  const [author, slug] = id.split('/') as [string, string];
  return {
    id,
    slug,
    author,
    authorName: author[0]!.toUpperCase() + author.slice(1),
    tags,
    license,
  };
};

const icons = [
  mk('lorc/broadsword', ['weapon']),
  mk('lorc/longsword', ['weapon', 'sword']),
  mk('lorc/sword-brandish'),
  mk('lorc/broad-dagger'),
  mk('delapouite/swordman'),
  mk('sbed/shield'),
  mk('zeromancer/orb', [], 'CC0-1.0'),
];

describe('tokenize', () => {
  it('splits slugs on dashes', () => {
    expect(tokenize('broad-sword')).toEqual(['broad', 'sword']);
    expect(tokenize('sword')).toEqual(['sword']);
  });
});

describe('searchIcons', () => {
  it('returns everything in index order for an empty query', () => {
    expect(searchIcons(icons, { query: '' }).map((i) => i.id)).toEqual(icons.map((i) => i.id));
  });

  it('ranks exact token > prefix > tag > substring', () => {
    expect(searchIcons(icons, { query: 'sword' }).map((i) => i.id)).toEqual([
      'lorc/sword-brandish', // exact token
      'delapouite/swordman', // token prefix
      'lorc/longsword', // curated tag
      'lorc/broadsword', // substring of a slug token
    ]);
  });

  it('requires every query token to match', () => {
    expect(searchIcons(icons, { query: 'broad dagger' }).map((i) => i.id)).toEqual([
      'lorc/broad-dagger',
    ]);
    expect(searchIcons(icons, { query: 'broad shield' })).toEqual([]);
  });

  it('matches author names and filters by author and licence', () => {
    expect(searchIcons(icons, { query: 'sbed' }).map((i) => i.id)).toEqual(['sbed/shield']);
    expect(searchIcons(icons, { query: '', author: 'lorc' })).toHaveLength(4);
    expect(searchIcons(icons, { query: '', license: 'CC0-1.0' }).map((i) => i.id)).toEqual([
      'zeromancer/orb',
    ]);
  });
});
