/**
 * Resolves an upstream directory slug (e.g. "john-colburn") to its attribution entry.
 *
 * Most directories match the license.txt display name once both are reduced to lowercase
 * alphanumerics ("HeavenlyDog" ↔ "heavenly-dog"). The rest are pinned in OVERRIDES. A directory
 * that matches nothing is a hard error — we would rather fail the build than ship an icon we
 * cannot attribute.
 */

import type { LicenseAuthor } from './license-parse.ts';

/** Directories that are not game icons and are skipped entirely. */
export const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  // Site UI badges committed by the maintainer; no author entry in license.txt and not
  // illustrative icons.
  'badges',
]);

/** Directory slug → license.txt display name, for dirs that don't match by normalisation. */
export const OVERRIDES: Readonly<Record<string, LicenseAuthor>> = {
  lucasms: { name: 'Lucas', license: 'CC-BY-3.0' },
  // Two collaborative icons committed by the maintainer with no single author.
  'various-artists': { name: 'Various artists', url: 'https://game-icons.net', license: 'CC-BY-3.0' },
};

export function normaliseKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function resolveAuthor(dir: string, authors: readonly LicenseAuthor[]): LicenseAuthor {
  const override = OVERRIDES[dir];
  if (override) return override;
  const key = normaliseKey(dir);
  const matches = authors.filter((a) => normaliseKey(a.name) === key);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new Error(`author dir "${dir}" matches multiple license.txt entries`);
  throw new Error(`author dir "${dir}" has no entry in license.txt and no override`);
}
