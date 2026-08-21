import { describe, expect, it } from 'vitest';

import { IconRegistry, icons } from './registry.ts';

describe('IconRegistry', () => {
  it('validates its input', () => {
    expect(() => new IconRegistry({ version: 2 })).toThrow();
    expect(
      () => new IconRegistry({ version: 1, source: { repo: 'r', commit: 'x' }, icons: [] }),
    ).toThrow();
  });

  it('exposes shipped icons and throws on unknown ids', () => {
    expect(icons.size).toBeGreaterThan(0);
    expect(icons.has('lorc/broadsword')).toBe(true);
    expect(icons.get('lorc/broadsword').d.startsWith('M')).toBe(true);
    expect(() => icons.get('lorc/not-a-real-icon')).toThrow(/not in the shipped icon set/);
  });
});
