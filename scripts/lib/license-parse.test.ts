import { describe, expect, it } from 'vitest';

import { OVERRIDES, resolveAuthor } from './authors.ts';
import { parseLicenseFile } from './license-parse.ts';

const SAMPLE = `Icons provided under the Creative Commons 3.0 BY or CC0 if mentioned below.

Each sub-folders in this archive correspond to a different contributor :

- Lorc, http://lorcblog.blogspot.com
- John Colburn, http://ninmunanmu.com
- PriorBlue
- Viscious Speed, http://viscious-speed.deviantart.com - CC0
- Zeromancer - CC0
- HeavenlyDog, http://www.gnomosygoblins.blogspot.com
- Lucas
- Andy Meneely, http://www.se.rit.edu/~andy/
`;

describe('parseLicenseFile', () => {
  it('parses name, url, and CC0 marker', () => {
    expect(parseLicenseFile(SAMPLE)).toEqual([
      { name: 'Lorc', url: 'http://lorcblog.blogspot.com', license: 'CC-BY-3.0' },
      { name: 'John Colburn', url: 'http://ninmunanmu.com', license: 'CC-BY-3.0' },
      { name: 'PriorBlue', license: 'CC-BY-3.0' },
      { name: 'Viscious Speed', url: 'http://viscious-speed.deviantart.com', license: 'CC0-1.0' },
      { name: 'Zeromancer', license: 'CC0-1.0' },
      { name: 'HeavenlyDog', url: 'http://www.gnomosygoblins.blogspot.com', license: 'CC-BY-3.0' },
      { name: 'Lucas', license: 'CC-BY-3.0' },
      { name: 'Andy Meneely', url: 'http://www.se.rit.edu/~andy/', license: 'CC-BY-3.0' },
    ]);
  });

  it('throws on an unparseable author line', () => {
    expect(() => parseLicenseFile('- Name, http://a b')).toThrow(/cannot parse/);
  });
});

describe('resolveAuthor', () => {
  const authors = parseLicenseFile(SAMPLE);

  it('matches directory slugs to display names case- and dash-insensitively', () => {
    expect(resolveAuthor('lorc', authors).name).toBe('Lorc');
    expect(resolveAuthor('john-colburn', authors).name).toBe('John Colburn');
    expect(resolveAuthor('heavenly-dog', authors).name).toBe('HeavenlyDog');
    expect(resolveAuthor('andymeneely', authors).name).toBe('Andy Meneely');
    expect(resolveAuthor('viscious-speed', authors).license).toBe('CC0-1.0');
  });

  it('uses overrides before name matching', () => {
    expect(resolveAuthor('lucasms', authors)).toBe(OVERRIDES['lucasms']);
    expect(resolveAuthor('various-artists', authors).name).toBe('Various artists');
  });

  it('fails loudly on an unattributable directory', () => {
    expect(() => resolveAuthor('badges', authors)).toThrow(/no entry in license.txt/);
  });
});
