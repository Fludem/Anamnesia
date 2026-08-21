import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import shipped from '../src/assets/icons.shipped.json';
import { IconIndexSchema } from '../src/icons/types.ts';
import { generateAttribution } from './lib/attribution.ts';

describe('ATTRIBUTION.md', () => {
  it('matches the committed shipped subset (run `npm run icons:ship` if this fails)', () => {
    const index = IconIndexSchema.parse(shipped);
    const committed = readFileSync(resolve(import.meta.dirname, '../ATTRIBUTION.md'), 'utf8');
    expect(committed).toBe(generateAttribution({ icons: index.icons, source: index.source }));
  });
});
