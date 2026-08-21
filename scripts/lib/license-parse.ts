/**
 * Parses upstream `license.txt`, which is the only attribution data in the game-icons repo.
 * Lines look like:
 *   - Lorc, http://lorcblog.blogspot.com
 *   - PriorBlue
 *   - Viscious Speed, http://viscious-speed.deviantart.com - CC0
 *   - Zeromancer - CC0
 */

import type { License } from '../../src/icons/types.ts';

export type LicenseAuthor = {
  name: string;
  url?: string;
  license: License;
};

const LINE = /^- (.+?)(?:, (\S+?))?( - CC0)?$/;

export function parseLicenseFile(text: string): LicenseAuthor[] {
  const authors: LicenseAuthor[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('- ')) continue;
    const m = LINE.exec(line);
    if (!m) throw new Error(`license.txt: cannot parse line "${line}"`);
    const [, name, url, cc0] = m;
    const entry: LicenseAuthor = { name: name!.trim(), license: cc0 ? 'CC0-1.0' : 'CC-BY-3.0' };
    if (url) entry.url = url;
    authors.push(entry);
  }
  return authors;
}
