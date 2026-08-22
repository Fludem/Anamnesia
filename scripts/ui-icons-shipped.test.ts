import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { icons } from '../src/icons/registry.ts';

/**
 * Every `author/slug` the UI names in source must be in the shipped set, which only knows
 * about content references and content/icon-manifest.json. A missing one throws at render
 * (the onboarding's hourglass did, once), so this catches it at test time instead.
 */
const AUTHORS = new Set([
  'lorc',
  'delapouite',
  'sbed',
  'skoll',
  'caro-asercion',
  'faithtoken',
  'willdabeast',
  'darkzaitzev',
  'cathelineau',
  'carl-olsen',
  'andymeneely',
  'badges',
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(tsx?|css)$/.test(name) && !name.endsWith('.test.ts') ? [p] : [];
  });
}

describe('ui icon references', () => {
  it('are all in the shipped icon set', () => {
    const refs = new Set<string>();
    for (const file of walk(join(import.meta.dirname, '..', 'src', 'ui'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/['"]([a-z0-9-]+\/[a-z0-9-]+)['"]/g)) {
        const id = m[1]!;
        // Skip paths and the like: an icon id has exactly one slash and a known author.
        if (AUTHORS.has(id.split('/')[0]!)) refs.add(id);
      }
    }
    expect(refs.size).toBeGreaterThan(5);
    for (const id of refs) expect(() => icons.get(id), id).not.toThrow();
  });
});
