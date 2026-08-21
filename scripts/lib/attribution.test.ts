import { describe, expect, it } from 'vitest';

import { generateAttribution } from './attribution.ts';

const source = { repo: 'https://example.com/icons.git', commit: 'a'.repeat(40) };
const lorc = {
  author: 'lorc',
  authorName: 'Lorc',
  authorUrl: 'http://lorc.example',
  license: 'CC-BY-3.0' as const,
};
const zero = { author: 'zeromancer', authorName: 'Zeromancer', license: 'CC0-1.0' as const };

describe('generateAttribution', () => {
  it('emits one sorted line per author with the required wording', () => {
    const md = generateAttribution({ icons: [zero, lorc, lorc], source });
    const lines = md.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toEqual([
      '- Icons made by Lorc. Available on https://game-icons.net ([http://lorc.example](http://lorc.example)) — 2 icons',
      '- Icons made by Zeromancer. Available on https://game-icons.net — CC0 — 1 icon',
    ]);
    expect(md).toContain(`at commit \`${source.commit}\``);
    expect(md).toContain('GENERATED');
  });

  it('is deterministic regardless of input order', () => {
    const a = generateAttribution({ icons: [lorc, zero], source });
    const b = generateAttribution({ icons: [zero, lorc], source });
    expect(a).toBe(b);
  });

  it('handles an empty subset', () => {
    expect(generateAttribution({ icons: [], source })).toContain(
      '_No icons are currently shipped._',
    );
  });
});
