/** Keeps src/ui/theme/tokens.css in step with theme.ts, and the theme honest to the design rules. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { content } from '../src/content/index.ts';
import { color, rarity, rgb, theme } from '../src/ui/theme/theme.ts';

const css = readFileSync(resolve(import.meta.dirname, '../src/ui/theme/tokens.css'), 'utf8');

function collectStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (typeof v === 'object' && v !== null)
    Object.values(v).forEach((x) => collectStrings(x, out));
  return out;
}

/** theme.ts writes `rgba(1,2,3,.5)`; prettier formats the CSS as `rgba(1, 2, 3, 0.5)`. */
const cssForm = (s: string) => s.replace(/,(?=\S)/g, ', ').replace(/(^|[\s,(])\.(\d)/g, '$10.$2');

describe('theme tokens', () => {
  it('every colour in theme.ts appears in tokens.css', () => {
    const missing = collectStrings({ color, rgb, rarity })
      .map(cssForm)
      .filter((s) => !css.includes(s));
    expect(missing).toEqual([]);
  });

  it('no pure black or pure white anywhere', () => {
    const all = collectStrings(theme);
    expect(all.filter((s) => /#000000|#ffffff|#fff\b|#000\b/i.test(s))).toEqual([]);
  });

  it('rarity treatments exist for every non-common rarity the content ships', () => {
    for (const r of content.rarities) {
      if (r.rank === 0) continue;
      expect(rarity[r.id], `rarity "${r.id}" has no treatment`).toBeDefined();
    }
  });

  it('material palettes in content are distinct', () => {
    const seen = new Map<string, string>();
    for (const m of content.materials) {
      const key = `${m.palette.highlight}${m.palette.primary}${m.palette.shadow}`;
      expect(seen.get(key), `"${m.id}" duplicates "${seen.get(key) ?? ''}"`).toBeUndefined();
      seen.set(key, m.id);
    }
  });
});
